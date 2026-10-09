use tauri::Webview;

/// Mint a short-lived token in the native host. Remote Work tabs cannot call this.
#[tauri::command]
pub async fn create_voice_token(webview: Webview, base_url: String, api_key: String, model: String) -> Result<String, String> {
    if webview.label() != "main" { return Err("Voice access is restricted to Nova's main window".into()); }
    if model.trim().is_empty() || model.len() > 200 { return Err("Choose a valid Realtime model".into()); }
    let base = reqwest::Url::parse(&base_url).map_err(|_| "Invalid voice provider URL")?;
    let local = matches!(base.host_str(), Some("127.0.0.1" | "localhost" | "[::1]" | "::1"));
    if base.scheme() != "https" && !(local && base.scheme() == "http") { return Err("Remote voice providers require HTTPS".into()); }
    if !base.username().is_empty() || base.password().is_some() || base.query().is_some() || base.fragment().is_some() { return Err("Use a plain API Base URL without credentials, query or fragment".into()); }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "Could not prepare voice connection")?;
    let mut request = client.post(format!("{}/realtime/client_secrets", base_url.trim_end_matches('/'))).json(&serde_json::json!({ "session": { "type": "realtime", "model": model } }));
    if !api_key.is_empty() { request = request.bearer_auth(api_key); }
    let response = request.send().await.map_err(|_| "Could not reach the voice provider. Check HTTPS, network and Realtime support.")?;
    if !response.status().is_success() { return Err(format!("Voice provider returned {}. Check the API key, Realtime support and model access.", response.status().as_u16())); }
    let value: serde_json::Value = response.json().await.map_err(|_| "Voice provider returned invalid JSON")?;
    value.get("value").and_then(|item| item.as_str()).filter(|item| !item.is_empty()).map(str::to_string).ok_or_else(|| "Provider did not return an ephemeral voice token".into())
}
