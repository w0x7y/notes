use crate::incoming_links::rewrite_incoming;
use crate::markdown::first_h1;
use crate::model::{
    Appearance, DeleteResult, NoteFile, Preferences, RenameImageResult, Rewrite, SaveResult,
    Session, Settings, Stored, Workspace,
};
use crate::pathing::{
    clean_filename, normalized_relative, open_regular, relative, resolve, unique_file,
    MAX_NOTE_BYTES,
};
use crate::scan_cache::ScanCache;
use crate::service::{err, is_image, is_note, note_content, revision, MoveFolderResult, Trash};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tempfile::NamedTempFile;
use walkdir::WalkDir;

/// Owns admission, revision checks, file commits, link rewrites and metadata
/// follow-up. Only this module acquires the mutation guard. Settings-only work
/// never acquires it; settings guards never survive into workspace file I/O.
pub(crate) struct WorkspaceMutations {
    order: Mutex<()>,
    config_file: PathBuf,
    state: Mutex<Stored>,
    scan_cache: Arc<ScanCache>,
    trash: Arc<dyn Trash>,
    roots_generation: AtomicU64,
    #[cfg(test)]
    pub(crate) hooks: TestHooks,
}

struct MutationContext {
    selected: Workspace,
    roots: Vec<Workspace>,
    auto_rename: bool,
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

fn validate_icon(icon: &str) -> Result<(), String> {
    if icon.is_empty()
        || icon.starts_with('-')
        || icon.ends_with('-')
        || icon.contains("--")
        || !icon
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        return Err("Icon must be a Lucide kebab-case ID".into());
    }
    Ok(())
}

fn validate_color(color: &str) -> Result<(), String> {
    if color.len() != 7
        || !color.starts_with('#')
        || !color[1..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Color must be #RRGGBB".into());
    }
    Ok(())
}

fn validate_destination(path: &Path, folder: bool) -> Result<(), String> {
    let components: Vec<_> = path.components().collect();
    for (index, part) in components.iter().enumerate() {
        let name = part.as_os_str().to_string_lossy();
        let directory = folder || index + 1 < components.len();
        if directory
            && (name.starts_with('.') || matches!(name.as_ref(), "node_modules" | "__pycache__"))
        {
            return Err("Destination folder is hidden or excluded from the workspace".into());
        }
    }
    Ok(())
}

fn decode_settings(bytes: &[u8]) -> (Stored, bool) {
    let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return (Stored::default(), true);
    };
    let mut recovered = false;
    if let Some(preferences) = value.get("preferences") {
        if serde_json::from_value::<Preferences>(preferences.clone())
            .ok()
            .is_none_or(|preferences| preferences.validate().is_err())
        {
            value["preferences"] = serde_json::to_value(Preferences::default()).unwrap();
            recovered = true;
        }
    }
    match serde_json::from_value(value) {
        Ok(state) => (state, recovered),
        Err(_) => (Stored::default(), true),
    }
}

fn preserve_settings(config_dir: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut backup = NamedTempFile::new_in(config_dir)
        .map_err(|e| err("Cannot create settings recovery backup", e))?;
    backup
        .write_all(bytes)
        .map_err(|e| err("Cannot back up settings", e))?;
    backup
        .as_file()
        .sync_all()
        .map_err(|e| err("Cannot sync settings backup", e))?;
    let target = config_dir.join(format!("notes.json.recovery-{}.bak", uuid::Uuid::new_v4()));
    backup
        .persist_noclobber(target)
        .map_err(|e| err("Cannot preserve settings backup", e.error))?;
    fs::File::open(config_dir)
        .and_then(|file| file.sync_all())
        .map_err(|e| err("Cannot sync settings backup directory", e))
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

fn publish_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
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
    Ok(())
}

fn sync_parent(path: &Path) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid file path")?;
    fs::File::open(parent)
        .map_err(|e| err("Cannot open parent directory", e))?
        .sync_all()
        .map_err(|e| err("Cannot sync parent directory", e))
}

// Settings preserve their existing failure semantics, including directory sync.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    publish_atomic(path, bytes)?;
    sync_parent(path)
}

impl WorkspaceMutations {
    pub fn new(
        config_dir: PathBuf,
        trash: Arc<dyn Trash>,
        scan_cache: Arc<ScanCache>,
    ) -> Result<Self, String> {
        fs::create_dir_all(&config_dir)
            .map_err(|e| err("Cannot create app config directory", e))?;
        let config_file = config_dir.join("notes.json");
        let state: Stored = match fs::symlink_metadata(&config_file) {
            Ok(_) => {
                let mut bytes = Vec::new();
                open_regular(&config_file)
                    .and_then(|mut file| file.read_to_end(&mut bytes))
                    .map_err(|e| err("Cannot read settings", e))?;
                let (state, recovered) = decode_settings(&bytes);
                if recovered {
                    preserve_settings(&config_dir, &bytes)?;
                    atomic_write(
                        &config_file,
                        &serde_json::to_vec_pretty(&state)
                            .map_err(|e| err("Cannot encode recovered settings", e))?,
                    )?;
                }
                state
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Stored::default(),
            Err(error) => return Err(err("Cannot inspect settings", error)),
        };
        state.settings.preferences.validate()?;
        Ok(Self {
            config_file,
            state: Mutex::new(state),
            scan_cache,
            order: Mutex::new(()),
            trash,
            roots_generation: AtomicU64::new(0),
            #[cfg(test)]
            hooks: TestHooks::default(),
        })
    }
    fn admit(&self) -> Result<MutexGuard<'_, ()>, String> {
        #[cfg(test)]
        if let Some(attempted) = self.hooks.attempted.lock().unwrap().as_ref() {
            let _ = attempted.send(());
        }
        self.order
            .lock()
            .map_err(|_| "Workspace mutation lock failed".into())
    }

    pub fn read_context(&self, id: &str, path: &str) -> Result<(Workspace, bool), String> {
        let state = self.state.lock().map_err(|_| "Settings lock failed")?;
        Ok((
            workspace(&state.settings, id)?.clone(),
            state
                .auto_names
                .get(&key(id, path))
                .copied()
                .unwrap_or(false),
        ))
    }

    fn context(&self, id: &str, path: &str) -> Result<MutationContext, String> {
        let state = self.state.lock().map_err(|_| "Settings lock failed")?;
        Ok(MutationContext {
            selected: workspace(&state.settings, id)?.clone(),
            roots: state.settings.workspaces.clone(),
            auto_rename: state
                .auto_names
                .get(&key(id, path))
                .copied()
                .unwrap_or(false),
        })
    }

    // Committed file work changes the latest metadata even if config persistence
    // fails. Callers turn that failure into a warning, preserving committed paths.
    fn commit_metadata(&self, edit: impl FnOnce(&mut Stored)) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        edit(&mut state);
        self.persist(&state)
    }

    fn write_note_file(&self, path: &Path, bytes: &[u8]) -> Result<Vec<String>, String> {
        if bytes.len() as u64 > MAX_NOTE_BYTES {
            return Err("Note exceeds 20 MiB limit".into());
        }
        #[cfg(test)]
        self.pause("before_write", path);
        // Cache access cannot intervene between validation and publication.
        let published = publish_atomic(path, bytes);
        self.scan_cache.invalidate(path);
        published?;
        #[cfg(test)]
        let synced = if self.hooks.sync_failures.lock().unwrap().contains(path) {
            Err("Cannot sync parent directory: injected sync failure".into())
        } else {
            sync_parent(path)
        };
        #[cfg(not(test))]
        let synced = sync_parent(path);
        Ok(synced
            .err()
            .map(|error| format!("Content saved, but durability could not be confirmed: {error}"))
            .into_iter()
            .collect())
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

    pub fn registered_roots(&self) -> Result<(u64, Vec<Workspace>), String> {
        let state = self.state.lock().map_err(|_| "Settings lock failed")?;
        Ok((
            self.roots_generation.load(Ordering::Relaxed),
            state.settings.workspaces.clone(),
        ))
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
        let mut next = state.clone();
        next.settings.sessions = sessions;
        next.settings.active_workspace_id = active_workspace_id;
        next.settings.toolbar_visible = toolbar_visible;
        self.persist(&next)?;
        *state = next;
        Ok(())
    }

    pub fn update_workspace(
        &self,
        id: &str,
        name: &str,
        color: &str,
        icon: &str,
    ) -> Result<Workspace, String> {
        validate_color(color)?;
        validate_icon(icon)?;
        if name.trim().is_empty() {
            return Err("Workspace name cannot be empty".into());
        }
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
        let mut next = state.clone();
        let selected = next
            .settings
            .workspaces
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or("Workspace is not registered")?;
        selected.name = name.trim().to_string();
        selected.color = color.into();
        selected.icon = icon.into();
        let result = selected.clone();
        self.persist(&next)?;
        *state = next;
        Ok(result)
    }

    pub fn set_entry_appearance(
        &self,
        id: &str,
        path: &str,
        appearance: Appearance,
    ) -> Result<Appearance, String> {
        if let Some(icon) = &appearance.icon {
            validate_icon(icon)?;
        }
        if let Some(color) = &appearance.color {
            validate_color(color)?;
        }
        let _order = self.admit()?;
        let (selected, _) = self.read_context(id, path)?;
        let target = resolve(Path::new(&selected.path), path, false)?;
        let metadata = fs::symlink_metadata(&target).map_err(|e| err("Cannot inspect entry", e))?;
        if !metadata.is_dir() && !(metadata.is_file() && (is_note(&target) || is_image(&target))) {
            return Err("Appearance requires a note, image, or folder".into());
        }
        let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
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
        let _order = self.admit()?;
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
        self.roots_generation.fetch_add(1, Ordering::Relaxed);
        let settings = state.settings.clone();
        drop(state);
        self.scan_cache.remove_root(&root);
        Ok(settings)
    }

    pub fn add_workspace(&self, path: &str) -> Result<Workspace, String> {
        let _order = self.admit()?;
        self.register(path)
    }

    fn register(&self, path: &str) -> Result<Workspace, String> {
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
            let mut next = state.clone();
            next.settings.workspaces.push(selected.clone());
            if next.settings.active_workspace_id.is_none() {
                next.settings.active_workspace_id = Some(selected.id.clone());
            }
            self.persist(&next)?;
            *state = next;
            self.roots_generation.fetch_add(1, Ordering::Relaxed);
            selected
        };
        drop(state);
        Ok(selected)
    }

    pub fn ensure_capture_workspace(&self, documents: &Path) -> Result<Workspace, String> {
        let _order = self.admit()?;
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
        self.register(root.to_str().ok_or("Workspace path is not valid UTF-8")?)
    }

    pub fn write_drawing_svg(&self, id: &str, svg: &str) -> Result<String, String> {
        crate::drawing::validate_svg(svg)?;
        let _order = self.admit()?;
        let (selected, _) = self.read_context(id, "")?;
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

    pub fn create_note(&self, id: &str, folder: &str) -> Result<NoteFile, String> {
        validate_destination(&relative(folder, true)?, true)?;
        let _order = self.admit()?;
        let context = self.context(id, folder)?;
        let selected = &context.selected;
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
        let persisted = {
            let mut state = self.state.lock().map_err(|_| "Settings lock failed")?;
            let mut next = state.clone();
            next.auto_names.insert(key(id, &path), true);
            self.persist(&next).map(|()| *state = next)
        };
        if let Err(error) = persisted {
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
        if content.len() as u64 > MAX_NOTE_BYTES {
            return Err("Note exceeds 20 MiB limit".into());
        }
        let _order = self.admit()?;
        let context = self.context(id, path)?;
        let selected = &context.selected;
        let root = Path::new(&selected.path);
        let source = resolve(root, path, false)?;
        let current = note_content(&source)?;
        if revision(&current) != expected {
            return Err("Note changed externally. Reload or copy your edits before saving.".into());
        }
        let mut warnings = self.write_note_file(&source, content.as_bytes())?;
        let auto = context.auto_rename;
        let mut target = source.clone();
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
                    let (links, issues) = self.rewrite_incoming(
                        &context.roots,
                        &[(source.clone(), target.clone())],
                        id,
                    );
                    rewritten = links;
                    warnings.extend(issues);
                    if let Err(error) = self.commit_metadata(|state| {
                        state.auto_names.remove(&key(id, path));
                        state.auto_names.insert(key(id, &new_path), true);
                        move_appearance(&mut state.settings, id, path, &new_path);
                        move_session_path(&mut state.settings, id, path, &new_path);
                    }) {
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
        let _order = self.admit()?;
        let context = self.context(id, path)?;
        let selected = &context.selected;
        let root = Path::new(&selected.path);
        let source = resolve(root, path, false)?;
        let content = note_content(&source)?;
        if revision(&content) != expected {
            return Err(
                "Note changed externally. Reload or copy your edits before renaming.".into(),
            );
        }
        let requested = relative(name, false)?;
        validate_destination(&requested, false)?;
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
            self.rewrite_incoming(&context.roots, &[(source.clone(), target.clone())], id)
        } else {
            (Vec::new(), Vec::new())
        };
        let new_path = normalized_relative(root, &target)?;
        if let Err(error) = self.commit_metadata(|state| {
            state.auto_names.remove(&key(id, path));
            if target != source {
                move_appearance(&mut state.settings, id, path, &new_path);
                move_session_path(&mut state.settings, id, path, &new_path);
            }
        }) {
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
        let _order = self.admit()?;
        let context = self.context(id, path)?;
        let selected = &context.selected;
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
        validate_destination(&requested, false)?;
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
        let (rewritten, mut warnings) =
            self.rewrite_incoming(&context.roots, &[(source.clone(), target.clone())], id);
        if let Err(error) = self.commit_metadata(|state| {
            move_appearance(&mut state.settings, id, path, &new_path);
            move_session_path(&mut state.settings, id, path, &new_path);
        }) {
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
        let _order = self.admit()?;
        let context = self.context(id, path)?;
        let selected = &context.selected;
        let target = resolve(Path::new(&selected.path), path, false)?;
        let metadata = fs::symlink_metadata(&target).map_err(|e| err("Cannot inspect entry", e))?;
        let folder = metadata.is_dir();
        if folder
            && context.roots.iter().any(|other| {
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
        let mut warnings = Vec::new();
        if let Err(error) = self.commit_metadata(|state| {
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
        }) {
            warnings.push(format!(
                "Entry moved to Trash, but metadata was not saved: {error}"
            ));
        }
        Ok(DeleteResult { warnings })
    }

    pub fn create_folder(&self, id: &str, parent: &str, name: &str) -> Result<(), String> {
        let _order = self.admit()?;
        let context = self.context(id, parent)?;
        let selected = &context.selected;
        if name.is_empty()
            || name == "."
            || name == ".."
            || name.contains('/')
            || name.contains('\\')
            || name.chars().any(char::is_control)
        {
            return Err("Invalid folder name".into());
        }
        validate_destination(&relative(parent, true)?.join(name), true)?;
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
        let _order = self.admit()?;
        let context = self.context(id, path)?;
        let selected = &context.selected;
        let root = Path::new(&selected.path);
        let source = resolve(root, path, false)?;
        if !fs::symlink_metadata(&source)
            .map_err(|e| err("Cannot inspect folder", e))?
            .is_dir()
        {
            return Err("Only folders can be moved".into());
        }
        let requested = relative(destination, false)?;
        validate_destination(&requested, true)?;
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
        if context.roots.iter().any(|other| {
            let other_root = Path::new(&other.path);
            other.id != id && (source.starts_with(other_root) || other_root.starts_with(&source))
        }) {
            return Err("This folder overlaps another open workspace. Remove that workspace from the app before moving the folder.".into());
        }
        if fs::symlink_metadata(&target).is_ok() {
            return Err("An entry already exists at that path".into());
        }
        #[cfg(test)]
        self.pause("before_folder_enumeration", &source);
        let mappings = WalkDir::new(&source)
            .follow_links(false)
            .into_iter()
            .map(|entry| entry.map_err(|error| err("Cannot enumerate folder before moving", error)))
            .collect::<Result<Vec<_>, String>>()?
            .into_iter()
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
        move_without_overwrite(&source, &target)?;
        self.scan_cache.remove_root(root);
        let new_path = normalized_relative(root, &target)?;
        let (rewritten, mut warnings) = self.rewrite_incoming(&context.roots, &mappings, id);
        if let Err(error) = self.commit_metadata(|state| {
            if let Some(appearances) = state.settings.appearances.get_mut(id) {
                let old = std::mem::take(appearances);
                *appearances = old
                    .into_iter()
                    .map(|(key, value)| {
                        (remap_tree_path(&key, path, &new_path).unwrap_or(key), value)
                    })
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
        }) {
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

    fn rewrite_incoming(
        &self,
        workspaces: &[Workspace],
        mappings: &[(PathBuf, PathBuf)],
        target_workspace_id: &str,
    ) -> (Vec<Rewrite>, Vec<String>) {
        #[cfg(test)]
        if let Some((source, _)) = mappings.first() {
            self.pause("before_rewrite", source);
        }
        rewrite_incoming(workspaces, target_workspace_id, mappings, |path, bytes| {
            self.write_note_file(path, bytes)
        })
    }

    fn move_file(&self, source: &Path, target: &Path) -> Result<(), String> {
        let result = move_without_overwrite(source, target);
        self.scan_cache.invalidate(source);
        self.scan_cache.invalidate(target);
        result
    }

    #[cfg(test)]
    fn pause(&self, stage: &str, path: &Path) {
        let pause = {
            let mut pending = self.hooks.pause.lock().unwrap();
            if pending
                .as_ref()
                .is_some_and(|pause| pause.stage == stage && pause.path == path)
            {
                pending.take()
            } else {
                None
            }
        };
        if let Some(pause) = pause {
            pause.entered.send(()).unwrap();
            pause
                .resume
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
        }
    }
}

pub(crate) fn move_without_overwrite(source: &Path, target: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let source_name = CString::new(source.as_os_str().as_bytes())
            .map_err(|e| err("Invalid source path", e))?;
        let target_name = CString::new(target.as_os_str().as_bytes())
            .map_err(|e| err("Invalid destination path", e))?;
        // Both C strings live for the call. NOREPLACE makes the collision check
        // and move atomic for files and directories, including dangling symlinks.
        let result = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                source_name.as_ptr(),
                libc::AT_FDCWD,
                target_name.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        if result == 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if !matches!(
            error.raw_os_error(),
            Some(libc::ENOSYS | libc::EINVAL | libc::EOPNOTSUPP)
        ) {
            return Err(err("Cannot move entry without overwriting", error));
        }
    }
    move_file_by_link(source, target)
}

pub(crate) fn move_file_by_link(source: &Path, target: &Path) -> Result<(), String> {
    if !fs::symlink_metadata(source)
        .map_err(|e| err("Cannot inspect move source", e))?
        .is_file()
    {
        return Err("This filesystem does not support moving folders without overwriting".into());
    }
    fs::hard_link(source, target).map_err(|e| err("Cannot rename note without overwriting", e))?;
    if let Err(e) = fs::remove_file(source) {
        let _ = fs::remove_file(target);
        return Err(err("Cannot remove old note after rename", e));
    }
    Ok(())
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct TestHooks {
    pub(crate) pause: Mutex<Option<MutationPause>>,
    pub(crate) attempted: Mutex<Option<std::sync::mpsc::Sender<()>>>,
    pub(crate) sync_failures: Mutex<std::collections::HashSet<PathBuf>>,
}
#[cfg(test)]
pub(crate) struct MutationPause {
    pub(crate) stage: &'static str,
    pub(crate) path: PathBuf,
    pub(crate) entered: std::sync::mpsc::Sender<()>,
    pub(crate) resume: std::sync::mpsc::Receiver<()>,
}
