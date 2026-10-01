// Fontconfig is part of the Linux GTK/WebKit stack. Read its configured system
// and user fonts directly, without relying on an optional fc-list executable.
#[cfg(target_os = "linux")]
pub fn list_families() -> Result<Vec<String>, String> {
    use std::collections::BTreeSet;
    use std::ffi::{c_char, c_int, c_void, CStr};
    use std::ptr;

    #[repr(C)]
    struct FontSet {
        count: c_int,
        capacity: c_int,
        fonts: *mut *mut c_void,
    }
    #[link(name = "fontconfig")]
    unsafe extern "C" {
        fn FcInitLoadConfigAndFonts() -> *mut c_void;
        fn FcConfigDestroy(config: *mut c_void);
        fn FcConfigGetFonts(config: *mut c_void, set: c_int) -> *mut FontSet;
        fn FcPatternGetString(
            pattern: *const c_void,
            object: *const c_char,
            index: c_int,
            value: *mut *mut u8,
        ) -> c_int;
    }
    struct Config(*mut c_void);
    impl Drop for Config {
        fn drop(&mut self) {
            // SAFETY: this guard uniquely owns the non-null configuration.
            unsafe { FcConfigDestroy(self.0) };
        }
    }

    // SAFETY: no arguments; returns an owned configuration or null on failure.
    let config = unsafe { FcInitLoadConfigAndFonts() };
    if config.is_null() {
        return Err("Cannot load installed fonts from Fontconfig".into());
    }
    let config = Config(config);
    let mut families = BTreeSet::new();
    // SAFETY: config stays alive for this entire block. Font sets, patterns and
    // NUL-terminated family strings are borrowed from it and never freed here.
    // The FontSet layout and set/result values match fontconfig/fontconfig.h.
    unsafe {
        for set_kind in [0, 1] {
            // FcSetSystem, FcSetApplication
            let set = FcConfigGetFonts(config.0, set_kind);
            if set.is_null() {
                continue;
            }
            for font_index in 0..(*set).count {
                let pattern = *(*set).fonts.add(font_index as usize);
                let mut family_index = 0;
                loop {
                    let mut value = ptr::null_mut();
                    if FcPatternGetString(pattern, c"family".as_ptr(), family_index, &mut value)
                        != 0
                    {
                        break;
                    }
                    if !value.is_null() {
                        if let Ok(name) = CStr::from_ptr(value.cast()).to_str() {
                            let name = name.trim();
                            if !name.is_empty() {
                                families.insert(name.to_owned());
                            }
                        }
                    }
                    family_index += 1;
                }
            }
        }
    }
    Ok(families.into_iter().collect())
}

#[cfg(not(target_os = "linux"))]
pub fn list_families() -> Result<Vec<String>, String> {
    Err("Installed font discovery is currently supported on Linux".into())
}
