fn main() {
    // WebKitGTK can abort with Wayland Error 71 on NVIDIA. Disable explicit
    // sync on affected systems while retaining accelerated rendering. Respect
    // an explicit environment override, and set this before starting threads.
    // https://v2.tauri.app/develop/debug/linux-graphics/
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::path::Path::new("/proc/driver/nvidia/version").exists()
        && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none()
    {
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }
    notes_lib::run();
}
