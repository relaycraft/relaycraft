//! Windows taskbar Jump List management.
//!
//! RelayCraft registers `.rcplugin` / `.rctheme` file associations. When users
//! double-click those files, Windows auto-populates the Jump List "Recent"
//! category with plugin IDs. We commit an empty custom list so automatic
//! Recent/Frequent entries stay suppressed.

/// Must match `identifier` in tauri.conf.json and platform configs.
#[cfg(windows)]
const APP_USER_MODEL_ID: &str = "com.relaycraft.app";

#[cfg(windows)]
pub fn reset_jump_list() {
    if let Err(err) = reset_jump_list_inner() {
        log::warn!("[JumpList] Failed to reset: {err}");
    } else {
        log::debug!("[JumpList] Reset complete");
    }
}

#[cfg(windows)]
fn reset_jump_list_inner() -> windows::core::Result<()> {
    use windows::{
        core::HSTRING,
        Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        },
        Win32::UI::Shell::{
            Common::IObjectArray, DestinationList, ICustomDestinationList,
            SetCurrentProcessExplicitAppUserModelID,
        },
    };

    unsafe {
        // COM may already be initialized by the runtime; ignore duplicate init.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let app_id = HSTRING::from(APP_USER_MODEL_ID);
        SetCurrentProcessExplicitAppUserModelID(&app_id)?;

        let dest_list: ICustomDestinationList =
            CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;

        dest_list.SetAppID(&app_id)?;

        // Clear any previously committed custom list and automatic Recent docs.
        let _ = dest_list.DeleteList(&app_id);

        // Committing an empty custom list suppresses automatic Recent/Frequent.
        let mut min_slots = 0u32;
        let _removed: IObjectArray = dest_list.BeginList(&mut min_slots)?;
        dest_list.CommitList()?;
    }

    Ok(())
}

#[cfg(not(windows))]
#[inline]
pub fn reset_jump_list() {}
