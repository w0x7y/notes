use notes_lib::service::Service;
use std::fs;
use tempfile::tempdir;

fn service() -> (tempfile::TempDir, Service) {
    let config = tempdir().unwrap();
    let service = Service::new(config.path().to_path_buf()).unwrap();
    (config, service)
}

#[test]
fn scan_includes_notes_images_folders_and_tags_outside_code() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("course")).unwrap();
    fs::create_dir(root.path().join(".git")).unwrap();
    fs::write(
        root.path().join("course/שלום.md"),
        "# שלום\n#lesson #עברית\n`#inline`\n```md\n#fenced\n```\n",
    )
    .unwrap();
    fs::write(root.path().join("picture.png"), b"png").unwrap();
    fs::write(root.path().join(".git/secret.md"), "#hidden").unwrap();
    let snapshot = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    assert!(snapshot
        .entries
        .iter()
        .any(|entry| entry.path == "course" && entry.kind == "folder"));
    let note = snapshot
        .entries
        .iter()
        .find(|entry| entry.path == "course/שלום.md")
        .unwrap();
    assert_eq!(note.tags, ["lesson", "עברית"]);
    assert!(snapshot
        .entries
        .iter()
        .any(|entry| entry.path == "picture.png" && entry.kind == "image"));
    assert!(!snapshot
        .entries
        .iter()
        .any(|entry| entry.path.contains("secret")));
}

#[test]
fn rejects_traversal_and_symlink_escape() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("secret.md"), "secret").unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    assert!(service.read_note(&workspace.id, "../secret.md").is_err());
    assert!(service
        .read_note(&workspace.id, "escape/secret.md")
        .is_err());
    assert!(service.create_note(&workspace.id, "escape").is_err());
    assert!(service
        .scan_workspace(&workspace.id)
        .unwrap()
        .entries
        .iter()
        .all(|entry| !entry.path.starts_with("escape")));
}

#[test]
fn revision_conflict_preserves_external_content() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "old").unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    let note = service.read_note(&workspace.id, "a.md").unwrap();
    fs::write(root.path().join("a.md"), "external").unwrap();
    let error = service
        .save_note(&workspace.id, "a.md", "mine", &note.revision)
        .unwrap_err();
    assert!(error.contains("external"));
    assert_eq!(
        fs::read_to_string(root.path().join("a.md")).unwrap(),
        "external"
    );
}

#[test]
fn new_note_uses_unique_name_and_tracks_title_until_manual_rename() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("Untitled.md"), "existing").unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    let created = service.create_note(&workspace.id, "").unwrap();
    assert_eq!(created.path, "Untitled 2.md");
    assert!(created.auto_rename);
    let saved = service
        .save_note(
            &workspace.id,
            &created.path,
            "# New / title\n",
            &created.revision,
        )
        .unwrap();
    assert_eq!(saved.path, "New - title.md");
    assert!(saved.auto_rename);
    let renamed = service
        .rename_note(&workspace.id, &saved.path, "My choice", &saved.revision)
        .unwrap();
    assert_eq!(renamed.path, "My choice.md");
    assert!(!renamed.auto_rename);
    let saved_again = service
        .save_note(
            &workspace.id,
            &renamed.path,
            "# Another title\n",
            &renamed.revision,
        )
        .unwrap();
    assert_eq!(saved_again.path, "My choice.md");
}

#[test]
fn rename_rewrites_resolvable_links_and_preserves_code() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "[[a]] [read](a.md) `[[a]]`\n```\n[[a]]\n```\n",
    )
    .unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    let note = service.read_note(&workspace.id, "a.md").unwrap();
    let result = service
        .rename_note(&workspace.id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(result.path, "b.md");
    assert_eq!(result.rewritten.len(), 1);
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[b]] [read](b.md) `[[a]]`\n```\n[[a]]\n```\n"
    );
}

#[test]
fn sessions_and_workspace_metadata_persist_outside_notes() {
    let (config, service) = service();
    let root = tempdir().unwrap();
    let workspace = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace;
    service
        .update_workspace(&workspace.id, "School", "#abc", "book")
        .unwrap();
    let sessions = serde_json::json!({workspace.id.clone(): {"tabs": ["a.md"], "primary": "a.md", "secondary": null, "split": false}});
    service
        .save_sessions(
            serde_json::from_value(sessions).unwrap(),
            Some(workspace.id.clone()),
            false,
        )
        .unwrap();
    drop(service);
    let reloaded = Service::new(config.path().to_path_buf())
        .unwrap()
        .load_settings()
        .unwrap();
    assert_eq!(reloaded.workspaces[0].name, "School");
    assert!(!reloaded.toolbar_visible);
    assert!(reloaded.sessions.contains_key(&workspace.id));
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
}

#[test]
fn scan_keeps_hidden_notes_but_skips_hidden_directories() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join(".scratch.md"), "# Scratch").unwrap();
    fs::create_dir(root.path().join(".cache")).unwrap();
    fs::write(root.path().join(".cache/inside.md"), "# Hidden").unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    assert!(selected
        .entries
        .iter()
        .any(|entry| entry.path == ".scratch.md"));
    assert!(!selected
        .entries
        .iter()
        .any(|entry| entry.path.contains("inside.md")));
}

#[test]
fn fenced_code_with_other_marker_does_not_expose_tags_or_titles() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(
        root.path().join("x.md"),
        "~~~md\n# Fake title\n#hidden\n```\n#alsohidden\n~~~\n# Real title\n#visible\n",
    )
    .unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let note = selected
        .entries
        .iter()
        .find(|entry| entry.path == "x.md")
        .unwrap();
    assert_eq!(note.title, "Real title");
    assert_eq!(note.tags, ["visible"]);
}

#[test]
fn saving_existing_note_preserves_its_unix_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let path = root.path().join("private.md");
    fs::write(&path, "old").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let note = service
        .read_note(&selected.workspace.id, "private.md")
        .unwrap();
    service
        .save_note(&selected.workspace.id, "private.md", "new", &note.revision)
        .unwrap();
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o644
    );
}

#[test]
fn scan_rejects_a_registered_root_replaced_by_a_symlink() {
    let (_config, service) = service();
    let holder = tempdir().unwrap();
    let root = holder.path().join("notes");
    let outside = holder.path().join("outside");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("secret.md"), "secret").unwrap();
    let selected = service.add_workspace(root.to_str().unwrap()).unwrap();
    fs::rename(&root, holder.path().join("moved")).unwrap();
    std::os::unix::fs::symlink(&outside, &root).unwrap();
    assert!(service.scan_workspace(&selected.workspace.id).is_err());
}

#[test]
fn an_indented_markdown_h1_drives_the_new_note_filename() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let created = service.create_note(&selected.workspace.id, "").unwrap();
    let saved = service
        .save_note(
            &selected.workspace.id,
            &created.path,
            "  # Lecture notes\n",
            &created.revision,
        )
        .unwrap();
    assert_eq!(saved.path, "Lecture notes.md");
}

#[test]
fn rename_updates_unique_wiki_links_in_other_registered_workspaces() {
    let (_config, service) = service();
    let source = tempdir().unwrap();
    let other = tempdir().unwrap();
    fs::write(source.path().join("lesson.md"), "# Lesson").unwrap();
    fs::write(other.path().join("index.md"), "See [[lesson|class]].").unwrap();
    let source_id = service
        .add_workspace(source.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let other_id = service
        .add_workspace(other.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let note = service.read_note(&source_id, "lesson.md").unwrap();
    let renamed = service
        .rename_note(&source_id, "lesson.md", "topic", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(other.path().join("index.md")).unwrap(),
        "See [[topic|class]]."
    );
    assert!(renamed
        .rewritten
        .iter()
        .any(|item| item.workspace_id == other_id && item.path == "index.md"));
}

#[test]
fn rename_preserves_ambiguous_basename_links() {
    let (_config, service) = service();
    let source = tempdir().unwrap();
    let other = tempdir().unwrap();
    fs::write(source.path().join("lesson.md"), "# Lesson").unwrap();
    fs::write(other.path().join("lesson.md"), "# Other").unwrap();
    fs::write(other.path().join("index.md"), "[[lesson]]").unwrap();
    let source_id = service
        .add_workspace(source.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .add_workspace(other.path().to_str().unwrap())
        .unwrap();
    let note = service.read_note(&source_id, "lesson.md").unwrap();
    service
        .rename_note(&source_id, "lesson.md", "topic", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(other.path().join("index.md")).unwrap(),
        "[[lesson]]"
    );
}

#[test]
fn dangling_untitled_symlink_does_not_block_note_creation() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    std::os::unix::fs::symlink(
        root.path().join("missing.md"),
        root.path().join("Untitled.md"),
    )
    .unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let created = service.create_note(&selected.workspace.id, "").unwrap();
    assert_eq!(created.path, "Untitled 2.md");
    assert!(fs::symlink_metadata(root.path().join("Untitled.md"))
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn rename_percent_encodes_spaces_in_markdown_destinations() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(root.path().join("ref.md"), "[read](a.md)").unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let id = &selected.workspace.id;
    let note = service.read_note(id, "a.md").unwrap();
    let renamed = service
        .rename_note(id, "a.md", "Two words", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[read](Two%20words.md)"
    );
    service
        .rename_note(id, &renamed.path, "Three words", &renamed.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[read](Three%20words.md)"
    );
}

#[test]
fn rename_leaves_links_inside_double_backtick_code_spans() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "``[[a]] [read](a.md)`` and [[a]]",
    )
    .unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let id = &selected.workspace.id;
    let note = service.read_note(id, "a.md").unwrap();
    service
        .rename_note(id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "``[[a]] [read](a.md)`` and [[b]]"
    );
}

#[test]
fn unique_filename_lookup_reports_filesystem_errors() {
    let root = tempdir().unwrap();
    let not_a_folder = root.path().join("file");
    fs::write(&not_a_folder, "content").unwrap();
    assert!(notes_lib::pathing::unique_file(&not_a_folder, "Untitled", None).is_err());
}

#[test]
fn rename_returns_committed_path_and_warning_if_config_write_fails() {
    let (config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(root.path().join("ref.md"), "[[a]]").unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let id = &selected.workspace.id;
    let note = service.read_note(id, "a.md").unwrap();
    fs::remove_file(config.path().join("notes.json")).unwrap();
    fs::create_dir(config.path().join("notes.json")).unwrap();
    let result = service
        .rename_note(id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(result.path, "b.md");
    assert!(!result.warnings.is_empty());
    assert!(root.path().join("b.md").exists());
    assert!(!root.path().join("a.md").exists());
    assert_eq!(result.rewritten[0].content, "[[b]]");
}

#[test]
fn autosave_reports_new_revision_when_automatic_rename_fails() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let id = &selected.workspace.id;
    let created = service.create_note(id, "").unwrap();
    let content = format!("# {}\nbody", "界".repeat(180));
    let result = service
        .save_note(id, &created.path, &content, &created.revision)
        .unwrap();
    assert_eq!(result.path, created.path);
    assert_eq!(result.content, content);
    assert!(!result.warnings.is_empty());
    assert_eq!(
        service.read_note(id, &created.path).unwrap().revision,
        result.revision
    );
}

#[test]
fn indented_code_does_not_contribute_tags_or_rewrite_links() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "    [[a]] #hidden\n[[a]] #visible\n",
    )
    .unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let entry = selected
        .entries
        .iter()
        .find(|item| item.path == "ref.md")
        .unwrap();
    assert_eq!(entry.tags, ["visible"]);
    let note = service.read_note(&selected.workspace.id, "a.md").unwrap();
    service
        .rename_note(&selected.workspace.id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "    [[a]] #hidden\n[[b]] #visible\n"
    );
}

#[test]
fn shorter_backtick_run_does_not_close_a_longer_fence() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    let body = "````md\n```\n[[a]] #hidden\n````\n[[a]] #visible\n";
    fs::write(root.path().join("ref.md"), body).unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let entry = selected
        .entries
        .iter()
        .find(|item| item.path == "ref.md")
        .unwrap();
    assert_eq!(entry.tags, ["visible"]);
    let note = service.read_note(&selected.workspace.id, "a.md").unwrap();
    service
        .rename_note(&selected.workspace.id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "````md\n```\n[[a]] #hidden\n````\n[[b]] #visible\n"
    );
}

#[test]
fn rename_qualifies_wiki_link_when_new_basename_is_ambiguous() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("folder")).unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(root.path().join("folder/b.md"), "# Other B").unwrap();
    fs::write(root.path().join("ref.md"), "[[a]]").unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let id = &selected.workspace.id;
    let note = service.read_note(id, "a.md").unwrap();
    let first = service
        .rename_note(id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[/b]]"
    );
    service
        .rename_note(id, &first.path, "c", &first.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[/c]]"
    );
}

#[test]
fn cross_workspace_rewrite_identifies_target_when_new_basename_collides() {
    let (_config, service) = service();
    let target = tempdir().unwrap();
    let other = tempdir().unwrap();
    fs::write(target.path().join("a.md"), "# A").unwrap();
    fs::write(other.path().join("b.md"), "# Existing B").unwrap();
    fs::write(other.path().join("ref.md"), "[[a]]").unwrap();
    let target_id = service
        .add_workspace(target.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .add_workspace(other.path().to_str().unwrap())
        .unwrap();
    let note = service.read_note(&target_id, "a.md").unwrap();
    let first = service
        .rename_note(&target_id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(other.path().join("ref.md")).unwrap(),
        format!("[[{target_id}:b]]")
    );
    service
        .rename_note(&target_id, &first.path, "c", &first.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(other.path().join("ref.md")).unwrap(),
        format!("[[{target_id}:c]]")
    );
}

#[test]
fn multiline_inline_code_does_not_contribute_tags_or_rewrite_links() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "`code\n[[a]] #hidden\n`\n[[a]] #visible\n",
    )
    .unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let entry = selected
        .entries
        .iter()
        .find(|item| item.path == "ref.md")
        .unwrap();
    assert_eq!(entry.tags, ["visible"]);
    let note = service.read_note(&selected.workspace.id, "a.md").unwrap();
    service
        .rename_note(&selected.workspace.id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "`code\n[[a]] #hidden\n`\n[[b]] #visible\n"
    );
}

#[test]
fn nested_blockquote_fence_does_not_contribute_tags_or_rewrite_links() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "> ````md\n> [[a]] #hidden\n> ```\n> [[a]] #stillhidden\n> ````\n[[a]] #visible\n",
    )
    .unwrap();
    let selected = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap();
    let entry = selected
        .entries
        .iter()
        .find(|item| item.path == "ref.md")
        .unwrap();
    assert_eq!(entry.tags, ["visible"]);
    let note = service.read_note(&selected.workspace.id, "a.md").unwrap();
    service
        .rename_note(&selected.workspace.id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "> ````md\n> [[a]] #hidden\n> ```\n> [[a]] #stillhidden\n> ````\n[[b]] #visible\n"
    );
}

#[test]
fn appearance_follows_note_renames_and_rejects_invalid_entries() {
    use notes_lib::model::Appearance;
    let (_config, service) = service();
    let root = tempdir().unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let note = service.create_note(&id, "").unwrap();
    let appearance = Appearance {
        icon: Some("file-heart".into()),
        color: Some("#A1b2C3".into()),
    };
    service
        .set_entry_appearance(&id, &note.path, appearance.clone())
        .unwrap();
    assert!(service
        .set_entry_appearance(&id, "../outside", appearance.clone())
        .is_err());
    assert!(service
        .set_entry_appearance(&id, "missing.md", appearance.clone())
        .is_err());
    let saved = service
        .save_note(&id, &note.path, "# Topic", &note.revision)
        .unwrap();
    assert_eq!(
        service.load_settings().unwrap().appearances[&id][&saved.path],
        appearance
    );
    let renamed = service
        .rename_note(&id, &saved.path, "Chosen", &saved.revision)
        .unwrap();
    let settings = service.load_settings().unwrap();
    assert_eq!(settings.appearances[&id][&renamed.path], appearance);
    assert!(!settings.appearances[&id].contains_key(&saved.path));
}

#[test]
fn removing_offline_workspace_only_changes_registration_metadata() {
    use notes_lib::model::Appearance;
    let (config, service) = service();
    let holder = tempdir().unwrap();
    let root = holder.path().join("notes");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("a.md"), "keep").unwrap();
    let id = service
        .add_workspace(root.to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .set_entry_appearance(
            &id,
            "a.md",
            Appearance {
                icon: None,
                color: Some("#123456".into()),
            },
        )
        .unwrap();
    let note = service.read_note(&id, "a.md").unwrap();
    service.save_sessions(serde_json::from_value(serde_json::json!({id.clone(): {"tabs": ["a.md"], "primary": "a.md", "secondary": null, "split": false}})).unwrap(), Some(id.clone()), true).unwrap();
    fs::rename(&root, holder.path().join("offline")).unwrap();
    let settings = service.remove_workspace(&id).unwrap();
    assert!(settings.workspaces.is_empty());
    assert!(settings.sessions.is_empty());
    assert!(settings.appearances.is_empty());
    assert!(settings.active_workspace_id.is_none());
    assert_eq!(
        fs::read_to_string(holder.path().join("offline/a.md")).unwrap(),
        "keep"
    );
    assert_eq!(service.load_settings().unwrap().workspaces.len(), 0);
    drop(service);
    let config_text = fs::read_to_string(config.path().join("notes.json")).unwrap();
    assert!(!config_text.contains(&id));
    assert!(!note.auto_rename);
}

#[test]
fn image_rename_preserves_extension_and_rewrites_resolvable_embeds() {
    use notes_lib::model::Appearance;
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("assets")).unwrap();
    fs::write(root.path().join("old.png"), b"pixels").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "![[old.png]] ![image](old.png) `![[old.png]]` ![[missing.png]]",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let appearance = Appearance {
        icon: Some("image".into()),
        color: None,
    };
    service
        .set_entry_appearance(&id, "old.png", appearance.clone())
        .unwrap();
    let result = service.rename_image(&id, "old.png", "assets/new").unwrap();
    assert_eq!(result.path, "assets/new.png");
    assert_eq!(
        fs::read(root.path().join("assets/new.png")).unwrap(),
        b"pixels"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "![[new.png]] ![image](assets/new.png) `![[old.png]]` ![[missing.png]]"
    );
    assert_eq!(result.rewritten.len(), 1);
    assert_eq!(
        service.load_settings().unwrap().appearances[&id][&result.path],
        appearance
    );
    assert!(service
        .rename_image(&id, &result.path, "../escape")
        .is_err());
    assert!(service
        .rename_image(&id, &result.path, "other.jpg")
        .is_err());
    fs::write(root.path().join("assets/existing.png"), b"existing").unwrap();
    assert!(service
        .rename_image(&id, &result.path, "assets/existing.png")
        .is_err());
    assert_eq!(
        fs::read(root.path().join("assets/existing.png")).unwrap(),
        b"existing"
    );
}

#[test]
fn image_rename_bare_destination_moves_nested_image_to_workspace_root() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("Lectures")).unwrap();
    fs::write(root.path().join("Lectures/image.svg"), b"<svg/>").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "![[/Lectures/image.svg]] ![figure](Lectures/image.svg)",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service.save_sessions(serde_json::from_value(serde_json::json!({id.clone(): {"tabs": ["Lectures/image.svg"], "primary": "Lectures/image.svg", "secondary": null, "split": false}})).unwrap(), Some(id.clone()), true).unwrap();
    let result = service
        .rename_image(&id, "Lectures/image.svg", "Renamed.svg")
        .unwrap();
    assert_eq!(result.path, "Renamed.svg");
    assert!(root.path().join("Renamed.svg").exists());
    assert!(!root.path().join("Lectures/image.svg").exists());
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "![[/Renamed.svg]] ![figure](Renamed.svg)"
    );
    let session = &service.load_settings().unwrap().sessions[&id];
    assert_eq!(session.tabs, ["Renamed.svg"]);
    assert_eq!(session.primary.as_deref(), Some("Renamed.svg"));
}

#[test]
fn image_rename_rewrites_embeds_without_changing_note_wiki_links() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("old.png"), b"pixels").unwrap();
    fs::write(root.path().join("old.png.md"), "# Note").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "[[old.png]] ![[old.png]] [note](old.png) ![image](old.png)",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service.rename_image(&id, "old.png", "new.png").unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[old.png]] ![[new.png]] [note](old.png) ![image](new.png)"
    );
}

#[test]
fn image_rename_rewrites_markdown_images_with_nested_and_code_alt_text() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("old.png"), b"pixels").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "![diagram [v1]](old.png) ![diagram `[v1]`](old.png)",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service.rename_image(&id, "old.png", "new.png").unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "![diagram [v1]](new.png) ![diagram `[v1]`](new.png)"
    );
}

#[test]
fn image_rename_rewrites_nested_image_destinations_without_offset_corruption() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("old.png"), b"pixels").unwrap();
    fs::write(root.path().join("ref.md"), "![![inner](old.png)](old.png)").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .rename_image(&id, "old.png", "renamed-long.png")
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "![![inner](renamed-long.png)](renamed-long.png)"
    );
}

#[test]
fn note_rename_keeps_image_syntax_untouched() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "![[a]] [[a]] ![image](a.md) [note](a.md)",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let note = service.read_note(&id, "a.md").unwrap();
    service
        .rename_note(&id, "a.md", "b", &note.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "![[a]] [[b]] ![image](a.md) [note](b.md)"
    );
}

#[test]
fn image_rename_rewrites_workspace_root_markdown_image_destination() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("Lectures")).unwrap();
    fs::write(root.path().join("old.png"), b"pixels").unwrap();
    fs::write(root.path().join("Lectures/ref.md"), "![figure](/old.png)").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service.rename_image(&id, "old.png", "new.png").unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("Lectures/ref.md")).unwrap(),
        "![figure](/new.png)"
    );
}

#[test]
fn bare_image_embed_rewrite_prefers_its_own_workspace() {
    let (_config, service) = service();
    let first = tempdir().unwrap();
    let second = tempdir().unwrap();
    for root in [&first, &second] {
        fs::write(root.path().join("old.png"), b"pixels").unwrap();
        fs::write(root.path().join("ref.md"), "![[old.png]]").unwrap();
    }
    let first_id = service
        .add_workspace(first.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .add_workspace(second.path().to_str().unwrap())
        .unwrap();
    service
        .rename_image(&first_id, "old.png", "new.png")
        .unwrap();
    assert_eq!(
        fs::read_to_string(first.path().join("ref.md")).unwrap(),
        "![[new.png]]"
    );
    assert_eq!(
        fs::read_to_string(second.path().join("ref.md")).unwrap(),
        "![[old.png]]"
    );
}

#[test]
fn note_rename_bare_destination_moves_nested_note_to_workspace_root() {
    let (_config, service) = service();
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("Lectures")).unwrap();
    fs::write(root.path().join("Lectures/a.md"), "# A").unwrap();
    fs::write(
        root.path().join("ref.md"),
        "[[/Lectures/a]] [read](Lectures/a.md)",
    )
    .unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service.save_sessions(serde_json::from_value(serde_json::json!({id.clone(): {"tabs": ["Lectures/a.md"], "primary": "Lectures/a.md", "secondary": null, "split": false}})).unwrap(), Some(id.clone()), true).unwrap();
    let note = service.read_note(&id, "Lectures/a.md").unwrap();
    let result = service
        .rename_note(&id, "Lectures/a.md", "Renamed.md", &note.revision)
        .unwrap();
    assert_eq!(result.path, "Renamed.md");
    assert!(root.path().join("Renamed.md").exists());
    assert!(!root.path().join("Lectures/a.md").exists());
    assert_eq!(
        fs::read_to_string(root.path().join("ref.md")).unwrap(),
        "[[/Renamed]] [read](Renamed.md)"
    );
    let session = &service.load_settings().unwrap().sessions[&id];
    assert_eq!(session.tabs, ["Renamed.md"]);
    assert_eq!(session.primary.as_deref(), Some("Renamed.md"));
}

#[derive(Default)]
struct FakeTrash(std::sync::Mutex<Vec<std::path::PathBuf>>);
impl notes_lib::service::Trash for FakeTrash {
    fn delete(&self, path: &std::path::Path) -> Result<(), String> {
        self.0.lock().unwrap().push(path.to_path_buf());
        fs::remove_file(path).map_err(|e| e.to_string())
    }
}

#[test]
fn delete_checks_revision_and_prunes_metadata_after_trash_success() {
    use notes_lib::model::Appearance;
    let fake = std::sync::Arc::new(FakeTrash::default());
    let config = tempdir().unwrap();
    let service = Service::with_trash(config.path().to_path_buf(), fake.clone()).unwrap();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "old").unwrap();
    fs::write(root.path().join("b.png"), b"pixels").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    service
        .set_entry_appearance(
            &id,
            "a.md",
            Appearance {
                icon: None,
                color: Some("#123456".into()),
            },
        )
        .unwrap();
    service.save_sessions(serde_json::from_value(serde_json::json!({id.clone(): {"tabs": ["a.md", "b.png"], "primary": "a.md", "secondary": "b.png", "split": true}})).unwrap(), Some(id.clone()), true).unwrap();
    let revision = service.read_note(&id, "a.md").unwrap().revision;
    assert!(service.delete_file(&id, "a.md", None).is_err());
    assert!(service.delete_file(&id, "a.md", Some("wrong")).is_err());
    assert!(root.path().join("a.md").exists());
    service.delete_file(&id, "a.md", Some(&revision)).unwrap();
    service.delete_file(&id, "b.png", None).unwrap();
    assert_eq!(fake.0.lock().unwrap().len(), 2);
    let settings = service.load_settings().unwrap();
    assert!(settings.appearances.get(&id).is_none_or(|a| a.is_empty()));
    assert!(settings.sessions[&id].tabs.is_empty());
    assert!(settings.sessions[&id].primary.is_none());
    assert!(settings.sessions[&id].secondary.is_none());
    assert!(!settings.sessions[&id].split);
    assert!(service.delete_file(&id, "../outside.md", None).is_err());
}

#[test]
fn committed_image_rename_and_delete_report_metadata_write_failures() {
    let fake = std::sync::Arc::new(FakeTrash::default());
    let config = tempdir().unwrap();
    let service = Service::with_trash(config.path().to_path_buf(), fake).unwrap();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.png"), b"pixels").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    fs::remove_file(config.path().join("notes.json")).unwrap();
    fs::create_dir(config.path().join("notes.json")).unwrap();
    let renamed = service.rename_image(&id, "a.png", "b").unwrap();
    assert_eq!(renamed.path, "b.png");
    assert!(!renamed.warnings.is_empty());
    assert!(root.path().join("b.png").exists());
    let deleted = service.delete_file(&id, "b.png", None).unwrap();
    assert!(!deleted.warnings.is_empty());
    assert!(!root.path().join("b.png").exists());
}

#[test]
fn failed_workspace_removal_persistence_keeps_registration_and_files() {
    let (config, service) = service();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.md"), "keep").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    fs::remove_file(config.path().join("notes.json")).unwrap();
    fs::create_dir(config.path().join("notes.json")).unwrap();
    assert!(service.remove_workspace(&id).is_err());
    assert_eq!(service.load_settings().unwrap().workspaces[0].id, id);
    assert_eq!(
        fs::read_to_string(root.path().join("a.md")).unwrap(),
        "keep"
    );
}

struct RejectTrash;
impl notes_lib::service::Trash for RejectTrash {
    fn delete(&self, _path: &std::path::Path) -> Result<(), String> {
        Err("Trash unavailable".into())
    }
}

#[test]
fn trash_failure_preserves_file_and_metadata() {
    use notes_lib::model::Appearance;
    let config = tempdir().unwrap();
    let service = Service::with_trash(
        config.path().to_path_buf(),
        std::sync::Arc::new(RejectTrash),
    )
    .unwrap();
    let root = tempdir().unwrap();
    fs::write(root.path().join("a.png"), b"pixels").unwrap();
    let id = service
        .add_workspace(root.path().to_str().unwrap())
        .unwrap()
        .workspace
        .id;
    let appearance = Appearance {
        icon: None,
        color: Some("#123456".into()),
    };
    service
        .set_entry_appearance(&id, "a.png", appearance.clone())
        .unwrap();
    assert!(service.delete_file(&id, "a.png", None).is_err());
    assert!(root.path().join("a.png").exists());
    assert_eq!(
        service.load_settings().unwrap().appearances[&id]["a.png"],
        appearance
    );
}
