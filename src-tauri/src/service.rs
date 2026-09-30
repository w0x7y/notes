use crate::incoming_links::rewrite_incoming;
use crate::markdown::first_h1;
use crate::model::{
    Appearance, DeleteResult, Entry, NoteFile, Preferences, RenameImageResult, Rewrite, SaveResult,
    Session, Settings, Snapshot, Stored, Workspace,
};
use crate::pathing::{
    clean_filename, normalized_relative, open_regular, read_regular_text, relative, resolve,
    unique_file,
};
use crate::scan_cache::ScanCache;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tempfile::NamedTempFile;
use walkdir::WalkDir;

// Apply the same boundary to indexing and incoming-link rewrites. Explicitly
// chosen workspace roots remain readable, even when their name is excluded.
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

pub struct Service {
    config_file: PathBuf,
    state: Mutex<Stored>,
    scan_cache: ScanCache,
    trash: Arc<dyn Trash>,
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

fn remap_tree_path(path: &str, old: &str, new: &str) -> Option<String> {
    (path == old || path.starts_with(&format!("{old}/")))
        .then(|| format!("{new}{}", &path[old.len()..]))
}

fn remove_session_path(settings: &mut Settings, id: &str, path: &str, folder: bool) {
    let matches = |candidate: &str| {
        candidate == path || (folder && candidate.starts_with(&format!("{path}/")))
    };
    if let Some(session) = settings.sessions.get_mut(id) {
        session.tabs.retain(|tab| !matches(tab));
        if session.primary.as_deref().is_some_and(matches) {
            session.primary = None;
        }
        if session.secondary.as_deref().is_some_and(matches) {
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
pub(crate) fn revision(content: &str) -> String {
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
    read_regular_text(path).map_err(|e| err("Cannot read note", e))
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
            serde_json::from_str(
                &read_regular_text(&config_file).map_err(|e| err("Cannot read settings", e))?,
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
    pub fn ensure_capture_workspace(&self, documents: &Path) -> Result<Snapshot, String> {
        fs::create_dir_all(documents).map_err(|e| err("Cannot create Documents directory", e))?;
        let documents = documents
            .canonicalize()
            .map_err(|e| err("Cannot resolve Documents directory", e))?;
        let root = resolve(&documents, "Quick Notes", false)?;
        fs::create_dir_all(&root).map_err(|e| err("Cannot create Quick Notes workspace", e))?;
        for name in ["Inbox", "Daily"] {
            let folder = resolve(&root, name, false)?;
            fs::create_dir_all(folder).map_err(|e| err("Cannot create capture folder", e))?;
        }
        self.add_workspace(root.to_str().ok_or("Workspace path is not valid UTF-8")?)
    }
    pub fn write_drawing_svg(&self, id: &str, svg: &str) -> Result<String, String> {
        crate::drawing::validate_svg(svg)?;
        let state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let selected = workspace(&state.settings, id)?;
        let root = Path::new(&selected.path);
        for folder in ["assets", "assets/drawings"] {
            let target = resolve(root, folder, false)?;
            fs::create_dir_all(target)
                .map_err(|e| err("Cannot create drawing assets folder", e))?;
        }
        let relative = format!("assets/drawings/{}.svg", revision(svg));
        let target = resolve(root, &relative, false)?;
        if target.exists() {
            let file = open_regular(&target).map_err(|e| err("Cannot read drawing preview", e))?;
            let mut existing = Vec::new();
            let length = svg.len() as u64;
            if file
                .metadata()
                .map_err(|e| err("Cannot inspect drawing preview", e))?
                .len()
                != length
            {
                return Err(
                    "Existing drawing preview has changed; refusing to overwrite it".into(),
                );
            }
            file.take(length + 1)
                .read_to_end(&mut existing)
                .map_err(|e| err("Cannot read drawing preview", e))?;
            if existing != svg.as_bytes() {
                return Err(
                    "Existing drawing preview has changed; refusing to overwrite it".into(),
                );
            }
        } else {
            let parent = target.parent().ok_or("Invalid drawing preview path")?;
            let mut temp = NamedTempFile::new_in(parent)
                .map_err(|e| err("Cannot create drawing preview", e))?;
            temp.write_all(svg.as_bytes())
                .map_err(|e| err("Cannot write drawing preview", e))?;
            temp.as_file()
                .sync_all()
                .map_err(|e| err("Cannot sync drawing preview", e))?;
            temp.persist_noclobber(&target)
                .map_err(|e| err("Cannot publish drawing preview", e.error))?;
            fs::File::open(parent)
                .and_then(|file| file.sync_all())
                .map_err(|e| err("Cannot sync drawing folder", e))?;
        }
        Ok(relative)
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
            .filter_entry(workspace_entry);
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
                    let (links, issues) =
                        self.rewrite_incoming(&state, &[(source.clone(), target.clone())], id);
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
            self.rewrite_incoming(&state, &[(source.clone(), target.clone())], id)
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
        let (rewritten, mut warnings) =
            self.rewrite_incoming(&state, &[(source.clone(), target.clone())], id);
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
        let metadata = fs::symlink_metadata(&target).map_err(|e| err("Cannot inspect entry", e))?;
        let folder = metadata.is_dir();
        if folder
            && state.settings.workspaces.iter().any(|other| {
                let other_root = Path::new(&other.path);
                other.id != id
                    && (target.starts_with(other_root) || other_root.starts_with(&target))
            })
        {
            return Err("This folder overlaps another open workspace. Remove that workspace from the app before deleting the folder.".into());
        }
        if !folder && !metadata.is_file() {
            return Err("Only regular files and folders can be moved to Trash".into());
        }
        if !folder && is_note(&target) {
            let expected = expected.ok_or("Revision is required to delete a note")?;
            if revision(&note_content(&target)?) != expected {
                return Err("Note changed externally. Reload before deleting.".into());
            }
        } else if !folder && !is_image(&target) {
            return Err("Only Markdown notes, supported images and folders can be deleted".into());
        }
        let path = normalized_relative(Path::new(&selected.path), &target)?;
        let matches = |candidate: &str| {
            candidate == path || (folder && candidate.starts_with(&format!("{path}/")))
        };
        let deletion = self.trash.delete(&target);
        self.scan_cache.invalidate(&target);
        deletion?;
        let workspace_prefix = format!("{id}\0");
        state
            .auto_names
            .retain(|entry, _| !entry.strip_prefix(&workspace_prefix).is_some_and(matches));
        if let Some(appearances) = state.settings.appearances.get_mut(id) {
            appearances.retain(|entry, _| !matches(entry));
            if appearances.is_empty() {
                state.settings.appearances.remove(id);
            }
        }
        remove_session_path(&mut state.settings, id, &path, folder);
        let mut warnings = Vec::new();
        if let Err(error) = self.persist(&state) {
            warnings.push(format!(
                "Entry moved to Trash, but metadata was not saved: {error}"
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

    pub fn move_folder(
        &self,
        id: &str,
        path: &str,
        destination: &str,
    ) -> Result<MoveFolderResult, String> {
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let selected = workspace(&state.settings, id)?.clone();
        let root = Path::new(&selected.path);
        let source = resolve(root, path, false)?;
        if !fs::symlink_metadata(&source)
            .map_err(|e| err("Cannot inspect folder", e))?
            .is_dir()
        {
            return Err("Only folders can be moved".into());
        }
        let requested = relative(destination, false)?;
        let name = requested.file_name().ok_or("Invalid folder name")?;
        if name.to_string_lossy().starts_with('.')
            || name.to_string_lossy().contains('\\')
            || name.to_string_lossy().chars().any(char::is_control)
            || matches!(name.to_str(), Some("node_modules" | "__pycache__"))
        {
            return Err("Folder name is hidden or excluded from the workspace".into());
        }
        let parent = requested.parent().unwrap_or(Path::new(""));
        let directory = resolve(root, parent.to_str().ok_or("Invalid destination")?, true)?;
        if !directory.is_dir() {
            return Err("Destination folder does not exist".into());
        }
        let target = directory.join(name);
        if target == source {
            return Ok(MoveFolderResult {
                path: path.into(),
                rewritten: Vec::new(),
                warnings: Vec::new(),
            });
        }
        if target.starts_with(&source) {
            return Err("Cannot move a folder into itself".into());
        }
        if fs::symlink_metadata(&target).is_ok() {
            return Err("An entry already exists at that path".into());
        }
        let mappings = WalkDir::new(&source)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.file_type().is_file() && (is_note(entry.path()) || is_image(entry.path()))
            })
            .map(|entry| {
                let old = entry.path().to_path_buf();
                let new = target.join(
                    old.strip_prefix(&source)
                        .map_err(|e| err("Cannot map moved file", e))?,
                );
                Ok((old, new))
            })
            .collect::<Result<Vec<_>, String>>()?;
        fs::rename(&source, &target).map_err(|e| err("Cannot move folder", e))?;
        self.scan_cache.remove_root(root);
        let new_path = normalized_relative(root, &target)?;
        if let Some(appearances) = state.settings.appearances.get_mut(id) {
            let old = std::mem::take(appearances);
            *appearances = old
                .into_iter()
                .map(|(key, value)| (remap_tree_path(&key, path, &new_path).unwrap_or(key), value))
                .collect();
        }
        if let Some(session) = state.settings.sessions.get_mut(id) {
            for tab in &mut session.tabs {
                if let Some(mapped) = remap_tree_path(tab, path, &new_path) {
                    *tab = mapped;
                }
            }
            if let Some(value) = &mut session.primary {
                if let Some(mapped) = remap_tree_path(value, path, &new_path) {
                    *value = mapped;
                }
            }
            if let Some(value) = &mut session.secondary {
                if let Some(mapped) = remap_tree_path(value, path, &new_path) {
                    *value = mapped;
                }
            }
        }
        let prefix = format!("{id}\0");
        let names = std::mem::take(&mut state.auto_names);
        state.auto_names = names
            .into_iter()
            .map(|(key, value)| {
                let mapped = key
                    .strip_prefix(&prefix)
                    .and_then(|item| remap_tree_path(item, path, &new_path));
                (
                    mapped.map(|item| format!("{prefix}{item}")).unwrap_or(key),
                    value,
                )
            })
            .collect();
        let (rewritten, mut warnings) = self.rewrite_incoming(&state, &mappings, id);
        if let Err(error) = self.persist(&state) {
            warnings.push(format!(
                "Folder moved, but workspace settings were not saved: {error}"
            ));
        }
        Ok(MoveFolderResult {
            path: new_path,
            rewritten,
            warnings,
        })
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
    fn rewrite_incoming(
        &self,
        state: &Stored,
        mappings: &[(PathBuf, PathBuf)],
        target_workspace_id: &str,
    ) -> (Vec<Rewrite>, Vec<String>) {
        rewrite_incoming(
            &state.settings.workspaces,
            target_workspace_id,
            mappings,
            |path, bytes| self.write_note_file(path, bytes),
        )
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan_cache::ReadPause;
    use std::sync::mpsc;
    use std::time::Duration;

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
