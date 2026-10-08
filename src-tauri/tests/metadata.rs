use notes_lib::markdown::{aliases, first_h1, tags};

#[test]
fn frontmatter_lists_merge_with_inline_tags_and_preserve_source() {
    let content = "---\r\ntags: [study, '#study', עברית/לימוד, null, 3, {bad: value}]\r\naliases: [Alternative title, כינוי, Alternative title, false]\r\ncustom: keep #hidden\r\n---\r\n\r\n# Actual title\r\n#study #לִמּוּד/עברית\r\n";
    assert_eq!(tags(content), ["study", "עברית/לימוד", "לִמּוּד/עברית"]);
    assert_eq!(aliases(content), ["Alternative title", "כינוי"]);
    assert_eq!(first_h1(content).as_deref(), Some("Actual title"));
}

#[test]
fn scalar_metadata_fields_and_unicode_names_are_normalized() {
    assert_eq!(
        tags("---\ntags: '#one/two'\n---\n#body"),
        ["one/two", "body"]
    );
    assert_eq!(aliases("---\naliases: כינוי\n---"), ["כינוי"]);
    assert_eq!(tags("---\ntags: [café, café]\n---\n#café"), ["café"]);
    assert_eq!(aliases("---\naliases: [café, café]\n---"), ["café"]);
}

#[test]
fn malformed_scalar_and_mixed_yaml_never_hide_ordinary_body_tags() {
    for yaml in [
        "tags: [broken",
        "scalar",
        "[a, b]",
        "tags: {bad: value}",
        "tags: 42",
    ] {
        let content = format!("---\n{yaml}\n---\n#inline");
        assert_eq!(tags(&content), ["inline"]);
        assert!(aliases(&content).is_empty());
    }
}

#[test]
fn bounded_metadata_keeps_normal_aliases_and_skips_unrelated_alias_expansion() {
    let blob = "x".repeat(1024);
    let references = vec!["*blob"; 1000].join(", ");
    let content = format!("---\npayload: &blob {blob}\nunused: [{references}]\ntags: [study, '#study']\naliases: [Lecture, כינוי]\n---\n# Title\n#body");
    assert_eq!(tags(&content), ["study", "body"]);
    assert_eq!(aliases(&content), ["Lecture", "כינוי"]);

    let shared =
        "---\nname: &name café\ntags: [*name, study]\naliases: [*name, Lecture]\n---\n#body";
    assert_eq!(tags(shared), ["café", "study", "body"]);
    assert_eq!(aliases(shared), ["café", "Lecture"]);
}

#[test]
fn metadata_limits_preserve_body_tags_and_never_rewrite_source() {
    for yaml in [
        format!("unused: {}", "x".repeat(64 * 1024)),
        format!("aliases: [{}]", vec!["name"; 257].join(", ")),
        format!(
            "blob: &blob {}\naliases: [{}]",
            "x".repeat(1024),
            vec!["*blob"; 65].join(", ")
        ),
        format!(
            "blob: &blob {}\ntags: [{}]",
            "x".repeat(1024),
            vec!["*blob"; 65].join(", ")
        ),
    ] {
        let content = format!("---\n{yaml}\n---\n# Actual title\n#inline");
        assert_eq!(tags(&content), ["inline"]);
        assert!(aliases(&content).is_empty());
        assert_eq!(first_h1(&content).as_deref(), Some("Actual title"));
        assert!(content.contains(&yaml));
    }
}

#[test]
fn metadata_accepts_the_item_and_expanded_string_boundaries() {
    let items = (0..256)
        .map(|index| format!("tag{index}"))
        .collect::<Vec<_>>();
    let content = format!("---\ntags: [{}]\n---", items.join(", "));
    assert_eq!(tags(&content), items);
    let blob = "x".repeat(1024);
    let content = format!(
        "---\nblob: &blob {blob}\naliases: [{}]\n---",
        vec!["*blob"; 64].join(", ")
    );
    assert_eq!(aliases(&content), [blob]);
}
