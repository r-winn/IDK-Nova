use tauri::Webview;

// Ad-hoc signed community updates can lose the old item's Keychain ACL trust.
// Fail closed instead of presenting a password dialog during startup/autosave.
#[cfg(target_os = "macos")]
fn without_keychain_prompt<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    static ACCESS: std::sync::Mutex<()> = std::sync::Mutex::new(());
    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecKeychainGetUserInteractionAllowed(state: *mut u8) -> i32;
        fn SecKeychainSetUserInteractionAllowed(state: u8) -> i32;
    }
    let _lock = ACCESS.lock().map_err(|_| "Credential access is unavailable".to_string())?;
    let mut previous = 0u8;
    unsafe {
        if SecKeychainGetUserInteractionAllowed(&mut previous) != 0 || SecKeychainSetUserInteractionAllowed(0) != 0 {
            return Err("Could not access Keychain without prompting".into());
        }
    }
    struct Restore(u8);
    impl Drop for Restore { fn drop(&mut self) { unsafe { SecKeychainSetUserInteractionAllowed(self.0); } } }
    let _restore = Restore(previous);
    operation()
}
#[cfg(not(target_os = "macos"))]
fn without_keychain_prompt<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> { operation() }

// Remote browser tabs must never be able to read or modify provider credentials.
fn trusted_window(webview: &Webview) -> Result<(), String> {
    if webview.label() != "main" { return Err("Credential access is restricted to Nova's main window".into()); }
    Ok(())
}

#[cfg(any(target_os = "macos", windows))]
fn entry(account: &str) -> Result<keyring::Entry, String> {
    if account.is_empty() || account.len() > 1024 || account.contains('\0') { return Err("Invalid credential identifier".into()); }
    keyring::Entry::new("ir.idk.nova.providers", account).map_err(|_| "Could not access the operating-system credential vault".into())
}

#[tauri::command]
pub async fn read_provider_credential(webview: Webview, account: String) -> Result<Option<String>, String> {
    trusted_window(&webview)?;
    tauri::async_runtime::spawn_blocking(move || without_keychain_prompt(|| {
        #[cfg(any(target_os = "macos", windows))]
        { match entry(&account)?.get_password() { Ok(value) => Ok(Some(value)), Err(keyring::Error::NoEntry) => Ok(None), Err(_) => Err("The credential vault is locked or unavailable. Unlock it and try again.".into()) } }
        #[cfg(not(any(target_os = "macos", windows)))]
        { let _ = account; Err("Native credential storage is supported on Windows and macOS".into()) }
    })).await.map_err(|_| "Credential operation could not finish".to_string())?
}

#[tauri::command]
pub async fn write_provider_credential(webview: Webview, account: String, secret: String) -> Result<(), String> {
    trusted_window(&webview)?;
    tauri::async_runtime::spawn_blocking(move || without_keychain_prompt(|| {
        #[cfg(any(target_os = "macos", windows))]
        {
            let credential = entry(&account)?;
            if secret.is_empty() {
                match credential.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(_) => Err("Could not remove the provider credential from the system vault".into()) }
            } else {
                credential.set_password(&secret).map_err(|_| "Could not save the provider credential in the system vault".into())
            }
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        { let _ = (account, secret); Err("Native credential storage is supported on Windows and macOS".into()) }
    })).await.map_err(|_| "Credential operation could not finish".to_string())?
}
