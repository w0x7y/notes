//! A bounded cache of derived metadata. File contents and save revisions never use it.
use crate::markdown::{first_h1, tags};
use crate::pathing::read_regular_text;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::SystemTime;

const MAX_ENTRIES: usize = 10_000;
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
    root: PathBuf,
    fingerprint: Fingerprint,
    title: Option<String>,
    tags: Vec<String>,
}

#[derive(Default)]
pub(crate) struct ScanCache {
    entries: Mutex<HashMap<PathBuf, CachedNote>>,
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
    fn entries(&self) -> MutexGuard<'_, HashMap<PathBuf, CachedNote>> {
        // Derived metadata is disposable. A poisoned cache must not fail a committed save.
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn finish(&self, root: &Path, seen: &HashSet<PathBuf>) {
        self.entries()
            .retain(|path, cached| cached.root != root || seen.contains(path));
    }

    pub fn remove_root(&self, root: &Path) {
        self.entries().retain(|_, cached| cached.root != root);
    }

    pub fn invalidate(&self, path: &Path) {
        self.entries().remove(path);
    }

    pub fn metadata(
        &self,
        root: &Path,
        path: &Path,
        metadata: &fs::Metadata,
    ) -> (Option<String>, Vec<String>) {
        let fingerprint = Fingerprint::read(metadata);
        {
            let mut entries = self.entries();
            if let Some(cached) = entries.get(path) {
                if cached.root == root && Some(&cached.fingerprint) == fingerprint.as_ref() {
                    return (cached.title.clone(), cached.tags.clone());
                }
            }
            entries.remove(path);
        }
        // Disk I/O and Markdown parsing never run while a cache lock is held.
        // Failed reads must be retried, even if metadata has not changed.
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
        let Ok(content) = read_regular_text(path) else {
            return (None, Vec::new());
        };
        let title = first_h1(&content);
        let tags = tags(&content);
        let bytes = title.as_ref().map_or(0, String::len)
            + tags
                .iter()
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
                let mut entries = self.entries();
                if entries.len() < MAX_ENTRIES {
                    entries.insert(
                        path.to_path_buf(),
                        CachedNote {
                            root: root.to_path_buf(),
                            fingerprint,
                            title: title.clone(),
                            tags: tags.clone(),
                        },
                    );
                }
            }
        }
        (title, tags)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn bounds_metadata_and_prunes_disappeared_files() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("note.md");
        fs::write(&path, "# Cached\n#tag").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let cache = ScanCache::default();
        cache.metadata(root.path(), &path, &metadata);
        cache.finish(root.path(), &HashSet::from([path.clone()]));
        assert_eq!(cache.entries().len(), 1);
        cache.finish(root.path(), &HashSet::new());
        assert!(cache.entries().is_empty());
        fs::write(&path, format!("# {}", "x".repeat(MAX_ENTRY_BYTES + 1))).unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let (title, _) = cache.metadata(root.path(), &path, &metadata);
        assert_eq!(title.unwrap().len(), MAX_ENTRY_BYTES + 1);
        assert!(cache.entries().is_empty());
        for index in 0..MAX_ENTRIES {
            cache.entries().insert(
                root.path().join(index.to_string()),
                CachedNote {
                    root: root.path().into(),
                    fingerprint: Fingerprint::read(&metadata).unwrap(),
                    title: None,
                    tags: Vec::new(),
                },
            );
        }
        fs::write(&path, "# Small").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        assert_eq!(
            cache.metadata(root.path(), &path, &metadata).0.as_deref(),
            Some("Small")
        );
        assert_eq!(cache.entries().len(), MAX_ENTRIES);
        assert!(!cache.entries().contains_key(&path));
        cache.remove_root(root.path());
        assert!(cache.entries().is_empty());
    }
}
