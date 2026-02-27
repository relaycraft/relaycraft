#[cfg(target_os = "macos")]
use std::sync::Mutex;

#[cfg(target_os = "macos")]
static VIBRANCY_VIEW: Mutex<Option<usize>> = Mutex::new(None);

pub fn setup_window(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    setup_macos_window(window);

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    setup_windows_linux_window(window);
}

pub fn update_vibrancy(window: &tauri::WebviewWindow, effect: &str) {
    #[cfg(target_os = "macos")]
    set_macos_vibrancy(window, effect);

    #[cfg(target_os = "windows")]
    set_windows_vibrancy(window, effect);
}

#[cfg(target_os = "macos")]
fn set_macos_vibrancy(window: &tauri::WebviewWindow, effect: &str) {
    use objc2_app_kit::{NSVisualEffectMaterial, NSVisualEffectView};
    use objc2_foundation::MainThreadMarker;

    if MainThreadMarker::new().is_none() {
        let window_clone = window.clone();
        let effect_owned = effect.to_string();
        let _ = window.run_on_main_thread(move || {
            set_macos_vibrancy(&window_clone, &effect_owned);
        });
        return;
    }

    unsafe {
        if effect == "none" {
            // If none, we make sure to just remove the visual effect or hide it
            if let Some(view_ptr) = *VIBRANCY_VIEW.lock().unwrap() {
                let view = &*(view_ptr as *const NSVisualEffectView);
                view.setHidden(true);
            }
            if let Ok(ns_window) = window.ns_window() {
                let ns_window = &*(ns_window as *const objc2_app_kit::NSWindow);
                ns_window.setOpaque(true);
                ns_window
                    .setBackgroundColor(Some(&objc2_app_kit::NSColor::windowBackgroundColor()));
            }
            return;
        }

        if let Some(view_ptr) = *VIBRANCY_VIEW.lock().unwrap() {
            let view = &*(view_ptr as *const NSVisualEffectView);
            view.setHidden(false); // Ensure it's visible again

            let material = match effect {
                "light" => NSVisualEffectMaterial::WindowBackground,
                "dark" => NSVisualEffectMaterial::UnderWindowBackground,
                _ => NSVisualEffectMaterial::Sidebar,
            };
            view.setMaterial(material);

            if let Ok(ns_window) = window.ns_window() {
                let ns_window = &*(ns_window as *const objc2_app_kit::NSWindow);
                ns_window.setOpaque(false);
                ns_window.setBackgroundColor(Some(&objc2_app_kit::NSColor::clearColor()));
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn setup_macos_window(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSColor, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
        NSVisualEffectState, NSVisualEffectView, NSWindow, NSWindowOrderingMode,
        NSWindowTitleVisibility,
    };
    use objc2_foundation::MainThreadMarker;

    if let Some(mtm) = MainThreadMarker::new() {
        unsafe {
            let ns_window = window.ns_window().unwrap() as *const NSWindow;
            let ns_window = &*ns_window;

            ns_window.setTitlebarAppearsTransparent(true);
            ns_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);

            let mut style_mask = ns_window.styleMask();
            style_mask.insert(objc2_app_kit::NSWindowStyleMask::FullSizeContentView);
            ns_window.setStyleMask(style_mask);

            let content_view = ns_window.contentView().unwrap();
            let frame = content_view.frame();

            let visual_effect_view =
                NSVisualEffectView::initWithFrame(mtm.alloc::<NSVisualEffectView>(), frame);

            visual_effect_view.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );

            visual_effect_view.setMaterial(NSVisualEffectMaterial::UnderWindowBackground);
            visual_effect_view.setState(NSVisualEffectState::FollowsWindowActiveState);
            visual_effect_view.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);

            let view_ptr = (&*visual_effect_view as *const NSVisualEffectView) as usize;
            *VIBRANCY_VIEW.lock().unwrap() = Some(view_ptr);

            ns_window.setOpaque(false);
            ns_window.setBackgroundColor(Some(&NSColor::clearColor()));

            content_view.addSubview_positioned_relativeTo(
                &visual_effect_view,
                NSWindowOrderingMode::Below,
                None,
            );
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn setup_windows_linux_window(window: &tauri::WebviewWindow) {
    // Initial setup for Windows - following the theme
    // We can't easily detect the theme here without more logic,
    // but the update_vibrancy will be called shortly after init in the store.
    // For now, we just ensure it's ready.

    // Disable decorations on Windows and Linux for custom TitleBar
    let _ = window.set_decorations(false);
}

#[cfg(target_os = "windows")]
fn set_windows_vibrancy(window: &tauri::WebviewWindow, effect: &str) {
    use window_vibrancy::{apply_acrylic, apply_mica, clear_vibrancy};

    // On Windows, we clear first to avoid stacking effects
    let _ = clear_vibrancy(window);

    match effect {
        "dark" => {
            // Acrylic looks great on Windows 10/11 for dark themes
            let _ = apply_acrylic(window, Some((20, 20, 25, 200)));
        }
        "light" => {
            // Mica is a nice, subtle alternative for light themes on Windows 11
            let _ = apply_mica(window, None);
        }
        "none" => {
            // Already cleared. The frontend will handle making the CSS background opaque
            // so it doesn't look like a broken glass window.
        }
        _ => {
            let _ = apply_mica(window, None);
        }
    }
}

#[tauri::command]
pub fn set_window_vibrancy(window: tauri::WebviewWindow, effect: String) {
    println!("[Rust] set_window_vibrancy called with effect: {}", effect);
    update_vibrancy(&window, &effect);
}
