use crate::markdown::{first_h1, rewrite_links, tags, LinkRewrite};
use crate::model::{
    Entry, NoteFile, Rewrite, SaveResult, Session, Settings, Snapshot, Stored, Workspace,
};
use crate::pathing::{clean_filename, normalized_relative, relative, resolve, unique_file};
use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tempfile::NamedTempFile;
use walkdir::WalkDir;

pub struct Service {
    config_file: PathBuf,
    state: Mutex<Stored>,
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
        fs::create_dir_all(&config_dir)
            .map_err(|e| err("Cannot create app config directory", e))?;
        let config_file = config_dir.join("notes.json");
        let state = if config_file.exists() {
            serde_json::from_slice(
                &fs::read(&config_file).map_err(|e| err("Cannot read settings", e))?,
            )
            .map_err(|e| err("Cannot parse settings", e))?
        } else {
            Stored::default()
        };
        Ok(Self {
            config_file,
            state: Mutex::new(state),
        })
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
            let content = if kind == "note" {
                fs::read_to_string(path).unwrap_or_default()
            } else {
                String::new()
            };
            let title = if kind == "note" {
                first_h1(&content)
            } else {
                None
            }
            .unwrap_or_else(|| {
                path.file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            });
            let modified = found
                .metadata()
                .map_err(|e| err("Cannot read file metadata", e))?
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            entries.push(Entry {
                path: path_str.replace('\\', "/"),
                kind: kind.into(),
                title,
                tags: if kind == "note" {
                    tags(&content)
                } else {
                    Vec::new()
                },
                modified,
            });
        }
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
        atomic_write(&source, content.as_bytes())?;
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
            match move_without_overwrite(&source, &target) {
                Ok(()) => {
                    let new_path = normalized_relative(root, &target)?;
                    state.auto_names.remove(&key(id, path));
                    state.auto_names.insert(key(id, &new_path), true);
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
        let destination_dir = if parent.as_os_str().is_empty() {
            source.parent().ok_or("Invalid note path")?.to_path_buf()
        } else {
            resolve(root, parent.to_str().ok_or("Invalid destination")?, false)?
        };
        if !destination_dir.is_dir() {
            return Err("Destination folder does not exist".into());
        }
        let target = destination_dir.join(format!("{clean}.md"));
        if target != source && target.exists() {
            return Err("A note already exists at that path".into());
        }
        let (rewritten, mut warnings) = if target != source {
            move_without_overwrite(&source, &target)?;
            self.rewrite_incoming(&state, &source, &target, id)
        } else {
            (Vec::new(), Vec::new())
        };
        state.auto_names.remove(&key(id, path));
        if let Err(error) = self.persist(&state) {
            warnings.push(format!(
                "Note renamed, but filename settings were not saved: {error}"
            ));
        }
        Ok(SaveResult {
            note: NoteFile {
                path: normalized_relative(root, &target)?,
                content: content.clone(),
                revision: revision(&content),
                auto_rename: false,
            },
            rewritten,
            warnings,
        })
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
        let mut warnings = Vec::new();
        for selected in &state.settings.workspaces {
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
                    Ok(entry)
                        if entry.file_type().is_file()
                            && entry
                                .path()
                                .extension()
                                .and_then(|s| s.to_str())
                                .is_some_and(|e| e.eq_ignore_ascii_case("md")) =>
                    {
                        notes.push((selected, entry.path().to_path_buf()))
                    }
                    _ => {}
                }
            }
        }
        let unique = notes.iter().all(|(_, p)| p.file_stem() != old.file_stem());
        let new_ambiguous = notes
            .iter()
            .any(|(_, p)| p != new && p.file_stem() == new.file_stem());
        let Some(target_workspace) = state
            .settings
            .workspaces
            .iter()
            .find(|w| w.id == target_workspace_id)
        else {
            warnings.push("Cannot identify renamed note workspace for link updates".into());
            return (Vec::new(), warnings);
        };
        let target_stem =
            match normalized_relative(Path::new(&target_workspace.path), &new.with_extension("")) {
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
                },
            );
            if changed == content {
                continue;
            }
            if let Err(e) = atomic_write(&note_path, changed.as_bytes()) {
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
