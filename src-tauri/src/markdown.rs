use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use pulldown_cmark::{Event, Parser, Tag};
use regex::{Captures, Regex};
use std::path::Path;
use std::sync::LazyLock;

static TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|[^\p{L}\p{N}_])#([\p{L}\p{N}_/-]+)").unwrap());
static WIKI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]").unwrap());
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

pub fn tags(content: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let visible = map_outside_code(content, str::to_string, |text| {
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
    for line in content.lines() {
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
    } = rewrite;
    visible_segments(content, |text| {
        let wiki = WIKI.replace_all(text, |caps: &Captures| {
            let destination = &caps[1];
            let stem = old.file_stem().unwrap_or_default().to_string_lossy();
            let (match_target, qualified) = if let Some(root_path) = destination.strip_prefix('/') {
                (
                    path_eq(&source_root.join(format!("{root_path}.md")), old),
                    true,
                )
            } else if let Some((id, root_path)) = destination.split_once(':') {
                if id == *target_workspace_id {
                    (
                        path_eq(
                            &target_root.join(format!("{}.md", root_path.trim_start_matches('/'))),
                            old,
                        ),
                        true,
                    )
                } else {
                    (false, true)
                }
            } else if destination == stem.as_ref() {
                (*unique_basename, false)
            } else {
                let relative = format!("{destination}.md");
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
                "[[{}{}{}]]",
                replacement,
                caps.get(2).map_or("", |m| m.as_str()),
                caps.get(3).map_or("", |m| m.as_str())
            )
        });
        LINK.replace_all(&wiki, |caps: &Captures| {
            let destination = &caps[1];
            let (path, fragment) = destination
                .split_once('#')
                .map_or((destination, ""), |(a, b)| (a, b));
            let decoded = percent_decode_str(path).decode_utf8();
            let Ok(decoded) = decoded else {
                return caps[0].to_string();
            };
            if !path_eq(
                &source
                    .parent()
                    .unwrap_or(source_root)
                    .join(decoded.as_ref()),
                old,
            ) {
                return caps[0].to_string();
            }
            let relative = pathdiff::diff_paths(new, source.parent().unwrap_or(source_root))
                .unwrap_or_default()
                .to_string_lossy()
                .replace('\\', "/");
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
        })
        .to_string()
    })
}
