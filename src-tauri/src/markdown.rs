use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use pulldown_cmark::{Event, LinkType, Parser, Tag};
use regex::{Captures, Regex};
use std::path::Path;
use std::sync::LazyLock;

static TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|[^\p{L}\p{N}_])#([\p{L}\p{N}_/-]+)").unwrap());
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

pub fn tags(content: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let visible = map_outside_code(body_without_frontmatter(content), str::to_string, |text| {
        text.chars()
            .map(|ch| if ch == '\n' { '\n' } else { ' ' })
            .collect()
    });
    for outside in visible.lines() {
        for cap in TAG.captures_iter(outside) {
            let tag = cap[1].to_string();
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

fn path_eq(candidate: &Path, target: &Path) -> bool {
    let Some(parent) = candidate.parent() else {
        return false;
    };
    parent
        .canonicalize()
        .ok()
        .map(|p| p.join(candidate.file_name().unwrap_or_default()) == target)
        .unwrap_or(false)
}

pub struct LinkRewrite<'a> {
    pub source: &'a Path,
    pub source_root: &'a Path,
    pub old: &'a Path,
    pub new: &'a Path,
    pub target_root: &'a Path,
    pub target_workspace_id: &'a str,
    pub unique_basename: bool,
    pub bare_destination: &'a str,
    pub qualified_destination: &'a str,
    pub image: bool,
}

pub fn rewrite_links(content: &str, rewrite: &LinkRewrite<'_>) -> String {
    let LinkRewrite {
        source,
        source_root,
        old,
        new,
        target_root,
        target_workspace_id,
        unique_basename,
        bare_destination,
        qualified_destination,
        image,
    } = rewrite;
    let wiki = visible_segments(content, |text| {
        WIKI.replace_all(text, |caps: &Captures| {
            let embed = &caps[1] == "!";
            if embed != *image {
                return caps[0].to_string();
            }
            let destination = &caps[2];
            let bare_old = if *image {
                old.file_name()
            } else {
                old.file_stem()
            }
            .unwrap_or_default()
            .to_string_lossy();
            let candidate = |path: &str| {
                if *image {
                    path.to_string()
                } else {
                    format!("{path}.md")
                }
            };
            let (match_target, qualified) = if let Some(root_path) = destination.strip_prefix('/') {
                (path_eq(&source_root.join(candidate(root_path)), old), true)
            } else if let Some((id, root_path)) = destination.split_once(':') {
                if id == *target_workspace_id {
                    (
                        path_eq(
                            &target_root.join(candidate(root_path.trim_start_matches('/'))),
                            old,
                        ),
                        true,
                    )
                } else {
                    (false, true)
                }
            } else if destination == bare_old.as_ref() {
                if *image {
                    let relative = source
                        .parent()
                        .unwrap_or(source_root)
                        .join(candidate(destination));
                    let root = source_root.join(candidate(destination));
                    let matches = if path_eq(&relative, old) {
                        true
                    } else if relative.exists() {
                        false
                    } else if path_eq(&root, old) {
                        true
                    } else if root.exists() {
                        false
                    } else {
                        *unique_basename
                    };
                    (matches, false)
                } else {
                    (*unique_basename, false)
                }
            } else {
                let relative = candidate(destination);
                (
                    path_eq(&source.parent().unwrap_or(source_root).join(&relative), old)
                        || path_eq(&source_root.join(&relative), old),
                    destination.contains('/'),
                )
            };
            if !match_target {
                return caps[0].to_string();
            }
            let replacement = if qualified {
                qualified_destination.to_string()
            } else {
                bare_destination.to_string()
            };
            format!(
                "{}[[{}{}{}]]",
                &caps[1],
                replacement,
                caps.get(3).map_or("", |m| m.as_str()),
                caps.get(4).map_or("", |m| m.as_str())
            )
        })
        .to_string()
    });
    let mut replacements = Vec::new();
    for (event, range) in Parser::new(&wiki).into_offset_iter() {
        let is_image_link = match event {
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
        if is_image_link != *image {
            continue;
        }
        let Some(caps) = LINK.captures_iter(&wiki[range.clone()]).last() else {
            continue;
        };
        let Some(matched) = caps.get(0) else {
            continue;
        };
        let replacement = {
            let destination = &caps[1];
            let (path, fragment) = destination
                .split_once('#')
                .map_or((destination, ""), |(a, b)| (a, b));
            let decoded = percent_decode_str(path).decode_utf8();
            let Ok(decoded) = decoded else {
                continue;
            };
            let root_relative = decoded.starts_with('/');
            let candidate = if root_relative {
                source_root.join(decoded.trim_start_matches('/'))
            } else {
                source
                    .parent()
                    .unwrap_or(source_root)
                    .join(decoded.as_ref())
            };
            if !path_eq(&candidate, old) {
                continue;
            }
            let relative = if root_relative {
                format!(
                    "/{}",
                    new.strip_prefix(source_root)
                        .unwrap_or(new)
                        .to_string_lossy()
                        .replace('\\', "/")
                )
            } else {
                pathdiff::diff_paths(new, source.parent().unwrap_or(source_root))
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
            format!(
                "]({encoded}{fragment}{})",
                caps.get(2).map_or("", |m| m.as_str())
            )
        };
        replacements.push((
            range.start + matched.start(),
            range.start + matched.end(),
            replacement,
        ));
    }
    let mut result = wiki;
    replacements.sort_unstable_by_key(|(start, _, _)| *start);
    replacements.dedup_by_key(|(start, _, _)| *start);
    for (start, end, replacement) in replacements.into_iter().rev() {
        result.replace_range(start..end, &replacement);
    }
    result
}
