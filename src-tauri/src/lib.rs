use serde::{Deserialize, Serialize};
use futures_util::StreamExt;
use std::{fs, io::{Cursor, Read, Write}, net::{TcpListener, TcpStream}, path::{Component, Path, PathBuf}, process::{Command, Stdio}, time::UNIX_EPOCH};
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    ok: bool,
    stdout: String,
    stderr: String,
    exit_code: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewServerOutput {
    ok: bool,
    url: String,
    directory: String,
}

fn preview_mime(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8", "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8", "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml", "png" => "image/png", "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif", "webp" => "image/webp", "ico" => "image/x-icon",
        "woff" => "font/woff", "woff2" => "font/woff2", "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn preview_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8], send_body: bool) {
    let header = format!("HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n", body.len());
    let _ = stream.write_all(header.as_bytes());
    if send_body { let _ = stream.write_all(body); }
    let _ = stream.flush();
}

fn serve_preview_request(mut stream: TcpStream, root: &Path) {
    let mut request = [0u8; 16_384];
    let Ok(read) = stream.read(&mut request) else { return; };
    if read == 0 { return; }
    let first_line = String::from_utf8_lossy(&request[..read]).lines().next().unwrap_or("").to_string();
    let mut fields = first_line.split_whitespace();
    let method = fields.next().unwrap_or("");
    let requested = fields.next().unwrap_or("/").split(['?', '#']).next().unwrap_or("/");
    if !matches!(method, "GET" | "HEAD") {
        preview_response(&mut stream, "405 Method Not Allowed", "text/plain; charset=utf-8", b"Method not allowed", method != "HEAD");
        return;
    }
    let relative = requested.trim_start_matches('/');
    if relative.split('/').any(|part| part == "..") || relative.contains('\\') || relative.contains('%') {
        preview_response(&mut stream, "403 Forbidden", "text/plain; charset=utf-8", b"Forbidden", method != "HEAD");
        return;
    }
    let mut target = root.join(relative);
    if target.is_dir() { target = target.join("index.html"); }
    let Ok(canonical) = target.canonicalize() else {
        preview_response(&mut stream, "404 Not Found", "text/plain; charset=utf-8", b"Not found", method != "HEAD");
        return;
    };
    if !canonical.starts_with(root) || !canonical.is_file() {
        preview_response(&mut stream, "403 Forbidden", "text/plain; charset=utf-8", b"Forbidden", method != "HEAD");
        return;
    }
    match fs::read(&canonical) {
        Ok(body) => preview_response(&mut stream, "200 OK", preview_mime(&canonical), &body, method != "HEAD"),
        Err(_) => preview_response(&mut stream, "500 Internal Server Error", "text/plain; charset=utf-8", b"Could not read file", method != "HEAD"),
    }
}

#[tauri::command]
async fn start_preview_server(root_path: String, relative_path: String, preferred_port: Option<u16>) -> Result<PreviewServerOutput, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let requested = if relative_path.trim().is_empty() { "." } else { relative_path.trim() };
        let target = safe_target(&root, requested)?;
        let (directory, entry) = if target.is_file() {
            (target.parent().ok_or_else(|| "Preview file has no parent directory".to_string())?.to_path_buf(), target.file_name().and_then(|value| value.to_str()).unwrap_or("").to_string())
        } else { (target, String::new()) };
        let canonical_directory = directory.canonicalize().map_err(|error| error.to_string())?;
        if !canonical_directory.starts_with(&root) { return Err("Preview path escapes the Work project".into()); }
        let bind_port = preferred_port.filter(|port| *port >= 1024).unwrap_or(0);
        let listener = TcpListener::bind(("127.0.0.1", bind_port)).or_else(|_| TcpListener::bind(("127.0.0.1", 0))).map_err(|error| format!("Could not start the local preview: {error}"))?;
        let port = listener.local_addr().map_err(|error| error.to_string())?.port();
        let server_root = canonical_directory.clone();
        std::thread::Builder::new().name(format!("nova-preview-{port}")).spawn(move || {
            for connection in listener.incoming() { if let Ok(stream) = connection { serve_preview_request(stream, &server_root); } }
        }).map_err(|error| error.to_string())?;
        let suffix = if entry.is_empty() { String::new() } else { format!("/{entry}") };
        Ok(PreviewServerOutput { ok: true, url: format!("http://127.0.0.1:{port}{suffix}"), directory: canonical_directory.to_string_lossy().to_string() })
    }).await.map_err(|error| error.to_string())?
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "Invalid data path".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!(".{}.tmp", path.file_name().and_then(|value| value.to_str()).unwrap_or("workspace")));
    fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    if path.exists() { fs::remove_file(path).map_err(|error| error.to_string())?; }
    fs::rename(&temporary, path).map_err(|error| error.to_string())
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
async fn click_screen(x: i32, y: i32, button: String, count: Option<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(windows, target_os = "macos"))]
        {
            let mut enigo = Enigo::new(&Settings::default()).map_err(desktop_control_error)?;
            let (screen_x, screen_y) = normalized_position(&enigo, x, y)?;
            let mouse_button = match button.as_str() { "right" => Button::Right, "middle" => Button::Middle, _ => Button::Left };
            enigo.move_mouse(screen_x, screen_y, Coordinate::Abs).map_err(desktop_control_error)?;
            let clicks = count.unwrap_or(1).clamp(1, 2);
            for index in 0..clicks {
                enigo.button(mouse_button, Direction::Click).map_err(desktop_control_error)?;
                if index + 1 < clicks { std::thread::sleep(std::time::Duration::from_millis(120)); }
            }
            return Ok(());
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        Err("Desktop input is currently available on Windows and macOS".into())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn move_screen(x: i32, y: i32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(windows, target_os = "macos"))]
        {
            let mut enigo = Enigo::new(&Settings::default()).map_err(desktop_control_error)?;
            let (screen_x, screen_y) = normalized_position(&enigo, x, y)?;
            enigo.move_mouse(screen_x, screen_y, Coordinate::Abs).map_err(desktop_control_error)?;
            return Ok(());
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        Err("Desktop input is currently available on Windows and macOS".into())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn drag_screen(from_x: i32, from_y: i32, to_x: i32, to_y: i32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(any(windows, target_os = "macos"))]
        {
            let mut enigo = Enigo::new(&Settings::default()).map_err(desktop_control_error)?;
            let (start_x, start_y) = normalized_position(&enigo, from_x, from_y)?;
            let (end_x, end_y) = normalized_position(&enigo, to_x, to_y)?;
            enigo.move_mouse(start_x, start_y, Coordinate::Abs).map_err(desktop_control_error)?;
            enigo.button(Button::Left, Direction::Press).map_err(desktop_control_error)?;
            std::thread::sleep(std::time::Duration::from_millis(120));
            enigo.move_mouse(end_x, end_y, Coordinate::Abs).map_err(desktop_control_error)?;
            enigo.button(Button::Left, Direction::Release).map_err(desktop_control_error)?;
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
        let status = {
            use std::os::windows::process::CommandExt;
            let escaped = name.replace('\'', "''");
            let mut process = Command::new("powershell.exe");
            process.creation_flags(0x08000000).args(["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &format!("Start-Process -FilePath '{escaped}'")]).status()
        };
        #[cfg(not(any(windows, target_os = "macos")))]
        return Err("Opening applications is currently available on Windows and macOS".into());
        status.map_err(desktop_control_error).and_then(|value| if value.success() { Ok(()) } else { Err(format!("Could not open {name}")) })
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn run_terminal(command: String, root_path: Option<String>) -> Result<TerminalOutput, String> {
    let command = command.trim().to_string();
    if command.is_empty() || command.len() > 8_000 { return Err("Enter a terminal command under 8,000 characters".into()); }
    let lowered = command.to_ascii_lowercase();
    let blocked = ["rm -rf /", "diskpart", "format ", "shutdown ", "reboot", "remove-item -recurse", "reg delete", "del /s", "cipher /w"];
    if blocked.iter().any(|pattern| lowered.contains(pattern)) { return Err("Nova blocked a destructive terminal command".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let working_directory = root_path.as_deref().map(canonical_root).transpose()?;
        #[cfg(target_os = "macos")]
        let output = { let mut process = Command::new("/bin/zsh"); process.args(["-lc", &command]); if let Some(path) = &working_directory { process.current_dir(path); } process.output() };
        #[cfg(windows)]
        let output = {
            use std::os::windows::process::CommandExt;
            let mut process = Command::new("powershell.exe");
            process.creation_flags(0x08000000).args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &command]);
            if let Some(path) = &working_directory { process.current_dir(path); }
            process.output()
        };
        #[cfg(not(any(windows, target_os = "macos")))]
        return Err("Terminal tools are currently available on Windows and macOS".into());
        let output = output.map_err(desktop_control_error)?;
        let truncate = |bytes: Vec<u8>| String::from_utf8_lossy(&bytes).chars().take(12_000).collect::<String>();
        Ok(TerminalOutput { ok: output.status.success(), stdout: truncate(output.stdout), stderr: truncate(output.stderr), exit_code: output.status.code().unwrap_or(-1) })
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn install_package(package: String) -> Result<TerminalOutput, String> {
    let requested = package.trim().to_ascii_lowercase();
    if requested.is_empty() || requested.len() > 80 || !requested.chars().all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '_' | '+')) {
        return Err("Enter a valid package name".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        let output = {
            use std::os::windows::process::CommandExt;
            let package_id = match requested.as_str() {
                "npm" | "node" | "nodejs" => "OpenJS.NodeJS.LTS",
                "git" => "Git.Git",
                "python" | "python3" => "Python.Python.3.13",
                "vscode" | "code" => "Microsoft.VisualStudioCode",
                "docker" => "Docker.DockerDesktop",
                "ollama" => "Ollama.Ollama",
                other => other,
            };
            let mut process = Command::new("winget.exe");
            process.creation_flags(0x08000000).args(["install", "--id", package_id, "--exact", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"]);
            process.output()
        };
        #[cfg(target_os = "macos")]
        let output = {
            let formula = match requested.as_str() { "npm" | "nodejs" => "node", "python" => "python@3.13", "vscode" | "code" => "visual-studio-code", other => other };
            if Command::new("brew").arg("--version").output().map(|value| value.status.success()).unwrap_or(false) {
                let mut process = Command::new("brew");
                if matches!(formula, "visual-studio-code" | "docker") { process.args(["install", "--cask", formula]); }
                else { process.args(["install", formula]); }
                process.output()
            } else { return Err("Homebrew is required for automatic package installation on macOS. Install Homebrew once, then Nova can install packages automatically.".into()); }
        };
        #[cfg(not(any(windows, target_os = "macos")))]
        return Err("Automatic package installation is currently available on Windows and macOS".into());
        let output = output.map_err(desktop_control_error)?;
        let truncate = |bytes: Vec<u8>| String::from_utf8_lossy(&bytes).chars().take(24_000).collect::<String>();
        Ok(TerminalOutput { ok: output.status.success(), stdout: truncate(output.stdout), stderr: truncate(output.stderr), exit_code: output.status.code().unwrap_or(-1) })
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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceUndo {
    action: String,
    path: String,
    secondary_path: Option<String>,
    snapshot_path: Option<String>,
    existed: bool,
}

fn ignored_name(name: &str) -> bool {
    matches!(name, ".git" | ".svn" | ".hg" | ".nova-work" | "node_modules" | "target" | "dist" | "build" | ".next" | ".cache" | "coverage")
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

fn nova_data_dir(root: &Path) -> Result<PathBuf, String> {
    let directory = root.join(".nova-work");
    if fs::symlink_metadata(&directory).map(|meta| meta.file_type().is_symlink()).unwrap_or(false) { return Err("The .nova-work path cannot be a symbolic link".into()); }
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn record_undo(root: &Path, undo: &WorkspaceUndo) -> Result<(), String> {
    let history = nova_data_dir(root)?.join("history");
    fs::create_dir_all(&history).map_err(|error| error.to_string())?;
    fs::write(history.join("latest.json"), serde_json::to_vec_pretty(undo).map_err(|error| error.to_string())?).map_err(|error| error.to_string())
}

fn snapshot_file(root: &Path, target: &Path, relative_path: &str) -> Result<Option<String>, String> {
    if !target.exists() { return Ok(None); }
    if !target.is_file() { return Err("Only files can be snapshotted by this operation".into()); }
    let stamp = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis()).unwrap_or(0);
    let relative = format!("history/snapshots/{stamp}/{relative_path}");
    let snapshot = nova_data_dir(root)?.join(&relative);
    if let Some(parent) = snapshot.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    fs::copy(target, &snapshot).map_err(|error| format!("Could not snapshot the existing file: {error}"))?;
    Ok(Some(relative))
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    if source.is_file() {
        if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        fs::copy(source, destination).map_err(|error| error.to_string())?;
        return Ok(());
    }
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().map_err(|error| error.to_string())?.is_symlink() { continue; }
        copy_tree(&entry.path(), &destination.join(entry.file_name()))?;
    }
    Ok(())
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
        if !project_path.exists() { atomic_write(&project_path, project_json.as_bytes())?; }
        if !chats_path.exists() { atomic_write(&chats_path, b"[]\n")?; }
        let stored_project = fs::read_to_string(project_path).map_err(|error| error.to_string())?;
        let stored_chats = fs::read_to_string(chats_path).map_err(|error| error.to_string())?;
        Ok(PortableWorkspace { project_json: stored_project, chats_json: stored_chats })
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_workspace_history(root_path: String, project_json: String, chats_json: String, activity_json: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let nova_dir = root.join(".nova-work");
        if fs::symlink_metadata(&nova_dir).map(|meta| meta.file_type().is_symlink()).unwrap_or(false) { return Err("The .nova-work path cannot be a symbolic link".into()); }
        fs::create_dir_all(&nova_dir).map_err(|error| error.to_string())?;
        let parsed: serde_json::Value = serde_json::from_str(&chats_json).map_err(|_| "Invalid workspace history".to_string())?;
        if !parsed.is_array() { return Err("Invalid workspace history".into()); }
        let project: serde_json::Value = serde_json::from_str(&project_json).map_err(|_| "Invalid workspace metadata".to_string())?;
        let activity: serde_json::Value = serde_json::from_str(&activity_json).map_err(|_| "Invalid workspace activity".to_string())?;
        let pretty_project = format!("{}\n", serde_json::to_string_pretty(&project).map_err(|error| error.to_string())?);
        let pretty_chats = format!("{}\n", serde_json::to_string_pretty(&parsed).map_err(|error| error.to_string())?);
        let pretty_activity = format!("{}\n", serde_json::to_string_pretty(&activity).map_err(|error| error.to_string())?);
        atomic_write(&nova_dir.join("project.json"), pretty_project.as_bytes())?;
        atomic_write(&nova_dir.join("chats.json"), pretty_chats.as_bytes())?;
        atomic_write(&nova_dir.join("activity.json"), pretty_activity.as_bytes())?;
        let bundle = serde_json::json!({ "version": 2, "project": project, "chats": parsed, "activity": activity });
        atomic_write(&nova_dir.join("workspace.json"), format!("{}\n", serde_json::to_string_pretty(&bundle).map_err(|error| error.to_string())?).as_bytes())?;
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn read_workspace_range(root_path: String, relative_path: String, start_line: usize, end_line: usize) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if start_line == 0 || end_line < start_line || end_line - start_line > 2_000 { return Err("Choose a valid range of at most 2,000 lines".into()); }
        let root = canonical_root(&root_path)?;
        let target = safe_target(&root, &relative_path)?;
        if !target.is_file() || !text_file(&target) { return Err("This file cannot be read as text".into()); }
        let content = fs::read_to_string(target).map_err(|_| "This file is not valid UTF-8 text".to_string())?;
        Ok(content.lines().enumerate().filter(|(index, _)| *index + 1 >= start_line && *index + 1 <= end_line).map(|(index, line)| format!("{}: {}", index + 1, line)).collect::<Vec<_>>().join("\n"))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn patch_workspace_file(root_path: String, relative_path: String, old_text: String, new_text: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if old_text.is_empty() { return Err("Patch target cannot be empty".into()); }
        let root = canonical_root(&root_path)?;
        let target = safe_target(&root, &relative_path)?;
        if !target.is_file() || !text_file(&target) { return Err("This file cannot be patched as text".into()); }
        let content = fs::read_to_string(&target).map_err(|_| "This file is not valid UTF-8 text".to_string())?;
        let occurrences = content.matches(&old_text).count();
        if occurrences != 1 { return Err(format!("Patch target must match exactly once; found {occurrences}")); }
        let snapshot = snapshot_file(&root, &target, &relative_path)?;
        fs::write(&target, content.replacen(&old_text, &new_text, 1)).map_err(|error| error.to_string())?;
        record_undo(&root, &WorkspaceUndo { action: "write".into(), path: relative_path.clone(), secondary_path: None, snapshot_path: snapshot, existed: true })?;
        Ok(serde_json::json!({ "ok": true, "path": relative_path.clone(), "changedFiles": [relative_path], "snapshotCreated": true }))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn create_workspace_directory(root_path: String, relative_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let target = safe_write_target(&root, &relative_path)?;
        if target.exists() { return Err("A project item already exists at this path".into()); }
        fs::create_dir_all(&target).map_err(|error| error.to_string())?;
        record_undo(&root, &WorkspaceUndo { action: "create".into(), path: relative_path.clone(), secondary_path: None, snapshot_path: None, existed: false })?;
        Ok(serde_json::json!({ "ok": true, "path": relative_path.clone(), "changedFiles": [relative_path] }))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn move_workspace_item(root_path: String, from_path: String, to_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let source = safe_target(&root, &from_path)?;
        let destination = safe_write_target(&root, &to_path)?;
        if destination.exists() { return Err("The destination already exists".into()); }
        if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        fs::rename(&source, &destination).map_err(|error| error.to_string())?;
        record_undo(&root, &WorkspaceUndo { action: "move".into(), path: to_path.clone(), secondary_path: Some(from_path.clone()), snapshot_path: None, existed: true })?;
        Ok(serde_json::json!({ "ok": true, "from": from_path.clone(), "to": to_path.clone(), "changedFiles": [from_path, to_path] }))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn copy_workspace_item(root_path: String, from_path: String, to_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let source = safe_target(&root, &from_path)?;
        let destination = safe_write_target(&root, &to_path)?;
        if destination.exists() { return Err("The destination already exists".into()); }
        copy_tree(&source, &destination)?;
        record_undo(&root, &WorkspaceUndo { action: "create".into(), path: to_path.clone(), secondary_path: None, snapshot_path: None, existed: false })?;
        Ok(serde_json::json!({ "ok": true, "from": from_path, "to": to_path.clone(), "changedFiles": [to_path] }))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn trash_workspace_item(root_path: String, relative_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let source = safe_target(&root, &relative_path)?;
        let stamp = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis()).unwrap_or(0);
        let trash_relative = format!("trash/{stamp}/{relative_path}");
        let destination = nova_data_dir(&root)?.join(&trash_relative);
        if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        fs::rename(&source, &destination).map_err(|error| error.to_string())?;
        record_undo(&root, &WorkspaceUndo { action: "trash".into(), path: relative_path.clone(), secondary_path: None, snapshot_path: Some(trash_relative), existed: true })?;
        Ok(serde_json::json!({ "ok": true, "path": relative_path.clone(), "recoverable": true, "changedFiles": [relative_path] }))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn undo_workspace_change(root_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_root(&root_path)?;
        let latest = nova_data_dir(&root)?.join("history/latest.json");
        let undo: WorkspaceUndo = serde_json::from_slice(&fs::read(&latest).map_err(|_| "There is no Nova change to undo".to_string())?).map_err(|error| error.to_string())?;
        let target = safe_write_target(&root, &undo.path)?;
        match undo.action.as_str() {
            "write" => if let Some(snapshot) = undo.snapshot_path { fs::copy(nova_data_dir(&root)?.join(snapshot), &target).map_err(|error| error.to_string())?; } else if target.exists() { fs::remove_file(&target).map_err(|error| error.to_string())?; },
            "create" => if target.is_dir() { fs::remove_dir_all(&target).map_err(|error| error.to_string())?; } else if target.exists() { fs::remove_file(&target).map_err(|error| error.to_string())?; },
            "move" => { let original = safe_write_target(&root, undo.secondary_path.as_deref().ok_or("Undo metadata is incomplete")?)?; if let Some(parent) = original.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; } fs::rename(&target, original).map_err(|error| error.to_string())?; },
            "trash" => { let stored = nova_data_dir(&root)?.join(undo.snapshot_path.ok_or("Undo metadata is incomplete")?); if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; } fs::rename(stored, &target).map_err(|error| error.to_string())?; },
            _ => return Err("This Nova change cannot be undone".into()),
        }
        let _ = fs::remove_file(latest);
        Ok(serde_json::json!({ "ok": true, "restored": undo.path.clone(), "changedFiles": [undo.path] }))
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
        let existed = target.exists();
        let snapshot = snapshot_file(&root, &target, &relative_path)?;
        fs::write(&target, content).map_err(|error| format!("Could not write workspace file: {error}"))?;
        record_undo(&root, &WorkspaceUndo { action: "write".into(), path: relative_path.clone(), secondary_path: None, snapshot_path: snapshot, existed })?;
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
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![import_gguf_model, ollama_status, install_ollama, scan_workspace, read_workspace_file, read_workspace_range, read_workspace_asset, search_workspace, initialize_workspace, save_workspace_history, write_workspace_file, patch_workspace_file, create_workspace_directory, move_workspace_item, copy_workspace_item, trash_workspace_item, undo_workspace_change, observe_screen, click_screen, move_screen, drag_screen, type_text, press_key, scroll_screen, open_application, run_terminal, install_package, start_preview_server])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running IDK Nova");
}
