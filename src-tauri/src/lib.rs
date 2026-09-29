mod drawing;
mod incoming_links;
pub mod markdown;
pub mod model;
pub mod pathing;
mod scan_cache;
pub mod service;

use model::{
    Appearance, DeleteResult, NoteFile, Preferences, RenameImageResult, SaveResult, Session,
    Settings, Snapshot, Workspace,
};
use service::{ImageData, MoveFolderResult, Service};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;

async fn work<T: Send + 'static>(
    service: tauri::State<'_, Arc<Service>>,
    f: impl FnOnce(Arc<Service>) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || f(service))
        .await
        .map_err(|e| format!("File task failed: {e}"))?
}

#[tauri::command]
async fn load_settings(service: tauri::State<'_, Arc<Service>>) -> Result<Settings, String> {
    work(service, |s| s.load_settings()).await
}
#[tauri::command]
async fn ensure_capture_workspace(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<Snapshot, String> {
    let documents = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir().map(|home| home.join("Documents")))
        .map_err(|e| e.to_string())?;
    work(service, move |s| s.ensure_capture_workspace(&documents)).await
}
#[tauri::command]
async fn write_drawing_svg(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
    svg: String,
) -> Result<String, String> {
    work(service, move |s| s.write_drawing_svg(&workspace_id, &svg)).await
}
#[tauri::command]
async fn save_preferences(
    service: tauri::State<'_, Arc<Service>>,
    preferences: Preferences,
) -> Result<Preferences, String> {
    work(service, move |s| s.save_preferences(preferences)).await
}
#[tauri::command]
async fn save_sessions(
    service: tauri::State<'_, Arc<Service>>,
    sessions: HashMap<String, Session>,
    active_workspace_id: Option<String>,
    toolbar_visible: bool,
) -> Result<(), String> {
    work(service, move |s| {
        s.save_sessions(sessions, active_workspace_id, toolbar_visible)
    })
    .await
}
#[tauri::command]
async fn add_workspace(
    service: tauri::State<'_, Arc<Service>>,
    path: String,
) -> Result<Snapshot, String> {
    work(service, move |s| s.add_workspace(&path)).await
}
#[tauri::command]
async fn update_workspace(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
    name: String,
    color: String,
    icon: String,
) -> Result<Workspace, String> {
    work(service, move |s| {
        s.update_workspace(&workspace_id, &name, &color, &icon)
    })
    .await
}
#[tauri::command]
async fn set_entry_appearance(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
    path: String,
    appearance: Appearance,
) -> Result<Appearance, String> {
    work(service, move |s| {
        s.set_entry_appearance(&workspace_id, &path, appearance)
    })
    .await
}
#[tauri::command]
async fn remove_workspace(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
) -> Result<Settings, String> {
    work(service, move |s| s.remove_workspace(&workspace_id)).await
}
#[tauri::command]
async fn scan_workspace(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
) -> Result<Snapshot, String> {
    work(service, move |s| s.scan_workspace(&workspace_id)).await
}
#[tauri::command]
async fn read_note(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
    path: String,
) -> Result<NoteFile, String> {
    work(service, move |s| s.read_note(&workspace_id, &path)).await
}
#[tauri::command]
async fn create_note(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
    folder: String,
) -> Result<NoteFile, String> {
    work(service, move |s| s.create_note(&workspace_id, &folder)).await
}
#[tauri::command]
async fn save_note(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
    path: String,
    content: String,
    revision: String,
) -> Result<SaveResult, String> {
    work(service, move |s| {
        s.save_note(&workspace_id, &path, &content, &revision)
    })
    .await
}
#[tauri::command]
async fn rename_note(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
    path: String,
    name: String,
    revision: String,
) -> Result<SaveResult, String> {
    work(service, move |s| {
        s.rename_note(&workspace_id, &path, &name, &revision)
    })
    .await
}
#[tauri::command]
async fn rename_image(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
    path: String,
    name: String,
) -> Result<RenameImageResult, String> {
    work(service, move |s| {
        s.rename_image(&workspace_id, &path, &name)
    })
    .await
}
#[tauri::command]
async fn delete_file(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
    path: String,
    revision: Option<String>,
) -> Result<DeleteResult, String> {
    work(service, move |s| {
        s.delete_file(&workspace_id, &path, revision.as_deref())
    })
    .await
}
#[tauri::command]
async fn create_folder(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
    parent: String,
    name: String,
) -> Result<(), String> {
    work(service, move |s| {
        s.create_folder(&workspace_id, &parent, &name)
    })
    .await
}
#[tauri::command]
async fn move_folder(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
    path: String,
    destination: String,
) -> Result<MoveFolderResult, String> {
    work(service, move |s| {
        s.move_folder(&workspace_id, &path, &destination)
    })
    .await
}
#[tauri::command]
async fn read_image(
    service: tauri::State<'_, Arc<Service>>,
    workspace_id: String,
    path: String,
) -> Result<ImageData, String> {
    work(service, move |s| s.read_image(&workspace_id, &path)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let service = Service::new(config_dir).map_err(std::io::Error::other)?;
            app.manage(Arc::new(service));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            ensure_capture_workspace,
            write_drawing_svg,
            save_preferences,
            save_sessions,
            add_workspace,
            update_workspace,
            set_entry_appearance,
            remove_workspace,
            scan_workspace,
            read_note,
            create_note,
            save_note,
            rename_note,
            rename_image,
            delete_file,
            create_folder,
            move_folder,
            read_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running Notes");
}
