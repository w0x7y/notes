use std::fs::{File, OpenOptions};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

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

pub(crate) fn read_regular_text(path: &Path) -> io::Result<String> {
    let mut text = String::new();
    open_regular(path)?.read_to_string(&mut text)?;
    Ok(text)
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
        cleaned.chars().take(180).collect()
    }
}

pub fn unique_file(parent: &Path, stem: &str, source: Option<&Path>) -> Result<PathBuf, String> {
    for index in 1.. {
        let name = if index == 1 {
            format!("{stem}.md")
        } else {
            format!("{stem} {index}.md")
        };
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
