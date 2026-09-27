use std::{fs, path::PathBuf, process::Command};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![import_gguf_model])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running IDK Nova");
}
