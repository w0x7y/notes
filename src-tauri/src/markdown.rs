use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use pulldown_cmark::{Event, LinkType, Parser, Tag};
use regex::{Captures, Regex};
use serde::de::{self, DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor};
use std::collections::HashSet;
use std::fmt;
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

static TAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:^|[^\p{L}\p{N}_])#([\p{L}\p{N}_][\p{L}\p{N}\p{M}_/-]*)").unwrap()
});
static METADATA_TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[\p{L}\p{N}_][\p{L}\p{N}\p{M}_/-]*$").unwrap());
static WIKI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(!?)\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]").unwrap());
static LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\]\(([^)\s]+)(\s+[^)]*)?\)").unwrap());
const LINK_PATH: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'<')
    .add(b'>')
    .add(b'#')
    .add(b'%')
    .add(b'?')
    .add(b'(')
    .add(b')');

#[derive(Clone, Copy)]
struct Fence {
    marker: u8,
    length: usize,
}

fn code_line(line: &str, fence: &mut Option<Fence>) -> bool {
    let unindented = line.trim_start_matches(' ');
    let indent = line.len() - unindented.len();
    if let Some(open) = fence {
        if indent <= 3 && unindented.as_bytes().first() == Some(&open.marker) {
            let length = unindented
                .as_bytes()
                .iter()
                .take_while(|byte| **byte == open.marker)
                .count();
            if length >= open.length && unindented[length..].trim().is_empty() {
                *fence = None;
            }
        }
        return true;
    }
    if indent >= 4 || unindented.starts_with('\t') {
        return true;
    }
    let marker = match unindented.as_bytes().first() {
        Some(b'`') => b'`',
        Some(b'~') => b'~',
        _ => return false,
    };
    let length = unindented
        .as_bytes()
        .iter()
        .take_while(|byte| **byte == marker)
        .count();
    if length < 3 || (marker == b'`' && unindented[length..].contains('`')) {
        return false;
    }
    *fence = Some(Fence { marker, length });
    true
}

fn map_outside_code(
    content: &str,
    mut outside: impl FnMut(&str) -> String,
    mut code: impl FnMut(&str) -> String,
) -> String {
    let mut protected = Parser::new(content)
        .into_offset_iter()
        .filter_map(|(event, range)| match event {
            Event::Code(_) | Event::Start(Tag::CodeBlock(_)) => Some(range),
            _ => None,
        })
        .collect::<Vec<_>>();
    protected.sort_by_key(|range| range.start);
    let mut result = String::with_capacity(content.len());
    let mut cursor = 0;
    for range in protected {
        if range.end <= cursor {
            continue;
        }
        if range.start > cursor {
            result.push_str(&outside(&content[cursor..range.start]));
        }
        let protected_start = cursor.max(range.start);
        result.push_str(&code(&content[protected_start..range.end]));
        cursor = range.end;
    }
    result.push_str(&outside(&content[cursor..]));
    result
}

pub fn visible_segments(content: &str, transform: impl FnMut(&str) -> String) -> String {
    map_outside_code(content, transform, str::to_string)
}

/// Only a closed YAML block at the start is metadata. Preserve ordinary thematic
/// breaks and unfinished Markdown rather than silently hiding the rest of a note.
fn body_without_frontmatter(content: &str) -> &str {
    let mut lines = content.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return content;
    };
    if first != "---\n" && first != "---\r\n" {
        return content;
    }
    let mut offset = first.len();
    for line in lines {
        offset += line.len();
        if line.trim_end_matches(['\r', '\n']) == "---" {
            return &content[offset..];
        }
    }
    content
}

const MAX_FRONTMATTER_BYTES: usize = 64 * 1024;
const MAX_METADATA_ITEMS: usize = 256;
const MAX_METADATA_BYTES: usize = 64 * 1024;
const METADATA_LIMIT: &str = "Frontmatter metadata exceeds";

#[derive(Default)]
struct Frontmatter {
    tags: Vec<String>,
    aliases: Vec<String>,
}

#[derive(Default)]
struct MetadataBudget {
    items: usize,
    bytes: usize,
}

impl MetadataBudget {
    fn item<E: de::Error>(&mut self) -> Result<(), E> {
        self.items += 1;
        if self.items > MAX_METADATA_ITEMS {
            return Err(E::custom(format!("{METADATA_LIMIT} 256 values")));
        }
        Ok(())
    }

    fn string<E: de::Error>(&mut self, value: &str) -> Result<String, E> {
        if value.len() > MAX_METADATA_BYTES - self.bytes {
            return Err(E::custom(format!("{METADATA_LIMIT} 64 KiB of strings")));
        }
        self.bytes += value.len();
        Ok(value.trim().nfc().collect())
    }
}

struct MetadataString<'a>(&'a mut MetadataBudget);

impl<'de> DeserializeSeed<'de> for MetadataString<'_> {
    type Value = Option<String>;

    fn deserialize<D: de::Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> Result<Self::Value, D::Error> {
        self.0.item()?;
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for MetadataString<'_> {
    type Value = Option<String>;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a metadata string")
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
        self.0.string(value).map(Some)
    }

    fn visit_bool<E: de::Error>(self, _: bool) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_i64<E: de::Error>(self, _: i64) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_u64<E: de::Error>(self, _: u64) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Self::Value, A::Error> {
        while sequence.next_element::<IgnoredAny>()?.is_some() {}
        Ok(None)
    }

    fn visit_map<A: MapAccess<'de>>(self, mut mapping: A) -> Result<Self::Value, A::Error> {
        while mapping.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
        Ok(None)
    }
}

struct MetadataStrings<'a>(&'a mut MetadataBudget);

impl<'de> DeserializeSeed<'de> for MetadataStrings<'_> {
    type Value = Vec<String>;

    fn deserialize<D: de::Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for MetadataStrings<'_> {
    type Value = Vec<String>;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("metadata strings or a list")
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
        self.0.item()?;
        Ok(vec![self.0.string(value)?])
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Self::Value, A::Error> {
        let mut strings = Vec::new();
        while let Some(value) = sequence.next_element_seed(MetadataString(self.0))? {
            if let Some(value) = value {
                strings.push(value);
            }
        }
        Ok(strings)
    }

    fn visit_bool<E: de::Error>(self, _: bool) -> Result<Self::Value, E> {
        Ok(Vec::new())
    }

    fn visit_i64<E: de::Error>(self, _: i64) -> Result<Self::Value, E> {
        Ok(Vec::new())
    }

    fn visit_u64<E: de::Error>(self, _: u64) -> Result<Self::Value, E> {
        Ok(Vec::new())
    }

    fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
        Ok(Vec::new())
    }

    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(Vec::new())
    }

    fn visit_map<A: MapAccess<'de>>(self, mut mapping: A) -> Result<Self::Value, A::Error> {
        while mapping.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
        Ok(Vec::new())
    }
}

impl<'de> Visitor<'de> for Frontmatter {
    type Value = Self;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("frontmatter properties")
    }

    fn visit_map<A: MapAccess<'de>>(mut self, mut mapping: A) -> Result<Self, A::Error> {
        let mut budget = MetadataBudget::default();
        while let Some(key) = mapping.next_key::<MetadataKey>()? {
            match key {
                MetadataKey::Tags => {
                    self.tags = mapping.next_value_seed(MetadataStrings(&mut budget))?
                }
                MetadataKey::Aliases => {
                    self.aliases = mapping.next_value_seed(MetadataStrings(&mut budget))?
                }
                _ => {
                    mapping.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(self)
    }
}

#[derive(serde::Deserialize)]
#[serde(field_identifier, rename_all = "lowercase")]
enum MetadataKey {
    Tags,
    Aliases,
    #[serde(other)]
    Other,
}

fn frontmatter(content: &str) -> Result<Frontmatter, String> {
    let body = body_without_frontmatter(content);
    if body.len() == content.len() {
        return Ok(Frontmatter::default());
    }
    let metadata = &content[..content.len() - body.len()];
    let Some((_, yaml)) = metadata.split_once('\n') else {
        return Ok(Frontmatter::default());
    };
    let yaml = yaml
        .trim_end_matches(['\r', '\n'])
        .strip_suffix("---")
        .unwrap_or(yaml);
    if yaml.len() > MAX_FRONTMATTER_BYTES {
        return Err(format!("{METADATA_LIMIT} 64 KiB of YAML input"));
    }
    // Ignore unrelated YAML values without building a Value tree. Relevant
    // scalar aliases share a budget checked before owned strings are allocated.
    match de::Deserializer::deserialize_map(
        serde_yaml_ng::Deserializer::from_str(yaml),
        Frontmatter::default(),
    ) {
        Ok(mut metadata) => {
            let mut seen = HashSet::new();
            metadata
                .aliases
                .retain(|value| !value.is_empty() && seen.insert(value.clone()));
            Ok(metadata)
        }
        Err(error) if error.to_string().contains(METADATA_LIMIT) => Err(error.to_string()),
        Err(_) => Ok(Frontmatter::default()),
    }
}

pub fn aliases(content: &str) -> Vec<String> {
    frontmatter(content).unwrap_or_default().aliases
}

pub fn tags(content: &str) -> Vec<String> {
    merge_tags(content, frontmatter(content).unwrap_or_default().tags)
}

pub(crate) type NoteMetadata = (Option<String>, Vec<String>, Vec<String>, Option<String>);

pub(crate) fn scan_metadata(content: &str) -> NoteMetadata {
    let (metadata, warning) = match frontmatter(content) {
        Ok(metadata) => (metadata, None),
        Err(error) => (
            Frontmatter::default(),
            Some(format!("Frontmatter metadata ignored: {error}")),
        ),
    };
    (
        first_h1(content),
        merge_tags(content, metadata.tags),
        metadata.aliases,
        warning,
    )
}

fn merge_tags(content: &str, metadata_tags: Vec<String>) -> Vec<String> {
    let mut tags = metadata_tags
        .into_iter()
        .filter_map(|tag| {
            let tag = tag.strip_prefix('#').unwrap_or(&tag);
            METADATA_TAG.is_match(tag).then(|| tag.to_string())
        })
        .collect::<Vec<_>>();
    let mut seen = HashSet::new();
    tags.retain(|tag| seen.insert(tag.clone()));
    let visible = map_outside_code(body_without_frontmatter(content), str::to_string, |text| {
        text.chars()
            .map(|ch| if ch == '\n' { '\n' } else { ' ' })
            .collect()
    });
    for outside in visible.lines() {
        for cap in TAG.captures_iter(outside) {
            let tag = cap[1].nfc().collect::<String>();
            if !tags.contains(&tag) {
                tags.push(tag);
            }
        }
    }
    tags
}

pub fn first_h1(content: &str) -> Option<String> {
    let mut fence = None;
    for line in body_without_frontmatter(content).lines() {
        if code_line(line, &mut fence) {
            continue;
        }
        let unindented = line.trim_start_matches(' ');
        if line.len() - unindented.len() > 3 {
            continue;
        }
        if let Some(rest) = unindented.strip_prefix('#') {
            if rest.is_empty() || rest.starts_with(char::is_whitespace) {
                let title = rest.trim().trim_end_matches('#').trim();
                return Some(if title.is_empty() {
                    "Untitled".into()
                } else {
                    title.into()
                });
            }
        }
    }
    None
}

fn path_eq(candidate: &Path, target: &Path, original_source: &Path) -> bool {
    if candidate == target {
        return true;
    }
    let Some(parent) = candidate.parent() else {
        return false;
    };
    if let Ok(parent) = parent.canonicalize() {
        return parent.join(candidate.file_name().unwrap_or_default()) == target;
    }
    // A relocation removes old parents. Only missing ancestors of the original
    // source or target may resolve lexically; unrelated missing paths stay invalid.
    let target_parent = target.parent().unwrap_or(target);
    let source_parent = original_source.parent().unwrap_or(original_source);
    let mut normalized = PathBuf::new();
    for component in parent.components() {
        match component {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            _ => normalized.push(component.as_os_str()),
        }
        match std::fs::symlink_metadata(&normalized) {
            Ok(metadata) if metadata.file_type().is_symlink() => return false,
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound
                    && (target_parent.starts_with(&normalized)
                        || source_parent.starts_with(&normalized)) => {}
            Err(_) => return false,
            _ => {}
        }
    }
    normalized.join(candidate.file_name().unwrap_or_default()) == target
}

pub struct LinkRewrite<'a> {
    pub source: &'a Path,
    pub final_source: &'a Path,
    pub source_root: &'a Path,
    pub old: &'a Path,
    pub new: &'a Path,
    pub target_root: &'a Path,
    pub target_workspace_id: &'a str,
    pub unique_basename: bool,
    pub bare_destination: &'a str,
    pub qualified_destination: &'a str,
    pub image: bool,
    pub original_images: &'a HashSet<PathBuf>,
}

fn rewrite_wiki(caps: &Captures<'_>, rewrite: &LinkRewrite<'_>) -> Option<String> {
    if (&caps[1] == "!") != rewrite.image {
        return None;
    }
    let destination = &caps[2];
    let bare_old = if rewrite.image {
        rewrite.old.file_name()
    } else {
        rewrite.old.file_stem()
    }
    .unwrap_or_default()
    .to_string_lossy();
    let candidate = |path: &str| {
        if rewrite.image {
            path.to_string()
        } else {
            format!("{path}.md")
        }
    };
    let (match_target, qualified) = if let Some(root_path) = destination.strip_prefix('/') {
        (
            path_eq(
                &rewrite.source_root.join(candidate(root_path)),
                rewrite.old,
                rewrite.source,
            ),
            true,
        )
    } else if let Some((id, root_path)) = destination.split_once(':') {
        (
            id == rewrite.target_workspace_id
                && path_eq(
                    &rewrite
                        .target_root
                        .join(candidate(root_path.trim_start_matches('/'))),
                    rewrite.old,
                    rewrite.source,
                ),
            true,
        )
    } else if destination == bare_old.as_ref() {
        if rewrite.image {
            let relative = rewrite
                .source
                .parent()
                .unwrap_or(rewrite.source_root)
                .join(candidate(destination));
            let root = rewrite.source_root.join(candidate(destination));
            let matches = if path_eq(&relative, rewrite.old, rewrite.source) {
                true
            } else if rewrite.original_images.contains(&relative) || relative.exists() {
                false
            } else if path_eq(&root, rewrite.old, rewrite.source) {
                true
            } else if rewrite.original_images.contains(&root) || root.exists() {
                false
            } else {
                rewrite.unique_basename
            };
            (matches, false)
        } else {
            (rewrite.unique_basename, false)
        }
    } else {
        let relative = candidate(destination);
        (
            path_eq(
                &rewrite
                    .source
                    .parent()
                    .unwrap_or(rewrite.source_root)
                    .join(&relative),
                rewrite.old,
                rewrite.source,
            ) || path_eq(
                &rewrite.source_root.join(&relative),
                rewrite.old,
                rewrite.source,
            ),
            destination.contains('/'),
        )
    };
    if !match_target {
        return None;
    }
    let replacement = if qualified {
        rewrite.qualified_destination
    } else {
        rewrite.bare_destination
    };
    Some(format!(
        "{}[[{}{}{}]]",
        &caps[1],
        replacement,
        caps.get(3).map_or("", |m| m.as_str()),
        caps.get(4).map_or("", |m| m.as_str())
    ))
}

fn rewrite_markdown(caps: &Captures<'_>, rewrite: &LinkRewrite<'_>) -> Option<String> {
    let destination = &caps[1];
    let (path, fragment) = destination
        .split_once('#')
        .map_or((destination, ""), |(a, b)| (a, b));
    let decoded = percent_decode_str(path).decode_utf8().ok()?;
    let root_relative = decoded.starts_with('/');
    let candidate = if root_relative {
        rewrite.source_root.join(decoded.trim_start_matches('/'))
    } else {
        rewrite
            .source
            .parent()
            .unwrap_or(rewrite.source_root)
            .join(decoded.as_ref())
    };
    if !path_eq(&candidate, rewrite.old, rewrite.source) {
        return None;
    }
    let relative = if root_relative {
        format!(
            "/{}",
            rewrite
                .new
                .strip_prefix(rewrite.source_root)
                .unwrap_or(rewrite.new)
                .to_string_lossy()
                .replace('\\', "/")
        )
    } else {
        pathdiff::diff_paths(
            rewrite.new,
            rewrite.final_source.parent().unwrap_or(rewrite.source_root),
        )
        .unwrap_or_default()
        .to_string_lossy()
        .replace('\\', "/")
    };
    let fragment = if fragment.is_empty() {
        String::new()
    } else {
        format!("#{fragment}")
    };
    let encoded = utf8_percent_encode(&relative, LINK_PATH);
    Some(format!(
        "]({encoded}{fragment}{})",
        caps.get(2).map_or("", |m| m.as_str())
    ))
}

pub fn rewrite_links(content: &str, rewrites: &[LinkRewrite<'_>]) -> String {
    // Match each original destination once. Rewritten destinations must never
    // become input to another target in the same relocation.
    let wiki = visible_segments(content, |text| {
        WIKI.replace_all(text, |caps: &Captures| {
            rewrites
                .iter()
                .find_map(|rewrite| rewrite_wiki(caps, rewrite))
                .unwrap_or_else(|| caps[0].to_string())
        })
        .to_string()
    });
    let mut replacements = Vec::new();
    for (event, range) in Parser::new(&wiki).into_offset_iter() {
        let image = match event {
            Event::Start(Tag::Image {
                link_type: LinkType::Inline,
                ..
            }) => true,
            Event::Start(Tag::Link {
                link_type: LinkType::Inline,
                ..
            }) => false,
            _ => continue,
        };
        let Some(caps) = LINK.captures_iter(&wiki[range.clone()]).last() else {
            continue;
        };
        let Some(matched) = caps.get(0) else {
            continue;
        };
        if let Some(replacement) = rewrites
            .iter()
            .filter(|rewrite| rewrite.image == image)
            .find_map(|rewrite| rewrite_markdown(&caps, rewrite))
        {
            replacements.push((
                range.start + matched.start(),
                range.start + matched.end(),
                replacement,
            ));
        }
    }
    let mut result = wiki;
    replacements.sort_unstable_by_key(|(start, _, _)| *start);
    replacements.dedup_by_key(|(start, _, _)| *start);
    for (start, end, replacement) in replacements.into_iter().rev() {
        result.replace_range(start..end, &replacement);
    }
    result
}
