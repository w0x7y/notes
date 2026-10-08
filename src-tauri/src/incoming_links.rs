use crate::markdown::{rewrite_links, LinkRewrite};
use crate::model::{Rewrite, Workspace};
use crate::pathing::{normalized_relative, read_note_text, resolve};
use crate::service::{is_image, is_note, revision, workspace_entry};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

struct Candidate<'a> {
    workspace: &'a Workspace,
    path: PathBuf,
}

#[derive(Default)]
struct Basenames {
    notes: HashMap<OsString, usize>,
    images: HashMap<OsString, usize>,
}

impl Basenames {
    fn add(&mut self, path: &Path, image: bool) {
        let (counts, name) = if image {
            (&mut self.images, path.file_name())
        } else {
            (&mut self.notes, path.file_stem())
        };
        if let Some(name) = name {
            *counts.entry(name.to_owned()).or_default() += 1;
        }
    }

    fn count(&self, path: &Path, image: bool) -> usize {
        let (counts, name) = if image {
            (&self.images, path.file_name())
        } else {
            (&self.notes, path.file_stem())
        };
        name.and_then(|name| counts.get(name)).copied().unwrap_or(0)
    }
}

struct Target<'a> {
    old: &'a Path,
    new: &'a Path,
    image: bool,
    unique: bool,
    ambiguous_destination: bool,
    stem: String,
}

/// Runs after the filesystem relocation. Matching uses the reconstructed original
/// paths; relative destinations use final paths. Only the final note is persisted.
pub(crate) fn rewrite_incoming(
    workspaces: &[Workspace],
    target_workspace_id: &str,
    mappings: &[(PathBuf, PathBuf)],
    write_note: impl Fn(&Path, &[u8]) -> Result<Vec<String>, String>,
) -> (Vec<Rewrite>, Vec<String>) {
    if mappings.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let Some(target_workspace) = workspaces.iter().find(|w| w.id == target_workspace_id) else {
        return (
            Vec::new(),
            vec!["Cannot identify renamed note workspace for link updates".into()],
        );
    };
    let original_paths: HashMap<&Path, &Path> = mappings
        .iter()
        .map(|(old, new)| (new.as_path(), old.as_path()))
        .collect();
    let original_path = |path: &Path| {
        original_paths
            .get(path)
            .copied()
            .unwrap_or(path)
            .to_path_buf()
    };
    let notes_moved = mappings.iter().any(|(old, _)| is_note(old));
    let mut notes = Vec::new();
    let mut discovered_notes = HashSet::new();
    let mut original = Basenames::default();
    let mut final_names = Basenames::default();
    let mut original_images = HashSet::new();
    let mut warnings = Vec::new();
    for workspace in std::iter::once(target_workspace).chain(
        workspaces
            .iter()
            .filter(|workspace| workspace.id != target_workspace_id),
    ) {
        if !notes_moved && workspace.id != target_workspace_id {
            continue;
        }
        let root = Path::new(&workspace.path);
        if root.canonicalize().ok().as_deref() != Some(root) {
            warnings.push(format!(
                "Cannot scan links in workspace {}: folder moved or became a symlink",
                workspace.name
            ));
            continue;
        }
        for found in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(workspace_entry)
        {
            let entry = match found {
                Ok(entry) => entry,
                Err(error) => {
                    warnings.push(format!(
                        "Cannot scan links in workspace {}: {error}",
                        workspace.name
                    ));
                    continue;
                }
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            if is_note(path) && discovered_notes.insert(path.to_path_buf()) {
                original.add(&original_path(path), false);
                final_names.add(path, false);
                notes.push(Candidate {
                    workspace,
                    path: path.to_path_buf(),
                });
            } else if is_image(path) && workspace.id == target_workspace_id {
                let old = original_path(path);
                original.add(&old, true);
                final_names.add(path, true);
                original_images.insert(old);
            }
        }
    }
    let target_root = Path::new(&target_workspace.path);
    let targets: Vec<_> = mappings
        .iter()
        .filter_map(|(old, new)| {
            let image = is_image(old);
            let link = if image {
                new.clone()
            } else {
                new.with_extension("")
            };
            let stem = match normalized_relative(target_root, &link) {
                Ok(stem) => stem,
                Err(error) => {
                    warnings.push(error);
                    return None;
                }
            };
            let indexed = usize::from(if image {
                original_images.contains(old)
            } else {
                discovered_notes.contains(new)
            });
            Some(Target {
                old,
                new,
                image,
                unique: original.count(old, image) == indexed,
                ambiguous_destination: final_names.count(new, image) > indexed,
                stem,
            })
        })
        .collect();
    let mut rewritten = Vec::new();
    for Candidate {
        workspace,
        path: note_path,
    } in notes
    {
        let root = Path::new(&workspace.path);
        let path = match normalized_relative(root, &note_path) {
            Ok(path) => path,
            Err(error) => {
                warnings.push(error);
                continue;
            }
        };
        // Recheck the boundary after enumeration and before either file operation.
        let content = match resolve(root, &path, false)
            .and_then(|safe_path| read_note_text(&safe_path).map_err(|error| error.to_string()))
        {
            Ok(content) => content,
            Err(error) => {
                warnings.push(format!("Cannot read links in {path}: {error}"));
                continue;
            }
        };
        let source = original_path(&note_path);
        let destinations: Vec<_> = targets
            .iter()
            .filter(|target| {
                target.old != source && (!target.image || workspace.id == target_workspace_id)
            })
            .map(|target| {
                let qualified = if workspace.id == target_workspace_id {
                    format!("/{}", target.stem)
                } else {
                    format!("{target_workspace_id}:{}", target.stem)
                };
                let bare = if target.ambiguous_destination {
                    qualified.clone()
                } else {
                    (if target.image {
                        target.new.file_name()
                    } else {
                        target.new.file_stem()
                    })
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
                };
                (target, qualified, bare)
            })
            .collect();
        let links: Vec<_> = destinations
            .iter()
            .map(|(target, qualified, bare)| LinkRewrite {
                source: &source,
                final_source: &note_path,
                source_root: root,
                old: target.old,
                new: target.new,
                target_root,
                target_workspace_id,
                unique_basename: target.unique,
                bare_destination: bare,
                qualified_destination: qualified,
                image: target.image,
                original_images: &original_images,
            })
            .collect();
        let changed = rewrite_links(&content, &links);
        if changed == content {
            continue;
        }
        match resolve(root, &path, false)
            .and_then(|safe_path| write_note(&safe_path, changed.as_bytes()))
        {
            Ok(issues) => warnings.extend(
                issues
                    .into_iter()
                    .map(|issue| format!("Links updated in {path}: {issue}")),
            ),
            Err(error) => {
                warnings.push(format!("Cannot update links in {path}: {error}"));
                continue;
            }
        }
        rewritten.push(Rewrite {
            workspace_id: workspace.id.clone(),
            path,
            revision: revision(&changed),
            content: changed,
        });
    }
    (rewritten, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::Service;
    use std::cell::RefCell;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn failed_referring_note_write_preserves_its_text_and_does_not_stop_other_rewrites() {
        let config = tempdir().unwrap();
        let service = Service::new(config.path().to_path_buf()).unwrap();
        let root = tempdir().unwrap();
        fs::create_dir(root.path().join("Old")).unwrap();
        fs::write(root.path().join("Old/a.md"), "# A").unwrap();
        fs::write(root.path().join("Old/b.md"), "# B").unwrap();
        let original = "[[Old/a]] [B](Old/b.md)";
        for path in ["first.md", "second.md"] {
            fs::write(root.path().join(path), original).unwrap();
        }
        let workspace = service
            .add_workspace(root.path().to_str().unwrap())
            .unwrap()
            .workspace;
        let mappings = ["a.md", "b.md"].map(|name| {
            (
                root.path().join("Old").join(name),
                root.path().join("New").join(name),
            )
        });
        fs::rename(root.path().join("Old"), root.path().join("New")).unwrap();

        // Reject the first referring file actually visited, so the test proves
        // that a later successful write survives regardless of directory order.
        let failed_path = RefCell::new(None);
        let (rewritten, warnings) = rewrite_incoming(
            std::slice::from_ref(&workspace),
            &workspace.id,
            &mappings,
            |path, bytes| {
                let mut failed = failed_path.borrow_mut();
                let rejected = failed.get_or_insert_with(|| path.to_path_buf());
                if rejected == path {
                    return Err("Injected write failure".into());
                }
                // Successful writes use the real revision-checked atomic Service
                // adapter, including its scan-cache invalidation.
                let relative = normalized_relative(root.path(), path)?;
                let note = service.read_note(&workspace.id, &relative)?;
                let content = std::str::from_utf8(bytes).map_err(|error| error.to_string())?;
                service.save_note(&workspace.id, &relative, content, &note.revision)?;
                Ok(Vec::new())
            },
        );

        let failed = failed_path.into_inner().unwrap();
        assert_eq!(fs::read_to_string(&failed).unwrap(), original);
        assert_eq!(warnings.len(), 1);
        let failed_relative = normalized_relative(root.path(), &failed).unwrap();
        assert!(warnings[0].contains(&format!("Cannot update links in {failed_relative}:")));
        assert!(warnings[0].contains("Injected write failure"));
        assert_eq!(rewritten.len(), 1);
        let success = &rewritten[0];
        assert_eq!(success.workspace_id, workspace.id);
        assert_ne!(root.path().join(&success.path), failed);
        assert_eq!(success.content, "[[/New/a]] [B](New/b.md)");
        let persisted = service.read_note(&workspace.id, &success.path).unwrap();
        assert_eq!(persisted.content, success.content);
        assert_eq!(persisted.revision, success.revision);
        assert!(root.path().join("New/a.md").exists());
        assert!(root.path().join("New/b.md").exists());
        assert!(!root.path().join("Old").exists());
    }
}
