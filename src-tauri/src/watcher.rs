//! Workspace invalidations only. Notes and revisions are still read by the service.
use crate::model::Workspace;
use crate::service::{is_image, is_note, workspace_entry};
use notify::event::{CreateKind, RemoveKind};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use walkdir::WalkDir;

pub const WORKSPACE_CHANGED: &str = "notes:workspace-changed";
const QUIET_TIME: Duration = Duration::from_millis(250);
const MAX_BURST: Duration = Duration::from_secs(1);
const ROOT_CHECK_INTERVAL: Duration = Duration::from_secs(2);
const RETRY_INTERVAL: Duration = Duration::from_secs(30);
const MAX_REPORTED_WARNINGS: usize = 128;
const EVENT_QUEUE_SIZE: usize = 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChanged {
    pub workspace_ids: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Default)]
struct Pending {
    ids: BTreeSet<String>,
    warnings: BTreeSet<String>,
    reported: HashSet<String>,
    first: Option<Instant>,
    last: Option<Instant>,
}

impl Pending {
    fn touch(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
    }

    fn change(&mut self, ids: impl IntoIterator<Item = String>, now: Instant) {
        let mut changed = false;
        for id in ids {
            self.ids.insert(id);
            changed = true;
        }
        if changed {
            self.touch(now);
        }
    }

    fn warn(&mut self, warning: String, now: Instant) {
        if self.reported.contains(&warning) {
            return;
        }
        let warning = if self.reported.len() >= MAX_REPORTED_WARNINGS {
            "Further filesystem watcher warnings suppressed. Focus refresh remains available."
                .into()
        } else {
            warning
        };
        if self.reported.insert(warning.clone()) {
            self.warnings.insert(warning);
            self.touch(now);
        }
    }

    fn ready(&self, now: Instant) -> bool {
        self.first
            .is_some_and(|first| now.duration_since(first) >= MAX_BURST)
            || self
                .last
                .is_some_and(|last| now.duration_since(last) >= QUIET_TIME)
    }

    fn take(&mut self) -> WorkspaceChanged {
        self.first = None;
        self.last = None;
        WorkspaceChanged {
            workspace_ids: std::mem::take(&mut self.ids).into_iter().collect(),
            warnings: std::mem::take(&mut self.warnings).into_iter().collect(),
        }
    }

    fn set_roots(&mut self, roots: &[Workspace]) {
        self.ids
            .retain(|id| roots.iter().any(|root| &root.id == id));
        self.warnings.clear();
        self.reported.clear();
        if self.ids.is_empty() {
            self.first = None;
            self.last = None;
        }
    }
}

fn available(root: &Path) -> bool {
    fs::symlink_metadata(root).is_ok_and(|metadata| metadata.is_dir())
        && root.canonicalize().ok().as_deref() == Some(root)
        && fs::read_dir(root).is_ok()
}

fn relevant(path: &Path, root: &Path, directory: bool) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    let components: Vec<_> = relative.components().collect();
    let mut current = root.to_path_buf();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(name) = component else {
            return false;
        };
        current.push(name);
        let name = name.to_string_lossy();
        let folder = directory || index + 1 < components.len();
        if folder
            && (name.starts_with('.') || matches!(name.as_ref(), "node_modules" | "__pycache__"))
        {
            return false;
        }
        // The leaf may have just replaced an indexed entry with a symlink. Its
        // change still invalidates the snapshot, but never inspect events inside
        // a symlink ancestor or install a watch on the target.
        if index + 1 < components.len()
            && fs::symlink_metadata(&current)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return false;
        }
    }
    directory || is_note(path) || is_image(path)
}

fn changed_ids(
    event: &Event,
    roots: &[Workspace],
    directories: &HashSet<PathBuf>,
) -> BTreeSet<String> {
    if event.need_rescan() {
        return roots.iter().map(|root| root.id.clone()).collect();
    }
    if event.kind.is_access() {
        return BTreeSet::new();
    }
    let explicit_directory = matches!(
        event.kind,
        EventKind::Create(CreateKind::Folder) | EventKind::Remove(RemoveKind::Folder)
    );
    roots
        .iter()
        .filter(|root| {
            event.paths.iter().any(|path| {
                let directory = explicit_directory || directories.contains(path) || path.is_dir();
                relevant(path, Path::new(&root.path), directory)
            })
        })
        .map(|root| root.id.clone())
        .collect()
}

type Emit = Arc<dyn Fn(WorkspaceChanged) + Send + Sync>;

enum Command {
    Roots(u64, Vec<Workspace>, Option<mpsc::Sender<()>>),
    Stop,
}

pub struct WorkspaceWatcher {
    commands: mpsc::Sender<Command>,
    worker: Mutex<Option<JoinHandle<()>>>,
    startup_warning: Mutex<Option<String>>,
    emit: Emit,
}

impl WorkspaceWatcher {
    pub fn new(emit: impl Fn(WorkspaceChanged) + Send + Sync + 'static) -> Self {
        let emit: Emit = Arc::new(emit);
        let (commands, receiver) = mpsc::channel();
        let worker_emit = emit.clone();
        let worker = thread::Builder::new()
            .name("notes-workspace-watcher".into())
            .spawn(move || run(receiver, worker_emit));
        let (worker, startup_warning) = match worker {
            Ok(worker) => (Some(worker), None),
            Err(error) => (
                None,
                Some(format!(
                    "Cannot start filesystem watcher: {error}. Focus refresh remains available."
                )),
            ),
        };
        Self {
            commands,
            worker: Mutex::new(worker),
            startup_warning: Mutex::new(startup_warning),
            emit,
        }
    }

    pub fn synchronize(&self, generation: u64, roots: Vec<Workspace>) {
        if self
            .commands
            .send(Command::Roots(generation, roots.clone(), None))
            .is_err()
        {
            if let Some(warning) = self
                .startup_warning
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take()
            {
                (self.emit)(WorkspaceChanged {
                    workspace_ids: roots.into_iter().map(|root| root.id).collect(),
                    warnings: vec![warning],
                });
            }
        }
    }

    #[cfg(test)]
    fn synchronize_wait(&self, generation: u64, roots: Vec<Workspace>) {
        let (ready, receiver) = mpsc::channel();
        self.commands
            .send(Command::Roots(generation, roots, Some(ready)))
            .unwrap();
        receiver.recv_timeout(Duration::from_secs(5)).unwrap();
    }
}

impl Drop for WorkspaceWatcher {
    fn drop(&mut self) {
        let _ = self.commands.send(Command::Stop);
        if let Some(worker) = self
            .worker
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
        {
            let _ = worker.join();
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DirectoryIdentity {
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(not(unix))]
    timestamp: std::time::SystemTime,
}

impl DirectoryIdentity {
    fn read(path: &Path) -> std::io::Result<Self> {
        let metadata = fs::symlink_metadata(path)?;
        if !metadata.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Watch path is not a regular directory",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            Ok(Self {
                device: metadata.dev(),
                inode: metadata.ino(),
            })
        }
        #[cfg(not(unix))]
        {
            // Creation time identifies replacements on Windows. When it is
            // unavailable, modified time conservatively reinstalls a watch.
            Ok(Self {
                timestamp: metadata.created().or_else(|_| metadata.modified())?,
            })
        }
    }
}

struct Watches {
    roots: Vec<Workspace>,
    directories: HashSet<PathBuf>,
    identities: HashMap<PathBuf, DirectoryIdentity>,
    readiness: HashMap<PathBuf, bool>,
    backend: Option<RecommendedWatcher>,
    events: mpsc::SyncSender<notify::Result<Event>>,
    overflow: Arc<AtomicBool>,
    retry: bool,
}

impl Watches {
    fn reconcile(&mut self, pending: &mut Pending, now: Instant) {
        self.retry = false;
        if self.backend.is_none() {
            let sender = self.events.clone();
            let overflow = self.overflow.clone();
            match RecommendedWatcher::new(
                move |event: notify::Result<Event>| {
                    if event
                        .as_ref()
                        .is_ok_and(|event| event.kind.is_access() && !event.need_rescan())
                    {
                        return;
                    }
                    if matches!(sender.try_send(event), Err(mpsc::TrySendError::Full(_))) {
                        overflow.store(true, Ordering::Release);
                    }
                },
                Config::default().with_follow_symlinks(false),
            ) {
                Ok(backend) => self.backend = Some(backend),
                Err(error) => {
                    self.retry = true;
                    pending.warn(format!("Cannot initialize filesystem watcher: {error}. Focus refresh remains available."), now);
                    return;
                }
            }
        }
        let mut desired = HashMap::new();
        for root in &self.roots {
            let path = Path::new(&root.path);
            let ready = available(path);
            let previous = self.readiness.insert(path.to_path_buf(), ready);
            if !ready {
                pending.warn(format!("Cannot watch workspace {}: folder is unavailable. Focus refresh remains available.", root.name), now);
                continue;
            }
            let identity = DirectoryIdentity::read(path).ok();
            if previous == Some(false)
                || self
                    .identities
                    .get(path)
                    .is_some_and(|old| Some(old) != identity.as_ref())
            {
                pending.change([root.id.clone()], now);
            }
            for entry in WalkDir::new(path)
                .follow_links(false)
                .into_iter()
                .filter_entry(workspace_entry)
            {
                match entry {
                    Ok(entry) if entry.file_type().is_dir() => {
                        match DirectoryIdentity::read(entry.path()) {
                            Ok(identity) => {
                                desired.insert(entry.into_path(), identity);
                            }
                            Err(error) => {
                                self.retry = true;
                                pending.warn(format!("Cannot inspect watch folder {}: {error}. Focus refresh remains available.", entry.path().display()), now);
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(error) => {
                        self.retry = true;
                        pending.warn(format!("Cannot watch part of workspace {}: {error}. Focus refresh remains available.", root.name), now);
                    }
                }
            }
        }
        let Some(backend) = self.backend.as_mut() else {
            return;
        };
        let removed: Vec<_> = self
            .directories
            .iter()
            .filter(|directory| desired.get(*directory) != self.identities.get(*directory))
            .cloned()
            .collect();
        for directory in removed {
            let _ = backend.unwatch(&directory);
            self.directories.remove(&directory);
            self.identities.remove(&directory);
        }
        let mut added: Vec<_> = desired
            .keys()
            .filter(|directory| !self.directories.contains(*directory))
            .cloned()
            .collect();
        added.sort();
        for directory in added {
            // Watching each visible directory avoids spending OS watches on excluded trees.
            match backend.watch(&directory, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    self.identities
                        .insert(directory.clone(), desired[&directory].clone());
                    self.directories.insert(directory);
                }
                Err(error) => {
                    self.retry = true;
                    pending.warn(
                        format!(
                            "Cannot watch folder {}: {error}. Focus refresh remains available.",
                            directory.display()
                        ),
                        now,
                    );
                }
            }
        }
        if self.roots.is_empty() {
            self.backend = None;
            self.readiness.clear();
        }
    }

    fn readiness_changed(&self) -> bool {
        self.roots.iter().any(|root| {
            let path = Path::new(&root.path);
            self.readiness.get(path).copied() != Some(available(path))
                || self
                    .identities
                    .get(path)
                    .is_some_and(|old| DirectoryIdentity::read(path).ok().as_ref() != Some(old))
        })
    }
}

fn run(commands: mpsc::Receiver<Command>, emit: Emit) {
    let (sender, events) = mpsc::sync_channel(EVENT_QUEUE_SIZE);
    let overflow = Arc::new(AtomicBool::new(false));
    let mut watches = Watches {
        roots: Vec::new(),
        directories: HashSet::new(),
        identities: HashMap::new(),
        readiness: HashMap::new(),
        backend: None,
        events: sender,
        overflow: overflow.clone(),
        retry: false,
    };
    let mut pending = Pending::default();
    let mut tree_changed = false;
    let mut checked = Instant::now();
    let mut reconciled = checked;
    let mut roots_generation = None;
    loop {
        match commands.recv_timeout(Duration::from_millis(25)) {
            Ok(Command::Roots(generation, roots, ready)) => {
                if roots_generation.is_some_and(|current| generation < current) {
                    if let Some(ready) = ready {
                        let _ = ready.send(());
                    }
                    continue;
                }
                roots_generation = Some(generation);
                let added_ids: Vec<_> = roots
                    .iter()
                    .filter(|new| {
                        !watches
                            .roots
                            .iter()
                            .any(|old| old.id == new.id && old.path == new.path)
                    })
                    .map(|root| root.id.clone())
                    .collect();
                let changed = watches.roots.len() != roots.len()
                    || watches
                        .roots
                        .iter()
                        .zip(&roots)
                        .any(|(old, new)| old.id != new.id || old.path != new.path);
                watches.roots = roots;
                if changed {
                    pending.set_roots(&watches.roots);
                    watches.readiness.retain(|path, _| {
                        watches
                            .roots
                            .iter()
                            .any(|root| Path::new(&root.path) == path)
                    });
                    watches.reconcile(&mut pending, Instant::now());
                    // Registration commands may have scanned before OS watches
                    // were installed. Refresh afterward to close that gap.
                    pending.change(added_ids, Instant::now());
                    reconciled = Instant::now();
                }
                if let Some(ready) = ready {
                    let _ = ready.send(());
                }
            }
            Ok(Command::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => return,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        let now = Instant::now();
        for event in events.try_iter().take(256) {
            match event {
                Ok(event) => {
                    let ids = changed_ids(&event, &watches.roots, &watches.directories);
                    if !ids.is_empty() {
                        tree_changed |= event.need_rescan()
                            || matches!(
                                event.kind,
                                EventKind::Create(CreateKind::Folder)
                                    | EventKind::Remove(RemoveKind::Folder)
                            )
                            || event
                                .paths
                                .iter()
                                .any(|path| path.is_dir() || watches.directories.contains(path));
                        pending.change(ids, now);
                    }
                    if event.need_rescan() {
                        pending.warn(
                            "Filesystem watcher lost events; refreshing registered workspaces."
                                .into(),
                            now,
                        );
                    }
                }
                Err(error) => {
                    pending.change(watches.roots.iter().map(|root| root.id.clone()), now);
                    pending.warn(
                        format!(
                            "Filesystem watcher error: {error}. Focus refresh remains available."
                        ),
                        now,
                    );
                    watches.retry = true;
                }
            }
        }
        if overflow.swap(false, Ordering::AcqRel) {
            pending.change(watches.roots.iter().map(|root| root.id.clone()), now);
            pending.warn(
                "Filesystem watcher event queue filled; refreshing registered workspaces.".into(),
                now,
            );
            tree_changed = true;
        }
        if now.duration_since(checked) >= ROOT_CHECK_INTERVAL {
            checked = now;
            if watches.readiness_changed()
                || (watches.retry && now.duration_since(reconciled) >= RETRY_INTERVAL)
            {
                watches.reconcile(&mut pending, now);
                reconciled = now;
            }
        }
        if pending.ready(now) {
            if tree_changed {
                watches.reconcile(&mut pending, now);
                reconciled = now;
                tree_changed = false;
            }
            emit(pending.take());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, DataChange, Flag, ModifyKind, RenameMode};

    fn workspace(id: &str, path: &Path) -> Workspace {
        Workspace {
            id: id.into(),
            name: id.into(),
            path: path.to_str().unwrap().into(),
            color: "#abcdef".into(),
            icon: "book".into(),
        }
    }

    fn write_event(path: PathBuf) -> Event {
        Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content))).add_path(path)
    }

    #[test]
    fn filters_access_excluded_trees_symlinks_and_unrelated_files_but_keeps_hidden_notes() {
        let root = tempfile::tempdir().unwrap();
        let nested = root.path().join("notes");
        fs::create_dir(&nested).unwrap();
        let roots = vec![
            workspace("parent", root.path()),
            workspace("nested", &nested),
        ];
        let directories = HashSet::from([root.path().into(), nested.clone()]);
        assert_eq!(
            changed_ids(&write_event(nested.join("a.md")), &roots, &directories),
            BTreeSet::from(["nested".into(), "parent".into()])
        );
        for path in [
            "node_modules/a.md",
            "__pycache__/a.md",
            ".hidden/a.md",
            "notes/nested/.git/a.md",
            "irrelevant.txt",
        ] {
            assert!(
                changed_ids(&write_event(root.path().join(path)), &roots, &directories).is_empty()
            );
        }
        assert_eq!(
            changed_ids(
                &write_event(root.path().join(".visible.md")),
                &roots,
                &directories
            ),
            BTreeSet::from(["parent".into()])
        );
        let access = Event::new(EventKind::Access(AccessKind::Read)).add_path(nested.join("a.md"));
        assert!(changed_ids(&access, &roots, &directories).is_empty());
        assert_eq!(
            changed_ids(&access.set_flag(Flag::Rescan), &roots, &directories).len(),
            2
        );
        let rename = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(nested.join("a.md"))
            .add_path(root.path().join("b.md"));
        assert_eq!(changed_ids(&rename, &roots, &directories).len(), 2);
        let excluded = root.path().join("node_modules");
        let roots = vec![
            workspace("parent", root.path()),
            workspace("chosen", &excluded),
        ];
        assert_eq!(
            changed_ids(
                &write_event(excluded.join("chosen.md")),
                &roots,
                &directories
            ),
            BTreeSet::from(["chosen".into()])
        );
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(outside.path(), root.path().join("link")).unwrap();
            assert!(changed_ids(
                &write_event(root.path().join("link/a.md")),
                &roots,
                &directories
            )
            .is_empty());
        }
    }

    #[test]
    fn debounce_merges_ids_uses_quiet_time_caps_bursts_and_deduplicates_warnings() {
        let start = Instant::now();
        let mut pending = Pending::default();
        pending.change(["a".into()], start);
        pending.change(["a".into(), "b".into()], start + Duration::from_millis(100));
        assert!(!pending.ready(start + Duration::from_millis(349)));
        assert!(pending.ready(start + Duration::from_millis(350)));
        let batch = pending.take();
        assert_eq!(batch.workspace_ids, vec!["a", "b"]);
        assert!(batch.warnings.is_empty());
        assert!(!pending.ready(start + Duration::from_secs(10)));
        for millis in (0..=900).step_by(100) {
            pending.change(["a".into()], start + Duration::from_millis(millis));
        }
        assert!(!pending.ready(start + Duration::from_millis(999)));
        assert!(pending.ready(start + MAX_BURST));
        pending.warn("error".into(), start + MAX_BURST);
        assert_eq!(pending.take().warnings, vec!["error"]);
        pending.warn("error".into(), start + Duration::from_secs(2));
        assert!(!pending.ready(start + Duration::from_secs(3)));
        for index in 0..300 {
            pending.warn(format!("error{index}"), start);
        }
        assert_eq!(pending.reported.len(), MAX_REPORTED_WARNINGS + 1);
        assert_eq!(pending.take().warnings.len(), MAX_REPORTED_WARNINGS);
        pending.change(["removed".into()], start);
        pending.set_roots(&[]);
        assert!(!pending.ready(start + Duration::from_secs(2)));
    }

    #[test]
    fn watch_registration_skips_excluded_directories_and_never_follows_symlinks() {
        let root = tempfile::tempdir().unwrap();
        for folder in [
            "visible/sub",
            "node_modules/sub",
            "__pycache__/sub",
            ".git/sub",
        ] {
            fs::create_dir_all(root.path().join(folder)).unwrap();
        }
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(outside.path(), root.path().join("linked")).unwrap();
        }
        let (sender, _receiver) = mpsc::sync_channel(EVENT_QUEUE_SIZE);
        let mut watches = Watches {
            roots: vec![workspace("a", root.path())],
            directories: HashSet::new(),
            identities: HashMap::new(),
            readiness: HashMap::new(),
            backend: None,
            events: sender,
            overflow: Arc::new(AtomicBool::new(false)),
            retry: false,
        };
        let mut pending = Pending::default();
        watches.reconcile(&mut pending, Instant::now());
        assert!(pending.warnings.is_empty(), "{:?}", pending.warnings);
        assert_eq!(
            watches.directories,
            HashSet::from([
                root.path().into(),
                root.path().join("visible"),
                root.path().join("visible/sub")
            ])
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn registration_refresh_covers_changes_before_watch_installation_and_replaced_roots() {
        let config = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let replacement = tempfile::tempdir().unwrap();
        fs::write(root.path().join("initial.md"), "# Initial").unwrap();
        let service = crate::service::Service::new(config.path().to_path_buf()).unwrap();
        let initial = service
            .add_workspace(root.path().to_str().unwrap())
            .unwrap();
        assert_eq!(initial.entries.len(), 1);
        // The command's initial snapshot predates both writes and watch installation.
        fs::write(root.path().join("initial.md"), "# External change").unwrap();
        fs::write(root.path().join("new.md"), "# New").unwrap();
        let (sender, changes) = mpsc::channel();
        let watcher = WorkspaceWatcher::new(move |change| {
            let _ = sender.send(change);
        });
        watcher.synchronize_wait(1, vec![initial.workspace.clone()]);
        assert_eq!(
            changes
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .workspace_ids,
            vec![initial.workspace.id.clone()]
        );
        let refreshed = service.scan_workspace(&initial.workspace.id).unwrap();
        assert_eq!(refreshed.entries.len(), 2);
        assert_eq!(refreshed.entries[0].title, "External change");
        // Replacing the path of the same registration also needs a refresh.
        let mut replaced = initial.workspace;
        replaced.path = replacement.path().to_str().unwrap().into();
        watcher.synchronize_wait(2, vec![replaced.clone()]);
        assert_eq!(
            changes
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .workspace_ids,
            vec![replaced.id.clone()]
        );
        watcher.synchronize_wait(3, vec![]);
        watcher.synchronize_wait(2, vec![replaced]);
        assert!(changes.recv_timeout(Duration::from_millis(400)).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn replacing_indexed_note_and_folder_with_symlinks_invalidates_but_never_indexes_targets() {
        let config = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("folder")).unwrap();
        fs::write(root.path().join("note.md"), "# Indexed").unwrap();
        fs::write(root.path().join("folder/child.md"), "# Indexed child").unwrap();
        fs::write(outside.path().join("target.md"), "# Outside").unwrap();
        let service = crate::service::Service::new(config.path().to_path_buf()).unwrap();
        let initial = service
            .add_workspace(root.path().to_str().unwrap())
            .unwrap();
        assert_eq!(initial.entries.len(), 3);
        let (sender, changes) = mpsc::channel();
        let watcher = WorkspaceWatcher::new(move |change| {
            let _ = sender.send(change);
        });
        watcher.synchronize_wait(1, vec![initial.workspace.clone()]);
        changes.recv_timeout(Duration::from_secs(3)).unwrap();
        fs::remove_file(root.path().join("note.md")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("target.md"),
            root.path().join("note.md"),
        )
        .unwrap();
        fs::rename(
            root.path().join("folder"),
            outside.path().join("old-folder"),
        )
        .unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("folder")).unwrap();
        assert_eq!(
            changes
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .workspace_ids,
            vec![initial.workspace.id.clone()]
        );
        let snapshot = service.scan_workspace(&initial.workspace.id).unwrap();
        assert!(!snapshot.incomplete);
        assert!(snapshot.entries.is_empty());
        assert!(service.read_note(&initial.workspace.id, "note.md").is_err());
        assert!(service
            .read_note(&initial.workspace.id, "folder/target.md")
            .is_err());
        let roots = vec![initial.workspace];
        let directories = HashSet::from([root.path().into(), root.path().join("folder")]);
        for kind in [
            EventKind::Remove(RemoveKind::File),
            EventKind::Create(CreateKind::File),
        ] {
            assert_eq!(
                changed_ids(
                    &Event::new(kind).add_path(root.path().join("note.md")),
                    &roots,
                    &directories
                )
                .len(),
                1
            );
        }
        assert_eq!(
            changed_ids(
                &Event::new(EventKind::Remove(RemoveKind::Folder))
                    .add_path(root.path().join("folder")),
                &roots,
                &directories
            )
            .len(),
            1
        );
        assert!(changed_ids(
            &write_event(root.path().join("folder/target.md")),
            &roots,
            &directories
        )
        .is_empty());
        fs::write(outside.path().join("target.md"), "# Unwatched target").unwrap();
        assert!(changes.recv_timeout(Duration::from_millis(500)).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn rapid_directory_and_root_replacements_reinstall_watches_for_later_writes() {
        for replace_root in [false, true] {
            let parent = tempfile::tempdir().unwrap();
            let root = parent.path().join("root");
            let directory = root.join("folder");
            fs::create_dir_all(&directory).unwrap();
            fs::write(directory.join("note.md"), "# Before").unwrap();
            let (sender, changes) = mpsc::channel();
            let watcher = WorkspaceWatcher::new(move |change| {
                let _ = sender.send(change);
            });
            watcher.synchronize_wait(1, vec![workspace("root", &root)]);
            changes.recv_timeout(Duration::from_secs(3)).unwrap();
            let replaced = if replace_root { &root } else { &directory };
            fs::rename(replaced, parent.path().join("old-directory")).unwrap();
            fs::create_dir_all(&directory).unwrap();
            fs::write(directory.join("note.md"), "# Replacement").unwrap();
            let refresh = changes.recv_timeout(Duration::from_secs(4)).unwrap();
            assert_eq!(refresh.workspace_ids, vec!["root"]);
            assert!(refresh.warnings.is_empty(), "{:?}", refresh.warnings);
            fs::write(directory.join("note.md"), "# Later edit").unwrap();
            assert_eq!(
                changes
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap()
                    .workspace_ids,
                vec!["root"],
                "replacement directory lost its watch (root replacement: {replace_root})"
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn actual_watcher_handles_writes_renames_deletes_new_folders_overlap_and_removal() {
        let root = tempfile::tempdir().unwrap();
        let nested = root.path().join("nested");
        fs::create_dir(&nested).unwrap();
        let (sender, changes) = mpsc::channel();
        let watcher = WorkspaceWatcher::new(move |change| {
            let _ = sender.send(change);
        });
        watcher.synchronize_wait(
            1,
            vec![
                workspace("parent", root.path()),
                workspace("child", &nested),
            ],
        );
        let initial = changes.recv_timeout(Duration::from_secs(3)).unwrap();
        assert_eq!(initial.workspace_ids, vec!["child", "parent"]);
        assert!(initial.warnings.is_empty());
        for index in 0..10 {
            fs::write(nested.join(format!("{index}.md")), "# Note").unwrap();
        }
        let batch = changes.recv_timeout(Duration::from_secs(3)).unwrap();
        assert_eq!(batch.workspace_ids, vec!["child", "parent"]);
        assert!(batch.warnings.is_empty());
        assert!(
            changes.recv_timeout(Duration::from_millis(400)).is_err(),
            "burst emitted multiple changes"
        );
        fs::rename(nested.join("0.md"), nested.join("renamed.md")).unwrap();
        assert_eq!(
            changes
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .workspace_ids,
            vec!["child", "parent"]
        );
        fs::remove_file(nested.join("renamed.md")).unwrap();
        assert_eq!(
            changes
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .workspace_ids,
            vec!["child", "parent"]
        );
        let created = nested.join("created");
        fs::create_dir(&created).unwrap();
        fs::write(created.join("new.md"), "# New").unwrap();
        assert_eq!(
            changes
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .workspace_ids,
            vec!["child", "parent"]
        );
        fs::write(created.join("new.md"), "# Changed").unwrap();
        assert_eq!(
            changes
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .workspace_ids,
            vec!["child", "parent"]
        );
        watcher.synchronize_wait(2, vec![workspace("child", &nested)]);
        // A delayed wrapper must not resurrect the older parent registration.
        watcher.synchronize_wait(
            1,
            vec![
                workspace("parent", root.path()),
                workspace("child", &nested),
            ],
        );
        fs::write(nested.join("only-child.md"), "# Only child").unwrap();
        assert_eq!(
            changes
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .workspace_ids,
            vec!["child"]
        );
        watcher.synchronize_wait(3, vec![]);
        fs::write(nested.join("unregistered.md"), "# None").unwrap();
        assert!(changes.recv_timeout(Duration::from_millis(500)).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn unavailable_roots_warn_once_and_reappearance_recovers_without_restarting() {
        let parent = tempfile::tempdir().unwrap();
        let missing = parent.path().join("missing");
        let (sender, changes) = mpsc::channel();
        let watcher = WorkspaceWatcher::new(move |change| {
            let _ = sender.send(change);
        });
        watcher.synchronize_wait(1, vec![workspace("missing", &missing)]);
        let warning = changes.recv_timeout(Duration::from_secs(3)).unwrap();
        assert_eq!(warning.warnings.len(), 1);
        assert!(warning.warnings[0].contains("unavailable"));
        watcher.synchronize_wait(1, vec![workspace("missing", &missing)]);
        assert!(changes.recv_timeout(Duration::from_millis(400)).is_err());
        fs::create_dir(&missing).unwrap();
        assert_eq!(
            changes
                .recv_timeout(Duration::from_secs(4))
                .unwrap()
                .workspace_ids,
            vec!["missing"]
        );
        fs::write(missing.join("restored.md"), "# Restored").unwrap();
        assert_eq!(
            changes
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .workspace_ids,
            vec!["missing"]
        );
    }
}
