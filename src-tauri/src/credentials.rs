use tauri::Webview;

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
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(target_os = "macos", windows))]
        { match entry(&account)?.get_password() { Ok(value) => Ok(Some(value)), Err(keyring::Error::NoEntry) => Ok(None), Err(_) => Err("The credential vault is locked or unavailable. Unlock it and try again.".into()) } }
        #[cfg(not(any(target_os = "macos", windows)))]
        { let _ = account; Err("Native credential storage is supported on Windows and macOS".into()) }
    }).await.map_err(|_| "Credential operation could not finish".to_string())?
}

#[tauri::command]
pub async fn write_provider_credential(webview: Webview, account: String, secret: String) -> Result<(), String> {
    trusted_window(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
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
    }).await.map_err(|_| "Credential operation could not finish".to_string())?
}
