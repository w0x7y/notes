use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: String,
    pub icon: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub kind: String,
    pub title: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub modified: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Snapshot {
    pub workspace: Workspace,
    pub entries: Vec<Entry>,
    pub warnings: Vec<String>,
    pub incomplete: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Appearance {
    pub icon: Option<String>,
    pub color: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    pub path: String,
    pub content: String,
    pub revision: String,
    pub auto_rename: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rewrite {
    pub workspace_id: String,
    pub path: String,
    pub content: String,
    pub revision: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct SaveResult {
    #[serde(flatten)]
    pub note: NoteFile,
    pub rewritten: Vec<Rewrite>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RenameImageResult {
    pub path: String,
    pub rewritten: Vec<Rewrite>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DeleteResult {
    pub warnings: Vec<String>,
}

impl std::ops::Deref for SaveResult {
    type Target = NoteFile;
    fn deref(&self) -> &Self::Target {
        &self.note
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Session {
    pub tabs: Vec<String>,
    pub primary: Option<String>,
    pub secondary: Option<String>,
    pub split: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditorFont {
    Mono,
    Sans,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchScope {
    All,
    Current,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortFilesBy {
    Name,
    Modified,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Theme {
    GraphiteAmber,
    InkJade,
    MidnightIce,
    CharcoalCoral,
    ForestMoss,
    OneDarkPro,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub theme: Theme,
    pub font_size: u8,
    pub line_height: f64,
    pub editor_font: EditorFont,
    pub custom_font: String,
    pub ui_font: String,
    pub font_weight: u16,
    pub letter_spacing: f64,
    pub line_wrapping: bool,
    pub line_numbers: bool,
    pub spellcheck: bool,
    pub tab_size: u8,
    pub readable_width: bool,
    pub note_width: u16,
    pub default_preview: bool,
    pub autosave_delay_ms: u16,
    pub search_scope: SearchScope,
    pub current_workspace_first: bool,
    pub search_limit: u16,
    pub restore_session: bool,
    pub refresh_on_focus: bool,
    pub sort_files_by: SortFilesBy,
    pub graph_bundling: f64,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            theme: Theme::GraphiteAmber,
            font_size: 15,
            line_height: 1.9,
            editor_font: EditorFont::Mono,
            custom_font: String::new(),
            ui_font: String::new(),
            font_weight: 400,
            letter_spacing: 0.0,
            line_wrapping: true,
            line_numbers: false,
            spellcheck: false,
            tab_size: 2,
            readable_width: true,
            note_width: 940,
            default_preview: false,
            autosave_delay_ms: 600,
            search_scope: SearchScope::All,
            current_workspace_first: true,
            search_limit: 60,
            restore_session: true,
            refresh_on_focus: true,
            sort_files_by: SortFilesBy::Name,
            graph_bundling: 0.85,
        }
    }
}

impl Preferences {
    pub fn validate(&self) -> Result<(), String> {
        if !self.graph_bundling.is_finite() || !(0.0..=1.0).contains(&self.graph_bundling) {
            return Err("Graph bundling strength must be between 0 and 1".into());
        }
        if [&self.custom_font, &self.ui_font]
            .iter()
            .any(|name| name.chars().any(|c| c <= '\u{001f}' || c == '\u{007f}'))
        {
            return Err("Font names must not contain control characters".into());
        }
        if !(300..=700).contains(&self.font_weight) || !self.font_weight.is_multiple_of(100) {
            return Err("Font weight must be 300, 400, 500, 600, or 700".into());
        }
        if !self.letter_spacing.is_finite() || !(-0.5..=3.0).contains(&self.letter_spacing) {
            return Err("Letter spacing must be between -0.5 and 3 pixels".into());
        }
        if !(600..=1400).contains(&self.note_width) {
            return Err("Note width must be between 600 and 1400 pixels".into());
        }
        if !(12..=24).contains(&self.font_size) {
            return Err("Font size must be between 12 and 24".into());
        }
        if !self.line_height.is_finite() || !(1.3..=2.2).contains(&self.line_height) {
            return Err("Line height must be between 1.3 and 2.2".into());
        }
        if ![2, 4, 8].contains(&self.tab_size) {
            return Err("Tab size must be 2, 4, or 8".into());
        }
        if !(200..=5000).contains(&self.autosave_delay_ms) {
            return Err("Autosave delay must be between 200 and 5000 milliseconds".into());
        }
        if !(20..=200).contains(&self.search_limit) {
            return Err("Search limit must be between 20 and 200".into());
        }
        Ok(())
    }
}

fn toolbar_default() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub preferences: Preferences,
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub active_workspace_id: Option<String>,
    #[serde(default)]
    pub sessions: HashMap<String, Session>,
    #[serde(default)]
    pub appearances: HashMap<String, HashMap<String, Appearance>>,
    #[serde(default = "toolbar_default")]
    pub toolbar_visible: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            preferences: Preferences::default(),
            workspaces: Vec::new(),
            active_workspace_id: None,
            sessions: HashMap::new(),
            appearances: HashMap::new(),
            toolbar_visible: true,
        }
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct Stored {
    #[serde(flatten)]
    pub settings: Settings,
    #[serde(default)]
    pub auto_names: HashMap<String, bool>,
}
