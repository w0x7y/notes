use std::fs::{File, OpenOptions};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

pub(crate) const MAX_NOTE_BYTES: u64 = 20 * 1024 * 1024;

pub(crate) fn open_regular(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // Opening a FIFO normally waits for a writer before metadata can be checked.
        // No-follow also rejects a final symlink substituted after path resolution.
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Only regular files can be read",
        ));
    }
    Ok(file)
}

pub(crate) fn read_note_text(path: &Path) -> io::Result<String> {
    read_bounded_text(open_regular(path)?, MAX_NOTE_BYTES)
}

fn read_bounded_text(file: File, limit: u64) -> io::Result<String> {
    let too_large = || io::Error::new(io::ErrorKind::InvalidData, "Note exceeds 20 MiB limit");
    if file.metadata()?.len() > limit {
        return Err(too_large());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(too_large());
    }
    String::from_utf8(bytes).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

pub fn relative(path: &str, allow_empty: bool) -> Result<PathBuf, String> {
    if path.is_empty() && allow_empty {
        return Ok(PathBuf::new());
    }
    let candidate = Path::new(path);
    if candidate.as_os_str().is_empty()
        || candidate
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Invalid workspace-relative path".into());
    }
    Ok(candidate.to_path_buf())
}

pub fn resolve(root: &Path, path: &str, allow_empty: bool) -> Result<PathBuf, String> {
    let relative = relative(path, allow_empty)?;
    let mut target = root.to_path_buf();
    for part in relative.components() {
        target.push(part.as_os_str());
        if let Ok(meta) = std::fs::symlink_metadata(&target) {
            if meta.file_type().is_symlink() {
                return Err("Symlinks are not allowed in workspace paths".into());
            }
        }
    }
    let existing = if target.exists() {
        target.as_path()
    } else {
        target.parent().ok_or("Invalid path")?
    };
    let canonical = existing
        .canonicalize()
        .map_err(|e| format!("Cannot resolve workspace path: {e}"))?;
    if !canonical.starts_with(root) {
        return Err("Path escapes the workspace".into());
    }
    Ok(target)
}

pub fn normalized_relative(root: &Path, target: &Path) -> Result<String, String> {
    let rel = target
        .strip_prefix(root)
        .map_err(|_| "Path escapes the workspace")?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

pub fn clean_filename(name: &str) -> String {
    let cleaned = name
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect::<String>();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    if cleaned.is_empty() {
        "Untitled".into()
    } else {
        truncate_utf8(cleaned, 180).into()
    }
}

fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    let mut end = value.len().min(max_bytes);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

pub fn unique_file(parent: &Path, stem: &str, source: Option<&Path>) -> Result<PathBuf, String> {
    for index in 1.. {
        let suffix = if index == 1 {
            ".md".to_string()
        } else {
            format!(" {index}.md")
        };
        let name = format!("{}{}", truncate_utf8(stem, 255 - suffix.len()), suffix);
        let candidate = parent.join(name);
        if source == Some(candidate.as_path()) {
            return Ok(candidate);
        }
        match std::fs::symlink_metadata(&candidate) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(candidate),
            Err(error) => return Err(format!("Cannot inspect note filename: {error}")),
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_text_accepts_the_limit_and_rejects_oversize_and_invalid_utf8() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("note.md");
        std::fs::write(&path, "שלום").unwrap();
        assert_eq!(
            read_bounded_text(open_regular(&path).unwrap(), 8).unwrap(),
            "שלום"
        );
        assert!(read_bounded_text(open_regular(&path).unwrap(), 7)
            .unwrap_err()
            .to_string()
            .contains("20 MiB"));
        std::fs::write(&path, [0xff]).unwrap();
        assert_eq!(
            read_bounded_text(open_regular(&path).unwrap(), 8)
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn unique_filenames_budget_bytes_for_extensions_and_collision_suffixes() {
        let root = tempfile::tempdir().unwrap();
        let stem = "ש".repeat(180);
        let first = unique_file(root.path(), &stem, None).unwrap();
        assert!(first.file_name().unwrap().len() <= 255);
        std::fs::write(&first, "").unwrap();
        let second = unique_file(root.path(), &stem, None).unwrap();
        assert!(second.file_name().unwrap().len() <= 255);
        assert!(second.to_str().unwrap().ends_with(" 2.md"));
        std::fs::write(&second, "").unwrap();
    }
}
