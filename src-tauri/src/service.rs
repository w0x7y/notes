use crate::markdown::{first_h1, rewrite_links, LinkRewrite};
use crate::model::{
    Appearance, DeleteResult, Entry, NoteFile, Preferences, RenameImageResult, Rewrite, SaveResult,
    Session, Settings, Snapshot, Stored, Workspace,
};
use crate::pathing::{clean_filename, normalized_relative, relative, resolve, unique_file};
use crate::scan_cache::ScanCache;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tempfile::NamedTempFile;
use walkdir::WalkDir;

pub struct Service {
    config_file: PathBuf,
    state: Mutex<Stored>,
    scan_cache: ScanCache,
    trash: Arc<dyn Trash>,
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

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|ext| {
            ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]
                .iter()
                .any(|supported| ext.eq_ignore_ascii_case(supported))
        })
}

fn is_note(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

fn move_appearance(settings: &mut Settings, id: &str, old: &str, new: &str) {
    if let Some(appearance) = settings.appearances.get_mut(id) {
        if let Some(value) = appearance.remove(old) {
            appearance.insert(new.into(), value);
        }
    }
}

fn move_session_path(settings: &mut Settings, id: &str, old: &str, new: &str) {
    if let Some(session) = settings.sessions.get_mut(id) {
        for tab in &mut session.tabs {
            if tab == old {
                *tab = new.into();
            }
        }
        if session.primary.as_deref() == Some(old) {
            session.primary = Some(new.into());
        }
        if session.secondary.as_deref() == Some(old) {
            session.secondary = Some(new.into());
        }
    }
}

fn remove_session_path(settings: &mut Settings, id: &str, path: &str) {
    if let Some(session) = settings.sessions.get_mut(id) {
        session.tabs.retain(|tab| tab != path);
        if session.primary.as_deref() == Some(path) {
            session.primary = None;
        }
        if session.secondary.as_deref() == Some(path) {
            session.secondary = None;
        }
        if session.primary.is_none() && session.secondary.is_some() {
            session.primary = session.secondary.take();
        }
        if session.secondary.is_none() {
            session.split = false;
        }
    }
}
fn err(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}
fn revision(content: &str) -> String {
    hex::encode(Sha256::digest(content.as_bytes()))
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid file path")?;
    let mut temp =
        NamedTempFile::new_in(parent).map_err(|e| err("Cannot create temporary file", e))?;
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            return Err("Refusing to replace a symlink".into());
        }
        fs::set_permissions(temp.path(), metadata.permissions())
            .map_err(|e| err("Cannot preserve file permissions", e))?;
    }
    temp.write_all(bytes)
        .map_err(|e| err("Cannot write temporary file", e))?;
    temp.as_file()
        .sync_all()
        .map_err(|e| err("Cannot sync temporary file", e))?;
    temp.persist(path)
        .map_err(|e| err("Cannot replace file", e.error))?;
    fs::File::open(parent)
        .map_err(|e| err("Cannot open parent directory", e))?
        .sync_all()
        .map_err(|e| err("Cannot sync parent directory", e))
}
fn note_content(path: &Path) -> Result<String, String> {
    if path
        .extension()
        .and_then(|v| v.to_str())
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("md"))
    {
        return Err("Only Markdown notes can be opened".into());
    }
    fs::read_to_string(path).map_err(|e| err("Cannot read note", e))
}
fn workspace<'a>(settings: &'a Settings, id: &str) -> Result<&'a Workspace, String> {
    settings
        .workspaces
        .iter()
        .find(|w| w.id == id)
        .ok_or_else(|| "Workspace is not registered".into())
}
fn key(id: &str, path: &str) -> String {
    format!("{id}\0{path}")
}

impl Service {
    pub fn new(config_dir: PathBuf) -> Result<Self, String> {
        Self::with_trash(config_dir, Arc::new(DesktopTrash))
    }

    pub fn with_trash(config_dir: PathBuf, trash: Arc<dyn Trash>) -> Result<Self, String> {
        fs::create_dir_all(&config_dir)
            .map_err(|e| err("Cannot create app config directory", e))?;
        let config_file = config_dir.join("notes.json");
        let state: Stored = if config_file.exists() {
            serde_json::from_slice(
                &fs::read(&config_file).map_err(|e| err("Cannot read settings", e))?,
            )
            .map_err(|e| err("Cannot parse settings", e))?
        } else {
            Stored::default()
        };
        state.settings.preferences.validate()?;
        Ok(Self {
            config_file,
            state: Mutex::new(state),
            scan_cache: ScanCache::default(),
            trash,
        })
    }
    fn write_note_file(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
        // Do not wait on the cache between revision validation and the actual write.
        let result = atomic_write(path, bytes);
        self.scan_cache.invalidate(path);
        result
    }
    fn move_file(&self, source: &Path, target: &Path) -> Result<(), String> {
        let result = move_without_overwrite(source, target);
        self.scan_cache.invalidate(source);
        self.scan_cache.invalidate(target);
        result
    }
    fn persist(&self, state: &Stored) -> Result<(), String> {
        atomic_write(
            &self.config_file,
            &serde_json::to_vec_pretty(state).map_err(|e| err("Cannot encode settings", e))?,
        )
    }
    pub fn load_settings(&self) -> Result<Settings, String> {
        Ok(self
            .state
            .lock()
            .map_err(|_| "Settings lock failed")?
            .settings
            .clone())
    }
    pub fn save_preferences(&self, preferences: Preferences) -> Result<Preferences, String> {
        preferences.validate()?;
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let mut next = state.clone();
        next.settings.preferences = preferences.clone();
        self.persist(&next)?;
        *state = next;
        Ok(preferences)
    }

    pub fn set_entry_appearance(
        &self,
        id: &str,
        path: &str,
        appearance: Appearance,
    ) -> Result<Appearance, String> {
        if appearance.icon.as_ref().is_some_and(|icon| {
            icon.is_empty()
                || icon.starts_with('-')
                || icon.ends_with('-')
                || icon.contains("--")
                || !icon
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
        }) {
            return Err("Icon must be a Lucide kebab-case ID".into());
        }
        if appearance.color.as_ref().is_some_and(|color| {
            color.len() != 7
                || !color.starts_with('#')
                || !color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
        }) {
            return Err("Color must be #RRGGBB".into());
        }
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let selected = workspace(&state.settings, id)?;
        let target = resolve(Path::new(&selected.path), path, false)?;
        let metadata = fs::symlink_metadata(&target).map_err(|e| err("Cannot inspect entry", e))?;
        if !metadata.is_dir() && !(metadata.is_file() && (is_note(&target) || is_image(&target))) {
            return Err("Appearance requires a note, image, or folder".into());
        }
        let mut next = state.clone();
        let entries = next.settings.appearances.entry(id.into()).or_default();
        if appearance == Appearance::default() {
            entries.remove(path);
        } else {
            entries.insert(path.into(), appearance.clone());
        }
        if entries.is_empty() {
            next.settings.appearances.remove(id);
        }
        self.persist(&next)?;
        *state = next;
        Ok(appearance)
    }

    pub fn remove_workspace(&self, id: &str) -> Result<Settings, String> {
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let root = PathBuf::from(&workspace(&state.settings, id)?.path);
        let mut next = state.clone();
        next.settings
            .workspaces
            .retain(|workspace| workspace.id != id);
        next.settings.sessions.remove(id);
        next.settings.appearances.remove(id);
        next.auto_names
            .retain(|name, _| !name.starts_with(&format!("{id}\0")));
        if next.settings.active_workspace_id.as_deref() == Some(id) {
            next.settings.active_workspace_id =
                next.settings.workspaces.first().map(|w| w.id.clone());
        }
        self.persist(&next)?;
        *state = next;
        self.scan_cache.remove_root(&root);
        Ok(state.settings.clone())
    }
    pub fn save_sessions(
        &self,
        sessions: HashMap<String, Session>,
        active_workspace_id: Option<String>,
        toolbar_visible: bool,
    ) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        if let Some(ref id) = active_workspace_id {
            workspace(&state.settings, id)?;
        }
        state.settings.sessions = sessions;
        state.settings.active_workspace_id = active_workspace_id;
        state.settings.toolbar_visible = toolbar_visible;
        self.persist(&state)
    }
    pub fn add_workspace(&self, path: &str) -> Result<Snapshot, String> {
        let root = Path::new(path)
            .canonicalize()
            .map_err(|e| err("Cannot open workspace", e))?;
        if !root.is_dir() {
            return Err("Workspace must be a folder".into());
        }
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let canonical = root.to_string_lossy().to_string();
        let selected = if let Some(existing) = state
            .settings
            .workspaces
            .iter()
            .find(|w| w.path == canonical)
        {
            existing.clone()
        } else {
            let selected = Workspace {
                id: uuid::Uuid::new_v4().to_string(),
                name: root
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                path: canonical,
                color: "#61afef".into(),
                icon: "book".into(),
            };
            state.settings.workspaces.push(selected.clone());
            if state.settings.active_workspace_id.is_none() {
                state.settings.active_workspace_id = Some(selected.id.clone());
            }
            self.persist(&state)?;
            selected
        };
        drop(state);
        self.scan(&selected)
    }
    pub fn update_workspace(
        &self,
        id: &str,
        name: &str,
        color: &str,
        icon: &str,
    ) -> Result<Workspace, String> {
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let selected = state
            .settings
            .workspaces
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or("Workspace is not registered")?;
        if name.trim().is_empty() {
            return Err("Workspace name cannot be empty".into());
        }
        selected.name = name.trim().to_string();
        selected.color = color.into();
        selected.icon = icon.into();
        let result = selected.clone();
        self.persist(&state)?;
        Ok(result)
    }
    fn scan(&self, selected: &Workspace) -> Result<Snapshot, String> {
        let root = Path::new(&selected.path)
            .canonicalize()
            .map_err(|e| err("Cannot open workspace", e))?;
        if root != Path::new(&selected.path) {
            return Err("Registered workspace folder has moved or become a symlink".into());
        }
        let mut seen = HashSet::new();
        let mut entries = Vec::new();
        let walk = WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                entry.depth() == 0
                    || (!entry.file_type().is_symlink()
                        && (!entry.file_type().is_dir()
                            || !entry.file_name().to_string_lossy().starts_with('.')))
            });
        for found in walk {
            let found = found.map_err(|e| err("Cannot scan workspace", e))?;
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
            let metadata = found
                .metadata()
                .map_err(|e| err("Cannot read file metadata", e))?;
            let (title, tags) = if kind == "note" {
                seen.insert(path.to_path_buf());
                self.scan_cache.metadata(&root, path, &metadata)
            } else {
                (None, Vec::new())
            };
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
                modified,
            });
        }
        self.scan_cache.finish(&root, &seen);
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(Snapshot {
            workspace: selected.clone(),
            entries,
        })
    }
    pub fn scan_workspace(&self, id: &str) -> Result<Snapshot, String> {
        let selected = workspace(
            &self
                .state
                .lock()
                .map_err(|_| "Settings lock failed")?
                .settings,
            id,
        )?
        .clone();
        self.scan(&selected)
    }
    pub fn read_note(&self, id: &str, path: &str) -> Result<NoteFile, String> {
        let state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let selected = workspace(&state.settings, id)?;
        let content = note_content(&resolve(Path::new(&selected.path), path, false)?)?;
        Ok(NoteFile {
            path: path.into(),
            revision: revision(&content),
            content,
            auto_rename: state
                .auto_names
                .get(&key(id, path))
                .copied()
                .unwrap_or(false),
        })
    }
    pub fn create_note(&self, id: &str, folder: &str) -> Result<NoteFile, String> {
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let selected = workspace(&state.settings, id)?.clone();
        let root = Path::new(&selected.path);
        let parent = resolve(root, folder, true)?;
        if !parent.is_dir() {
            return Err("Note folder does not exist".into());
        }
        let target = loop {
            let candidate = unique_file(&parent, "Untitled", None)?;
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&candidate)
            {
                Ok(file) => {
                    file.sync_all()
                        .map_err(|e| err("Cannot sync new note", e))?;
                    break candidate;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(err("Cannot create note", e)),
            }
        };
        let path = normalized_relative(root, &target)?;
        state.auto_names.insert(key(id, &path), true);
        if let Err(error) = self.persist(&state) {
            state.auto_names.remove(&key(id, &path));
            if let Err(cleanup) = fs::remove_file(&target) {
                return Err(format!(
                    "{error}; new empty note remains at {path}: {cleanup}"
                ));
            }
            return Err(error);
        }
        Ok(NoteFile {
            path,
            content: String::new(),
            revision: revision(""),
            auto_rename: true,
        })
    }
    pub fn save_note(
        &self,
        id: &str,
        path: &str,
        content: &str,
        expected: &str,
    ) -> Result<SaveResult, String> {
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let selected = workspace(&state.settings, id)?.clone();
        let root = Path::new(&selected.path);
        let source = resolve(root, path, false)?;
        let current = note_content(&source)?;
        if revision(&current) != expected {
            return Err("Note changed externally. Reload or copy your edits before saving.".into());
        }
        self.write_note_file(&source, content.as_bytes())?;
        let auto = state
            .auto_names
            .get(&key(id, path))
            .copied()
            .unwrap_or(false);
        let mut target = source.clone();
        let mut warnings = Vec::new();
        if auto {
            let title = clean_filename(first_h1(content).as_deref().unwrap_or("Untitled"));
            match unique_file(
                source.parent().ok_or("Invalid note path")?,
                &title,
                Some(&source),
            ) {
                Ok(destination) => target = destination,
                Err(error) => warnings.push(format!(
                    "Content saved, but automatic rename failed: {error}"
                )),
            }
        }
        let mut rewritten = Vec::new();
        if target != source {
            match self.move_file(&source, &target) {
                Ok(()) => {
                    let new_path = normalized_relative(root, &target)?;
                    state.auto_names.remove(&key(id, path));
                    state.auto_names.insert(key(id, &new_path), true);
                    move_appearance(&mut state.settings, id, path, &new_path);
                    move_session_path(&mut state.settings, id, path, &new_path);
                    let (links, issues) = self.rewrite_incoming(&state, &source, &target, id);
                    rewritten = links;
                    warnings.extend(issues);
                    if let Err(error) = self.persist(&state) {
                        warnings.push(format!(
                            "Note renamed, but filename settings were not saved: {error}"
                        ));
                    }
                }
                Err(error) => {
                    warnings.push(format!(
                        "Content saved, but automatic rename failed: {error}"
                    ));
                    target = source.clone();
                }
            }
        }
        Ok(SaveResult {
            note: NoteFile {
                path: normalized_relative(root, &target)?,
                content: content.into(),
                revision: revision(content),
                auto_rename: auto,
            },
            rewritten,
            warnings,
        })
    }
    pub fn rename_note(
        &self,
        id: &str,
        path: &str,
        name: &str,
        expected: &str,
    ) -> Result<SaveResult, String> {
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let selected = workspace(&state.settings, id)?.clone();
        let root = Path::new(&selected.path);
        let source = resolve(root, path, false)?;
        let content = note_content(&source)?;
        if revision(&content) != expected {
            return Err(
                "Note changed externally. Reload or copy your edits before renaming.".into(),
            );
        }
        let requested = relative(name, false)?;
        let parent = requested.parent().unwrap_or(Path::new(""));
        let file_name = requested
            .file_name()
            .ok_or("Invalid note name")?
            .to_string_lossy();
        let stem = file_name.strip_suffix(".md").unwrap_or(&file_name);
        let clean = clean_filename(stem);
        let destination_dir = resolve(root, parent.to_str().ok_or("Invalid destination")?, true)?;
        if !destination_dir.is_dir() {
            return Err("Destination folder does not exist".into());
        }
        let target = destination_dir.join(format!("{clean}.md"));
        if target != source && fs::symlink_metadata(&target).is_ok() {
            return Err("A note already exists at that path".into());
        }
        let (rewritten, mut warnings) = if target != source {
            self.move_file(&source, &target)?;
            self.rewrite_incoming(&state, &source, &target, id)
        } else {
            (Vec::new(), Vec::new())
        };
        let new_path = normalized_relative(root, &target)?;
        state.auto_names.remove(&key(id, path));
        if target != source {
            move_appearance(&mut state.settings, id, path, &new_path);
            move_session_path(&mut state.settings, id, path, &new_path);
        }
        if let Err(error) = self.persist(&state) {
            warnings.push(format!(
                "Note renamed, but filename settings were not saved: {error}"
            ));
        }
        Ok(SaveResult {
            note: NoteFile {
                path: new_path,
                content: content.clone(),
                revision: revision(&content),
                auto_rename: false,
            },
            rewritten,
            warnings,
        })
    }
    pub fn rename_image(
        &self,
        id: &str,
        path: &str,
        name: &str,
    ) -> Result<RenameImageResult, String> {
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let selected = workspace(&state.settings, id)?.clone();
        let root = Path::new(&selected.path);
        let source = resolve(root, path, false)?;
        if !is_image(&source)
            || !fs::symlink_metadata(&source)
                .map_err(|e| err("Cannot inspect image", e))?
                .is_file()
        {
            return Err("Only supported image files can be renamed".into());
        }
        let requested = relative(name, false)?;
        let requested_name = requested
            .file_name()
            .ok_or("Invalid image name")?
            .to_string_lossy();
        let extension = source
            .extension()
            .and_then(|ext| ext.to_str())
            .ok_or("Invalid image extension")?;
        let stem = if let Some((stem, requested_extension)) = requested_name.rsplit_once('.') {
            if !requested_extension.eq_ignore_ascii_case(extension) {
                return Err("Image extension cannot change".into());
            }
            stem
        } else {
            &requested_name
        };
        let clean = clean_filename(stem);
        let parent = requested.parent().unwrap_or(Path::new(""));
        let destination_dir = resolve(root, parent.to_str().ok_or("Invalid destination")?, true)?;
        if !destination_dir.is_dir() {
            return Err("Destination folder does not exist".into());
        }
        let target = destination_dir.join(format!("{clean}.{extension}"));
        if target != source && fs::symlink_metadata(&target).is_ok() {
            return Err("An image already exists at that path".into());
        }
        if target == source {
            return Ok(RenameImageResult {
                path: path.into(),
                rewritten: Vec::new(),
                warnings: Vec::new(),
            });
        }
        self.move_file(&source, &target)?;
        let new_path = normalized_relative(root, &target)?;
        move_appearance(&mut state.settings, id, path, &new_path);
        move_session_path(&mut state.settings, id, path, &new_path);
        let (rewritten, mut warnings) = self.rewrite_incoming(&state, &source, &target, id);
        if let Err(error) = self.persist(&state) {
            warnings.push(format!(
                "Image renamed, but appearance settings were not saved: {error}"
            ));
        }
        Ok(RenameImageResult {
            path: new_path,
            rewritten,
            warnings,
        })
    }

    pub fn delete_file(
        &self,
        id: &str,
        path: &str,
        expected: Option<&str>,
    ) -> Result<DeleteResult, String> {
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let selected = workspace(&state.settings, id)?;
        let target = resolve(Path::new(&selected.path), path, false)?;
        if !fs::symlink_metadata(&target)
            .map_err(|e| err("Cannot inspect file", e))?
            .is_file()
        {
            return Err("Only files can be moved to Trash".into());
        }
        if is_note(&target) {
            let expected = expected.ok_or("Revision is required to delete a note")?;
            if revision(&note_content(&target)?) != expected {
                return Err("Note changed externally. Reload before deleting.".into());
            }
        } else if !is_image(&target) {
            return Err("Only Markdown notes and supported images can be deleted".into());
        }
        let deletion = self.trash.delete(&target);
        self.scan_cache.invalidate(&target);
        deletion?;
        state.auto_names.remove(&key(id, path));
        if let Some(appearances) = state.settings.appearances.get_mut(id) {
            appearances.remove(path);
            if appearances.is_empty() {
                state.settings.appearances.remove(id);
            }
        }
        remove_session_path(&mut state.settings, id, path);
        let mut warnings = Vec::new();
        if let Err(error) = self.persist(&state) {
            warnings.push(format!(
                "File moved to Trash, but metadata was not saved: {error}"
            ));
        }
        Ok(DeleteResult { warnings })
    }
    pub fn create_folder(&self, id: &str, parent: &str, name: &str) -> Result<(), String> {
        let state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let selected = workspace(&state.settings, id)?;
        if name.is_empty()
            || name == "."
            || name == ".."
            || name.contains('/')
            || name.contains('\\')
            || name.chars().any(char::is_control)
        {
            return Err("Invalid folder name".into());
        }
        let base = resolve(Path::new(&selected.path), parent, true)?;
        if !base.is_dir() {
            return Err("Parent folder does not exist".into());
        }
        fs::create_dir(base.join(name)).map_err(|e| err("Cannot create folder", e))
    }
    pub fn read_image(&self, id: &str, path: &str) -> Result<ImageData, String> {
        let state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let selected = workspace(&state.settings, id)?;
        let full = resolve(Path::new(&selected.path), path, false)?;
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
        if fs::metadata(&full)
            .map_err(|e| err("Cannot inspect image", e))?
            .len()
            > 20 * 1024 * 1024
        {
            return Err("Image exceeds 20 MB limit".into());
        }
        Ok(ImageData {
            data: base64::engine::general_purpose::STANDARD
                .encode(fs::read(full).map_err(|e| err("Cannot read image", e))?),
            mime: mime.into(),
        })
    }
    fn rewrite_incoming(
        &self,
        state: &Stored,
        old: &Path,
        new: &Path,
        target_workspace_id: &str,
    ) -> (Vec<Rewrite>, Vec<String>) {
        let mut notes = Vec::new();
        let mut matching_targets = Vec::new();
        let image = is_image(old);
        let mut warnings = Vec::new();
        for selected in &state.settings.workspaces {
            if image && selected.id != target_workspace_id {
                continue;
            }
            if Path::new(&selected.path).canonicalize().ok().as_deref()
                != Some(Path::new(&selected.path))
            {
                warnings.push(format!(
                    "Cannot scan links in workspace {}: folder moved or became a symlink",
                    selected.name
                ));
                continue;
            }
            for found in WalkDir::new(&selected.path)
                .follow_links(false)
                .into_iter()
                .filter_entry(|e| {
                    !e.file_type().is_symlink()
                        && (e.depth() == 0
                            || !e.file_type().is_dir()
                            || !e.file_name().to_string_lossy().starts_with('.'))
                })
            {
                match found {
                    Ok(entry) if entry.file_type().is_file() => {
                        if is_note(entry.path()) {
                            notes.push((selected, entry.path().to_path_buf()));
                        }
                        if (image && is_image(entry.path())) || (!image && is_note(entry.path())) {
                            matching_targets.push(entry.path().to_path_buf());
                        }
                    }
                    _ => {}
                }
            }
        }
        let unique = matching_targets.iter().all(|p| {
            p == new
                || if image {
                    p.file_name() != old.file_name()
                } else {
                    p.file_stem() != old.file_stem()
                }
        });
        let new_ambiguous = matching_targets.iter().any(|p| {
            p != new
                && if image {
                    p.file_name() == new.file_name()
                } else {
                    p.file_stem() == new.file_stem()
                }
        });
        let Some(target_workspace) = state
            .settings
            .workspaces
            .iter()
            .find(|w| w.id == target_workspace_id)
        else {
            warnings.push("Cannot identify renamed note workspace for link updates".into());
            return (Vec::new(), warnings);
        };
        let target_link = if image {
            new.to_path_buf()
        } else {
            new.with_extension("")
        };
        let target_stem = match normalized_relative(Path::new(&target_workspace.path), &target_link)
        {
            Ok(stem) => stem,
            Err(error) => {
                warnings.push(error);
                return (Vec::new(), warnings);
            }
        };
        let mut rewritten = Vec::new();
        for (selected, note_path) in notes {
            if note_path == new {
                continue;
            }
            let root = Path::new(&selected.path);
            let Ok(path) = normalized_relative(root, &note_path) else {
                continue;
            };
            let content = match fs::read_to_string(&note_path) {
                Ok(c) => c,
                Err(e) => {
                    warnings.push(format!("Cannot read links in {path}: {e}"));
                    continue;
                }
            };
            let qualified = if selected.id == target_workspace_id {
                format!("/{target_stem}")
            } else {
                format!("{target_workspace_id}:{target_stem}")
            };
            let bare = if new_ambiguous {
                qualified.as_str()
            } else if image {
                new.file_name().unwrap_or_default().to_str().unwrap_or("")
            } else {
                new.file_stem().unwrap_or_default().to_str().unwrap_or("")
            };
            let changed = rewrite_links(
                &content,
                &LinkRewrite {
                    source: &note_path,
                    source_root: root,
                    old,
                    new,
                    target_root: Path::new(&target_workspace.path),
                    target_workspace_id,
                    unique_basename: unique,
                    bare_destination: bare,
                    qualified_destination: &qualified,
                    image,
                },
            );
            if changed == content {
                continue;
            }
            if let Err(e) = self.write_note_file(&note_path, changed.as_bytes()) {
                warnings.push(format!("Cannot update links in {path}: {e}"));
                continue;
            }
            rewritten.push(Rewrite {
                workspace_id: selected.id.clone(),
                path,
                revision: revision(&changed),
                content: changed,
            });
        }
        (rewritten, warnings)
    }
}
fn move_without_overwrite(source: &Path, target: &Path) -> Result<(), String> {
    fs::hard_link(source, target).map_err(|e| err("Cannot rename note without overwriting", e))?;
    if let Err(e) = fs::remove_file(source) {
        let _ = fs::remove_file(target);
        return Err(err("Cannot remove old note after rename", e));
    }
    Ok(())
}
#[derive(serde::Serialize)]
pub struct ImageData {
    pub data: String,
    pub mime: String,
}
