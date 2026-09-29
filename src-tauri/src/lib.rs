use serde::Serialize;
use futures_util::StreamExt;
use std::{fs, io::{Cursor, Write}, path::{Component, Path, PathBuf}, process::{Command, Stdio}, time::UNIX_EPOCH};
use tauri::Manager;
use tauri::ipc::Channel;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

#[cfg(any(windows, target_os = "macos"))]
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenObservation {
    data_url: String,
    width: u32,
    height: u32,
}

fn desktop_control_error(error: impl std::fmt::Display) -> String {
    #[cfg(target_os = "macos")]
    return format!("Desktop control failed: {error}. Allow IDK Nova in System Settings → Privacy & Security → Accessibility and Screen Recording.");
    #[cfg(not(target_os = "macos"))]
    format!("Desktop control failed: {error}")
}

#[tauri::command]
async fn observe_screen() -> Result<ScreenObservation, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(windows, target_os = "macos"))]
        {
            let screen = screenshots::Screen::from_point(0, 0).map_err(desktop_control_error)?;
            let captured = screen.capture().map_err(desktop_control_error)?;
            let (width, height) = captured.dimensions();
            let max_width = 1600u32;
            let rendered = if width > max_width {
                let next_height = ((height as f64) * (max_width as f64 / width as f64)).round() as u32;
                image::imageops::resize(&captured, max_width, next_height, image::imageops::FilterType::Triangle)
            } else { captured };
            let mut bytes = Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(rendered).write_to(&mut bytes, image::ImageOutputFormat::Jpeg(72)).map_err(desktop_control_error)?;
            return Ok(ScreenObservation { data_url: format!("data:image/jpeg;base64,{}", BASE64.encode(bytes.into_inner())), width, height });
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        Err("Desktop observation is currently available on Windows and macOS".into())
    }).await.map_err(|error| error.to_string())?
}

fn normalized_position(enigo: &Enigo, x: i32, y: i32) -> Result<(i32, i32), String> {
    if !(0..=1000).contains(&x) || !(0..=1000).contains(&y) { return Err("Screen coordinates must be between 0 and 1000".into()); }
    let (width, height) = enigo.main_display().map_err(desktop_control_error)?;
    Ok((((width.saturating_sub(1)) * x) / 1000, ((height.saturating_sub(1)) * y) / 1000))
}

#[tauri::command]
async fn click_screen(x: i32, y: i32, button: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(windows, target_os = "macos"))]
        {
            let mut enigo = Enigo::new(&Settings::default()).map_err(desktop_control_error)?;
            let (screen_x, screen_y) = normalized_position(&enigo, x, y)?;
            let mouse_button = match button.as_str() { "right" => Button::Right, "middle" => Button::Middle, _ => Button::Left };
            enigo.move_mouse(screen_x, screen_y, Coordinate::Abs).map_err(desktop_control_error)?;
            enigo.button(mouse_button, Direction::Click).map_err(desktop_control_error)?;
            return Ok(());
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        Err("Desktop input is currently available on Windows and macOS".into())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn type_text(text: String) -> Result<(), String> {
    if text.len() > 20_000 { return Err("Text input exceeds the 20,000 character safety limit".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(windows, target_os = "macos"))]
        { let mut enigo = Enigo::new(&Settings::default()).map_err(desktop_control_error)?; enigo.text(&text).map_err(desktop_control_error)?; return Ok(()); }
        #[cfg(not(any(windows, target_os = "macos")))]
        Err("Desktop input is currently available on Windows and macOS".into())
    }).await.map_err(|error| error.to_string())?
}

fn named_key(value: &str) -> Result<Key, String> {
    Ok(match value.to_ascii_lowercase().as_str() {
        "enter" | "return" => Key::Return, "tab" => Key::Tab, "escape" | "esc" => Key::Escape,
        "backspace" => Key::Backspace, "delete" => Key::Delete, "space" => Key::Space,
        "up" | "arrowup" => Key::UpArrow, "down" | "arrowdown" => Key::DownArrow,
        "left" | "arrowleft" => Key::LeftArrow, "right" | "arrowright" => Key::RightArrow,
        "home" => Key::Home, "end" => Key::End, "pageup" => Key::PageUp, "pagedown" => Key::PageDown,
        other if other.chars().count() == 1 => Key::Unicode(other.chars().next().unwrap()),
        _ => return Err("Unsupported key".into()),
    })
}

#[tauri::command]
async fn press_key(key: String, modifiers: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(windows, target_os = "macos"))]
        {
            let mut enigo = Enigo::new(&Settings::default()).map_err(desktop_control_error)?;
            let mods: Vec<Key> = modifiers.iter().map(|value| match value.to_ascii_lowercase().as_str() {
                "shift" => Ok(Key::Shift), "control" | "ctrl" => Ok(Key::Control), "alt" | "option" => Ok(Key::Alt), "meta" | "command" | "cmd" => Ok(Key::Meta), _ => Err("Unsupported modifier".to_string()),
            }).collect::<Result<_, _>>()?;
            for modifier in &mods { enigo.key(*modifier, Direction::Press).map_err(desktop_control_error)?; }
            enigo.key(named_key(&key)?, Direction::Click).map_err(desktop_control_error)?;
            for modifier in mods.iter().rev() { enigo.key(*modifier, Direction::Release).map_err(desktop_control_error)?; }
            return Ok(());
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        Err("Desktop input is currently available on Windows and macOS".into())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn scroll_screen(amount: i32) -> Result<(), String> {
    if !(-20..=20).contains(&amount) { return Err("Scroll amount must be between -20 and 20".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(windows, target_os = "macos"))]
        { let mut enigo = Enigo::new(&Settings::default()).map_err(desktop_control_error)?; enigo.scroll(amount, Axis::Vertical).map_err(desktop_control_error)?; return Ok(()); }
        #[cfg(not(any(windows, target_os = "macos")))]
        Err("Desktop input is currently available on Windows and macOS".into())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_application(name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() || name.len() > 120 || !name.chars().all(|value| value.is_alphanumeric() || matches!(value, ' ' | '.' | '_' | '-')) { return Err("Enter a valid application name".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let status = Command::new("open").args(["-a", &name]).status();
        #[cfg(windows)]
        let status = Command::new("cmd.exe").args(["/C", "start", "", &name]).status();
        #[cfg(not(any(windows, target_os = "macos")))]
        return Err("Opening applications is currently available on Windows and macOS".into());
        status.map_err(desktop_control_error).and_then(|value| if value.success() { Ok(()) } else { Err(format!("Could not open {name}")) })
    }).await.map_err(|error| error.to_string())?
}

fn ollama_executable() -> Option<PathBuf> {
    if Command::new("ollama").arg("--version").output().map(|output| output.status.success()).unwrap_or(false) { return Some(PathBuf::from("ollama")); }
    #[cfg(windows)] {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let candidate = PathBuf::from(local).join("Programs").join("Ollama").join("ollama.exe");
            if candidate.is_file() { return Some(candidate); }
        }
    }
    #[cfg(target_os = "macos")] {
        let mut apps = vec![PathBuf::from("/Applications/Ollama.app")];
        if let Ok(home) = std::env::var("HOME") { apps.push(PathBuf::from(home).join("Applications").join("Ollama.app")); }
        for app in apps {
            for relative in ["Contents/Resources/ollama", "Contents/MacOS/Ollama"] {
                let candidate = app.join(relative);
                if candidate.is_file() { return Some(candidate); }
            }
        }
    }
    None
}

fn ensure_ollama_runtime(ollama: &Path) -> Result<(), String> {
    let runtime_ready = || Command::new(ollama).arg("list").output().map(|output| output.status.success()).unwrap_or(false);
    if runtime_ready() { return Ok(()); }
    let mut command = Command::new(ollama);
    command.arg("serve").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().map_err(|error| format!("Ollama is installed but Nova could not start its local service: {error}"))?;
    for _ in 0..30 {
        std::thread::sleep(std::time::Duration::from_millis(300));
        if runtime_ready() { return Ok(()); }
    }
    Err("Ollama is installed, but its local service did not start on 127.0.0.1:11434".into())
}

#[tauri::command]
async fn import_gguf_model(app: tauri::AppHandle, source_path: String, model_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(&source_path);
        if source.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("gguf")) != Some(true) {
            return Err("Choose a valid .gguf model file".into());
        }
        if !source.is_file() {
            return Err("The selected model file is unavailable".into());
        }
        let fallback = source.file_stem().and_then(|value| value.to_str()).unwrap_or("nova-local");
        let requested = if model_name.trim().is_empty() { fallback } else { model_name.trim() };
        let safe_name: String = requested.to_lowercase().chars().map(|character| if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':') { character } else { '-' }).collect();
        let safe_name = safe_name.trim_matches('-').to_string();
        if safe_name.is_empty() {
            return Err("Enter a valid model name".into());
        }
        let models_dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("models");
        fs::create_dir_all(&models_dir).map_err(|error| format!("Could not create the private model folder: {error}"))?;
        let file_name = source.file_name().ok_or("Invalid model filename")?;
        let stored_model = models_dir.join(file_name);
        if source != stored_model {
            fs::copy(&source, &stored_model).map_err(|error| format!("Could not copy the model into Nova: {error}"))?;
        }
        let model_file = models_dir.join(format!("{safe_name}.Modelfile"));
        let normalized = stored_model.to_string_lossy().replace('\\', "/").replace('"', "\\\"");
        fs::write(&model_file, format!("FROM \"{normalized}\"\n")).map_err(|error| format!("Could not prepare the local model: {error}"))?;
        let ollama = ollama_executable().ok_or_else(|| "OLLAMA_NOT_INSTALLED: Install Ollama before importing a GGUF model".to_string())?;
        ensure_ollama_runtime(&ollama)?;
        let mut command = Command::new(ollama);
        command.args(["create", &safe_name, "-f"]).arg(&model_file);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let output = command.output().map_err(|_| "Ollama was not found. Install and start Ollama, then try again.".to_string())?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if detail.is_empty() { "Ollama could not import this GGUF file".into() } else { detail });
        }
        Ok(safe_name)
    }).await.map_err(|error| error.to_string())?
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
enum OllamaInstallEvent {
    Status { phase: String, message: String },
    Progress { downloaded: u64, total: u64 },
}

#[tauri::command]
async fn ollama_status() -> Result<bool, String> { Ok(ollama_executable().is_some()) }

#[tauri::command]
async fn install_ollama(on_event: Channel<OllamaInstallEvent>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if ollama_executable().is_some() { return Ok(()); }
        on_event.send(OllamaInstallEvent::Status { phase: "downloading".into(), message: "Downloading Ollama for macOS from GitHub".into() }).map_err(|error| error.to_string())?;
        let client = reqwest::Client::builder().user_agent("IDK-Nova/0.14 (+https://github.com/r-winn/IDK-Nova)").build().map_err(|error| error.to_string())?;
        let payload = client.get("https://api.github.com/repos/ollama/ollama/releases/latest").header("Accept", "application/vnd.github+json").send().await.map_err(|error| format!("Could not reach GitHub: {error}"))?;
        if !payload.status().is_success() { return Err(format!("GitHub returned {} while checking Ollama", payload.status())); }
        let payload = payload.json::<serde_json::Value>().await.map_err(|error| error.to_string())?;
        let asset = payload.get("assets").and_then(|value| value.as_array()).and_then(|assets| assets.iter().find(|asset| asset.get("name").and_then(|value| value.as_str()) == Some("Ollama-darwin.zip"))).ok_or("The macOS Ollama package was not found in the latest GitHub release")?;
        let url = asset.get("browser_download_url").and_then(|value| value.as_str()).ok_or("The macOS Ollama download URL is missing")?;
        let expected = asset.get("digest").and_then(|value| value.as_str()).and_then(|value| value.strip_prefix("sha256:")).map(str::to_string);
        let response = client.get(url).header("Accept", "application/octet-stream").send().await.map_err(|error| format!("Could not download Ollama: {error}"))?;
        if !response.status().is_success() { return Err(format!("Ollama download returned {}", response.status())); }
        let total = response.content_length().unwrap_or(0);
        let archive = std::env::temp_dir().join("Nova-Ollama-macOS.zip");
        let unpacked = std::env::temp_dir().join("Nova-Ollama-macOS");
        let _ = fs::remove_dir_all(&unpacked);
        let mut file = fs::File::create(&archive).map_err(|error| error.to_string())?;
        let mut downloaded = 0u64;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|error| format!("Ollama download interrupted: {error}"))?;
            file.write_all(&bytes).map_err(|error| error.to_string())?;
            downloaded += bytes.len() as u64;
            on_event.send(OllamaInstallEvent::Progress { downloaded, total }).map_err(|error| error.to_string())?;
        }
        drop(file);
        on_event.send(OllamaInstallEvent::Status { phase: "verifying".into(), message: "Verifying the GitHub release checksum".into() }).map_err(|error| error.to_string())?;
        if let Some(expected) = expected {
            let output = Command::new("shasum").args(["-a", "256"]).arg(&archive).output().map_err(|error| error.to_string())?;
            let actual = String::from_utf8_lossy(&output.stdout).split_whitespace().next().unwrap_or("").to_string();
            if !output.status.success() || actual != expected { let _ = fs::remove_file(&archive); return Err("Ollama package checksum verification failed".into()); }
        }
        on_event.send(OllamaInstallEvent::Status { phase: "installing".into(), message: "Installing Ollama in your Applications folder".into() }).map_err(|error| error.to_string())?;
        fs::create_dir_all(&unpacked).map_err(|error| error.to_string())?;
        let unpack = Command::new("ditto").args(["-x", "-k"]).arg(&archive).arg(&unpacked).status().map_err(|error| format!("Could not unpack Ollama: {error}"))?;
        if !unpack.success() { return Err("The Ollama macOS package could not be unpacked".into()); }
        let source_app = unpacked.join("Ollama.app");
        if !source_app.is_dir() { return Err("Ollama.app was not found in the downloaded package".into()); }
        let home = std::env::var("HOME").map_err(|_| "Your macOS home folder is unavailable")?;
        let applications = PathBuf::from(home).join("Applications");
        fs::create_dir_all(&applications).map_err(|error| error.to_string())?;
        let destination = applications.join("Ollama.app");
        let _ = fs::remove_dir_all(&destination);
        let copied = Command::new("ditto").arg(&source_app).arg(&destination).status().map_err(|error| format!("Could not install Ollama: {error}"))?;
        let _ = fs::remove_file(&archive); let _ = fs::remove_dir_all(&unpacked);
        if !copied.success() { return Err("Ollama could not be copied to ~/Applications".into()); }
        let _ = Command::new("open").arg("-a").arg(&destination).status();
        for _ in 0..30 { if ollama_executable().is_some() { on_event.send(OllamaInstallEvent::Status { phase: "ready".into(), message: "Ollama is ready on macOS".into() }).ok(); return Ok(()); } std::thread::sleep(std::time::Duration::from_millis(500)); }
        return Err("Ollama was installed in ~/Applications, but Nova could not start it yet. Open Ollama once and retry.".into());
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    { let _ = on_event; return Err("Guided Ollama installation is available on Windows and macOS".into()); }
    #[cfg(windows)]
    {
        if ollama_executable().is_some() { return Ok(()); }
        on_event.send(OllamaInstallEvent::Status { phase: "downloading".into(), message: "Downloading the official Ollama installer".into() }).map_err(|error| error.to_string())?;
        let client = reqwest::Client::builder().user_agent("IDK-Nova/0.13 (+https://github.com/r-winn/IDK-Nova)").build().map_err(|error| error.to_string())?;
        let github_url = client.get("https://api.github.com/repos/ollama/ollama/releases/latest")
            .header("Accept", "application/vnd.github+json").send().await.ok()
            .and_then(|response| if response.status().is_success() { Some(response) } else { None });
        let github_url = if let Some(response) = github_url {
            response.json::<serde_json::Value>().await.ok().and_then(|payload| payload.get("assets")?.as_array()?.iter().find(|asset| asset.get("name").and_then(|name| name.as_str()) == Some("OllamaSetup.exe"))?.get("browser_download_url")?.as_str().map(str::to_string))
        } else { None };
        let mut last_error = String::new();
        let mut response = None;
        for url in github_url.into_iter().chain(std::iter::once("https://ollama.com/download/OllamaSetup.exe".to_string())) {
            match client.get(&url).header("Accept", "application/octet-stream").send().await {
                Ok(candidate) if candidate.status().is_success() => { response = Some(candidate); break; }
                Ok(candidate) => last_error = format!("{} returned {}", url, candidate.status()),
                Err(error) => last_error = format!("{}: {}", url, error),
            }
        }
        let response = response.ok_or_else(|| format!("Could not download Ollama from GitHub or ollama.com. {last_error}"))?;
        let total = response.content_length().unwrap_or(0);
        let installer = std::env::temp_dir().join("Nova-OllamaSetup.exe");
        let mut file = fs::File::create(&installer).map_err(|error| error.to_string())?;
        let mut downloaded = 0u64;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|error| format!("Ollama download interrupted: {error}"))?;
            file.write_all(&bytes).map_err(|error| error.to_string())?;
            downloaded += bytes.len() as u64;
            on_event.send(OllamaInstallEvent::Progress { downloaded, total }).map_err(|error| error.to_string())?;
        }
        drop(file);
        on_event.send(OllamaInstallEvent::Status { phase: "verifying".into(), message: "Verifying Ollama digital signature".into() }).map_err(|error| error.to_string())?;
        let escaped = installer.to_string_lossy().replace('\'', "''");
        let verify = Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", &format!("(Get-AuthenticodeSignature -LiteralPath '{escaped}').Status")]).output().map_err(|error| error.to_string())?;
        if String::from_utf8_lossy(&verify.stdout).trim() != "Valid" { let _ = fs::remove_file(&installer); return Err("Ollama installer signature verification failed".into()); }
        on_event.send(OllamaInstallEvent::Status { phase: "installing".into(), message: "Installing Ollama".into() }).map_err(|error| error.to_string())?;
        let status = Command::new(&installer).args(["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"]).status().map_err(|error| format!("Could not start Ollama installer: {error}"))?;
        let _ = fs::remove_file(&installer);
        if !status.success() { return Err("Ollama installation did not complete successfully".into()); }
        for _ in 0..20 { if ollama_executable().is_some() { on_event.send(OllamaInstallEvent::Status { phase: "ready".into(), message: "Ollama is ready".into() }).ok(); return Ok(()); } std::thread::sleep(std::time::Duration::from_millis(500)); }
        Err("Ollama installed, but Nova could not find it yet. Restart Nova and try again.".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEntry { path: String, name: String, kind: String, size: u64, modified: u64 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceScan { entries: Vec<WorkspaceEntry>, truncated: bool }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceMatch { path: String, line: usize, preview: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortableWorkspace { project_json: String, chats_json: String }

fn ignored_name(name: &str) -> bool {
    matches!(name, ".git" | ".svn" | ".hg" | "node_modules" | "target" | "dist" | "build" | ".next" | ".cache" | "coverage")
        || matches!(name, ".env" | ".env.local" | ".env.production" | "id_rsa" | "id_ed25519")
}

fn text_file(path: &Path) -> bool {
    path.extension().and_then(|value| value.to_str()).map(|ext| matches!(ext.to_ascii_lowercase().as_str(),
        "txt" | "md" | "mdx" | "json" | "jsonc" | "toml" | "yaml" | "yml" | "xml" | "csv" |
        "js" | "jsx" | "ts" | "tsx" | "css" | "scss" | "html" | "vue" | "svelte" |
        "rs" | "py" | "go" | "java" | "kt" | "swift" | "c" | "h" | "cpp" | "hpp" | "cs" |
        "php" | "rb" | "sh" | "zsh" | "fish" | "sql" | "graphql" | "ini" | "conf" | "env.example"
    )).unwrap_or(false)
}

fn canonical_root(root_path: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root_path).map_err(|_| "The workspace folder is unavailable".to_string())?;
    if !root.is_dir() { return Err("Choose a folder for this workspace".into()); }
    Ok(root)
}

fn safe_target(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute() || relative.components().any(|part| matches!(part, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        return Err("Invalid workspace path".into());
    }
    let target = fs::canonicalize(root.join(relative)).map_err(|_| "Workspace file not found".to_string())?;
    if !target.starts_with(root) { return Err("The file is outside this workspace".into()); }
    Ok(target)
}

fn safe_write_target(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty() || relative.is_absolute() || relative.components().any(|part| matches!(part, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        return Err("Invalid workspace path".into());
    }
    if relative.components().any(|part| part.as_os_str().to_string_lossy().starts_with('.')) { return Err("Agent cannot write hidden workspace paths".into()); }
    let mut cursor = root.to_path_buf();
    let parts: Vec<_> = relative.components().collect();
    for part in parts.iter().take(parts.len().saturating_sub(1)) {
        cursor.push(part.as_os_str());
        if cursor.exists() && fs::symlink_metadata(&cursor).map(|meta| meta.file_type().is_symlink()).unwrap_or(true) { return Err("Agent cannot write through symbolic links".into()); }
    }
    let target = root.join(relative);
    if target.exists() && fs::symlink_metadata(&target).map(|meta| meta.file_type().is_symlink()).unwrap_or(true) { return Err("Agent cannot overwrite a symbolic link".into()); }
    Ok(target)
}

fn walk_workspace(root: &Path, current: &Path, depth: usize, output: &mut Vec<WorkspaceEntry>, truncated: &mut bool) {
    if depth > 10 || output.len() >= 2500 { *truncated = true; return; }
    let Ok(read_dir) = fs::read_dir(current) else { return };
    let mut children: Vec<_> = read_dir.flatten().collect();
    children.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
    for child in children {
        if output.len() >= 2500 { *truncated = true; break; }
        let name = child.file_name().to_string_lossy().to_string();
        if ignored_name(&name) || name.starts_with('.') { continue; }
        let Ok(metadata) = child.metadata() else { continue };
        if metadata.file_type().is_symlink() { continue; }
        let path = child.path();
        let relative = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        output.push(WorkspaceEntry {
            path: relative,
            name,
            kind: if metadata.is_dir() { "directory" } else { "file" }.into(),
            size: metadata.len(),
            modified: metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_secs()).unwrap_or(0),
        });
        if metadata.is_dir() { walk_workspace(root, &path, depth + 1, output, truncated); }
    }
}

#[tauri::command]
async fn scan_workspace(root_path: String) -> Result<WorkspaceScan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let mut entries = Vec::new(); let mut truncated = false;
        walk_workspace(&root, &root, 0, &mut entries, &mut truncated);
        Ok(WorkspaceScan { entries, truncated })
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn read_workspace_file(root_path: String, relative_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let target = safe_target(&root, &relative_path)?;
        if !target.is_file() || !text_file(&target) { return Err("This file cannot be added to AI context".into()); }
        if target.metadata().map_err(|error| error.to_string())?.len() > 1_000_000 { return Err("This file is larger than the 1 MB safety limit".into()); }
        fs::read_to_string(target).map_err(|_| "This file is not valid text".to_string())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn read_workspace_asset(root_path: String, relative_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let target = safe_target(&root, &relative_path)?;
        if !target.is_file() { return Err("Workspace asset was not found".into()); }
        let size = target.metadata().map_err(|error| error.to_string())?.len();
        if size > 25_000_000 { return Err("This preview is larger than the 25 MB safety limit".into()); }
        let extension = target.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
        let mime = match extension.as_str() {
            "pdf" => "application/pdf", "png" => "image/png", "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif", "webp" => "image/webp", "svg" => "image/svg+xml",
            _ => return Err("This file type does not have a native preview".into()),
        };
        let bytes = fs::read(target).map_err(|error| error.to_string())?;
        Ok(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn search_workspace(root_path: String, query: String) -> Result<Vec<WorkspaceMatch>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let mut entries = Vec::new(); let mut truncated = false;
        walk_workspace(&root, &root, 0, &mut entries, &mut truncated);
        let terms: Vec<String> = query.split(|value: char| !value.is_alphanumeric() && value != '_' && value != '-')
            .filter(|value| value.len() > 2).take(8).map(|value| value.to_lowercase()).collect();
        let mut matches = Vec::new();
        for entry in entries.into_iter().filter(|entry| entry.kind == "file" && entry.size <= 500_000).take(1000) {
            let path = root.join(&entry.path);
            if !text_file(&path) { continue; }
            let Ok(content) = fs::read_to_string(&path) else { continue };
            for (index, line) in content.lines().enumerate() {
                let lowered = line.to_lowercase();
                if terms.is_empty() || terms.iter().any(|term| lowered.contains(term) || entry.path.to_lowercase().contains(term)) {
                    matches.push(WorkspaceMatch { path: entry.path.clone(), line: index + 1, preview: line.chars().take(220).collect() });
                    if matches.len() >= 80 { return Ok(matches); }
                }
            }
        }
        Ok(matches)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn initialize_workspace(root_path: String, project_json: String) -> Result<PortableWorkspace, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let nova_dir = root.join(".nova-work");
        if fs::symlink_metadata(&nova_dir).map(|meta| meta.file_type().is_symlink()).unwrap_or(false) { return Err("The .nova-work path cannot be a symbolic link".into()); }
        fs::create_dir_all(&nova_dir).map_err(|error| format!("Could not create portable workspace data: {error}"))?;
        let project_path = nova_dir.join("project.json");
        let chats_path = nova_dir.join("chats.json");
        if !project_path.exists() { fs::write(&project_path, &project_json).map_err(|error| error.to_string())?; }
        if !chats_path.exists() { fs::write(&chats_path, "[]\n").map_err(|error| error.to_string())?; }
        let stored_project = fs::read_to_string(project_path).map_err(|error| error.to_string())?;
        let stored_chats = fs::read_to_string(chats_path).map_err(|error| error.to_string())?;
        Ok(PortableWorkspace { project_json: stored_project, chats_json: stored_chats })
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_workspace_history(root_path: String, chats_json: String, activity_json: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let nova_dir = root.join(".nova-work");
        if fs::symlink_metadata(&nova_dir).map(|meta| meta.file_type().is_symlink()).unwrap_or(false) { return Err("The .nova-work path cannot be a symbolic link".into()); }
        fs::create_dir_all(&nova_dir).map_err(|error| error.to_string())?;
        let parsed: serde_json::Value = serde_json::from_str(&chats_json).map_err(|_| "Invalid workspace history".to_string())?;
        if !parsed.is_array() { return Err("Invalid workspace history".into()); }
        fs::write(nova_dir.join("chats.json"), format!("{}\n", serde_json::to_string_pretty(&parsed).map_err(|error| error.to_string())?)).map_err(|error| error.to_string())?;
        fs::write(nova_dir.join("activity.json"), activity_json).map_err(|error| error.to_string())?;
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn write_workspace_file(root_path: String, relative_path: String, content: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if content.len() > 2_000_000 { return Err("Agent output exceeds the 2 MB file safety limit".into()); }
        let root = canonical_root(&root_path)?;
        let target = safe_write_target(&root, &relative_path)?;
        if !text_file(&target) { return Err("Agent can only write supported text and source-code files".into()); }
        if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        if target.exists() {
            let stamp = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis()).unwrap_or(0);
            let backup = root.join(".nova-work").join("backups").join(stamp.to_string()).join(&relative_path);
            if let Some(parent) = backup.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
            fs::copy(&target, backup).map_err(|error| format!("Could not back up the existing file: {error}"))?;
        }
        fs::write(&target, content).map_err(|error| format!("Could not write workspace file: {error}"))?;
        Ok(relative_path)
    }).await.map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![import_gguf_model, ollama_status, install_ollama, scan_workspace, read_workspace_file, read_workspace_asset, search_workspace, initialize_workspace, save_workspace_history, write_workspace_file, observe_screen, click_screen, type_text, press_key, scroll_screen, open_application])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running IDK Nova");
}
