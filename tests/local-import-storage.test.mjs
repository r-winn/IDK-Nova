import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('Local import passes original files to Ollama after a storage preflight, not redundant private copies', () => {
  const source = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /copy_model_with_progress/);
  assert.match(source, /import_storage::check_space\(&store, combined_size\)\?/);
  assert.match(source, /gguf::modelfile\(&source, projector\.as_deref\(\)\)/);
});
test('Runtime availability cannot be confused with a successful model import', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /ollamaInstalled && localModelImport\?\.phase !== "error"/);
  assert.doesNotMatch(source, /Your GGUF file can be imported now/);
});
