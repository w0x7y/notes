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
    pub modified: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Snapshot {
    pub workspace: Workspace,
    pub entries: Vec<Entry>,
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

fn toolbar_default() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub active_workspace_id: Option<String>,
    #[serde(default)]
    pub sessions: HashMap<String, Session>,
    #[serde(default = "toolbar_default")]
    pub toolbar_visible: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            workspaces: Vec::new(),
            active_workspace_id: None,
            sessions: HashMap::new(),
            toolbar_visible: true,
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Stored {
    #[serde(flatten)]
    pub settings: Settings,
    #[serde(default)]
    pub auto_names: HashMap<String, bool>,
}
