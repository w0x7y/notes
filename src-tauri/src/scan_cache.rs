//! A bounded cache of derived metadata. File contents and save revisions never use it.
use crate::markdown::{scan_metadata, NoteMetadata};
use crate::pathing::read_note_text;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::SystemTime;

const MAX_ROOT_ENTRIES: usize = 20_000;
const MAX_TOTAL_ENTRIES: usize = 40_000;
const MAX_CACHE_BYTES: usize = 32 * 1024 * 1024;
// Budget allocation/index overhead and all copies of root/path keys.
const ENTRY_OVERHEAD_BYTES: usize = 512;
const MAX_ENTRY_BYTES: usize = 4096;

#[derive(PartialEq, Eq)]
struct Fingerprint {
    modified: SystemTime,
    size: u64,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}

impl Fingerprint {
    fn read(metadata: &fs::Metadata) -> Option<Self> {
        // Platforms without a reliable change timestamp keep the uncached behavior.
        #[cfg(not(unix))]
        {
            let _ = metadata;
            None
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            Some(Self {
                modified: metadata.modified().ok()?,
                size: metadata.len(),
                identity: (
                    metadata.dev(),
                    metadata.ino(),
                    metadata.ctime(),
                    metadata.ctime_nsec(),
                ),
            })
        }
    }
}

struct CachedNote {
    fingerprint: Fingerprint,
    title: Option<String>,
    tags: Vec<String>,
    aliases: Vec<String>,
    warning: Option<String>,
    last_used: u64,
    bytes: usize,
}

type CacheKey = (PathBuf, PathBuf);

#[derive(Default)]
struct CacheState {
    entries: HashMap<CacheKey, CachedNote>,
    order: BTreeMap<u64, CacheKey>,
    roots: HashMap<PathBuf, BTreeSet<u64>>,
    clock: u64,
    bytes: usize,
}

impl CacheState {
    fn next_tick(&mut self) -> u64 {
        if let Some(next) = self.clock.checked_add(1) {
            self.clock = next;
        } else {
            // Recency is derived state. Clear rather than reuse an occupied ticket.
            *self = Self::default();
            self.clock = 1;
        }
        self.clock
    }

    fn get(&mut self, key: &CacheKey, fingerprint: Option<&Fingerprint>) -> Option<NoteMetadata> {
        let tick = self.next_tick();
        let cached = self.entries.get_mut(key)?;
        if Some(&cached.fingerprint) != fingerprint {
            return None;
        }
        let result = (
            cached.title.clone(),
            cached.tags.clone(),
            cached.aliases.clone(),
            cached.warning.clone(),
        );
        let old_tick = std::mem::replace(&mut cached.last_used, tick);
        self.order.remove(&old_tick);
        self.order.insert(tick, key.clone());
        let root = self.roots.entry(key.0.clone()).or_default();
        root.remove(&old_tick);
        root.insert(tick);
        Some(result)
    }

    fn remove(&mut self, key: &CacheKey) {
        if let Some(cached) = self.entries.remove(key) {
            self.bytes -= cached.bytes;
            self.order.remove(&cached.last_used);
            if let Some(root) = self.roots.get_mut(&key.0) {
                root.remove(&cached.last_used);
                if root.is_empty() {
                    self.roots.remove(&key.0);
                }
            }
        }
    }

    fn retain(&mut self, keep: impl Fn(&CacheKey) -> bool) {
        let removed: Vec<_> = self
            .entries
            .keys()
            .filter(|key| !keep(key))
            .cloned()
            .collect();
        for key in removed {
            self.remove(&key);
        }
    }

    fn insert(
        &mut self,
        key: CacheKey,
        fingerprint: Fingerprint,
        title: Option<String>,
        tags: Vec<String>,
        aliases: Vec<String>,
        warning: Option<String>,
    ) {
        self.remove(&key);
        let bytes = ENTRY_OVERHEAD_BYTES
            + 3 * key.0.as_os_str().len()
            + 2 * key.1.as_os_str().len()
            + title.as_ref().map_or(0, String::len)
            + warning.as_ref().map_or(0, String::len)
            + tags
                .iter()
                .chain(aliases.iter())
                .map(|tag| tag.len() + std::mem::size_of::<String>())
                .sum::<usize>();
        if bytes > MAX_CACHE_BYTES {
            return;
        }
        let tick = self.next_tick();
        while self
            .roots
            .get(&key.0)
            .is_some_and(|root| root.len() >= MAX_ROOT_ENTRIES)
        {
            let oldest = self
                .roots
                .get(&key.0)
                .and_then(|root| root.first())
                .and_then(|tick| self.order.get(tick))
                .cloned();
            let Some(oldest) = oldest else {
                break;
            };
            self.remove(&oldest);
        }
        while self.entries.len() >= MAX_TOTAL_ENTRIES || self.bytes + bytes > MAX_CACHE_BYTES {
            let Some((_, oldest)) = self.order.first_key_value() else {
                break;
            };
            let oldest = oldest.clone();
            self.remove(&oldest);
        }
        self.bytes += bytes;
        self.order.insert(tick, key.clone());
        self.roots.entry(key.0.clone()).or_default().insert(tick);
        self.entries.insert(
            key,
            CachedNote {
                fingerprint,
                title,
                tags,
                aliases,
                warning,
                last_used: tick,
                bytes,
            },
        );
    }
}

#[derive(Default)]
pub(crate) struct ScanCache {
    entries: Mutex<CacheState>,
    #[cfg(test)]
    pub(crate) read_pause: Mutex<Option<ReadPause>>,
}

#[cfg(test)]
pub(crate) struct ReadPause {
    pub path: PathBuf,
    pub entered: std::sync::mpsc::Sender<()>,
    pub resume: std::sync::mpsc::Receiver<()>,
}

impl ScanCache {
    fn entries(&self) -> MutexGuard<'_, CacheState> {
        // Derived metadata is disposable. A poisoned cache must not fail a committed save.
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn finish(&self, root: &Path, seen: &HashSet<PathBuf>) {
        self.entries()
            .retain(|(cached_root, path)| cached_root != root || seen.contains(path));
    }

    pub fn remove_root(&self, root: &Path) {
        self.entries()
            .retain(|(cached_root, _)| cached_root != root);
    }

    pub fn invalidate(&self, path: &Path) {
        self.entries()
            .retain(|(_, cached_path)| cached_path != path);
    }

    pub fn metadata(
        &self,
        root: &Path,
        path: &Path,
        metadata: &fs::Metadata,
    ) -> io::Result<NoteMetadata> {
        let fingerprint = Fingerprint::read(metadata);
        let key = (root.to_path_buf(), path.to_path_buf());
        {
            let mut entries = self.entries();
            if let Some(cached) = entries.get(&key, fingerprint.as_ref()) {
                return Ok(cached);
            }
            entries.remove(&key);
        }
        // Disk I/O and Markdown parsing never run while a cache lock is held.
        // Transient I/O failures retry; invalid UTF-8 and oversized notes cache
        // empty derived metadata until the file fingerprint changes.
        #[cfg(test)]
        {
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
        let (title, tags, aliases, warning) = match read_note_text(path) {
            Ok(content) => scan_metadata(&content),
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {
                (None, Vec::new(), Vec::new(), None)
            }
            Err(error) => return Err(error),
        };
        let bytes = title.as_ref().map_or(0, String::len)
            + warning.as_ref().map_or(0, String::len)
            + tags
                .iter()
                .chain(aliases.iter())
                .map(|tag| tag.len() + std::mem::size_of::<String>())
                .sum::<usize>();
        if bytes <= MAX_ENTRY_BYTES {
            // Do not cache a parse if an external writer changed the file during the read.
            let after = fs::symlink_metadata(path).ok().and_then(|m| {
                if m.is_file() {
                    Fingerprint::read(&m)
                } else {
                    None
                }
            });
            if let Some(fingerprint) = fingerprint.filter(|before| Some(before) == after.as_ref()) {
                self.entries().insert(
                    key,
                    fingerprint,
                    title.clone(),
                    tags.clone(),
                    aliases.clone(),
                    warning.clone(),
                );
            }
        }
        Ok((title, tags, aliases, warning))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn caches_aliases_without_rewriting_source_and_refreshes_changed_metadata() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("metadata.md");
        let content = "---\ntags: [study, עברית/לימוד]\naliases: [Alternative, כינוי]\ncustom: keep\n---\n# Title\n";
        fs::write(&path, content).unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let cache = ScanCache::default();
        let first = cache.metadata(root.path(), &path, &metadata).unwrap();
        assert_eq!(first.1, ["study", "עברית/לימוד"]);
        assert_eq!(first.2, ["Alternative", "כינוי"]);
        assert_eq!(
            cache.metadata(root.path(), &path, &metadata).unwrap(),
            first
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), content);

        fs::write(&path, "---\naliases: Changed alias\n---\n# Title\n").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        assert_eq!(
            cache.metadata(root.path(), &path, &metadata).unwrap().2,
            ["Changed alias"]
        );

        cache.invalidate(&path);
        fs::write(
            &path,
            format!(
                "---\naliases: {}\n---\n# Title",
                "x".repeat(MAX_ENTRY_BYTES + 1)
            ),
        )
        .unwrap();
        let metadata = fs::metadata(&path).unwrap();
        assert_eq!(
            cache.metadata(root.path(), &path, &metadata).unwrap().2[0].len(),
            MAX_ENTRY_BYTES + 1
        );
        assert!(cache.entries().entries.is_empty());
    }

    fn add_entries(state: &mut CacheState, root: &Path, metadata: &fs::Metadata, count: usize) {
        for index in 0..count {
            state.insert(
                (root.into(), root.join(index.to_string())),
                Fingerprint::read(metadata).unwrap(),
                Some("Cached".into()),
                Vec::new(),
                Vec::new(),
                None,
            );
        }
    }

    fn assert_consistent(state: &CacheState) {
        assert_eq!(state.entries.len(), state.order.len());
        assert_eq!(
            state.entries.len(),
            state.roots.values().map(BTreeSet::len).sum::<usize>()
        );
        assert_eq!(
            state.bytes,
            state
                .entries
                .values()
                .map(|entry| entry.bytes)
                .sum::<usize>()
        );
        assert!(state.bytes <= MAX_CACHE_BYTES);
        assert!(state.entries.len() <= MAX_TOTAL_ENTRIES);
        assert!(state
            .roots
            .values()
            .all(|root| root.len() <= MAX_ROOT_ENTRIES));
        for (key, cached) in &state.entries {
            assert_eq!(state.order.get(&cached.last_used), Some(key));
            assert!(state.roots.get(&key.0).unwrap().contains(&cached.last_used));
        }
    }

    #[test]
    fn roots_cache_more_than_ten_thousand_entries_independently() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let file = root.path().join("fingerprint.md");
        fs::write(&file, "# Note").unwrap();
        let metadata = fs::metadata(file).unwrap();
        let mut state = CacheState::default();
        add_entries(&mut state, root.path(), &metadata, 10_001);
        add_entries(&mut state, other.path(), &metadata, MAX_ROOT_ENTRIES);
        assert_eq!(state.roots.get(root.path()).unwrap().len(), 10_001);
        assert_eq!(
            state.roots.get(other.path()).unwrap().len(),
            MAX_ROOT_ENTRIES
        );
        assert!(state
            .get(
                &(root.path().into(), root.path().join("0")),
                Fingerprint::read(&metadata).as_ref()
            )
            .is_some());
        assert_consistent(&state);
    }

    #[test]
    fn lru_admits_overflow_and_preserves_recent_entries_across_root_and_total_limits() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let third = tempfile::tempdir().unwrap();
        let file = root.path().join("fingerprint.md");
        fs::write(&file, "# Note").unwrap();
        let metadata = fs::metadata(file).unwrap();
        let mut state = CacheState::default();
        add_entries(&mut state, root.path(), &metadata, MAX_ROOT_ENTRIES);
        let hot = (root.path().into(), root.path().join("0"));
        assert!(state
            .get(&hot, Fingerprint::read(&metadata).as_ref())
            .is_some());
        state.insert(
            (root.path().into(), root.path().join("new")),
            Fingerprint::read(&metadata).unwrap(),
            None,
            Vec::new(),
            Vec::new(),
            None,
        );
        assert!(state.entries.contains_key(&hot));
        assert!(!state
            .entries
            .contains_key(&(root.path().into(), root.path().join("1"))));
        assert!(state
            .entries
            .contains_key(&(root.path().into(), root.path().join("new"))));
        add_entries(&mut state, other.path(), &metadata, MAX_ROOT_ENTRIES);
        assert!(state
            .get(&hot, Fingerprint::read(&metadata).as_ref())
            .is_some());
        state.insert(
            (other.path().into(), other.path().join("new")),
            Fingerprint::read(&metadata).unwrap(),
            None,
            Vec::new(),
            Vec::new(),
            None,
        );
        assert!(state.entries.contains_key(&hot));
        assert!(!state
            .entries
            .contains_key(&(other.path().into(), other.path().join("0"))));
        state.insert(
            (third.path().into(), third.path().join("new")),
            Fingerprint::read(&metadata).unwrap(),
            None,
            Vec::new(),
            Vec::new(),
            None,
        );
        assert!(state.entries.contains_key(&hot));
        assert_eq!(state.entries.len(), MAX_TOTAL_ENTRIES);
        assert_eq!(
            state.roots.get(root.path()).unwrap().len(),
            MAX_ROOT_ENTRIES - 1
        );
        assert_consistent(&state);
        state.retain(|(cached_root, _)| cached_root != other.path());
        assert!(!state.roots.contains_key(other.path()));
        assert_consistent(&state);
    }

    #[test]
    fn memory_budget_evicts_old_metadata_and_counter_wrap_discards_only_cache_state() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("fingerprint.md");
        fs::write(&file, "# Note").unwrap();
        let metadata = fs::metadata(file).unwrap();
        let mut state = CacheState::default();
        let count = MAX_CACHE_BYTES / MAX_ENTRY_BYTES + 100;
        for index in 0..count {
            state.insert(
                (root.path().into(), root.path().join(index.to_string())),
                Fingerprint::read(&metadata).unwrap(),
                Some("x".repeat(MAX_ENTRY_BYTES)),
                Vec::new(),
                Vec::new(),
                None,
            );
        }
        assert!(state.entries.len() < count);
        assert!(!state
            .entries
            .contains_key(&(root.path().into(), root.path().join("0"))));
        assert!(state.entries.contains_key(&(
            root.path().into(),
            root.path().join((count - 1).to_string())
        )));
        assert_consistent(&state);
        state.clock = u64::MAX;
        state.insert(
            (root.path().into(), root.path().join("new")),
            Fingerprint::read(&metadata).unwrap(),
            Some("New".into()),
            Vec::new(),
            Vec::new(),
            None,
        );
        assert_eq!(state.entries.len(), 1);
        assert_consistent(&state);
        assert_eq!(
            fs::read_to_string(root.path().join("fingerprint.md")).unwrap(),
            "# Note"
        );
    }

    #[test]
    fn caches_invalid_utf8_until_changed_and_retries_io_errors() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("invalid.md");
        fs::write(&path, [0xff, 0xfe]).unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let cache = ScanCache::default();
        assert_eq!(
            cache.metadata(root.path(), &path, &metadata).unwrap(),
            (None, Vec::new(), Vec::new(), None)
        );
        assert_eq!(cache.entries().entries.len(), 1);
        // A pending pause is consumed only on a cache miss.
        let (entered, receiver) = std::sync::mpsc::channel();
        let (resume, resumed) = std::sync::mpsc::channel();
        resume.send(()).unwrap();
        *cache.read_pause.lock().unwrap() = Some(ReadPause {
            path: path.clone(),
            entered,
            resume: resumed,
        });
        cache.metadata(root.path(), &path, &metadata).unwrap();
        assert!(receiver.try_recv().is_err());
        assert!(cache.read_pause.lock().unwrap().is_some());
        fs::write(&path, "# Repaired\n#valid").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let (title, tags, _, _) = cache.metadata(root.path(), &path, &metadata).unwrap();
        assert_eq!(title.as_deref(), Some("Repaired"));
        assert_eq!(tags, vec!["valid"]);
        assert!(receiver.try_recv().is_ok());
        fs::remove_file(&path).unwrap();
        cache.invalidate(&path);
        assert_eq!(
            cache
                .metadata(root.path(), &path, &metadata)
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
        assert!(cache.entries().entries.is_empty());
    }

    #[test]
    fn deletion_after_metadata_read_is_reported_and_retries_when_the_note_returns() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("moving.md");
        fs::write(&path, "---\naliases: Existing\n---\n# Existing\n#old").unwrap();
        let cache = ScanCache::default();
        let metadata = fs::metadata(&path).unwrap();
        assert_eq!(
            cache.metadata(root.path(), &path, &metadata).unwrap().2,
            ["Existing"]
        );

        fs::write(&path, "---\naliases: New alias\n---\n# Changed title\n#new").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let (entered, receiver) = std::sync::mpsc::channel();
        let (resume, resumed) = std::sync::mpsc::channel();
        *cache.read_pause.lock().unwrap() = Some(ReadPause {
            path: path.clone(),
            entered,
            resume: resumed,
        });
        std::thread::scope(|threads| {
            let pending = threads.spawn(|| cache.metadata(root.path(), &path, &metadata));
            receiver
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
            fs::remove_file(&path).unwrap();
            resume.send(()).unwrap();
            assert_eq!(
                pending.join().unwrap().unwrap_err().kind(),
                io::ErrorKind::NotFound
            );
        });
        assert!(cache.entries().entries.is_empty());

        fs::write(&path, "---\naliases: Restored\n---\n# Restored\n#returned").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        assert_eq!(
            cache.metadata(root.path(), &path, &metadata).unwrap(),
            (
                Some("Restored".into()),
                vec!["returned".into()],
                vec!["Restored".into()],
                None
            )
        );
    }

    #[test]
    fn overlapping_roots_keep_separate_entries_and_invalidate_all_copies() {
        let root = tempfile::tempdir().unwrap();
        let nested = root.path().join("nested");
        fs::create_dir(&nested).unwrap();
        let path = nested.join("note.md");
        fs::write(&path, "# Shared").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let cache = ScanCache::default();
        cache.metadata(root.path(), &path, &metadata).unwrap();
        cache.metadata(&nested, &path, &metadata).unwrap();
        assert_eq!(cache.entries().entries.len(), 2);
        cache.finish(root.path(), &HashSet::new());
        assert_eq!(cache.entries().entries.len(), 1);
        cache.metadata(root.path(), &path, &metadata).unwrap();
        cache.remove_root(&nested);
        assert_eq!(cache.entries().entries.len(), 1);
        cache.metadata(&nested, &path, &metadata).unwrap();
        cache.invalidate(&path);
        assert!(cache.entries().entries.is_empty());
    }

    #[test]
    fn oversized_notes_cache_fallback_metadata_and_refresh_after_shrinking() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("large.md");
        fs::File::create(&path)
            .unwrap()
            .set_len(crate::pathing::MAX_NOTE_BYTES + 1)
            .unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let cache = ScanCache::default();
        assert_eq!(
            cache.metadata(root.path(), &path, &metadata).unwrap(),
            (None, Vec::new(), Vec::new(), None)
        );
        assert_eq!(cache.entries().entries.len(), 1);
        fs::write(&path, "# Small\n#tag").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        assert_eq!(
            cache.metadata(root.path(), &path, &metadata).unwrap(),
            (Some("Small".into()), vec!["tag".into()], Vec::new(), None)
        );
    }

    #[test]
    fn bounds_metadata_and_prunes_disappeared_files() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("note.md");
        fs::write(&path, "# Cached\n#tag").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let cache = ScanCache::default();
        cache.metadata(root.path(), &path, &metadata).unwrap();
        cache.finish(root.path(), &HashSet::from([path.clone()]));
        assert_eq!(cache.entries().entries.len(), 1);
        cache.finish(root.path(), &HashSet::new());
        assert!(cache.entries().entries.is_empty());
        fs::write(&path, format!("# {}", "x".repeat(MAX_ENTRY_BYTES + 1))).unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let (title, _, _, _) = cache.metadata(root.path(), &path, &metadata).unwrap();
        assert_eq!(title.unwrap().len(), MAX_ENTRY_BYTES + 1);
        assert!(cache.entries().entries.is_empty());
        for index in 0..MAX_ROOT_ENTRIES {
            cache.entries().insert(
                (root.path().into(), root.path().join(index.to_string())),
                Fingerprint::read(&metadata).unwrap(),
                None,
                Vec::new(),
                Vec::new(),
                None,
            );
        }
        fs::write(&path, "# Small").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        assert_eq!(
            cache
                .metadata(root.path(), &path, &metadata)
                .unwrap()
                .0
                .as_deref(),
            Some("Small")
        );
        assert_eq!(cache.entries().entries.len(), MAX_ROOT_ENTRIES);
        assert!(cache
            .entries()
            .entries
            .contains_key(&(root.path().into(), path)));
        cache.remove_root(root.path());
        assert!(cache.entries().entries.is_empty());
    }
}
