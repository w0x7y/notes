use notes_lib::service::Service;
use std::fs;
use tempfile::tempdir;

fn service() -> (tempfile::TempDir, Service) {
    let config = tempdir().unwrap();
    let service = Service::new(config.path().to_path_buf()).unwrap();
    (config, service)
}

#[test]
fn malformed_settings_recover_with_an_exact_backup_and_restart_cleanly() {
    for original in [b"{truncated".as_slice(), &[0xff, 0xfe], b"[]"] {
        let config = tempdir().unwrap();
        let config_file = config.path().join("notes.json");
        fs::write(&config_file, original).unwrap();
        let service = Service::new(config.path().to_path_buf()).unwrap();
        let settings = service.load_settings().unwrap();
        assert!(settings.workspaces.is_empty());
        assert_eq!(
            settings.preferences,
            notes_lib::model::Preferences::default()
        );
        let backups: Vec<_> = fs::read_dir(config.path())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "bak"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read(&backups[0]).unwrap(), original);
        let repaired = fs::read(&config_file).unwrap();
        drop(service);
        Service::new(config.path().to_path_buf()).unwrap();
        assert_eq!(fs::read(&config_file).unwrap(), repaired);
        assert_eq!(fs::read_dir(config.path()).unwrap().count(), 2);
    }
}

#[test]
fn settings_recovery_rejects_nonregular_configs_without_replacing_them() {
    let config = tempdir().unwrap();
    let path = config.path().join("notes.json");
    fs::create_dir(&path).unwrap();
    assert!(Service::new(config.path().to_path_buf()).is_err());
    assert!(path.is_dir());
    assert_eq!(fs::read_dir(config.path()).unwrap().count(), 1);
    #[cfg(unix)]
    {
        fs::remove_dir(&path).unwrap();
        let original = config.path().join("original.json");
        fs::write(&original, "{broken").unwrap();
        std::os::unix::fs::symlink(&original, &path).unwrap();
        assert!(Service::new(config.path().to_path_buf()).is_err());
        assert_eq!(fs::read_to_string(&original).unwrap(), "{broken");
        assert_eq!(fs::read_dir(config.path()).unwrap().count(), 2);
        fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink("missing.json", &path).unwrap();
        assert!(Service::new(config.path().to_path_buf()).is_err());
        assert!(fs::symlink_metadata(&path)
            .unwrap()
            .file_type()
            .is_symlink());
    }
}

#[test]
fn invalid_stored_preferences_recover_without_losing_workspace_metadata() {
    for invalid in [
        serde_json::json!({"fontSize":99}),
        serde_json::json!({"theme":"unknown"}),
        serde_json::json!({"fontSize":"broken"}),
        serde_json::Value::Null,
    ] {
        let (config, service) = service();
        let root = tempdir().unwrap();
        let id = service
            .add_workspace(root.path().to_str().unwrap())
            .unwrap()
            .workspace
            .id;
        let note = service.create_note(&id, "").unwrap();
        service
            .set_entry_appearance(
                &id,
                &note.path,
                notes_lib::model::Appearance {
                    icon: Some("book-open".into()),
                    color: Some("#abcdef".into()),
                },
            )
            .unwrap();
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(config.path().join("notes.json")).unwrap()).unwrap();
        value["toolbarVisible"] = serde_json::json!(false);
        value["sessions"] = serde_json::json!({id.clone(): {
            "tabs":[note.path], "primary":note.path,"secondary":null,"split":false
        }});
        value["preferences"] = invalid;
        let original = serde_json::to_vec(&value).unwrap();
        fs::write(config.path().join("notes.json"), &original).unwrap();
        drop(service);
        let recovered = Service::new(config.path().to_path_buf()).unwrap();
        assert!(recovered.read_note(&id, &note.path).unwrap().auto_rename);
        assert_eq!(
            recovered.load_settings().unwrap().preferences,
            notes_lib::model::Preferences::default()
        );
        let mut saved: serde_json::Value =
            serde_json::from_slice(&fs::read(config.path().join("notes.json")).unwrap()).unwrap();
        saved.as_object_mut().unwrap().remove("preferences");
        value.as_object_mut().unwrap().remove("preferences");
        assert_eq!(saved, value);
        let backup = fs::read_dir(config.path())
            .unwrap()
            .map(|e| e.unwrap().path())
            .find(|p| p.extension().is_some_and(|ext| ext == "bak"))
            .unwrap();
        assert_eq!(fs::read(backup).unwrap(), original);
    }
}

#[test]
fn failed_workspace_and_session_persistence_preserves_all_in_memory_settings() {
    let (config, service) = service();
    let root = tempdir().unwrap();
    let other = tempdir().unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    let before = serde_json::to_value(service.load_settings().unwrap()).unwrap();
    fs::remove_file(config.path().join("notes.json")).unwrap();
    fs::create_dir(config.path().join("notes.json")).unwrap();
    assert!(service
        .add_workspace(other.path().to_str().unwrap())
        .is_err());
    assert_eq!(
        serde_json::to_value(service.load_settings().unwrap()).unwrap(),
        before
    );
    assert!(service
        .update_workspace(&workspace.id, "Changed", "#abcdef", "folder")
        .is_err());
    assert_eq!(
        serde_json::to_value(service.load_settings().unwrap()).unwrap(),
        before
    );
    assert!(service
        .save_sessions(std::collections::HashMap::new(), None, false)
        .is_err());
    assert_eq!(
        serde_json::to_value(service.load_settings().unwrap()).unwrap(),
        before
    );
}

#[test]
fn workspace_appearance_rejects_invalid_colors_and_icons_without_persisting() {
    let (config, service) = service();
    let root = tempdir().unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    let before = fs::read(config.path().join("notes.json")).unwrap();
    for color in ["red", "#fff", "#gg1234", "#1234567", ""] {
        assert!(service
            .update_workspace(&workspace.id, "Valid", color, "book")
            .is_err());
    }
    for icon in [
        "",
        "Book",
        "book icon",
        "-book",
        "book-",
        "book--open",
        "../book",
    ] {
        assert!(service
            .update_workspace(&workspace.id, "Valid", "#abcdef", icon)
            .is_err());
    }
    assert_eq!(
        service.load_settings().unwrap().workspaces[0].name,
        workspace.name
    );
    assert_eq!(fs::read(config.path().join("notes.json")).unwrap(), before);
    assert_eq!(
        service
            .update_workspace(&workspace.id, " Valid ", "#ABCDef", "book-open")
            .unwrap()
            .name,
        "Valid"
    );
}

#[test]
fn note_size_limits_reject_reads_and_saves_but_keep_scan_entries() {
    const LIMIT: u64 = 20 * 1024 * 1024;
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("small.md"), "# Safe\n").unwrap();
    let oversized = fs::File::create(root.path().join("large.md")).unwrap();
    oversized.set_len(LIMIT + 1).unwrap();
    let snapshot = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let entry = snapshot
        .entries
        .iter()
        .find(|entry| entry.path == "large.md")
        .unwrap();
    assert_eq!(entry.title, "large");
    assert!(entry.tags.is_empty());
    let id = &snapshot.workspace.id;
    assert!(service
        .read_note(id, "large.md")
        .unwrap_err()
        .contains("20 MiB"));
    let original = service.read_note(id, "small.md").unwrap();
    let too_large = "x".repeat((LIMIT + 1) as usize);
    assert!(service
        .save_note(id, "small.md", &too_large, &original.revision)
        .unwrap_err()
        .contains("20 MiB"));
    assert_eq!(
        fs::read_to_string(root.path().join("small.md")).unwrap(),
        original.content
    );
    assert_eq!(
        service.read_note(id, "small.md").unwrap().revision,
        original.revision
    );
    assert_eq!(service.scan_workspace(id).unwrap().entries.len(), 2);
}

#[test]
fn oversized_incoming_link_candidates_report_warnings_without_blocking_a_rename() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(root.path().join("ref.md"), "[[a]]").unwrap();
    let large = fs::File::create(root.path().join("large.md")).unwrap();
    large.set_len(20 * 1024 * 1024 + 1).unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let note = service.read_note(&id, "a.md").unwrap();
    let result = service
        .rename_note(&id, "a.md", "b.md", &note.revision)
        .unwrap();
    assert_eq!(result.note.path, "b.md");
    assert!(result
        .warnings
        .iter()
        .any(|warning| warning.contains("large.md") && warning.contains("20 MiB")));
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[b]]"
    );
    assert_eq!(
        fs::metadata(root.path().join("large.md")).unwrap().len(),
        20 * 1024 * 1024 + 1
    );
}

#[test]
fn automatic_filenames_keep_hebrew_with_a_utf8_byte_limit() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let title = "שלום".repeat(60);
    let content = format!("# {title}\n");
    for suffix in [".md", " 2.md"] {
        let note = service.create_note(&id, "").unwrap();
        let saved = service
            .save_note(&id, &note.path, &content, &note.revision)
            .unwrap();
        assert!(saved.warnings.is_empty(), "{:?}", saved.warnings);
        assert_eq!(
            saved.note.path,
            format!("{}{}", "שלום".repeat(22) + "של", suffix)
        );
        assert!(saved.note.path.len() <= 255);
        assert_eq!(
            service.read_note(&id, &saved.note.path).unwrap().content,
            content
        );
    }
}

#[test]
fn folder_and_file_moves_preserve_existing_destinations() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("source")).unwrap();
    fs::create_dir(root.path().join("destination")).unwrap();
    fs::write(root.path().join("source/a.md"), "# Source").unwrap();
    fs::write(root.path().join("existing.md"), "# Existing").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    assert!(service.move_folder(&id, "source", "destination").is_err());
    assert!(root.path().join("destination").is_dir());
    assert_eq!(
        fs::read_to_string(root.path().join("source/a.md")).unwrap(),
        "# Source"
    );
    let note = service.read_note(&id, "source/a.md").unwrap();
    assert!(service
        .rename_note(&id, &note.path, "existing.md", &note.revision)
        .is_err());
    assert_eq!(
        fs::read_to_string(root.path().join("existing.md")).unwrap(),
        "# Existing"
    );
    assert!(service.move_folder(&id, "source", "moved").is_ok());
    assert!(!root.path().join("source").exists());
    assert_eq!(
        fs::read_to_string(root.path().join("moved/a.md")).unwrap(),
        "# Source"
    );
}

#[test]
fn new_destinations_reject_every_hidden_or_excluded_directory_component() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let excluded = [
        ".hidden",
        "node_modules",
        "__pycache__",
        "visible/.nested",
        "visible/node_modules",
        "visible/__pycache__",
    ];
    for folder in excluded {
        fs::create_dir_all(root.path().join(folder)).unwrap();
    }
    fs::create_dir(root.path().join("source")).unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(root.path().join("image.png"), "image").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let note = service.read_note(&id, "a.md").unwrap();
    for folder in excluded {
        assert!(service.create_note(&id, folder).is_err());
        assert!(service.create_folder(&id, folder, "child").is_err());
        assert!(service
            .rename_note(&id, "a.md", &format!("{folder}/moved.md"), &note.revision)
            .is_err());
        assert!(service
            .rename_image(&id, "image.png", &format!("{folder}/moved.png"))
            .is_err());
        assert!(service
            .move_folder(&id, "source", &format!("{folder}/moved"))
            .is_err());
        assert!(fs::read_dir(root.path().join(folder))
            .unwrap()
            .next()
            .is_none());
    }
    for name in [".new", "node_modules", "__pycache__"] {
        assert!(service.create_folder(&id, "visible", name).is_err());
    }
    assert_eq!(fs::read_to_string(root.path().join("a.md")).unwrap(), "# A");
    assert_eq!(
        fs::read_to_string(root.path().join("image.png")).unwrap(),
        "image"
    );
    assert!(root.path().join("source").is_dir());
    assert!(service.create_note(&id, "visible").is_ok());
    assert!(service
        .rename_note(&id, "a.md", "visible/moved.md", &note.revision)
        .is_ok());
    assert!(service
        .rename_image(&id, "image.png", "visible/moved.png")
        .is_ok());
    assert!(service.move_folder(&id, "source", "visible/moved").is_ok());
}

#[test]
fn scans_emit_aliases_and_complete_status_without_rewriting_yaml_source() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let content = "---\naliases: [Lecture, שיעור]\ntags: [course]\n---\n# Actual title\n";
    fs::write(root.path().join("a.md"), content).unwrap();
    let snapshot = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    assert!(!snapshot.incomplete);
    assert!(snapshot.warnings.is_empty());
    assert_eq!(snapshot.entries[0].aliases, vec!["Lecture", "שיעור"]);
    assert_eq!(snapshot.entries[0].tags, vec!["course"]);
    let refreshed = service.scan_workspace(&snapshot.workspace.id).unwrap();
    assert_eq!(refreshed.entries[0].aliases, snapshot.entries[0].aliases);
    assert_eq!(
        fs::read_to_string(root.path().join("a.md")).unwrap(),
        content
    );
}

#[test]
fn a_registered_root_replaced_by_a_file_still_returns_a_hard_scan_error() {
    let (_config, service) = service();
    let parent = tempdir().unwrap();
    let root = parent.path().join("root");
    fs::create_dir(&root).unwrap();
    let id = service
        .add_workspace(root.to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    fs::remove_dir(&root).unwrap();
    fs::write(&root, "file").unwrap();
    assert!(service.scan_workspace(&id).is_err());
}

#[test]
fn watcher_root_generations_advance_only_after_committed_registration_changes() {
    let (config, service) = service();
    let root = tempdir().unwrap();
    let other = tempdir().unwrap();
    assert_eq!(service.registered_roots().unwrap().0, 0);
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    let (generation, roots) = service.registered_roots().unwrap();
    assert_eq!(generation, 1);
    assert_eq!(roots.len(), 1);
    service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    assert_eq!(service.registered_roots().unwrap().0, 1);
    fs::remove_file(config.path().join("notes.json")).unwrap();
    fs::create_dir(config.path().join("notes.json")).unwrap();
    assert!(service
        .add_workspace(other.path().to_str().unwrap())
        .is_err());
    assert!(service.remove_workspace(&workspace.id).is_err());
    assert_eq!(service.registered_roots().unwrap().0, 1);
    fs::remove_dir(config.path().join("notes.json")).unwrap();
    service.remove_workspace(&workspace.id).unwrap();
    let (generation, roots) = service.registered_roots().unwrap();
    assert_eq!(generation, 2);
    assert!(roots.is_empty());
}

#[test]
fn metadata_limits_warn_on_warm_scans_but_keep_the_note_and_body_tags() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let source = format!(
        "---\nblob: &blob {}\naliases: [{}]\n---\n# Title\n#body",
        "x".repeat(1024),
        vec!["*blob"; 65].join(", ")
    );
    fs::write(root.path().join("bounded.md"), &source).unwrap();
    let initial = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    for snapshot in [
        initial,
        service
            .scan_workspace(&service.load_settings().unwrap().workspaces[0].id)
            .unwrap(),
    ] {
        assert!(!snapshot.incomplete);
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].title, "Title");
        assert_eq!(snapshot.entries[0].tags, ["body"]);
        assert!(snapshot.entries[0].aliases.is_empty());
        assert_eq!(snapshot.warnings.len(), 1);
        assert!(snapshot.warnings[0].contains("bounded.md: Frontmatter metadata ignored"));
        assert!(snapshot.warnings[0].contains("64 KiB of strings"));
        assert_eq!(
            service
                .read_note(&snapshot.workspace.id, "bounded.md")
                .unwrap()
                .content,
            source
        );
    }
    assert_eq!(
        fs::read_to_string(root.path().join("bounded.md")).unwrap(),
        source
    );
    fs::write(root.path().join("removed.md"), "# Removed").unwrap();
    let id = service.load_settings().unwrap().workspaces[0].id.clone();
    assert_eq!(service.scan_workspace(&id).unwrap().entries.len(), 2);
    fs::remove_file(root.path().join("removed.md")).unwrap();
    let after_removal = service.scan_workspace(&id).unwrap();
    assert!(!after_removal.incomplete);
    assert_eq!(after_removal.entries.len(), 1);
}

#[test]
fn folder_moves_reject_registered_workspace_overlap_before_changing_files_or_settings() {
    use notes_lib::model::Session;
    use std::collections::HashMap;
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir_all(root.path().join("Shared/Child")).unwrap();
    fs::create_dir(root.path().join("Ordinary")).unwrap();
    fs::write(root.path().join("Shared/Child/note.md"), "# Note").unwrap();
    fs::write(root.path().join("ref.md"), "[[Shared/Child/note]]").unwrap();
    let parent = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    let child = service
        .add_workspace(root.path().join("Shared").to_str().unwrap())
        .unwrap()
        .workspace;
    service
        .save_sessions(
            HashMap::from([(
                child.id.clone(),
                Session {
                    tabs: vec!["Child/note.md".into()],
                    primary: Some("Child/note.md".into()),
                    secondary: None,
                    split: false,
                },
            )]),
            Some(child.id.clone()),
            true,
        )
        .unwrap();
    let before = serde_json::to_value(service.load_settings().unwrap()).unwrap();
    for (id, source, destination) in [
        (&parent.id, "Shared", "Renamed"),
        (&child.id, "Child", "Renamed"),
    ] {
        let error = service.move_folder(id, source, destination).err().unwrap();
        assert!(error.contains("overlaps another open workspace"));
        assert_eq!(
            serde_json::to_value(service.load_settings().unwrap()).unwrap(),
            before
        );
        assert!(service.scan_workspace(&parent.id).is_ok());
        assert!(service.scan_workspace(&child.id).is_ok());
        assert_eq!(
            fs::read_to_string(root.path().join("ref.md")).unwrap(),
            "[[Shared/Child/note]]"
        );
        assert!(root.path().join("Shared/Child/note.md").is_file());
    }
    service
        .move_folder(&parent.id, "Ordinary", "Moved")
        .unwrap();
    assert!(root.path().join("Moved").is_dir());
}

// Run blocking-file probes in a child so a regression cannot hang the test suite.
#[cfg(unix)]
#[test]
fn special_files_do_not_block_native_reads_or_workspace_scans() {
    use std::os::unix::ffi::OsStrExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    const MODE: &str = "NOTES_SPECIAL_FILE_PROBE";
    const CONFIG: &str = "NOTES_SPECIAL_FILE_CONFIG";
    if let Ok(mode) = std::env::var(MODE) {
        let service = Service::new(std::env::var_os(CONFIG).unwrap().into()).unwrap();
        let id = service.load_settings().unwrap().workspaces[0].id.clone();
        assert_eq!(
            service.read_note(&id, "normal.md").unwrap().content,
            "# Normal"
        );
        let image = service.read_image(&id, "normal.svg").unwrap();
        assert_eq!(image.mime, "image/svg+xml");
        assert_eq!(image.data, "PHN2Zy8+");
        match mode.as_str() {
            "note" => assert!(service.read_note(&id, "blocked.md").is_err()),
            "image" => assert!(service.read_image(&id, "blocked.svg").is_err()),
            "scan" => {
                let scan = service.scan_workspace(&id).unwrap();
                assert!(scan.entries.iter().any(|entry| entry.path == "normal.md"));
                assert!(!scan
                    .entries
                    .iter()
                    .any(|entry| entry.path.starts_with("blocked.")));
            }
            _ => panic!("Unknown special-file probe"),
        }
        // A rejected read must release the service mutex for other IPC work.
        assert_eq!(service.load_settings().unwrap().workspaces.len(), 1);
        return;
    }

    let (config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("normal.md"), "# Normal").unwrap();
    fs::write(root.path().join("normal.svg"), "<svg/>").unwrap();
    service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    for name in ["blocked.md", "blocked.svg"] {
        let path = std::ffi::CString::new(root.path().join(name).as_os_str().as_bytes()).unwrap();
        // SAFETY: path is a NUL-terminated, owned string; mkfifo retains no pointer.
        assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
    }
    let mut failures = Vec::new();
    for mode in ["note", "image", "scan"] {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "special_files_do_not_block_native_reads_or_workspace_scans",
            ])
            .env(MODE, mode)
            .env(CONFIG, config.path())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                if !status.success() {
                    failures.push(format!("{mode}: failed"));
                }
                break;
            }
            if Instant::now() >= deadline {
                child.kill().unwrap();
                child.wait().unwrap();
                failures.push(format!("{mode}: blocked on a special file"));
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join(", "));
}

#[test]
fn image_reads_keep_the_size_limit_and_reject_directories() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("normal.png"), b"pixels").unwrap();
    fs::create_dir(root.path().join("folder.png")).unwrap();
    let large = fs::File::create(root.path().join("large.png")).unwrap();
    large.set_len(20 * 1024 * 1024 + 1).unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    assert_eq!(
        service.read_image(&id, "normal.png").unwrap().data,
        "cGl4ZWxz"
    );
    assert!(service.read_image(&id, "folder.png").is_err());
    assert!(service
        .read_image(&id, "large.png")
        .err()
        .unwrap()
        .contains("20 MB"));
}

#[test]
fn folder_move_returns_one_final_rewrite_for_all_referenced_targets() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("Old")).unwrap();
    fs::write(root.path().join("Old/a.md"), "# A").unwrap();
    fs::write(root.path().join("Old/b.md"), "# B").unwrap();
    fs::write(root.path().join("Old/picture.png"), b"pixels").unwrap();
    fs::write(
        root.path().join("Index.md"),
        "[[Old/a]] [B](Old/b.md#part) ![P](Old/picture.png) `[[Old/b]]`",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;

    let result = service.move_folder(&id, "Old", "New").unwrap();

    assert!(result.warnings.is_empty(), "{:?}", result.warnings);
    assert_eq!(result.rewritten.len(), 1);
    let rewritten = &result.rewritten[0];
    assert_eq!(rewritten.workspace_id, id);
    assert_eq!(rewritten.path, "Index.md");
    assert_eq!(
        rewritten.content,
        "[[/New/a]] [B](New/b.md#part) ![P](New/picture.png) `[[Old/b]]`"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("Index.md")).unwrap(),
        rewritten.content
    );
    assert_eq!(
        service.read_note(&id, "Index.md").unwrap().revision,
        rewritten.revision
    );
}

#[test]
fn folder_move_resolves_descendant_links_before_move_and_writes_final_relative_paths() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir_all(root.path().join("Old/Nested")).unwrap();
    fs::create_dir(root.path().join("Target")).unwrap();
    fs::write(root.path().join("Old/b.md"), "# B").unwrap();
    fs::write(root.path().join("Old/picture.png"), b"pixels").unwrap();
    fs::write(
        root.path().join("Old/Nested/a.md"),
        "[[../b]] [[/Old/b]] [B](/Old/b.md) [relative](../b.md) ![[../picture.png]] ![P](/Old/picture.png) ![relative](../picture.png)",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;

    let result = service.move_folder(&id, "Old", "Target/New").unwrap();

    let note = service.read_note(&id, "Target/New/Nested/a.md").unwrap();
    assert_eq!(
        note.content,
        "[[/Target/New/b]] [[/Target/New/b]] [B](/Target/New/b.md) [relative](../b.md) ![[/Target/New/picture.png]] ![P](/Target/New/picture.png) ![relative](../picture.png)"
    );
    assert_eq!(result.rewritten.len(), 1);
    assert_eq!(result.rewritten[0].path, note.path);
    assert_eq!(result.rewritten[0].content, note.content);
    assert_eq!(result.rewritten[0].revision, note.revision);
}

#[test]
fn folder_move_warns_once_for_unreadable_note_and_returns_other_final_rewrites() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("Old")).unwrap();
    fs::write(root.path().join("Old/a.md"), "# A").unwrap();
    fs::write(root.path().join("Old/b.md"), "# B").unwrap();
    fs::write(root.path().join("ref.md"), "[[Old/a]] [B](Old/b.md)").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    fs::write(root.path().join("broken.md"), [0xff, 0xfe]).unwrap();

    let result = service.move_folder(&id, "Old", "New").unwrap();

    assert_eq!(result.path, "New");
    assert_eq!(result.warnings.len(), 1);
    assert!(result.warnings[0].contains("Cannot read links in broken.md:"));
    assert_eq!(result.rewritten.len(), 1);
    let success = &result.rewritten[0];
    assert_eq!(success.workspace_id, id);
    assert_eq!(success.path, "ref.md");
    assert_eq!(success.content, "[[/New/a]] [B](New/b.md)");
    let persisted = service.read_note(&id, "ref.md").unwrap();
    assert_eq!(persisted.content, success.content);
    assert_eq!(persisted.revision, success.revision);
    assert_eq!(
        fs::read(root.path().join("broken.md")).unwrap(),
        [0xff, 0xfe]
    );
    assert!(root.path().join("New/a.md").exists());
    assert!(root.path().join("New/b.md").exists());
    assert!(!root.path().join("Old").exists());
}

#[test]
fn moving_folder_remaps_nested_files_metadata_and_links() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir_all(root.path().join("Old/Nested")).unwrap();
    fs::create_dir(root.path().join("Target")).unwrap();
    fs::write(root.path().join("Old/Nested/Topic.md"), "# Topic\n").unwrap();
    fs::write(root.path().join("Index.md"), "[[Old/Nested/Topic]]\n").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let result = service.move_folder(&id, "Old", "Target/Renamed").unwrap();
    assert_eq!(result.path, "Target/Renamed");
    assert!(root.path().join("Target/Renamed/Nested/Topic.md").exists());
    assert!(!root.path().join("Old").exists());
    assert!(fs::read_to_string(root.path().join("Index.md"))
        .unwrap()
        .contains("Target/Renamed/Nested/Topic"));
    assert!(service
        .move_folder(&id, "Target", "Target/Renamed/Inside")
        .is_err());
    assert!(service
        .move_folder(&id, "Target/Renamed", "Target")
        .is_err());
}

#[test]
fn drawing_svg_exports_are_immutable_bounded_and_path_safe() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect x="1" y="2" width="20" height="30" stroke="#61AFEF" stroke-width="2" fill="none"/><text x="2" y="50" font-family="sans-serif" font-size="24" fill="#ABB2BF" dominant-baseline="text-before-edge" direction="rtl" unicode-bidi="plaintext">שלום &lt;script&gt; &amp; &quot;hello&quot;</text></svg>"##;
    let path = service.write_drawing_svg(&id, svg).unwrap();
    assert!(path.starts_with("assets/drawings/"));
    assert_eq!(path.len(), "assets/drawings/".len() + 64 + 4);
    assert_eq!(fs::read_to_string(root.path().join(&path)).unwrap(), svg);
    assert_eq!(service.write_drawing_svg(&id, svg).unwrap(), path);
    let next = service
        .write_drawing_svg(&id, &svg.replace("100", "200"))
        .unwrap();
    assert_ne!(path, next);
    fs::write(root.path().join(&path), "externally edited").unwrap();
    assert!(service
        .write_drawing_svg(&id, svg)
        .unwrap_err()
        .contains("refusing to overwrite"));
    assert!(service
        .write_drawing_svg(&id, &" ".repeat(4_000_001))
        .is_err());
    for unsafe_svg in [
        "<svg><script>alert(1)</script></svg>",
        "<svg onload=\"alert(1)\"/>",
        "<svg><image href=\"https://example.com\"/></svg>",
        "<svg><path fill=\"url(https://example.com)\"/></svg>",
        "<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><svg><text>&x;</text></svg>",
        "<svg><text>&unknown;</text></svg>",
        "<svg><text></svg>",
        "<svg></svg><svg/>",
    ] {
        assert!(
            service.write_drawing_svg(&id, unsafe_svg).is_err(),
            "accepted {unsafe_svg}"
        );
    }
    let other = tempdir().unwrap();
    let outside = tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), other.path().join("assets")).unwrap();
    let other_id = service
        .add_workspace(other.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    assert!(service.write_drawing_svg(&other_id, svg).is_err());
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[test]
fn capture_workspace_is_reused_without_touching_existing_notes() {
    let (config, service) = service();
    let documents = tempdir().unwrap();
    let first = service.ensure_capture_workspace(documents.path()).unwrap();
    assert_eq!(first.workspace.name, "Quick Notes");
    assert!(documents.path().join("Quick Notes/Inbox").is_dir());
    assert!(documents.path().join("Quick Notes/Daily").is_dir());
    let note = service.create_note(&first.workspace.id, "Inbox").unwrap();
    let second = service.ensure_capture_workspace(documents.path()).unwrap();
    assert_eq!(first.workspace.id, second.workspace.id);
    assert!(second.entries.iter().any(|entry| entry.path == note.path));
    drop(service);
    let service = Service::new(config.path().to_path_buf()).unwrap();
    assert_eq!(
        service
            .ensure_capture_workspace(documents.path())
            .unwrap()
            .workspace
            .id,
        first.workspace.id
    );
    service.remove_workspace(&first.workspace.id).unwrap();
    assert!(service
        .ensure_capture_workspace(documents.path())
        .unwrap()
        .entries
        .iter()
        .any(|entry| entry.path == note.path));
}

#[test]
fn capture_workspace_rejects_symlinked_capture_folders() {
    let (_config, service) = service();
    let documents = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::create_dir(documents.path().join("Quick Notes")).unwrap();
    std::os::unix::fs::symlink(outside.path(), documents.path().join("Quick Notes/Inbox")).unwrap();
    assert!(service.ensure_capture_workspace(documents.path()).is_err());
    assert!(service.load_settings().unwrap().workspaces.is_empty());
}

#[test]
fn yaml_comments_never_become_note_titles_or_inline_tags() {
    use notes_lib::markdown::{first_h1, tags};
    for newline in ["\n", "\r\n"] {
        let content = [
            "---",
            "# keep this comment",
            "subject: '#metadata'",
            "status: todo",
            "---",
            "",
            "# Actual lecture title",
            "",
            "#lecture #עברית",
        ]
        .join(newline);
        assert_eq!(first_h1(&content).as_deref(), Some("Actual lecture title"));
        assert_eq!(tags(&content), ["lecture", "עברית"]);
        assert_eq!(
            first_h1(&format!("---{newline}---{newline}# Empty properties")).as_deref(),
            Some("Empty properties")
        );
    }
    assert_eq!(
        first_h1("---\n# metadata comment\nsubject: '#hidden'\n---"),
        None
    );
    assert!(tags("---\n#hidden\n---").is_empty());
    assert_eq!(
        first_h1("---\n# Unfinished delimiter").as_deref(),
        Some("Unfinished delimiter")
    );
    assert_eq!(
        first_h1("Introduction\n---\n# Markdown title\n---").as_deref(),
        Some("Markdown title")
    );
}

#[test]
fn autosave_and_scan_use_the_actual_heading_after_yaml_properties() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let note = service.create_note(&id, "").unwrap();
    let content = "---\n# keep this comment\nstatus: todo\nsubject: '#hidden'\n---\n\n# Linear algebra\n\n#lecture\n";
    let saved = service
        .save_note(&id, &note.path, content, &note.revision)
        .unwrap();
    assert_eq!(saved.path, "Linear algebra.md");
    assert_eq!(
        fs::read_to_string(root.path().join(&saved.path)).unwrap(),
        content
    );
    let snapshot = service.scan_workspace(&id).unwrap();
    let entry = snapshot
        .entries
        .iter()
        .find(|entry| entry.path == saved.path)
        .unwrap();
    assert_eq!(entry.title, "Linear algebra");
    assert_eq!(entry.tags, ["lecture"]);
}

#[test]
fn scan_includes_notes_images_folders_and_tags_outside_code() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("course")).unwrap();
    fs::create_dir(root.path().join(".git")).unwrap();
    fs::write(
        root.path().join("course/שלום.md"),
        "# שלום\n#lesson #עברית\n`#inline`\n```md\n#fenced\n```\n",
    )
    .unwrap();
    fs::write(root.path().join("picture.png"), b"png").unwrap();
    fs::write(root.path().join(".git/secret.md"), "#hidden").unwrap();
    let snapshot = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    assert!(snapshot
        .entries
        .iter()
        .any(|entry| entry.path == "course" && entry.kind == "folder"));
    let note = snapshot
        .entries
        .iter()
        .find(|entry| entry.path == "course/שלום.md")
        .unwrap();
    assert_eq!(note.tags, ["lesson", "עברית"]);
    assert!(snapshot
        .entries
        .iter()
        .any(|entry| entry.path == "picture.png" && entry.kind == "image"));
    assert!(!snapshot
        .entries
        .iter()
        .any(|entry| entry.path.contains("secret")));
}

#[test]
fn rejects_traversal_and_symlink_escape() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("secret.md"), "secret").unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    assert!(service.read_note(&workspace.id, "../secret.md").is_err());
    assert!(service
        .read_note(&workspace.id, "escape/secret.md")
        .is_err());
    assert!(service.create_note(&workspace.id, "escape").is_err());
    assert!(service
        .scan_workspace(&workspace.id)
        .unwrap()
        .entries
        .iter()
        .all(|entry| !entry.path.starts_with("escape")));
}

#[test]
fn revision_conflict_preserves_external_content() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "old").unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    let note = service.read_note(&workspace.id, "a.md").unwrap();
    fs::write(root.path().join("a.md"), "external").unwrap();
    let error = service
        .save_note(&workspace.id, "a.md", "mine", &note.revision)
        .unwrap_err();
    assert!(error.contains("external"));
    assert_eq!(
        fs::read_to_string(root.path().join("a.md")).unwrap(),
        "external"
    );
}

#[test]
fn new_note_uses_unique_name_and_tracks_title_until_manual_rename() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("Untitled.md"), "existing").unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    let created = service.create_note(&workspace.id, "").unwrap();
    assert_eq!(created.path, "Untitled 2.md");
    assert!(created.auto_rename);
    let saved = service
        .save_note(
            &workspace.id,
            &created.path,
            "# New / title\n",
            &created.revision,
        )
        .unwrap();
    assert_eq!(saved.path, "New - title.md");
    assert!(saved.auto_rename);
    let renamed = service
        .rename_note(&workspace.id, &saved.path, "My choice", &saved.revision)
        .unwrap();
    assert_eq!(renamed.path, "My choice.md");
    assert!(!renamed.auto_rename);
    let saved_again = service
        .save_note(
            &workspace.id,
            &renamed.path,
            "# Another title\n",
            &renamed.revision,
        )
        .unwrap();
    assert_eq!(saved_again.path, "My choice.md");
}

#[test]
fn rename_rewrites_resolvable_links_and_preserves_code() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "[[a]] [read](a.md) `[[a]]`\n```\n[[a]]\n```\n",
    )
    .unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    let note = service.read_note(&workspace.id, "a.md").unwrap();
    let result = service
        .rename_note(&workspace.id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(result.path, "b.md");
    assert_eq!(result.rewritten.len(), 1);
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[b]] [read](b.md) `[[a]]`\n```\n[[a]]\n```\n"
    );
}

#[test]
fn rename_does_not_resolve_links_through_unrelated_missing_directories() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(root.path().join("ref.md"), "[[missing/../a]] [read](a.md)").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let note = service.read_note(&id, "a.md").unwrap();

    service
        .rename_note(&id, "a.md", "b.md", &note.revision)
        .unwrap();

    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[missing/../a]] [read](b.md)"
    );
}

#[test]
fn overlapping_workspaces_do_not_make_one_target_basename_ambiguous() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("Sub")).unwrap();
    fs::write(root.path().join("Sub/a.md"), "# A").unwrap();
    fs::write(root.path().join("ref.md"), "[[a]]").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .add_workspace(root.path().join("Sub").to_str().unwrap())
        .unwrap();
    let note = service.read_note(&id, "Sub/a.md").unwrap();

    let result = service
        .rename_note(&id, "Sub/a.md", "Sub/b.md", &note.revision)
        .unwrap();

    assert_eq!(result.rewritten.len(), 1);
    assert_eq!(result.rewritten[0].content, "[[b]]");
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[b]]"
    );
}

#[test]
fn sessions_and_workspace_metadata_persist_outside_notes() {
    let (config, service) = service();
    let root = tempdir().unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    service
        .update_workspace(&workspace.id, "School", "#aabbcc", "book")
        .unwrap();
    let sessions = serde_json::json!({workspace.id.clone(): {"tabs": ["a.md"], "primary": "a.md", "secondary": null, "split": false}});
    service
        .save_sessions(
            serde_json::from_value(sessions).unwrap(),
            Some(workspace.id.clone()),
            false,
        )
        .unwrap();
    drop(service);
    let reloaded = Service::new(config.path().to_path_buf())
        .unwrap()
        .load_settings()
        .unwrap();
    assert_eq!(reloaded.workspaces[0].name, "School");
    assert!(!reloaded.toolbar_visible);
    assert!(reloaded.sessions.contains_key(&workspace.id));
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
}

#[test]
fn scan_keeps_hidden_notes_but_skips_hidden_directories() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join(".scratch.md"), "# Scratch").unwrap();
    fs::create_dir(root.path().join(".cache")).unwrap();
    fs::write(root.path().join(".cache/inside.md"), "# Hidden").unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    assert!(selected
        .entries
        .iter()
        .any(|entry| entry.path == ".scratch.md"));
    assert!(!selected
        .entries
        .iter()
        .any(|entry| entry.path.contains("inside.md")));
}

#[test]
fn fenced_code_with_other_marker_does_not_expose_tags_or_titles() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(
        root.path().join("x.md"),
        "~~~md\n# Fake title\n#hidden\n```\n#alsohidden\n~~~\n# Real title\n#visible\n",
    )
    .unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let note = selected
        .entries
        .iter()
        .find(|entry| entry.path == "x.md")
        .unwrap();
    assert_eq!(note.title, "Real title");
    assert_eq!(note.tags, ["visible"]);
}

#[test]
fn saving_existing_note_preserves_its_unix_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let path = root.path().join("private.md");
    fs::write(&path, "old").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let note = service
        .read_note(&selected.workspace.id, "private.md")
        .unwrap();
    service
        .save_note(&selected.workspace.id, "private.md", "new", &note.revision)
        .unwrap();
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o644
    );
}

#[test]
fn scan_rejects_a_registered_root_replaced_by_a_symlink() {
    let (_config, service) = service();
    let holder = tempdir().unwrap();
    let root = holder.path().join("notes");
    let outside = holder.path().join("outside");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("secret.md"), "secret").unwrap();
    let selected = service.add_workspace(root.to_str().unwrap()).unwrap();
    fs::rename(&root, holder.path().join("moved")).unwrap();
    std::os::unix::fs::symlink(&outside, &root).unwrap();
    assert!(service.scan_workspace(&selected.workspace.id).is_err());
}

#[test]
fn an_indented_markdown_h1_drives_the_new_note_filename() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let created = service.create_note(&selected.workspace.id, "").unwrap();
    let saved = service
        .save_note(
            &selected.workspace.id,
            &created.path,
            "  # Lecture notes\n",
            &created.revision,
        )
        .unwrap();
    assert_eq!(saved.path, "Lecture notes.md");
}

#[test]
fn rename_updates_unique_wiki_links_in_other_registered_workspaces() {
    let (_config, service) = service();
    let source = tempdir().unwrap();
    let other = tempdir().unwrap();
    fs::write(source.path().join("lesson.md"), "# Lesson").unwrap();
    fs::write(other.path().join("index.md"), "See [[lesson|class]].").unwrap();
    let source_id = service
        .add_workspace(source.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let other_id = service
        .add_workspace(other.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let note = service.read_note(&source_id, "lesson.md").unwrap();
    let renamed = service
        .rename_note(&source_id, "lesson.md", "topic", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(other.path().join("index.md")).unwrap(),
        "See [[topic|class]]."
    );
    assert!(renamed
        .rewritten
        .iter()
        .any(|item| item.workspace_id == other_id && item.path == "index.md"));
}

#[test]
fn rename_preserves_ambiguous_basename_links() {
    let (_config, service) = service();
    let source = tempdir().unwrap();
    let other = tempdir().unwrap();
    fs::write(source.path().join("lesson.md"), "# Lesson").unwrap();
    fs::write(other.path().join("lesson.md"), "# Other").unwrap();
    fs::write(other.path().join("index.md"), "[[lesson]]").unwrap();
    let source_id = service
        .add_workspace(source.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .add_workspace(other.path().to_str().unwrap())
        .unwrap();
    let note = service.read_note(&source_id, "lesson.md").unwrap();
    service
        .rename_note(&source_id, "lesson.md", "topic", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(other.path().join("index.md")).unwrap(),
        "[[lesson]]"
    );
}

#[test]
fn dangling_untitled_symlink_does_not_block_note_creation() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    std::os::unix::fs::symlink(
        root.path().join("missing.md"),
        root.path().join("Untitled.md"),
    )
    .unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let created = service.create_note(&selected.workspace.id, "").unwrap();
    assert_eq!(created.path, "Untitled 2.md");
    assert!(fs::symlink_metadata(root.path().join("Untitled.md"))
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn rename_percent_encodes_spaces_in_markdown_destinations() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(root.path().join("ref.md"), "[read](a.md)").unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let id = &selected.workspace.id;
    let note = service.read_note(id, "a.md").unwrap();
    let renamed = service
        .rename_note(id, "a.md", "Two words", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[read](Two%20words.md)"
    );
    service
        .rename_note(id, &renamed.path, "Three words", &renamed.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[read](Three%20words.md)"
    );
}

#[test]
fn rename_leaves_links_inside_double_backtick_code_spans() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "``[[a]] [read](a.md)`` and [[a]]",
    )
    .unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let id = &selected.workspace.id;
    let note = service.read_note(id, "a.md").unwrap();
    service
        .rename_note(id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "``[[a]] [read](a.md)`` and [[b]]"
    );
}

#[test]
fn unique_filename_lookup_reports_filesystem_errors() {
    let root = tempdir().unwrap();
    let not_a_folder = root.path().join("file");
    fs::write(&not_a_folder, "content").unwrap();
    assert!(notes_lib::pathing::unique_file(&not_a_folder, "Untitled", None).is_err());
}

#[test]
fn rename_returns_committed_path_and_warning_if_config_write_fails() {
    let (config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(root.path().join("ref.md"), "[[a]]").unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let id = &selected.workspace.id;
    let note = service.read_note(id, "a.md").unwrap();
    fs::remove_file(config.path().join("notes.json")).unwrap();
    fs::create_dir(config.path().join("notes.json")).unwrap();
    let result = service
        .rename_note(id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(result.path, "b.md");
    assert!(!result.warnings.is_empty());
    assert!(root.path().join("b.md").exists());
    assert!(!root.path().join("a.md").exists());
    assert_eq!(result.rewritten[0].content, "[[b]]");
}

#[test]
fn long_multibyte_titles_auto_rename_without_warnings_and_keep_revision() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let id = &selected.workspace.id;
    let created = service.create_note(id, "").unwrap();
    let content = format!("# {}\nbody", "界".repeat(180));
    let result = service
        .save_note(id, &created.path, &content, &created.revision)
        .unwrap();
    assert_eq!(result.path, format!("{}.md", "界".repeat(60)));
    assert_eq!(result.content, content);
    assert!(result.warnings.is_empty());
    assert_eq!(
        service.read_note(id, &result.path).unwrap().revision,
        result.revision
    );
}

#[test]
fn indented_code_does_not_contribute_tags_or_rewrite_links() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "    [[a]] #hidden\n[[a]] #visible\n",
    )
    .unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let entry = selected
        .entries
        .iter()
        .find(|item| item.path == "ref.md")
        .unwrap();
    assert_eq!(entry.tags, ["visible"]);
    let note = service.read_note(&selected.workspace.id, "a.md").unwrap();
    service
        .rename_note(&selected.workspace.id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "    [[a]] #hidden\n[[b]] #visible\n"
    );
}

#[test]
fn shorter_backtick_run_does_not_close_a_longer_fence() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    let body = "````md\n```\n[[a]] #hidden\n````\n[[a]] #visible\n";
    fs::write(root.path().join("ref.md"), body).unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let entry = selected
        .entries
        .iter()
        .find(|item| item.path == "ref.md")
        .unwrap();
    assert_eq!(entry.tags, ["visible"]);
    let note = service.read_note(&selected.workspace.id, "a.md").unwrap();
    service
        .rename_note(&selected.workspace.id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "````md\n```\n[[a]] #hidden\n````\n[[b]] #visible\n"
    );
}

#[test]
fn rename_qualifies_wiki_link_when_new_basename_is_ambiguous() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("folder")).unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(root.path().join("folder/b.md"), "# Other B").unwrap();
    fs::write(root.path().join("ref.md"), "[[a]]").unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let id = &selected.workspace.id;
    let note = service.read_note(id, "a.md").unwrap();
    let first = service
        .rename_note(id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[/b]]"
    );
    service
        .rename_note(id, &first.path, "c", &first.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[/c]]"
    );
}

#[test]
fn cross_workspace_rewrite_identifies_target_when_new_basename_collides() {
    let (_config, service) = service();
    let target = tempdir().unwrap();
    let other = tempdir().unwrap();
    fs::write(target.path().join("a.md"), "# A").unwrap();
    fs::write(other.path().join("b.md"), "# Existing B").unwrap();
    fs::write(other.path().join("ref.md"), "[[a]]").unwrap();
    let target_id = service
        .add_workspace(target.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .add_workspace(other.path().to_str().unwrap())
        .unwrap();
    let note = service.read_note(&target_id, "a.md").unwrap();
    let first = service
        .rename_note(&target_id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(other.path().join("ref.md")).unwrap(),
        format!("[[{target_id}:b]]")
    );
    service
        .rename_note(&target_id, &first.path, "c", &first.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(other.path().join("ref.md")).unwrap(),
        format!("[[{target_id}:c]]")
    );
}

#[test]
fn multiline_inline_code_does_not_contribute_tags_or_rewrite_links() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "`code\n[[a]] #hidden\n`\n[[a]] #visible\n",
    )
    .unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let entry = selected
        .entries
        .iter()
        .find(|item| item.path == "ref.md")
        .unwrap();
    assert_eq!(entry.tags, ["visible"]);
    let note = service.read_note(&selected.workspace.id, "a.md").unwrap();
    service
        .rename_note(&selected.workspace.id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "`code\n[[a]] #hidden\n`\n[[b]] #visible\n"
    );
}

#[test]
fn nested_blockquote_fence_does_not_contribute_tags_or_rewrite_links() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "> ````md\n> [[a]] #hidden\n> ```\n> [[a]] #stillhidden\n> ````\n[[a]] #visible\n",
    )
    .unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let entry = selected
        .entries
        .iter()
        .find(|item| item.path == "ref.md")
        .unwrap();
    assert_eq!(entry.tags, ["visible"]);
    let note = service.read_note(&selected.workspace.id, "a.md").unwrap();
    service
        .rename_note(&selected.workspace.id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "> ````md\n> [[a]] #hidden\n> ```\n> [[a]] #stillhidden\n> ````\n[[b]] #visible\n"
    );
}

#[test]
fn appearance_follows_note_renames_and_rejects_invalid_entries() {
    use notes_lib::model::Appearance;
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let note = service.create_note(&id, "").unwrap();
    let appearance = Appearance {
        icon: Some("file-heart".into()),
        color: Some("#A1b2C3".into()),
    };
    service
        .set_entry_appearance(&id, &note.path, appearance.clone())
        .unwrap();
    assert!(service
        .set_entry_appearance(&id, "../outside", appearance.clone())
        .is_err());
    assert!(service
        .set_entry_appearance(&id, "missing.md", appearance.clone())
        .is_err());
    let saved = service
        .save_note(&id, &note.path, "# Topic", &note.revision)
        .unwrap();
    assert_eq!(
        service.load_settings().unwrap().appearances[&id][&saved.path],
        appearance
    );
    let renamed = service
        .rename_note(&id, &saved.path, "Chosen", &saved.revision)
        .unwrap();
    let settings = service.load_settings().unwrap();
    assert_eq!(settings.appearances[&id][&renamed.path], appearance);
    assert!(!settings.appearances[&id].contains_key(&saved.path));
}

#[test]
fn removing_offline_workspace_only_changes_registration_metadata() {
    use notes_lib::model::Appearance;
    let (config, service) = service();
    let holder = tempdir().unwrap();
    let root = holder.path().join("notes");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("a.md"), "keep").unwrap();
    let id = service
        .add_workspace(root.to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .set_entry_appearance(
            &id,
            "a.md",
            Appearance {
                icon: None,
                color: Some("#123456".into()),
            },
        )
        .unwrap();
    let note = service.read_note(&id, "a.md").unwrap();
    service.save_sessions(serde_json::from_value(serde_json::json!({id.clone(): {"tabs": ["a.md"], "primary": "a.md", "secondary": null, "split": false}})).unwrap(), Some(id.clone()), true).unwrap();
    fs::rename(&root, holder.path().join("offline")).unwrap();
    let settings = service.remove_workspace(&id).unwrap();
    assert!(settings.workspaces.is_empty());
    assert!(settings.sessions.is_empty());
    assert!(settings.appearances.is_empty());
    assert!(settings.active_workspace_id.is_none());
    assert_eq!(
        fs::read_to_string(holder.path().join("offline/a.md")).unwrap(),
        "keep"
    );
    assert_eq!(service.load_settings().unwrap().workspaces.len(), 0);
    drop(service);
    let config_text = fs::read_to_string(config.path().join("notes.json")).unwrap();
    assert!(!config_text.contains(&id));
    assert!(!note.auto_rename);
}

#[test]
fn image_rename_preserves_extension_and_rewrites_resolvable_embeds() {
    use notes_lib::model::Appearance;
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("assets")).unwrap();
    fs::write(root.path().join("old.png"), b"pixels").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "![[old.png]] ![image](old.png) `![[old.png]]` ![[missing.png]]",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let appearance = Appearance {
        icon: Some("image".into()),
        color: None,
    };
    service
        .set_entry_appearance(&id, "old.png", appearance.clone())
        .unwrap();
    let result = service.rename_image(&id, "old.png", "assets/new").unwrap();
    assert_eq!(result.path, "assets/new.png");
    assert_eq!(
        fs::read(root.path().join("assets/new.png")).unwrap(),
        b"pixels"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "![[new.png]] ![image](assets/new.png) `![[old.png]]` ![[missing.png]]"
    );
    assert_eq!(result.rewritten.len(), 1);
    assert_eq!(
        service.load_settings().unwrap().appearances[&id][&result.path],
        appearance
    );
    assert!(service
        .rename_image(&id, &result.path, "../escape")
        .is_err());
    assert!(service
        .rename_image(&id, &result.path, "other.jpg")
        .is_err());
    fs::write(root.path().join("assets/existing.png"), b"existing").unwrap();
    assert!(service
        .rename_image(&id, &result.path, "assets/existing.png")
        .is_err());
    assert_eq!(
        fs::read(root.path().join("assets/existing.png")).unwrap(),
        b"existing"
    );
}

#[test]
fn image_rename_bare_destination_moves_nested_image_to_workspace_root() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("Lectures")).unwrap();
    fs::write(root.path().join("Lectures/image.svg"), b"<svg/>").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "![[/Lectures/image.svg]] ![figure](Lectures/image.svg)",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service.save_sessions(serde_json::from_value(serde_json::json!({id.clone(): {"tabs": ["Lectures/image.svg"], "primary": "Lectures/image.svg", "secondary": null, "split": false}})).unwrap(), Some(id.clone()), true).unwrap();
    let result = service
        .rename_image(&id, "Lectures/image.svg", "Renamed.svg")
        .unwrap();
    assert_eq!(result.path, "Renamed.svg");
    assert!(root.path().join("Renamed.svg").exists());
    assert!(!root.path().join("Lectures/image.svg").exists());
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "![[/Renamed.svg]] ![figure](Renamed.svg)"
    );
    let session = &service.load_settings().unwrap().sessions[&id];
    assert_eq!(session.tabs, ["Renamed.svg"]);
    assert_eq!(session.primary.as_deref(), Some("Renamed.svg"));
}

#[test]
fn image_rename_rewrites_embeds_without_changing_note_wiki_links() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("old.png"), b"pixels").unwrap();
    fs::write(root.path().join("old.png.md"), "# Note").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "[[old.png]] ![[old.png]] [note](old.png) ![image](old.png)",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service.rename_image(&id, "old.png", "new.png").unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[old.png]] ![[new.png]] [note](old.png) ![image](new.png)"
    );
}

#[test]
fn image_rename_rewrites_markdown_images_with_nested_and_code_alt_text() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("old.png"), b"pixels").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "![diagram [v1]](old.png) ![diagram `[v1]`](old.png)",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service.rename_image(&id, "old.png", "new.png").unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "![diagram [v1]](new.png) ![diagram `[v1]`](new.png)"
    );
}

#[test]
fn image_rename_rewrites_nested_image_destinations_without_offset_corruption() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("old.png"), b"pixels").unwrap();
    fs::write(root.path().join("ref.md"), "![![inner](old.png)](old.png)").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .rename_image(&id, "old.png", "renamed-long.png")
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "![![inner](renamed-long.png)](renamed-long.png)"
    );
}

#[test]
fn note_rename_keeps_image_syntax_untouched() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "![[a]] [[a]] ![image](a.md) [note](a.md)",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let note = service.read_note(&id, "a.md").unwrap();
    service
        .rename_note(&id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "![[a]] [[b]] ![image](a.md) [note](b.md)"
    );
}

#[test]
fn image_rename_rewrites_workspace_root_markdown_image_destination() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("Lectures")).unwrap();
    fs::write(root.path().join("old.png"), b"pixels").unwrap();
    fs::write(root.path().join("Lectures/ref.md"), "![figure](/old.png)").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service.rename_image(&id, "old.png", "new.png").unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("Lectures/ref.md")).unwrap(),
        "![figure](/new.png)"
    );
}

#[test]
fn bare_image_embed_rewrite_prefers_its_own_workspace() {
    let (_config, service) = service();
    let first = tempdir().unwrap();
    let second = tempdir().unwrap();
    for root in [&first, &second] {
        fs::write(root.path().join("old.png"), b"pixels").unwrap();
        fs::write(root.path().join("ref.md"), "![[old.png]]").unwrap();
    }
    let first_id = service
        .add_workspace(first.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .add_workspace(second.path().to_str().unwrap())
        .unwrap();
    service
        .rename_image(&first_id, "old.png", "new.png")
        .unwrap();
    assert_eq!(
        fs::read_to_string(first.path().join("ref.md")).unwrap(),
        "![[new.png]]"
    );
    assert_eq!(
        fs::read_to_string(second.path().join("ref.md")).unwrap(),
        "![[old.png]]"
    );
}

#[test]
fn image_rename_does_not_resolve_a_bare_embed_through_an_existing_directory() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("assets")).unwrap();
    fs::create_dir(root.path().join("old.png")).unwrap();
    fs::write(root.path().join("assets/old.png"), b"pixels").unwrap();
    fs::write(root.path().join("ref.md"), "![[old.png]]").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;

    let result = service
        .rename_image(&id, "assets/old.png", "assets/new.png")
        .unwrap();

    assert!(result.rewritten.is_empty());
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "![[old.png]]"
    );
}

#[test]
fn note_rename_bare_destination_moves_nested_note_to_workspace_root() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("Lectures")).unwrap();
    fs::write(root.path().join("Lectures/a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "[[/Lectures/a]] [read](Lectures/a.md)",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service.save_sessions(serde_json::from_value(serde_json::json!({id.clone(): {"tabs": ["Lectures/a.md"], "primary": "Lectures/a.md", "secondary": null, "split": false}})).unwrap(), Some(id.clone()), true).unwrap();
    let note = service.read_note(&id, "Lectures/a.md").unwrap();
    let result = service
        .rename_note(&id, "Lectures/a.md", "Renamed.md", &note.revision)
        .unwrap();
    assert_eq!(result.path, "Renamed.md");
    assert!(root.path().join("Renamed.md").exists());
    assert!(!root.path().join("Lectures/a.md").exists());
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[/Renamed]] [read](Renamed.md)"
    );
    let session = &service.load_settings().unwrap().sessions[&id];
    assert_eq!(session.tabs, ["Renamed.md"]);
    assert_eq!(session.primary.as_deref(), Some("Renamed.md"));
}

#[derive(Default)]
struct FakeTrash(std::sync::Mutex<Vec<std::path::PathBuf>>);
impl notes_lib::service::Trash for FakeTrash {
    fn delete(&self, path: &std::path::Path) -> Result<(), String> {
        self.0.lock().unwrap().push(path.to_path_buf());
        if path.is_dir() {
            fs::remove_dir_all(path)
        } else {
            fs::remove_file(path)
        }
        .map_err(|e| e.to_string())
    }
}

#[test]
fn delete_checks_revision_and_prunes_metadata_after_trash_success() {
    use notes_lib::model::Appearance;
    let fake = std::sync::Arc::new(FakeTrash::default());
    let config = tempdir().unwrap();
    let service = Service::with_trash(config.path().to_path_buf(), fake.clone()).unwrap();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "old").unwrap();
    fs::write(root.path().join("b.png"), b"pixels").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .set_entry_appearance(
            &id,
            "a.md",
            Appearance {
                icon: None,
                color: Some("#123456".into()),
            },
        )
        .unwrap();
    service.save_sessions(serde_json::from_value(serde_json::json!({id.clone(): {"tabs": ["a.md", "b.png"], "primary": "a.md", "secondary": "b.png", "split": true}})).unwrap(), Some(id.clone()), true).unwrap();
    let revision = service.read_note(&id, "a.md").unwrap().revision;
    assert!(service.delete_file(&id, "a.md", None).is_err());
    assert!(service.delete_file(&id, "a.md", Some("wrong")).is_err());
    assert!(root.path().join("a.md").exists());
    service.delete_file(&id, "a.md", Some(&revision)).unwrap();
    service.delete_file(&id, "b.png", None).unwrap();
    assert_eq!(fake.0.lock().unwrap().len(), 2);
    let settings = service.load_settings().unwrap();
    assert!(settings.appearances.get(&id).is_none_or(|a| a.is_empty()));
    assert!(settings.sessions[&id].tabs.is_empty());
    assert!(settings.sessions[&id].primary.is_none());
    assert!(settings.sessions[&id].secondary.is_none());
    assert!(!settings.sessions[&id].split);
    assert!(service.delete_file(&id, "../outside.md", None).is_err());
}

#[test]
fn committed_image_rename_and_delete_report_metadata_write_failures() {
    let fake = std::sync::Arc::new(FakeTrash::default());
    let config = tempdir().unwrap();
    let service = Service::with_trash(config.path().to_path_buf(), fake).unwrap();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.png"), b"pixels").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    fs::remove_file(config.path().join("notes.json")).unwrap();
    fs::create_dir(config.path().join("notes.json")).unwrap();
    let renamed = service.rename_image(&id, "a.png", "b").unwrap();
    assert_eq!(renamed.path, "b.png");
    assert!(!renamed.warnings.is_empty());
    assert!(root.path().join("b.png").exists());
    let deleted = service.delete_file(&id, "b.png", None).unwrap();
    assert!(!deleted.warnings.is_empty());
    assert!(!root.path().join("b.png").exists());
}

#[test]
fn failed_workspace_removal_persistence_keeps_registration_and_files() {
    let (config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "keep").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    fs::remove_file(config.path().join("notes.json")).unwrap();
    fs::create_dir(config.path().join("notes.json")).unwrap();
    assert!(service.remove_workspace(&id).is_err());
    assert_eq!(service.load_settings().unwrap().workspaces[0].id, id);
    assert_eq!(
        fs::read_to_string(root.path().join("a.md")).unwrap(),
        "keep"
    );
}

struct RejectTrash;
impl notes_lib::service::Trash for RejectTrash {
    fn delete(&self, _path: &std::path::Path) -> Result<(), String> {
        Err("Trash unavailable".into())
    }
}

#[test]
fn trash_failure_preserves_file_and_metadata() {
    use notes_lib::model::Appearance;
    let config = tempdir().unwrap();
    let service = Service::with_trash(
        config.path().to_path_buf(),
        std::sync::Arc::new(RejectTrash),
    )
    .unwrap();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.png"), b"pixels").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let appearance = Appearance {
        icon: None,
        color: Some("#123456".into()),
    };
    service
        .set_entry_appearance(&id, "a.png", appearance.clone())
        .unwrap();
    assert!(service.delete_file(&id, "a.png", None).is_err());
    assert!(root.path().join("a.png").exists());
    assert_eq!(
        service.load_settings().unwrap().appearances[&id]["a.png"],
        appearance
    );
}

#[test]
fn old_settings_receive_complete_preference_defaults() {
    let config = tempdir().unwrap();
    fs::write(
        config.path().join("notes.json"),
        r#"{"toolbarVisible":false}"#,
    )
    .unwrap();
    let service = Service::new(config.path().to_path_buf()).unwrap();
    let settings = serde_json::to_value(service.load_settings().unwrap()).unwrap();
    assert_eq!(settings["toolbarVisible"], false);
    assert_eq!(
        settings["preferences"],
        serde_json::json!({
            "fontSize":15,"lineHeight":1.9,"editorFont":"mono","lineWrapping":true,
            "lineNumbers":false,"spellcheck":false,"tabSize":2,"readableWidth":true,
            "defaultPreview":false,"autosaveDelayMs":600,"searchScope":"all",
            "currentWorkspaceFirst":true,"searchLimit":60,"restoreSession":true,
            "refreshOnFocus":true,"sortFilesBy":"name",
            "customFont":"","fontWeight":400,"letterSpacing":0.0,"noteWidth":940,
            "graphBundling":0.85,"theme":"graphite-amber","uiFont":""
        })
    );
}

#[test]
fn legacy_preferences_receive_default_theme_without_losing_values() {
    let config = tempdir().unwrap();
    fs::write(
        config.path().join("notes.json"),
        r#"{"preferences":{"fontSize":18,"graphBundling":0.4},"toolbarVisible":false}"#,
    )
    .unwrap();
    let service = Service::new(config.path().to_path_buf()).unwrap();
    let settings = serde_json::to_value(service.load_settings().unwrap()).unwrap();
    assert_eq!(settings["preferences"]["theme"], "graphite-amber");
    assert_eq!(settings["preferences"]["fontSize"], 18);
    assert_eq!(settings["preferences"]["graphBundling"], 0.4);
    assert_eq!(settings["toolbarVisible"], false);
}

#[test]
fn themes_persist_across_restart_without_changing_notes_or_other_settings() {
    use notes_lib::model::{Appearance, Preferences, Session};
    let (config, service) = service();
    let root = tempdir().unwrap();
    let content = "---\ncustom: keep\n---\n# Note\nשלום world\n";
    fs::write(root.path().join("note.md"), content).unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    service
        .set_entry_appearance(
            &workspace.id,
            "note.md",
            Appearance {
                icon: Some("book".into()),
                color: Some("#123456".into()),
            },
        )
        .unwrap();
    service
        .save_sessions(
            std::collections::HashMap::from([(
                workspace.id.clone(),
                Session {
                    tabs: vec!["note.md".into()],
                    primary: Some("note.md".into()),
                    secondary: None,
                    split: false,
                },
            )]),
            Some(workspace.id.clone()),
            false,
        )
        .unwrap();
    let baseline = serde_json::to_value(service.load_settings().unwrap()).unwrap();
    for theme in [
        "graphite-amber",
        "ink-jade",
        "midnight-ice",
        "charcoal-coral",
        "forest-moss",
        "one-dark-pro",
    ] {
        let preferences: Preferences = serde_json::from_value(serde_json::json!({
            "theme":theme,"fontSize":18,"graphBundling":0.4
        }))
        .unwrap();
        let saved = service.save_preferences(preferences.clone()).unwrap();
        assert_eq!(serde_json::to_value(&saved).unwrap()["theme"], theme);
        let restarted = Service::new(config.path().to_path_buf()).unwrap();
        let settings = restarted.load_settings().unwrap();
        assert_eq!(settings.preferences, preferences);
        let settings = serde_json::to_value(settings).unwrap();
        for field in [
            "workspaces",
            "sessions",
            "activeWorkspaceId",
            "toolbarVisible",
            "appearances",
        ] {
            assert_eq!(settings[field], baseline[field], "{field}");
        }
        assert_eq!(
            fs::read_to_string(root.path().join("note.md")).unwrap(),
            content
        );
    }
    service.save_preferences(Preferences::default()).unwrap();
    let restarted = Service::new(config.path().to_path_buf()).unwrap();
    assert_eq!(
        serde_json::to_value(restarted.load_settings().unwrap().preferences).unwrap()["theme"],
        "graphite-amber"
    );
}

#[test]
fn invalid_themes_cannot_replace_saved_preferences() {
    use notes_lib::model::Preferences;
    let (config, service) = service();
    let preferences: Preferences = serde_json::from_value(serde_json::json!({
        "theme":"ink-jade","fontSize":18
    }))
    .unwrap();
    service.save_preferences(preferences.clone()).unwrap();
    let before = fs::read(config.path().join("notes.json")).unwrap();
    for theme in [
        serde_json::json!("unknown"),
        serde_json::json!(""),
        serde_json::json!("GraphiteAmber"),
        serde_json::json!("one-dark"),
        serde_json::Value::Null,
        serde_json::json!(3),
    ] {
        assert!(
            serde_json::from_value::<Preferences>(serde_json::json!({"theme":theme})).is_err(),
            "{theme}"
        );
    }
    assert_eq!(service.load_settings().unwrap().preferences, preferences);
    assert_eq!(fs::read(config.path().join("notes.json")).unwrap(), before);
}

#[test]
fn preferences_persist_and_missing_fields_use_defaults() {
    use notes_lib::model::Preferences;
    let (config, service) = service();
    let preferences: Preferences = serde_json::from_value(serde_json::json!({
        "fontSize":24,"lineHeight":2.2,"editorFont":"sans","tabSize":8,
        "autosaveDelayMs":5000,"searchScope":"current","searchLimit":200,
        "sortFilesBy":"modified","refreshOnFocus":false,
        "customFont":"Noto Sans Hebrew","uiFont":"DejaVu Sans","fontWeight":500,"letterSpacing":0.3,"noteWidth":1200
    }))
    .unwrap();
    assert!(preferences.line_wrapping);
    assert!(preferences.restore_session);
    assert_eq!(preferences.graph_bundling, 0.85);
    assert_eq!(
        serde_json::to_value(&preferences).unwrap()["uiFont"],
        "DejaVu Sans"
    );
    assert_eq!(
        service.save_preferences(preferences.clone()).unwrap(),
        preferences
    );
    drop(service);
    let restarted = Service::new(config.path().to_path_buf()).unwrap();
    assert_eq!(restarted.load_settings().unwrap().preferences, preferences);
}

#[test]
fn invalid_ui_fonts_leave_preferences_unchanged() {
    let (_config, service) = service();
    for name in ["Bad\nFont", "Bad\u{007f}Font"] {
        let preferences = serde_json::from_value(serde_json::json!({"uiFont":name})).unwrap();
        assert!(service.save_preferences(preferences).is_err());
    }
    assert_eq!(
        service.load_settings().unwrap().preferences,
        notes_lib::model::Preferences::default()
    );
}

#[test]
fn long_installed_font_names_persist() {
    let (config, service) = service();
    let family = "Long installed family ".repeat(8);
    let preferences: notes_lib::model::Preferences =
        serde_json::from_value(serde_json::json!({"customFont":family,"uiFont":family})).unwrap();
    service.save_preferences(preferences.clone()).unwrap();
    let restarted = Service::new(config.path().to_path_buf()).unwrap();
    assert_eq!(restarted.load_settings().unwrap().preferences, preferences);
}

#[cfg(target_os = "linux")]
#[test]
fn installed_font_families_match_fontconfig_and_do_not_change_settings() {
    let (_config, service) = service();
    let before = serde_json::to_value(service.load_settings().unwrap()).unwrap();
    let families = service.list_fonts().unwrap();
    assert!(families.windows(2).all(|pair| pair[0] < pair[1]));
    assert!(families.iter().all(|name| !name.is_empty()));
    // fc-list is optional at runtime; when present it independently checks that
    // the native service includes each family returned by Fontconfig's CLI.
    if let Ok(output) = std::process::Command::new("fc-list")
        .args(["--format", "%{family}\\n"])
        .output()
    {
        assert!(output.status.success());
        for name in String::from_utf8(output.stdout)
            .unwrap()
            .lines()
            .flat_map(|line| line.split(','))
        {
            assert!(
                families.iter().any(|family| family == name.trim()),
                "Missing font: {name}"
            );
        }
    }
    assert_eq!(
        serde_json::to_value(service.load_settings().unwrap()).unwrap(),
        before
    );
}

#[test]
fn graph_bundling_persists_and_rejects_invalid_values() {
    use notes_lib::model::Preferences;
    let (config, service) = service();
    for strength in [0.0, 0.4, 0.85, 1.0] {
        service
            .save_preferences(Preferences {
                graph_bundling: strength,
                ..Preferences::default()
            })
            .unwrap();
        let restarted = Service::new(config.path().to_path_buf()).unwrap();
        assert_eq!(
            restarted
                .load_settings()
                .unwrap()
                .preferences
                .graph_bundling,
            strength
        );
    }
    for strength in [-0.01, 1.01, f64::INFINITY, f64::NAN] {
        assert!(service
            .save_preferences(Preferences {
                graph_bundling: strength,
                ..Preferences::default()
            })
            .is_err());
    }
    assert_eq!(
        service.load_settings().unwrap().preferences.graph_bundling,
        1.0
    );
}

#[test]
fn invalid_preferences_never_replace_saved_or_in_memory_values() {
    use notes_lib::model::Preferences;
    let (config, service) = service();
    service.save_preferences(Preferences::default()).unwrap();
    let before = fs::read(config.path().join("notes.json")).unwrap();
    for (field, values) in [
        ("fontSize", vec![11.0_f64, 25.0, 15.5]),
        ("lineHeight", vec![1.29, 2.21]),
        ("fontWeight", vec![299.0, 450.0, 701.0]),
        ("letterSpacing", vec![3.1]),
        ("noteWidth", vec![599.0, 1401.0]),
        ("tabSize", vec![0.0, 3.0, 9.0]),
        ("autosaveDelayMs", vec![199.0, 5001.0]),
        ("searchLimit", vec![19.0, 201.0]),
    ] {
        for value in values {
            let value = if value.fract() == 0.0 {
                serde_json::json!(value as u64)
            } else {
                serde_json::json!(value)
            };
            let input = serde_json::json!({field: value});
            if let Ok(preferences) = serde_json::from_value::<Preferences>(input) {
                assert!(
                    service.save_preferences(preferences).is_err(),
                    "{field}: {value}"
                );
            }
        }
    }
    for field in ["editorFont", "searchScope", "sortFilesBy"] {
        assert!(
            serde_json::from_value::<Preferences>(serde_json::json!({field:"invalid"})).is_err()
        );
    }
    for line_height in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(service
            .save_preferences(Preferences {
                line_height,
                ..Preferences::default()
            })
            .is_err());
    }
    for letter_spacing in [-0.6, f64::NAN, f64::INFINITY] {
        assert!(service
            .save_preferences(Preferences {
                letter_spacing,
                ..Preferences::default()
            })
            .is_err());
    }
    for custom_font in ["Bad\nFont".to_string(), "Bad\u{007f}Font".to_string()] {
        assert!(service
            .save_preferences(Preferences {
                custom_font,
                ..Preferences::default()
            })
            .is_err());
    }
    assert_eq!(
        service.load_settings().unwrap().preferences,
        Preferences::default()
    );
    assert_eq!(fs::read(config.path().join("notes.json")).unwrap(), before);
}

#[test]
fn failed_preference_persistence_keeps_previous_preferences() {
    use notes_lib::model::Preferences;
    let (config, service) = service();
    service.save_preferences(Preferences::default()).unwrap();
    fs::remove_file(config.path().join("notes.json")).unwrap();
    fs::create_dir(config.path().join("notes.json")).unwrap();
    assert!(service
        .save_preferences(Preferences {
            font_size: 20,
            ..Preferences::default()
        })
        .is_err());
    assert_eq!(
        service.load_settings().unwrap().preferences,
        Preferences::default()
    );
}

#[test]
fn scan_refreshes_external_edits_additions_deletions_and_renames() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let path = root.path().join("a.md");
    fs::write(&path, "# First\n#before").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let stale_revision = service.read_note(&id, "a.md").unwrap().revision;
    let original_modified = fs::metadata(&path).unwrap().modified().unwrap();
    fs::write(&path, "# Other\n#afterx").unwrap(); // Same byte length.
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(original_modified))
        .unwrap();
    let snapshot = service.scan_workspace(&id).unwrap();
    assert_eq!(snapshot.entries[0].title, "Other");
    assert_eq!(snapshot.entries[0].tags, ["afterx"]);
    assert!(service
        .save_note(&id, "a.md", "overwrite", &stale_revision)
        .is_err());
    fs::rename(&path, root.path().join("b.md")).unwrap();
    fs::write(root.path().join("c.md"), "# New").unwrap();
    let snapshot = service.scan_workspace(&id).unwrap();
    assert_eq!(
        snapshot
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>(),
        ["b.md", "c.md"]
    );
    fs::remove_file(root.path().join("b.md")).unwrap();
    let snapshot = service.scan_workspace(&id).unwrap();
    assert_eq!(snapshot.entries.len(), 1);
    assert_eq!(snapshot.entries[0].title, "New");
}

#[test]
fn scan_after_native_save_rename_and_link_rewrite_uses_fresh_metadata() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# First\n#before").unwrap();
    fs::write(root.path().join("reference.md"), "# [[a]]").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let note = service.read_note(&id, "a.md").unwrap();
    let saved = service
        .save_note(&id, "a.md", "# Second\n#after", &note.revision)
        .unwrap();
    let snapshot = service.scan_workspace(&id).unwrap();
    assert_eq!(snapshot.entries[0].title, "Second");
    assert_eq!(snapshot.entries[0].tags, ["after"]);
    service
        .rename_note(&id, "a.md", "b", &saved.revision)
        .unwrap();
    let snapshot = service.scan_workspace(&id).unwrap();
    assert_eq!(snapshot.entries[0].path, "b.md");
    assert_eq!(snapshot.entries[1].title, "[[b]]");
}

#[test]
fn scan_cache_isolated_by_workspace_path() {
    let (_config, service) = service();
    let roots = [tempdir().unwrap(), tempdir().unwrap()];
    let mut ids = Vec::new();
    for (index, root) in roots.iter().enumerate() {
        fs::write(root.path().join("a.md"), format!("# Workspace {index}")).unwrap();
        ids.push(
            service
                .add_workspace(root.path().to_str().unwrap())
                .unwrap()
                .workspace
                .id,
        );
    }
    for (index, id) in ids.iter().enumerate() {
        assert_eq!(
            service.scan_workspace(id).unwrap().entries[0].title,
            format!("Workspace {index}")
        );
    }
}

#[test]
fn drawing_blocks_round_trip_as_notes_without_polluting_search_metadata() {
    let (config, service) = service();
    let root = tempdir().unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    let note = service.create_note(&workspace.id, "").unwrap();
    let content = "# Diagram\n\n#school\n\n```notes-drawing\n{\"version\":1,\"id\":\"demo\",\"shapes\":[{\"kind\":\"text\",\"id\":\"t\",\"x\":0,\"y\":0,\"color\":\"#61AFEF\",\"stroke\":2,\"size\":24,\"text\":\"שלום #private\"}]}\n```\n";
    let saved = service
        .save_note(&workspace.id, &note.path, content, &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join(&saved.path)).unwrap(),
        content
    );
    drop(service);
    let restarted = Service::new(config.path().to_path_buf()).unwrap();
    assert_eq!(
        restarted
            .read_note(&workspace.id, &saved.path)
            .unwrap()
            .content,
        content
    );
    let scan = restarted.scan_workspace(&workspace.id).unwrap();
    let entry = scan
        .entries
        .iter()
        .find(|entry| entry.path == saved.path)
        .unwrap();
    assert_eq!(entry.title, "Diagram");
    assert_eq!(entry.tags, ["school"]);
}

#[test]
fn workspace_scan_skips_dependency_trees_but_keeps_real_note_folders() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    for folder in [
        "project/node_modules/package",
        "__pycache__",
        "Lectures",
        "target",
        "dist",
    ] {
        fs::create_dir_all(root.path().join(folder)).unwrap();
        fs::write(root.path().join(folder).join("Readme.md"), "# Note").unwrap();
    }
    let scan = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    assert!(!scan
        .entries
        .iter()
        .any(|entry| entry.path.contains("node_modules") || entry.path.contains("__pycache__")));
    for path in ["Lectures/Readme.md", "target/Readme.md", "dist/Readme.md"] {
        assert!(scan.entries.iter().any(|entry| entry.path == path));
    }
    // Explicitly opening such a directory still means the user chose it as the root.
    let explicit = service
        .add_workspace(
            root.path()
                .join("project/node_modules/package")
                .to_str()
                .unwrap(),
        )
        .unwrap();
    assert!(explicit
        .entries
        .iter()
        .any(|entry| entry.path == "Readme.md"));
}

#[test]
fn folder_delete_trashes_the_tree_and_prunes_descendant_metadata() {
    use notes_lib::model::Appearance;
    let config = tempdir().unwrap();
    let fake = std::sync::Arc::new(FakeTrash::default());
    let service = Service::with_trash(config.path().to_path_buf(), fake.clone()).unwrap();
    let root = tempdir().unwrap();
    fs::create_dir_all(root.path().join("Folder/Nested")).unwrap();
    fs::create_dir(root.path().join("Folder extra")).unwrap();
    fs::write(root.path().join("Folder/Nested/image.png"), "pixels").unwrap();
    fs::write(root.path().join("Folder/other.txt"), "unindexed file").unwrap();
    fs::write(root.path().join("outside.md"), "keep").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let created = service.create_note(&id, "Folder/Nested").unwrap();
    for path in ["Folder", &created.path, "outside.md"] {
        service
            .set_entry_appearance(
                &id,
                path,
                Appearance {
                    icon: None,
                    color: Some("#123456".into()),
                },
            )
            .unwrap();
    }
    service.save_sessions(serde_json::from_value(serde_json::json!({id.clone(): {"tabs": [created.path, "Folder/Nested/image.png", "outside.md"], "primary": created.path, "secondary": "outside.md", "split": true}})).unwrap(), Some(id.clone()), false).unwrap();
    service.delete_file(&id, "Folder", None).unwrap();
    assert_eq!(*fake.0.lock().unwrap(), vec![root.path().join("Folder")]);
    assert!(!root.path().join("Folder").exists());
    assert!(root.path().join("Folder extra").exists());
    assert!(root.path().join("outside.md").exists());
    let settings = service.load_settings().unwrap();
    assert_eq!(settings.sessions[&id].tabs, ["outside.md"]);
    assert_eq!(
        settings.sessions[&id].primary.as_deref(),
        Some("outside.md")
    );
    assert!(!settings.sessions[&id].split);
    assert_eq!(settings.appearances[&id].len(), 1);
    let stored: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(config.path().join("notes.json")).unwrap())
            .unwrap();
    assert!(stored["auto_names"].as_object().unwrap().is_empty());
    assert!(service.delete_file(&id, "", None).is_err());
    assert!(service.delete_file(&id, "../", None).is_err());
}

#[test]
fn folder_trash_failure_preserves_contents_and_metadata() {
    use notes_lib::model::Appearance;
    let config = tempdir().unwrap();
    let service = Service::with_trash(
        config.path().to_path_buf(),
        std::sync::Arc::new(RejectTrash),
    )
    .unwrap();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("Folder")).unwrap();
    fs::write(root.path().join("Folder/a.md"), "keep").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .set_entry_appearance(
            &id,
            "Folder/a.md",
            Appearance {
                icon: None,
                color: Some("#123456".into()),
            },
        )
        .unwrap();
    let before = service.load_settings().unwrap();
    assert!(service
        .delete_file(&id, "Folder", None)
        .unwrap_err()
        .contains("Trash unavailable"));
    assert!(root.path().join("Folder/a.md").exists());
    assert_eq!(
        service.load_settings().unwrap().appearances,
        before.appearances
    );
}

#[cfg(unix)]
#[test]
fn folder_deletion_rejects_symlink_paths_and_keeps_link_targets() {
    use std::os::unix::fs::symlink;
    let config = tempdir().unwrap();
    let fake = std::sync::Arc::new(FakeTrash::default());
    let service = Service::with_trash(config.path().to_path_buf(), fake.clone()).unwrap();
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("keep.md"), "keep").unwrap();
    fs::create_dir(root.path().join("Folder")).unwrap();
    symlink(outside.path(), root.path().join("Link")).unwrap();
    symlink(outside.path(), root.path().join("Folder/Link")).unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    assert!(service.delete_file(&id, "Link", None).is_err());
    assert!(fake.0.lock().unwrap().is_empty());
    service.delete_file(&id, "Folder", None).unwrap();
    assert_eq!(
        fs::read_to_string(outside.path().join("keep.md")).unwrap(),
        "keep"
    );
}

#[test]
fn committed_folder_deletion_reports_metadata_write_failures() {
    let config = tempdir().unwrap();
    let service = Service::with_trash(
        config.path().to_path_buf(),
        std::sync::Arc::new(FakeTrash::default()),
    )
    .unwrap();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("Empty")).unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    fs::remove_file(config.path().join("notes.json")).unwrap();
    fs::create_dir(config.path().join("notes.json")).unwrap();
    let result = service.delete_file(&id, "Empty", None).unwrap();
    assert!(!root.path().join("Empty").exists());
    assert!(!result.warnings.is_empty());
}

#[test]
fn folder_deletion_rejects_overlap_with_other_registered_workspaces() {
    let config = tempdir().unwrap();
    let fake = std::sync::Arc::new(FakeTrash::default());
    let service = Service::with_trash(config.path().to_path_buf(), fake.clone()).unwrap();
    let root = tempdir().unwrap();
    fs::create_dir_all(root.path().join("Shared/Nested")).unwrap();
    fs::write(root.path().join("Shared/Nested/note.md"), "keep").unwrap();
    let parent = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let child = service
        .add_workspace(root.path().join("Shared").to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    for (id, path) in [
        (&parent, "Shared"),
        (&parent, "Shared/Nested"),
        (&child, "Nested"),
    ] {
        assert!(service
            .delete_file(id, path, None)
            .unwrap_err()
            .contains("another open workspace"));
    }
    assert!(fake.0.lock().unwrap().is_empty());
    assert_eq!(
        fs::read_to_string(root.path().join("Shared/Nested/note.md")).unwrap(),
        "keep"
    );
    service.remove_workspace(&child).unwrap();
    service.delete_file(&parent, "Shared", None).unwrap();
    assert!(!root.path().join("Shared").exists());
}
