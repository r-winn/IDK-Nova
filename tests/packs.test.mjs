import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, dependencies, globals) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: module.exports, module, require: name => dependencies[name], crypto, Error, TextDecoder, Uint8Array, Event, URL, ...globals });
  return module.exports;
}
function environment() {
  const data = new Map(); const events = [];
  const globals = { localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }, window: { dispatchEvent: event => events.push(event.type) } };
  const prompts = load('../src/lib/prompts.ts', { '../agent/catalog': { NOVA_TOOLS: [] } }, globals);
  const packs = load('../src/lib/packs.ts', { './prompts': prompts }, globals);
  const bundle = load('../src/lib/config-bundle.ts', { './prompts': prompts, './packs': packs, './intelligence': { intelligenceSettings: () => JSON.parse(data.get('nova-intelligence') || '{"enabled":false,"contextMessages":40,"routes":{}}') }, './usage': { modelPrices: () => JSON.parse(data.get('nova-prices-v1') || '{}') } }, globals);
  return { data, events, globals, prompts, packs, bundle };
}
const config = { providers: [{ id: 'source', baseUrl: 'https://test.invalid/v1', models: ['test'], apiKey: 'test-secret', apiKeyStored: true }], database: { url: 'private-database' } };
test('Portable config carries installed packs, prompts, routing and prices without secrets or history', () => {
  const { data, packs, bundle } = environment();
  packs.storePrompts([{ id: 'a', name: 'Email', shortcut: 'email', text: 'Draft an email', pack: 'writing' }]);
  data.set('nova-intelligence', JSON.stringify({ enabled: true, contextMessages: 60, routes: { strong: 'source::test' } }));
  data.set('nova-prices-v1', JSON.stringify({ 'source::test': { input: 1, output: 2, cached: .5 } }));
  data.set('nova-memory-notes', JSON.stringify([{ id: 'm', scope: 'personal', text: 'Private note', pinned: true }]));
  const exported = bundle.exportConfigBundle(config);
  assert.doesNotMatch(JSON.stringify(exported), /test-secret|private-database|Private note/);
  assert.equal(exported.providers[0].apiKeyStored, false);
  const valid = bundle.validateConfigBundle(exported.novaBundle);
  data.clear();
  bundle.importConfigBundle(valid, config, { ...config, providers: [{ ...config.providers[0], id: 'existing' }] });
  assert.equal(packs.installedPacks()[0].id, 'writing');
  assert.match(packs.packContext(['writing']), /Draft an email/);
  assert.equal(JSON.parse(data.get('nova-intelligence')).routes.strong, 'existing::test');
  assert.equal(JSON.parse(data.get('nova-prices-v1'))['existing::test'].output, 2);
  assert.equal(packs.packContext(['research']), '');
  assert.equal(data.has('idk-nova-history'), false);
});
test('Explicit memory export/import preserves Work notes without crossing their scope', () => {
  const { data, bundle } = environment();
  data.set('nova-memory-notes', JSON.stringify([{ id: 'm', scope: 'personal', text: 'Remember this', pinned: true }, { id: 'w', scope: 'work-id', text: 'Work private', pinned: false }]));
  const exported = bundle.exportConfigBundle(config, false, true);
  assert.equal(exported.novaBundle.personalMemory.length, 1);
  assert.doesNotMatch(JSON.stringify(exported), /Work private/);
  bundle.importConfigBundle(bundle.validateConfigBundle(exported.novaBundle), config, config);
  assert.equal(JSON.parse(data.get('nova-memory-notes')).length, 2);
});
test('Invalid bundle fails validation before mutation; legacy configs stay compatible', () => {
  const { bundle, data } = environment();
  assert.equal(bundle.validateConfigBundle(undefined), undefined);
  const exported = bundle.exportConfigBundle(config);
  assert.throws(() => bundle.validateConfigBundle({ ...exported.novaBundle, schema: 2 }), /Invalid/);
  assert.throws(() => bundle.validateConfigBundle({ ...exported.novaBundle, prices: { model: { output: -1 } } }), /Invalid/);
  assert.equal(data.size, 0);
  assert.throws(() => bundle.configPreferences({ temperature: 'wrong' }), /Invalid temperature/);
  assert.throws(() => bundle.configPreferences({ providers: [{ ...config.providers[0], name: 'Test', baseUrl: 'javascript:alert(1)' }] }), /HTTP/);
  assert.equal(bundle.configPreferences({ theme: 'dark', unknown: 'ignored' }).unknown, undefined);
});
test('Pack downloads report actual streamed bytes, validate manifests and reject excessive permissions', async () => {
  const { prompts, globals } = environment();
  const bytes = new TextEncoder().encode(readFileSync(new URL('../public/packs/writing.json', import.meta.url), 'utf8'));
  const calls = [];
  const api = load('../src/lib/packs.ts', { './prompts': prompts }, { ...globals, fetch: async () => ({ ok: true, headers: { get: key => key === 'content-length' ? String(bytes.length) : null }, body: new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 100)); controller.enqueue(bytes.slice(100)); controller.close(); } }) }) });
  const downloaded = await api.downloadPack('writing', '/packs/writing.json', (loaded, total) => calls.push([loaded, total]));
  assert.equal(downloaded.length, 2); assert.equal(downloaded[0].pack, 'writing');
  assert.equal(calls[0][0], 100); assert.equal(calls.at(-1)[0], bytes.length); assert.equal(calls.at(-1)[1], bytes.length);
  const bad = new TextEncoder().encode(JSON.stringify({ id: 'writing', version: '1.0', permissions: ['terminal'], prompts: [] }));
  const rejected = load('../src/lib/packs.ts', { './prompts': prompts }, { ...globals, fetch: async () => ({ ok: true, headers: { get: () => '0' }, arrayBuffer: async () => bad.buffer }) });
  await assert.rejects(rejected.downloadPack('writing', '/packs/writing.json', () => {}), /Invalid pack/);
});
test('A failed bundle write rolls back portable preferences without announcing partial installation', () => {
  const { data, events, globals, bundle } = environment();
  data.set('nova-prompts-v1', '[]');
  data.set('nova-intelligence', '{"enabled":false,"contextMessages":40,"routes":{}}');
  const before = JSON.stringify([...data]);
  const valid = bundle.validateConfigBundle(bundle.exportConfigBundle(config).novaBundle);
  const write = globals.localStorage.setItem; let failed = false;
  globals.localStorage.setItem = (key, value) => { if (key === 'nova-intelligence' && !failed) { failed = true; throw new Error('quota'); } write(key, value); };
  assert.throws(() => bundle.importConfigBundle(valid, config, config), /quota/);
  assert.equal(JSON.stringify([...data]), before);
  assert.equal(events.length, 0);
});
