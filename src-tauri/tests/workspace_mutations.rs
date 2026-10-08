use notes_lib::model::Session;
use notes_lib::service::{Service, Trash};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

struct PausedTrash {
    entered: mpsc::Sender<()>,
    resume: Mutex<mpsc::Receiver<()>>,
}

impl Trash for PausedTrash {
    fn delete(&self, path: &Path) -> Result<(), String> {
        self.entered.send(()).unwrap();
        self.resume.lock().unwrap().recv().unwrap();
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

#[test]
fn settings_and_scans_progress_during_trash_and_latest_session_is_pruned() {
    let config = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(root.path().join("b.md"), "# B").unwrap();
    let (entered_tx, entered) = mpsc::channel();
    let (resume, resume_rx) = mpsc::channel();
    let service = Arc::new(
        Service::with_trash(
            config.path().into(),
            Arc::new(PausedTrash {
                entered: entered_tx,
                resume: Mutex::new(resume_rx),
            }),
        )
        .unwrap(),
    );
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let revision = service.read_note(&id, "a.md").unwrap().revision;
    let writer_service = service.clone();
    let writer_id = id.clone();
    let writer =
        std::thread::spawn(move || writer_service.delete_file(&writer_id, "a.md", Some(&revision)));
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    let updater_service = service.clone();
    let updater_id = id.clone();
    let (done_tx, done) = mpsc::channel();
    let updater = std::thread::spawn(move || {
        let mut preferences = updater_service.load_settings().unwrap().preferences;
        preferences.font_size = 19;
        updater_service.save_preferences(preferences).unwrap();
        updater_service
            .save_sessions(
                HashMap::from([(
                    updater_id.clone(),
                    Session {
                        tabs: vec!["a.md".into(), "b.md".into()],
                        primary: Some("a.md".into()),
                        secondary: Some("b.md".into()),
                        split: true,
                    },
                )]),
                Some(updater_id.clone()),
                false,
            )
            .unwrap();
        let scan = updater_service.scan_workspace(&updater_id).unwrap();
        done_tx.send(scan.entries.len()).unwrap();
    });
    let progress = done.recv_timeout(Duration::from_secs(2));
    resume.send(()).unwrap();
    let result = writer.join().unwrap().unwrap();
    updater.join().unwrap();
    assert_eq!(
        progress.unwrap(),
        2,
        "settings and scans must finish while Trash is paused"
    );
    assert!(result.warnings.is_empty());
    let settings = service.load_settings().unwrap();
    assert_eq!(settings.preferences.font_size, 19);
    assert!(!settings.toolbar_visible);
    assert_eq!(settings.sessions[&id].tabs, ["b.md"]);
    assert_eq!(settings.sessions[&id].primary.as_deref(), Some("b.md"));
    assert!(!settings.sessions[&id].split);
    let restarted = Service::new(config.path().into())
        .unwrap()
        .load_settings()
        .unwrap();
    assert_eq!(
        serde_json::to_value(settings).unwrap(),
        serde_json::to_value(restarted).unwrap()
    );
}
