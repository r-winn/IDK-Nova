use std::{fs::File, io::Read, path::Path};

// Inspect only bounded metadata, never tensor contents. Unknown architectures
// still go through Ollama's authoritative compatibility check.
pub fn check_chat_file(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    (&mut file).take(8 * 1024 * 1024).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let architecture = architecture(&bytes)?;
    if matches!(architecture.as_deref(), Some("flux" | "flux1" | "sd1" | "sd2" | "sdxl" | "stable-diffusion" | "sd3" | "wan")) {
        return Err(format!("GGUF_IMAGE_MODEL: Architecture {} generates images/video, not chat. This file needs a compatible image runtime, not Ollama chat import.", architecture.unwrap()));
    }
    Ok(())
}
fn architecture(bytes: &[u8]) -> Result<Option<String>, String> {
    let mut reader = Metadata { bytes, position: 0 };
    if reader.take(4)? != b"GGUF" { return Err("Invalid GGUF header. Select an actual GGUF model, not a renamed download.".into()); }
    let version = reader.number(4)?;
    if ![2, 3].contains(&version) { return Err("Unsupported GGUF version; use a version 2 or 3 model.".into()); }
    reader.number(8)?;
    let count = reader.number(8)?;
    if count > 100_000 { return Err("GGUF metadata exceeds the safety limit.".into()); }
    for _ in 0..count {
        let key = reader.string()?;
        let kind = reader.number(4)?;
        if key == "general.architecture" {
            if kind != 8 { return Err("Invalid GGUF architecture metadata.".into()); }
            return Ok(Some(reader.string()?.to_lowercase()));
        }
        reader.skip(kind, 0)?;
    }
    Ok(None)
}
struct Metadata<'a> { bytes: &'a [u8], position: usize }
impl Metadata<'_> {
    fn take(&mut self, size: usize) -> Result<&[u8], String> {
        let end = self.position.checked_add(size).ok_or("Invalid GGUF size")?;
        let value = self.bytes.get(self.position..end).ok_or("Incomplete GGUF metadata or metadata exceeds 8 MB")?;
        self.position = end; Ok(value)
    }
    fn number(&mut self, size: usize) -> Result<u64, String> {
        let mut value = [0u8; 8]; value[..size].copy_from_slice(self.take(size)?); Ok(u64::from_le_bytes(value))
    }
    fn string(&mut self) -> Result<String, String> {
        let size = usize::try_from(self.number(8)?).map_err(|_| "Invalid GGUF string size")?;
        String::from_utf8(self.take(size)?.to_vec()).map_err(|_| "Invalid GGUF UTF-8 metadata".into())
    }
    fn skip(&mut self, kind: u64, depth: u8) -> Result<(), String> {
        let size = match kind { 0 | 1 | 7 => 1, 2 | 3 => 2, 4 | 5 | 6 => 4, 10 | 11 | 12 => 8, 8 => { self.string()?; return Ok(()); }, 9 => {
            if depth > 1 { return Err("Invalid nested GGUF array".into()); }
            let item = self.number(4)?; let count = self.number(8)?;
            if count > 1_000_000 { return Err("GGUF array exceeds the safety limit".into()); }
            for _ in 0..count { self.skip(item, depth + 1)?; } return Ok(());
        }, _ => return Err("Invalid GGUF metadata type".into()) };
        self.take(size)?; Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn sample(value: &str) -> Vec<u8> {
        let mut bytes = b"GGUF".to_vec(); bytes.extend(3u32.to_le_bytes()); bytes.extend(0u64.to_le_bytes()); bytes.extend(1u64.to_le_bytes());
        let key = b"general.architecture"; bytes.extend((key.len() as u64).to_le_bytes()); bytes.extend(key); bytes.extend(8u32.to_le_bytes()); bytes.extend((value.len() as u64).to_le_bytes()); bytes.extend(value.as_bytes()); bytes
    }
    #[test] fn actual_architecture_is_read_not_guessed_from_filename() { assert_eq!(architecture(&sample("flux")).unwrap().as_deref(), Some("flux")); assert_eq!(architecture(&sample("llama")).unwrap().as_deref(), Some("llama")); }
    #[test] fn invalid_or_truncated_metadata_is_rejected() { assert!(architecture(b"html").is_err()); let mut bytes = sample("llama"); bytes.pop(); assert!(architecture(&bytes).is_err()); }
}
