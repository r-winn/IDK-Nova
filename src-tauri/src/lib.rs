use serde::Serialize;
use std::{fs, path::{Component, Path, PathBuf}, process::Command, time::UNIX_EPOCH};
use tauri::Manager;

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
        let mut command = Command::new("ollama");
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEntry { path: String, name: String, kind: String, size: u64, modified: u64 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceScan { entries: Vec<WorkspaceEntry>, truncated: bool }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceMatch { path: String, line: usize, preview: String }

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![import_gguf_model, scan_workspace, read_workspace_file, search_workspace])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running IDK Nova");
}
