import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function storageWithVault(invoke) {
  const data = new Map();
  const events = [];
  const module = { exports: {} };
  const source = readFileSync(new URL('../src/lib/storage.ts', import.meta.url), 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  class CustomEvent { constructor(name, options) { this.type = name; this.detail = options.detail; } }
  vm.runInNewContext(compiled, { exports: module.exports, module, require: name => ({ '../types': { defaultConfig: {}, defaultProvider: {} }, '@tauri-apps/api/core': { invoke }, './secrets': { registerSecrets() {} } })[name], localStorage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }, window: { __TAURI_INTERNALS__: {}, dispatchEvent: event => events.push(event) }, structuredClone, CustomEvent });
  return { api: module.exports, data, events };
}
const config = { providers: [{ id: 'company', baseUrl: 'https://example.com/v1', apiKey: 'test-only-secret', models: ['test'] }] };
const flush = () => new Promise(resolve => setImmediate(resolve));
test('Desktop config strips plaintext only after successful vault save and hydrates on restart', async () => {
  const secrets = new Map();
  const { api, data } = storageWithVault(async (command, args) => {
    if (command === 'write_provider_credential') secrets.set(args.account, args.secret);
    if (command === 'read_provider_credential') return secrets.get(args.account) || null;
  });
  data.set('nova-chat-config', JSON.stringify(config));
  api.saveConfig(config); await flush();
  const stored = JSON.parse(data.get('idk-nova-config'));
  assert.equal(stored.providers[0].apiKey, ''); assert.equal(stored.providers[0].apiKeyStored, true);
  assert.equal(data.has('nova-chat-config'), false);
  const restored = await api.hydrateProviderCredentials(stored);
  assert.equal(restored.providers[0].apiKey, 'test-only-secret');
});
test('Vault failures preserve previous config, emit an error and never silently fall back to plaintext', async () => {
  const { api, data, events } = storageWithVault(async () => { throw new Error('vault locked'); });
  data.set('idk-nova-config', 'previous-config');
  api.saveConfig(config); await flush();
  assert.equal(data.get('idk-nova-config'), 'previous-config');
  assert.equal(events.length, 1); assert.equal(events[0].type, 'nova-credential-error');
  assert.doesNotMatch(events[0].detail, /test-only-secret/);
});
