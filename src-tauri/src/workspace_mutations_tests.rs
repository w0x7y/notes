use super::Service;
use crate::model::Session;
use crate::workspace_mutations::MutationPause;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{mpsc, Arc};
use std::time::Duration;

fn pause(
    service: &Service,
    stage: &'static str,
    path: &Path,
) -> (mpsc::Receiver<()>, mpsc::Sender<()>) {
    let (entered_tx, entered) = mpsc::channel();
    let (resume, resume_rx) = mpsc::channel();
    *service.mutations.hooks.pause.lock().unwrap() = Some(MutationPause {
        stage,
        path: path.into(),
        entered: entered_tx,
        resume: resume_rx,
    });
    (entered, resume)
}

fn observe_attempts(service: &Service) -> mpsc::Receiver<()> {
    let (tx, rx) = mpsc::channel();
    *service.mutations.hooks.attempted.lock().unwrap() = Some(tx);
    rx
}

fn setup() -> (tempfile::TempDir, tempfile::TempDir, Arc<Service>, String) {
    let config = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let service = Arc::new(Service::new(config.path().into()).unwrap());
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    (config, root, service, id)
}

#[test]
fn a_save_waits_for_the_admitted_save_before_checking_its_revision() {
    let (_config, root, service, id) = setup();
    fs::write(root.path().join("a.md"), "# Original").unwrap();
    let original = service.read_note(&id, "a.md").unwrap();
    let (entered, resume) = pause(&service, "before_write", &root.path().join("a.md"));
    let first_service = service.clone();
    let first_id = id.clone();
    let first_revision = original.revision.clone();
    let first = std::thread::spawn(move || {
        first_service.save_note(&first_id, "a.md", "# First", &first_revision)
    });
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    let attempts = observe_attempts(&service);
    let second_service = service.clone();
    let second_id = id.clone();
    let second = std::thread::spawn(move || {
        second_service.save_note(&second_id, "a.md", "# Second", &original.revision)
    });
    attempts.recv_timeout(Duration::from_secs(2)).unwrap();
    resume.send(()).unwrap();
    let saved = first.join().unwrap().unwrap();
    let rejected = second.join().unwrap().unwrap_err();
    assert!(rejected.contains("changed externally"));
    let disk = service.read_note(&id, "a.md").unwrap();
    assert_eq!(disk.content, "# First");
    assert_eq!(disk.revision, saved.revision);
}

#[test]
fn automatic_rename_commits_metadata_to_latest_settings_after_a_paused_write() {
    let (config, root, service, id) = setup();
    let note = service.create_note(&id, "").unwrap();
    fs::write(root.path().join("other.md"), "# Other").unwrap();
    let (entered, resume) = pause(&service, "before_write", &root.path().join(&note.path));
    let writer_service = service.clone();
    let writer_id = id.clone();
    let writer = std::thread::spawn(move || {
        writer_service.save_note(&writer_id, &note.path, "# Renamed", &note.revision)
    });
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    let updater_service = service.clone();
    let updater_id = id.clone();
    let (done_tx, done) = mpsc::channel();
    let updater = std::thread::spawn(move || {
        let mut preferences = updater_service.load_settings().unwrap().preferences;
        preferences.font_size = 21;
        updater_service.save_preferences(preferences).unwrap();
        updater_service
            .save_sessions(
                HashMap::from([(
                    updater_id.clone(),
                    Session {
                        tabs: vec!["Untitled.md".into(), "other.md".into()],
                        primary: Some("Untitled.md".into()),
                        secondary: Some("other.md".into()),
                        split: true,
                    },
                )]),
                Some(updater_id.clone()),
                false,
            )
            .unwrap();
        updater_service
            .update_workspace(&updater_id, "Updated", "#123456", "folder")
            .unwrap();
        let roots = updater_service.registered_roots().unwrap();
        let scan = updater_service.scan_workspace(&updater_id).unwrap();
        done_tx.send((roots.0, scan.entries.len())).unwrap();
    });
    let progress = done.recv_timeout(Duration::from_secs(2));
    resume.send(()).unwrap();
    let result = writer.join().unwrap().unwrap();
    updater.join().unwrap();
    assert_eq!(progress.unwrap(), (1, 2));
    assert_eq!(result.path, "Renamed.md");
    assert!(result.warnings.is_empty());
    let latest = service.load_settings().unwrap();
    assert_eq!(latest.preferences.font_size, 21);
    assert!(!latest.toolbar_visible);
    assert_eq!(latest.workspaces[0].name, "Updated");
    assert_eq!(latest.workspaces[0].color, "#123456");
    assert_eq!(latest.sessions[&id].tabs, ["Renamed.md", "other.md"]);
    assert_eq!(latest.sessions[&id].primary.as_deref(), Some("Renamed.md"));
    assert_eq!(latest.sessions[&id].secondary.as_deref(), Some("other.md"));
    assert!(latest.sessions[&id].split);
    let restarted = Service::new(config.path().into()).unwrap();
    assert_eq!(
        serde_json::to_value(latest).unwrap(),
        serde_json::to_value(restarted.load_settings().unwrap()).unwrap()
    );
    assert!(restarted.read_note(&id, "Renamed.md").unwrap().auto_rename);
}

#[test]
fn registration_removal_waits_for_admitted_cross_workspace_rewrites() {
    let (_config, root, service, id) = setup();
    let other = tempfile::tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(other.path().join("ref.md"), "[[a]]").unwrap();
    let other_id = service
        .add_workspace(other.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let revision = service.read_note(&id, "a.md").unwrap().revision;
    let (entered, resume) = pause(&service, "before_rewrite", &root.path().join("a.md"));
    let writer_service = service.clone();
    let writer =
        std::thread::spawn(move || writer_service.rename_note(&id, "a.md", "b", &revision));
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    let attempts = observe_attempts(&service);
    let remover_service = service.clone();
    let remover_id = other_id.clone();
    let (removed_tx, removed) = mpsc::channel();
    let remover = std::thread::spawn(move || {
        removed_tx
            .send(remover_service.remove_workspace(&remover_id))
            .unwrap()
    });
    attempts.recv_timeout(Duration::from_secs(2)).unwrap();
    let premature = removed.recv_timeout(Duration::from_millis(100));
    let during = service.registered_roots().unwrap();
    resume.send(()).unwrap();
    let renamed = writer.join().unwrap().unwrap();
    remover.join().unwrap();
    assert!(matches!(premature, Err(mpsc::RecvTimeoutError::Timeout)));
    assert_eq!(during.0, 2);
    assert_eq!(during.1.len(), 2);
    let after = removed
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .unwrap();
    assert_eq!(after.workspaces.len(), 1);
    assert_eq!(service.registered_roots().unwrap().0, 3);
    assert_eq!(renamed.rewritten.len(), 1);
    assert_eq!(renamed.rewritten[0].workspace_id, other_id);
    assert_eq!(renamed.rewritten[0].content, "[[b]]");
    assert_eq!(
        fs::read_to_string(other.path().join("ref.md")).unwrap(),
        "[[b]]"
    );
}

#[test]
fn a_save_in_another_workspace_cannot_replace_an_admitted_incoming_rewrite() {
    let (_config, root, service, id) = setup();
    let other = tempfile::tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(other.path().join("ref.md"), "[[a]]").unwrap();
    let other_id = service
        .add_workspace(other.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let revision = service.read_note(&id, "a.md").unwrap().revision;
    let old_ref = service.read_note(&other_id, "ref.md").unwrap();
    let (entered, resume) = pause(&service, "before_rewrite", &root.path().join("a.md"));
    let writer_service = service.clone();
    let writer =
        std::thread::spawn(move || writer_service.rename_note(&id, "a.md", "b", &revision));
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    let attempts = observe_attempts(&service);
    let ref_service = service.clone();
    let ref_id = other_id.clone();
    let ref_writer = std::thread::spawn(move || {
        ref_service.save_note(&ref_id, "ref.md", "[[a]] edits", &old_ref.revision)
    });
    attempts.recv_timeout(Duration::from_secs(2)).unwrap();
    resume.send(()).unwrap();
    let renamed = writer.join().unwrap().unwrap();
    assert!(ref_writer
        .join()
        .unwrap()
        .unwrap_err()
        .contains("changed externally"));
    let disk = service.read_note(&other_id, "ref.md").unwrap();
    assert_eq!(disk.content, "[[b]]");
    assert_eq!(disk.revision, renamed.rewritten[0].revision);
}

#[test]
fn published_save_and_incoming_rewrite_keep_results_when_directory_sync_fails() {
    let (_config, root, service, id) = setup();
    let note = service.create_note(&id, "").unwrap();
    fs::write(root.path().join("ref.md"), "[[Untitled]]").unwrap();
    service
        .mutations
        .hooks
        .sync_failures
        .lock()
        .unwrap()
        .extend([root.path().join(&note.path), root.path().join("ref.md")]);
    let result = service
        .save_note(&id, &note.path, "# Published", &note.revision)
        .unwrap();
    assert_eq!(result.path, "Published.md");
    assert_eq!(result.content, "# Published");
    assert_eq!(result.warnings.len(), 2);
    assert!(result
        .warnings
        .iter()
        .all(|warning| warning.contains("durability")));
    assert_eq!(result.rewritten.len(), 1);
    assert_eq!(result.rewritten[0].path, "ref.md");
    assert_eq!(result.rewritten[0].content, "[[Published]]");
    let disk = service.read_note(&id, "Published.md").unwrap();
    assert_eq!(disk.revision, result.revision);
    let ref_disk = service.read_note(&id, "ref.md").unwrap();
    assert_eq!(ref_disk.revision, result.rewritten[0].revision);
    assert_eq!(ref_disk.content, result.rewritten[0].content);
    assert!(!root.path().join("Untitled.md").exists());
}

#[test]
fn committed_rename_warns_on_metadata_failure_and_preserves_latest_in_memory_settings() {
    let (config, root, service, id) = setup();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(root.path().join("ref.md"), "[[a]]").unwrap();
    let revision = service.read_note(&id, "a.md").unwrap().revision;
    let (entered, resume) = pause(&service, "before_rewrite", &root.path().join("a.md"));
    let writer_service = service.clone();
    let writer_id = id.clone();
    let writer =
        std::thread::spawn(move || writer_service.rename_note(&writer_id, "a.md", "b", &revision));
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    let mut preferences = service.load_settings().unwrap().preferences;
    preferences.font_size = 23;
    service.save_preferences(preferences).unwrap();
    service
        .save_sessions(
            HashMap::from([(
                id.clone(),
                Session {
                    tabs: vec!["a.md".into(), "ref.md".into()],
                    primary: Some("a.md".into()),
                    secondary: None,
                    split: false,
                },
            )]),
            Some(id.clone()),
            false,
        )
        .unwrap();
    fs::remove_file(config.path().join("notes.json")).unwrap();
    fs::create_dir(config.path().join("notes.json")).unwrap();
    resume.send(()).unwrap();
    let result = writer.join().unwrap().unwrap();
    assert_eq!(result.path, "b.md");
    assert_eq!(result.rewritten.len(), 1);
    assert_eq!(result.rewritten[0].content, "[[b]]");
    assert_eq!(result.warnings.len(), 1);
    assert!(result.warnings[0].contains("filename settings"));
    let latest = service.load_settings().unwrap();
    assert_eq!(latest.preferences.font_size, 23);
    assert!(!latest.toolbar_visible);
    assert_eq!(latest.sessions[&id].tabs, ["b.md", "ref.md"]);
    assert_eq!(latest.sessions[&id].primary.as_deref(), Some("b.md"));
    assert_eq!(
        service.read_note(&id, "b.md").unwrap().revision,
        result.revision
    );
}

#[test]
fn failed_new_note_metadata_persistence_removes_only_the_new_empty_note() {
    let (config, root, service, id) = setup();
    fs::write(root.path().join("existing.md"), "existing").unwrap();
    fs::remove_file(config.path().join("notes.json")).unwrap();
    fs::create_dir(config.path().join("notes.json")).unwrap();
    assert!(service.create_note(&id, "").is_err());
    assert!(!root.path().join("Untitled.md").exists());
    assert_eq!(
        fs::read_to_string(root.path().join("existing.md")).unwrap(),
        "existing"
    );
    assert_eq!(service.load_settings().unwrap().workspaces.len(), 1);
}

#[test]
fn file_and_registration_operations_wait_for_admitted_note_work() {
    use crate::model::Appearance;
    for operation in [
        "create_note",
        "create_folder",
        "rename_image",
        "move_folder",
        "drawing",
        "add_workspace",
        "capture",
        "appearance",
    ] {
        let (_config, root, service, id) = setup();
        let other = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a.md"), "# Original").unwrap();
        fs::write(root.path().join("image.png"), "image bytes").unwrap();
        fs::create_dir(root.path().join("Old")).unwrap();
        fs::write(root.path().join("Old/note.md"), "# Child").unwrap();
        let revision = service.read_note(&id, "a.md").unwrap().revision;
        let (entered, resume) = pause(&service, "before_write", &root.path().join("a.md"));
        let writer_service = service.clone();
        let writer_id = id.clone();
        let writer = std::thread::spawn(move || {
            writer_service.save_note(&writer_id, "a.md", "# Saved", &revision)
        });
        entered.recv_timeout(Duration::from_secs(2)).unwrap();
        let attempts = observe_attempts(&service);
        let follower_service = service.clone();
        let follower_id = id.clone();
        let other_path = other.path().to_path_buf();
        let (done_tx, done) = mpsc::channel();
        let follower = std::thread::spawn(move || {
            let result = match operation {
                "create_note" => follower_service.create_note(&follower_id, "").map(|_| ()),
                "create_folder" => follower_service.create_folder(&follower_id, "", "New"),
                "rename_image" => follower_service
                    .rename_image(&follower_id, "image.png", "renamed")
                    .map(|_| ()),
                "move_folder" => follower_service
                    .move_folder(&follower_id, "Old", "New")
                    .map(|_| ()),
                "drawing" => follower_service
                    .write_drawing_svg(&follower_id, "<svg xmlns=\"http://www.w3.org/2000/svg\"/>")
                    .map(|_| ()),
                "add_workspace" => follower_service
                    .add_workspace(other_path.to_str().unwrap())
                    .map(|_| ()),
                "capture" => follower_service
                    .ensure_capture_workspace(&other_path)
                    .map(|_| ()),
                "appearance" => follower_service
                    .set_entry_appearance(
                        &follower_id,
                        "a.md",
                        Appearance {
                            icon: Some("star".into()),
                            color: None,
                        },
                    )
                    .map(|_| ()),
                _ => unreachable!(),
            };
            done_tx.send(result).unwrap();
        });
        let attempted = attempts.recv_timeout(Duration::from_secs(2));
        let premature = done.recv_timeout(Duration::from_millis(100));
        resume.send(()).unwrap();
        writer.join().unwrap().unwrap();
        follower.join().unwrap();
        assert!(
            attempted.is_ok(),
            "{operation} must enter mutation ordering"
        );
        assert!(
            matches!(premature, Err(mpsc::RecvTimeoutError::Timeout)),
            "{operation} finished during admitted note work"
        );
        done.recv_timeout(Duration::from_secs(2)).unwrap().unwrap();
        assert_eq!(service.read_note(&id, "a.md").unwrap().content, "# Saved");
        match operation {
            "create_note" => assert!(root.path().join("Untitled.md").is_file()),
            "create_folder" => assert!(root.path().join("New").is_dir()),
            "rename_image" => assert_eq!(
                fs::read(root.path().join("renamed.png")).unwrap(),
                b"image bytes"
            ),
            "move_folder" => assert!(root.path().join("New/note.md").is_file()),
            "drawing" => assert_eq!(
                fs::read_dir(root.path().join("assets/drawings"))
                    .unwrap()
                    .count(),
                1
            ),
            "add_workspace" => assert_eq!(service.load_settings().unwrap().workspaces.len(), 2),
            "capture" => assert!(other.path().join("Quick Notes/Inbox").is_dir()),
            "appearance" => assert_eq!(
                service.load_settings().unwrap().appearances[&id]["a.md"]
                    .icon
                    .as_deref(),
                Some("star")
            ),
            _ => unreachable!(),
        }
    }
}

#[cfg(unix)]
#[test]
fn folder_enumeration_failure_rejects_before_move_and_preserves_links_and_metadata() {
    use crate::model::Appearance;
    use std::os::unix::fs::PermissionsExt;
    let (_config, root, service, id) = setup();
    let private = root.path().join("Old/private");
    fs::create_dir_all(&private).unwrap();
    fs::write(private.join("note.md"), "# Note").unwrap();
    fs::write(root.path().join("ref.md"), "[[Old/private/note]]").unwrap();
    let permissions = fs::metadata(&private).unwrap().permissions();
    fs::set_permissions(&private, fs::Permissions::from_mode(0o0)).unwrap();
    let enforced = fs::read_dir(&private).is_err();
    fs::set_permissions(&private, permissions.clone()).unwrap();
    if !enforced {
        eprintln!("Folder enumeration regression requires enforced Unix permissions");
        return;
    }
    service
        .save_sessions(
            HashMap::from([(
                id.clone(),
                Session {
                    tabs: vec!["Old/private/note.md".into()],
                    primary: Some("Old/private/note.md".into()),
                    secondary: None,
                    split: false,
                },
            )]),
            Some(id.clone()),
            true,
        )
        .unwrap();
    service
        .set_entry_appearance(
            &id,
            "Old",
            Appearance {
                icon: Some("star".into()),
                color: None,
            },
        )
        .unwrap();
    let before = serde_json::to_value(service.load_settings().unwrap()).unwrap();
    let (entered, resume) = pause(
        &service,
        "before_folder_enumeration",
        &root.path().join("Old"),
    );
    let mover_service = service.clone();
    let mover_id = id.clone();
    let worker = std::thread::spawn(move || mover_service.move_folder(&mover_id, "Old", "New"));
    let reached = entered.recv_timeout(Duration::from_secs(2));
    fs::set_permissions(&private, fs::Permissions::from_mode(0o0)).unwrap();
    let _ = resume.send(());
    let moved = worker.join();
    fs::set_permissions(&private, permissions).unwrap();
    assert!(reached.is_ok());
    assert!(moved
        .unwrap()
        .err()
        .unwrap()
        .contains("Cannot enumerate folder before moving"));
    assert!(root.path().join("Old/private/note.md").is_file());
    assert!(!root.path().join("New").exists());
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[Old/private/note]]"
    );
    assert_eq!(
        serde_json::to_value(service.load_settings().unwrap()).unwrap(),
        before
    );
    service.move_folder(&id, "Old", "New").unwrap();
    assert!(root.path().join("New/private/note.md").is_file());
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[/New/private/note]]"
    );
    assert_eq!(
        service.load_settings().unwrap().sessions[&id].tabs,
        ["New/private/note.md"]
    );
}
