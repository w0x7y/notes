use crate::model::{
    Appearance, DeleteResult, Entry, NoteFile, Preferences, RenameImageResult, Rewrite, SaveResult,
    Session, Settings, Snapshot, Workspace,
};
use crate::pathing::{open_regular, read_note_text, resolve};
use crate::scan_cache::ScanCache;
use crate::workspace_mutations::WorkspaceMutations;
#[cfg(test)]
use crate::workspace_mutations::{move_file_by_link, move_without_overwrite};
use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

pub(crate) fn workspace_entry(entry: &walkdir::DirEntry) -> bool {
    if !entry.file_type().is_dir() && !entry.file_type().is_file() {
        return false;
    }
    if entry.depth() == 0 || !entry.file_type().is_dir() {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    !name.starts_with('.') && !matches!(name.as_ref(), "node_modules" | "__pycache__")
}

pub(crate) fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|ext| {
            ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]
                .iter()
                .any(|supported| ext.eq_ignore_ascii_case(supported))
        })
}

pub(crate) fn is_note(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

pub(crate) fn err(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}

pub(crate) fn revision(content: &str) -> String {
    hex::encode(Sha256::digest(content.as_bytes()))
}

pub(crate) fn note_content(path: &Path) -> Result<String, String> {
    if path
        .extension()
        .and_then(|v| v.to_str())
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("md"))
    {
        return Err("Only Markdown notes can be opened".into());
    }
    read_note_text(path).map_err(|e| err("Cannot read note", e))
}

pub struct Service {
    mutations: WorkspaceMutations,
    scan_cache: Arc<ScanCache>,
    #[cfg(test)]
    read_pause: Mutex<Option<crate::scan_cache::ReadPause>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveFolderResult {
    pub path: String,
    pub rewritten: Vec<Rewrite>,
    pub warnings: Vec<String>,
}

pub trait Trash: Send + Sync {
    fn delete(&self, path: &Path) -> Result<(), String>;
}

struct DesktopTrash;
impl Trash for DesktopTrash {
    fn delete(&self, path: &Path) -> Result<(), String> {
        trash::delete(path).map_err(|e| err("Cannot move file to Trash", e))
    }
}

impl Service {
    pub fn load_settings(&self) -> Result<Settings, String> {
        self.mutations.load_settings()
    }

    pub fn registered_roots(&self) -> Result<(u64, Vec<Workspace>), String> {
        self.mutations.registered_roots()
    }

    pub fn save_preferences(&self, preferences: Preferences) -> Result<Preferences, String> {
        self.mutations.save_preferences(preferences)
    }

    pub fn save_sessions(
        &self,
        sessions: HashMap<String, Session>,
        active_workspace_id: Option<String>,
        toolbar_visible: bool,
    ) -> Result<(), String> {
        self.mutations
            .save_sessions(sessions, active_workspace_id, toolbar_visible)
    }

    pub fn update_workspace(
        &self,
        id: &str,
        name: &str,
        color: &str,
        icon: &str,
    ) -> Result<Workspace, String> {
        self.mutations.update_workspace(id, name, color, icon)
    }

    pub fn set_entry_appearance(
        &self,
        id: &str,
        path: &str,
        appearance: Appearance,
    ) -> Result<Appearance, String> {
        self.mutations.set_entry_appearance(id, path, appearance)
    }

    pub fn remove_workspace(&self, id: &str) -> Result<Settings, String> {
        self.mutations.remove_workspace(id)
    }

    pub fn write_drawing_svg(&self, id: &str, svg: &str) -> Result<String, String> {
        self.mutations.write_drawing_svg(id, svg)
    }

    pub fn create_note(&self, id: &str, folder: &str) -> Result<NoteFile, String> {
        self.mutations.create_note(id, folder)
    }

    pub fn save_note(
        &self,
        id: &str,
        path: &str,
        content: &str,
        expected: &str,
    ) -> Result<SaveResult, String> {
        self.mutations.save_note(id, path, content, expected)
    }

    pub fn rename_note(
        &self,
        id: &str,
        path: &str,
        name: &str,
        expected: &str,
    ) -> Result<SaveResult, String> {
        self.mutations.rename_note(id, path, name, expected)
    }

    pub fn rename_image(
        &self,
        id: &str,
        path: &str,
        name: &str,
    ) -> Result<RenameImageResult, String> {
        self.mutations.rename_image(id, path, name)
    }

    pub fn delete_file(
        &self,
        id: &str,
        path: &str,
        expected: Option<&str>,
    ) -> Result<DeleteResult, String> {
        self.mutations.delete_file(id, path, expected)
    }

    pub fn create_folder(&self, id: &str, parent: &str, name: &str) -> Result<(), String> {
        self.mutations.create_folder(id, parent, name)
    }

    pub fn move_folder(
        &self,
        id: &str,
        path: &str,
        destination: &str,
    ) -> Result<MoveFolderResult, String> {
        self.mutations.move_folder(id, path, destination)
    }

    pub fn list_fonts(&self) -> Result<Vec<String>, String> {
        crate::fonts::list_families()
    }

    pub fn new(config_dir: PathBuf) -> Result<Self, String> {
        Self::with_trash(config_dir, Arc::new(DesktopTrash))
    }

    pub fn with_trash(config_dir: PathBuf, trash: Arc<dyn Trash>) -> Result<Self, String> {
        let scan_cache = Arc::new(ScanCache::default());
        Ok(Self {
            mutations: WorkspaceMutations::new(config_dir, trash, scan_cache.clone())?,
            scan_cache,
            #[cfg(test)]
            read_pause: Mutex::new(None),
        })
    }

    #[cfg(test)]
    fn pause_read(&self, path: &Path) {
        let pause = {
            let mut pending = self.read_pause.lock().unwrap();
            if pending.as_ref().is_some_and(|pause| pause.path == path) {
                pending.take()
            } else {
                None
            }
        };
        if let Some(pause) = pause {
            let _ = pause.entered.send(());
            let _ = pause.resume.recv_timeout(std::time::Duration::from_secs(5));
        }
    }

    pub fn add_workspace(&self, path: &str) -> Result<Snapshot, String> {
        let selected = self.mutations.add_workspace(path)?;
        self.scan(&selected)
    }

    pub fn ensure_capture_workspace(&self, documents: &Path) -> Result<Snapshot, String> {
        let selected = self.mutations.ensure_capture_workspace(documents)?;
        self.scan(&selected)
    }

    fn scan(&self, selected: &Workspace) -> Result<Snapshot, String> {
        let root = Path::new(&selected.path)
            .canonicalize()
            .map_err(|e| err("Cannot open workspace", e))?;
        if root != Path::new(&selected.path) {
            return Err("Registered workspace folder has moved or become a symlink".into());
        }
        fs::read_dir(&root).map_err(|error| err("Cannot open workspace folder", error))?;
        let mut seen = HashSet::new();
        let mut entries = Vec::new();
        let mut warnings = Vec::new();
        let mut incomplete = false;
        let walk = WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(workspace_entry);
        for found in walk {
            let found = match found {
                Ok(found) => found,
                Err(error) => {
                    if error.depth() == 0 {
                        return Err(err("Cannot open workspace folder", error));
                    }
                    warnings.push(err("Cannot scan part of workspace", error));
                    incomplete = true;
                    continue;
                }
            };
            if found.depth() == 0 {
                continue;
            }
            let path = found.path();
            let Some(path_str) = path.strip_prefix(&root).ok().and_then(|p| p.to_str()) else {
                continue;
            };
            let extension = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let kind = if found.file_type().is_dir() {
                "folder"
            } else if extension == "md" {
                "note"
            } else if ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]
                .contains(&extension.as_str())
            {
                "image"
            } else {
                continue;
            };
            #[cfg(test)]
            self.pause_read(path);
            let metadata = match found.metadata() {
                Ok(metadata) => metadata,
                Err(error) => {
                    warnings.push(err("Cannot read entry metadata", error));
                    incomplete = true;
                    continue;
                }
            };
            let (title, tags, aliases, warning) = if kind == "note" {
                seen.insert(path.to_path_buf());
                match self.scan_cache.metadata(&root, path, &metadata) {
                    Ok(metadata) => metadata,
                    Err(error) => {
                        warnings.push(err(
                            &format!("Cannot read note metadata ({path_str})"),
                            error,
                        ));
                        incomplete = true;
                        continue;
                    }
                }
            } else {
                (None, Vec::new(), Vec::new(), None)
            };
            if let Some(warning) = warning {
                warnings.push(format!("{path_str}: {warning}"));
            }
            let title = title.unwrap_or_else(|| {
                path.file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            });
            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            entries.push(Entry {
                path: path_str.replace('\\', "/"),
                kind: kind.into(),
                title,
                tags,
                aliases,
                modified,
            });
        }
        if !incomplete {
            self.scan_cache.finish(&root, &seen);
        }
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(Snapshot {
            workspace: selected.clone(),
            entries,
            incomplete,
            warnings,
        })
    }

    pub fn scan_workspace(&self, id: &str) -> Result<Snapshot, String> {
        let (selected, _) = self.mutations.read_context(id, "")?;
        self.scan(&selected)
    }

    pub fn read_note(&self, id: &str, path: &str) -> Result<NoteFile, String> {
        let (selected, auto_rename) = self.mutations.read_context(id, path)?;
        let full = resolve(Path::new(&selected.path), path, false)?;
        #[cfg(test)]
        self.pause_read(&full);
        let content = note_content(&full)?;
        Ok(NoteFile {
            path: path.into(),
            revision: revision(&content),
            content,
            auto_rename,
        })
    }

    pub fn read_image(&self, id: &str, path: &str) -> Result<ImageData, String> {
        let (selected, _) = self.mutations.read_context(id, path)?;
        let full = resolve(Path::new(&selected.path), path, false)?;
        #[cfg(test)]
        self.pause_read(&full);
        let mime = match full
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "avif" => "image/avif",
            _ => return Err("Unsupported image type".into()),
        };
        const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
        let file = open_regular(&full).map_err(|e| err("Cannot read image", e))?;
        if file
            .metadata()
            .map_err(|e| err("Cannot inspect image", e))?
            .len()
            > MAX_IMAGE_BYTES
        {
            return Err("Image exceeds 20 MB limit".into());
        }
        let mut bytes = Vec::new();
        file.take(MAX_IMAGE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| err("Cannot read image", e))?;
        if bytes.len() as u64 > MAX_IMAGE_BYTES {
            return Err("Image exceeds 20 MB limit".into());
        }
        Ok(ImageData {
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
            mime: mime.into(),
        })
    }
}

#[derive(serde::Serialize)]
pub struct ImageData {
    pub data: String,
    pub mime: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan_cache::ReadPause;
    use std::sync::mpsc;
    use std::time::Duration;

    #[cfg(unix)]
    #[test]
    fn traversal_error_preserves_healthy_siblings_and_recovers_after_access_returns() {
        use std::os::unix::fs::PermissionsExt;

        let config = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let visible = root.path().join("visible");
        let inaccessible = visible.join("inaccessible");
        fs::create_dir_all(&inaccessible).unwrap();
        fs::write(inaccessible.join("child.md"), "# Child").unwrap();
        fs::write(root.path().join("healthy.md"), "# Healthy").unwrap();
        let permissions = fs::metadata(&inaccessible).unwrap().permissions();
        // Privileged processes can bypass Unix permission bits, so first verify
        // that this environment can actually exercise a read_dir failure.
        fs::set_permissions(&inaccessible, fs::Permissions::from_mode(0o0)).unwrap();
        let permission_enforced = fs::read_dir(&inaccessible).is_err();
        fs::set_permissions(&inaccessible, permissions.clone()).unwrap();
        if !permission_enforced {
            eprintln!("Traversal permission regression requires enforced Unix permissions");
            return;
        }
        let service = Arc::new(Service::new(config.path().to_path_buf()).unwrap());
        let id = service
            .add_workspace(root.path().to_str().unwrap())
            .unwrap()
            .workspace
            .id;
        let (entered_sender, entered) = mpsc::channel();
        let (resume, resumed) = mpsc::channel();
        *service.read_pause.lock().unwrap() = Some(ReadPause {
            path: visible,
            entered: entered_sender,
            resume: resumed,
        });
        let scanner = service.clone();
        let scan_id = id.clone();
        let worker = std::thread::spawn(move || scanner.scan_workspace(&scan_id));
        let reached = entered.recv_timeout(Duration::from_secs(2));
        // The visible parent is discovered, but WalkDir has not opened this
        // child directory. Its subsequent enumeration must return WalkDir::Err.
        fs::set_permissions(&inaccessible, fs::Permissions::from_mode(0o0)).unwrap();
        let _ = resume.send(());
        let result = worker.join();
        fs::set_permissions(&inaccessible, permissions).unwrap();
        let snapshot = result.unwrap().unwrap();
        assert!(reached.is_ok(), "scan did not reach the visible folder");
        assert!(snapshot.incomplete);
        assert!(snapshot
            .entries
            .iter()
            .any(|entry| entry.path == "healthy.md"));
        assert!(!snapshot
            .entries
            .iter()
            .any(|entry| entry.path == "visible/inaccessible/child.md"));
        assert_eq!(snapshot.warnings.len(), 1);
        assert!(snapshot.warnings[0].contains("Cannot scan part of workspace"));
        assert!(snapshot.warnings[0].contains("visible/inaccessible"));
        let recovered = service.scan_workspace(&id).unwrap();
        assert!(!recovered.incomplete);
        assert!(recovered.warnings.is_empty());
        assert!(recovered.entries.iter().any(|entry| {
            entry.path == "visible/inaccessible/child.md" && entry.title == "Child"
        }));
    }

    #[test]
    fn note_read_failure_returns_partial_snapshot_and_recovers_on_next_scan() {
        let config = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let vanishing = root.path().join("vanishing.md");
        fs::write(&vanishing, "# Vanishing").unwrap();
        fs::write(root.path().join("healthy.md"), "# Healthy").unwrap();
        let service = Arc::new(Service::new(config.path().to_path_buf()).unwrap());
        let id = service
            .add_workspace(root.path().to_str().unwrap())
            .unwrap()
            .workspace
            .id;
        service.scan_cache.invalidate(&vanishing);
        let (entered_sender, entered) = mpsc::channel();
        let (resume, resumed) = mpsc::channel();
        *service.scan_cache.read_pause.lock().unwrap() = Some(ReadPause {
            path: vanishing.clone(),
            entered: entered_sender,
            resume: resumed,
        });
        let scanner = service.clone();
        let scan_id = id.clone();
        let worker = std::thread::spawn(move || scanner.scan_workspace(&scan_id));
        let reached = entered.recv_timeout(Duration::from_secs(2));
        fs::remove_file(&vanishing).unwrap();
        let _ = resume.send(());
        let snapshot = worker.join().unwrap().unwrap();
        assert!(reached.is_ok(), "scan did not reach the note read");
        assert!(snapshot.incomplete);
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].path, "healthy.md");
        assert_eq!(snapshot.warnings.len(), 1);
        assert!(snapshot.warnings[0].contains("Cannot read note metadata (vanishing.md)"));
        fs::write(vanishing, "# Restored\n#tag").unwrap();
        let snapshot = service.scan_workspace(&id).unwrap();
        assert!(!snapshot.incomplete);
        assert!(snapshot.warnings.is_empty());
        let restored = snapshot
            .entries
            .iter()
            .find(|entry| entry.path == "vanishing.md")
            .unwrap();
        assert_eq!(restored.title, "Restored");
        assert_eq!(restored.tags, vec!["tag"]);
    }

    #[test]
    fn metadata_failure_returns_healthy_entries_and_an_incomplete_snapshot() {
        let config = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("vanishing.md"), "# Vanishing").unwrap();
        fs::write(root.path().join("healthy.md"), "# Healthy").unwrap();
        let service = Arc::new(Service::new(config.path().to_path_buf()).unwrap());
        let id = service
            .add_workspace(root.path().to_str().unwrap())
            .unwrap()
            .workspace
            .id;
        let (entered_sender, entered) = mpsc::channel();
        let (resume, resumed) = mpsc::channel();
        *service.read_pause.lock().unwrap() = Some(ReadPause {
            path: root.path().join("vanishing.md"),
            entered: entered_sender,
            resume: resumed,
        });
        let scanner = service.clone();
        let worker = std::thread::spawn(move || scanner.scan_workspace(&id));
        let reached = entered.recv_timeout(Duration::from_secs(2));
        fs::remove_file(root.path().join("vanishing.md")).unwrap();
        let _ = resume.send(());
        let result = worker.join().unwrap().unwrap();
        assert!(reached.is_ok());
        assert!(result.incomplete);
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].path, "healthy.md");
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("vanishing.md"));
    }

    #[test]
    fn repeated_large_workspace_scans_cache_notes_admitted_after_ten_thousand_entries() {
        let config = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        for index in 0..10_000 {
            fs::write(root.path().join(format!("{index}.md")), "# Existing\n#tag").unwrap();
        }
        let service = Service::new(config.path().to_path_buf()).unwrap();
        let id = service
            .add_workspace(root.path().to_str().unwrap())
            .unwrap()
            .workspace
            .id;
        let late = root.path().join("late.md");
        fs::write(&late, "# Late\n#tag").unwrap();
        service.scan_workspace(&id).unwrap();
        let (entered, receiver) = mpsc::channel();
        let (resume, resumed) = mpsc::channel();
        resume.send(()).unwrap();
        *service.scan_cache.read_pause.lock().unwrap() = Some(ReadPause {
            path: late,
            entered,
            resume: resumed,
        });
        for _ in 0..2 {
            let snapshot = service.scan_workspace(&id).unwrap();
            assert_eq!(snapshot.entries.len(), 10_001);
            assert_eq!(
                snapshot
                    .entries
                    .iter()
                    .find(|entry| entry.path == "late.md")
                    .unwrap()
                    .title,
                "Late"
            );
        }
        assert!(
            receiver.try_recv().is_err(),
            "warm scans reparsed the late entry"
        );
        assert!(service.scan_cache.read_pause.lock().unwrap().is_some());
    }

    #[test]
    fn slow_note_and_image_reads_do_not_block_ordered_mutations() {
        for path in ["a.md", "a.png"] {
            let config = tempfile::tempdir().unwrap();
            let root = tempfile::tempdir().unwrap();
            fs::write(root.path().join("a.md"), "# Original").unwrap();
            fs::write(root.path().join("a.png"), "image bytes").unwrap();
            let service = Arc::new(Service::new(config.path().to_path_buf()).unwrap());
            let id = service
                .add_workspace(root.path().to_str().unwrap())
                .unwrap()
                .workspace
                .id;
            let revision = service.read_note(&id, "a.md").unwrap().revision;
            let (entered_sender, entered) = mpsc::channel();
            let (resume, resume_receiver) = mpsc::channel();
            *service.read_pause.lock().unwrap() = Some(ReadPause {
                path: root.path().join(path),
                entered: entered_sender,
                resume: resume_receiver,
            });
            let reader_service = service.clone();
            let reader_id = id.clone();
            let reader = std::thread::spawn(move || {
                if path.ends_with("md") {
                    reader_service.read_note(&reader_id, path).map(|_| ())
                } else {
                    reader_service.read_image(&reader_id, path).map(|_| ())
                }
            });
            let read_entered = entered.recv_timeout(Duration::from_secs(1));
            let (saved_sender, saved) = mpsc::channel();
            let writer = std::thread::spawn(move || {
                let _ = saved_sender.send(service.save_note(&id, "a.md", "# Saved", &revision));
            });
            let result = saved.recv_timeout(Duration::from_secs(1));
            let reader_stalled = !reader.is_finished();
            let _ = resume.send(());
            let read_result = reader.join();
            writer.join().unwrap();
            assert!(read_entered.is_ok());
            assert!(reader_stalled);
            assert!(result.unwrap().is_ok());
            assert!(read_result.unwrap().is_ok());
        }
    }

    #[test]
    fn move_primitives_never_replace_existing_files_folders_or_dangling_symlinks() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.md");
        let target = root.path().join("target.md");
        fs::write(&source, "source").unwrap();
        fs::write(&target, "target").unwrap();
        assert!(move_without_overwrite(&source, &target).is_err());
        assert!(move_file_by_link(&source, &target).is_err());
        assert_eq!(fs::read_to_string(&source).unwrap(), "source");
        assert_eq!(fs::read_to_string(&target).unwrap(), "target");
        let folder = root.path().join("folder");
        let existing_folder = root.path().join("existing");
        fs::create_dir(&folder).unwrap();
        fs::create_dir(&existing_folder).unwrap();
        assert!(move_without_overwrite(&folder, &existing_folder).is_err());
        assert!(move_file_by_link(&folder, &root.path().join("new")).is_err());
        assert!(folder.is_dir());
        assert!(existing_folder.is_dir());
        #[cfg(unix)]
        {
            let dangling = root.path().join("dangling");
            std::os::unix::fs::symlink("missing", &dangling).unwrap();
            assert!(move_without_overwrite(&source, &dangling).is_err());
            assert!(move_file_by_link(&source, &dangling).is_err());
            assert!(fs::symlink_metadata(dangling)
                .unwrap()
                .file_type()
                .is_symlink());
        }
        let new_target = root.path().join("linked.md");
        move_file_by_link(&source, &new_target).unwrap();
        assert!(!source.exists());
        assert_eq!(fs::read_to_string(new_target).unwrap(), "source");
    }

    #[test]
    fn slow_scan_does_not_block_note_saves_or_other_workspace_scans() {
        let config = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a.md"), "# Original").unwrap();
        fs::write(other.path().join("other.md"), "# Other").unwrap();
        let service = Arc::new(Service::new(config.path().to_path_buf()).unwrap());
        let id = service
            .add_workspace(root.path().to_str().unwrap())
            .unwrap()
            .workspace
            .id;
        let other_id = service
            .add_workspace(other.path().to_str().unwrap())
            .unwrap()
            .workspace
            .id;
        let revision = service.read_note(&id, "a.md").unwrap().revision;
        // Force a real cache miss, then pause only this service's ordinary note read.
        service.scan_cache.invalidate(&root.path().join("a.md"));
        service
            .scan_cache
            .invalidate(&other.path().join("other.md"));
        let (entered_sender, entered) = mpsc::channel();
        let (resume, resume_receiver) = mpsc::channel();
        *service.scan_cache.read_pause.lock().unwrap() = Some(ReadPause {
            path: root.path().join("a.md"),
            entered: entered_sender,
            resume: resume_receiver,
        });
        let scan_service = service.clone();
        let scan_id = id.clone();
        let scan = std::thread::spawn(move || scan_service.scan_workspace(&scan_id));
        let scan_entered = entered.recv_timeout(Duration::from_secs(1));
        let (save_sender, saved) = mpsc::channel();
        let save_service = service.clone();
        let save = std::thread::spawn(move || {
            let result = save_service.save_note(&id, "a.md", "# Saved", &revision);
            let _ = save_sender.send(result);
        });
        let (other_sender, other_scanned) = mpsc::channel();
        let other_scan = std::thread::spawn(move || {
            let _ = other_sender.send(service.scan_workspace(&other_id));
        });
        let saved_while_stalled = saved.recv_timeout(Duration::from_secs(1));
        let other_scanned_while_stalled = other_scanned.recv_timeout(Duration::from_secs(1));
        let scan_still_stalled = !scan.is_finished();
        // Always release and join all workers before asserting, including failure paths.
        let _ = resume.send(());
        let scan_result = scan.join();
        let save_result = save.join();
        let other_result = other_scan.join();
        assert!(scan_entered.is_ok(), "scan did not reach ordinary note I/O");
        assert!(
            scan_still_stalled,
            "scan was not held during concurrent operations"
        );
        assert!(saved_while_stalled.unwrap().is_ok());
        assert!(other_scanned_while_stalled.unwrap().is_ok());
        assert!(scan_result.unwrap().is_ok());
        save_result.unwrap();
        other_result.unwrap();
        assert_eq!(
            fs::read_to_string(root.path().join("a.md")).unwrap(),
            "# Saved"
        );
    }
}

#[cfg(test)]
#[path = "workspace_mutations_tests.rs"]
mod mutation_tests;
