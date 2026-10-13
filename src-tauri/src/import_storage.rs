use std::{fs, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};

const RESERVE: u64 = 512 * 1024 * 1024;
pub fn space_requirement(model_bytes: u64, available: u64) -> Result<(), String> {
    let required = model_bytes.saturating_add(RESERVE);
    if available < required {
        return Err(format!("INSUFFICIENT_DISK_SPACE: About {:.2} GB free is needed for the model and projector in Ollama; only {:.2} GB is available. Free at least {:.2} GB more, then retry. Original files were not changed. Nova no longer creates an additional model copy. This is a conservative estimate for a new import; already-stored Ollama layers may require less space.", required as f64 / 1e9, available as f64 / 1e9, required.saturating_sub(available) as f64 / 1e9));
    }
    Ok(())
}
pub fn check_space(store: &Path, model_bytes: u64) -> Result<(), String> {
    let mut existing = store;
    while !existing.exists() { existing = existing.parent().ok_or("Could not locate the Ollama model storage volume")?; }
    let available = fs2::available_space(existing).map_err(|e| format!("Could not check Ollama storage space: {e}"))?;
    space_requirement(model_bytes, available)
}
pub struct Definition { directory: PathBuf, file: PathBuf }
impl Definition {
    pub fn create(root: &Path, content: &str) -> Result<Self, String> {
        let parent = root.join("import-definitions");
        fs::create_dir_all(&parent).map_err(|e| format!("Could not create the import definition folder: {e}"))?;
        let directory = parent.join(format!("{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));
        fs::create_dir(&directory).map_err(|e| format!("Could not create a private import definition: {e}"))?;
        let definition = Self { file: directory.join("Modelfile"), directory };
        fs::write(&definition.file, content).map_err(|e| format!("Could not write the model definition: {e}"))?;
        Ok(definition)
    }
    pub fn path(&self) -> &Path { &self.file }
}
impl Drop for Definition {
    fn drop(&mut self) { let _ = fs::remove_file(&self.file); let _ = fs::remove_dir(&self.directory); }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn space_checks_cover_both_components_and_reserve() {
        let bytes = 6_600_000_000;
        assert!(space_requirement(bytes, 2_800_000_000).unwrap_err().contains("INSUFFICIENT_DISK_SPACE"));
        assert!(space_requirement(bytes, bytes + RESERVE - 1).is_err());
        assert!(space_requirement(bytes, bytes + RESERVE).is_ok());
        assert!(space_requirement(u64::MAX, 0).is_err());
    }
    #[test] fn definition_cleanup_never_removes_originals_or_other_imports() {
        let root = std::env::temp_dir().join(format!("nova-definition-test-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&root).unwrap();
        let original = root.join("original.gguf"); fs::write(&original, b"unchanged").unwrap();
        let first = Definition::create(&root, "FROM original.gguf").unwrap();
        let second = Definition::create(&root, "FROM original.gguf").unwrap();
        let path = first.path().to_owned(); drop(first);
        assert!(!path.exists()); assert!(second.path().is_file());
        assert_eq!(fs::read(&original).unwrap(), b"unchanged");
        drop(second); fs::remove_file(original).unwrap(); fs::remove_dir(root.join("import-definitions")).unwrap(); fs::remove_dir(root).unwrap();
    }
}
