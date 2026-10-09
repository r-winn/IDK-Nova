import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, dependencies, globals) {
  if (path !== '../src/lib/extensions.ts' && !dependencies['./extensions']) dependencies = { ...dependencies, './extensions': load('../src/lib/extensions.ts', {}, globals) };
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
  return { data, events, globals, prompts, packs, bundle, extensions: load('../src/lib/extensions.ts', {}, globals) };
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
test('Selective export omits unselected sections and import keeps destination preferences', () => {
  const { data, bundle, packs } = environment();
  data.set('nova-prompts-v1', JSON.stringify([{ id: 'p', name: 'Email', shortcut: 'mail', text: 'Draft an email', pack: 'writing' }, { id: 'q', name: 'Mine', shortcut: 'mine', text: 'Personal instruction' }]));
  data.set('nova-intelligence', '{"enabled":false,"contextMessages":40,"routes":{}}');
  data.set('nova-prices-v1', '{"existing":{"input":2}}');
  const selected = { appearance: false, providers: false, prompts: false, packs: true, intelligence: false, prices: false };
  const exported = bundle.exportConfigBundle(config, true, false, selected);
  assert.equal(exported.providers, undefined);
  assert.equal(exported.branding, undefined);
  assert.equal(exported.novaBundle.intelligence, undefined);
  assert.equal(exported.novaBundle.prices, undefined);
  assert.equal(exported.novaBundle.prompts.length, 1);
  const before = data.get('nova-intelligence');
  bundle.importConfigBundle(bundle.validateConfigBundle(exported.novaBundle), config, config);
  assert.equal(data.get('nova-intelligence'), before);
  assert.equal(data.get('nova-prices-v1'), '{"existing":{"input":2}}');
  assert.equal(JSON.parse(data.get('nova-prompts-v1')).length, 2);
  const use = packs.preparePackUse(['writing', 'missing']);
  assert.equal(use.usedPacks.length, 1);
  assert.match(use.context, /Draft an email/);
  data.set('nova-prompts-v1', '[]');
  assert.equal(use.usedPacks[0].name, 'Professional writing');
  assert.match(use.context, /Draft an email/);
  assert.equal(packs.preparePackUse(['writing']).context, '');
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
test('Executable tools are opt-in, portable and actually compute results', async () => {
  const { extensions, packs, bundle, data } = environment();
  extensions.saveExtensions(['calculator', 'text-analysis']);
  assert.equal(packs.preparePackUse([]).tools.length, 0);
  const use = packs.preparePackUse([], '@calculate 12 * 7');
  assert.equal(use.tools[0].function.name, 'calculate');
  assert.equal(use.usedPacks[0].id, 'calculator');
  const result = await extensions.executeExtension({ function: { name: 'calculate', arguments: '{"expression":"12 * 7"}' } });
  assert.equal(result.result, 84);
  const exported = bundle.exportConfigBundle(config);
  data.clear();
  bundle.importConfigBundle(bundle.validateConfigBundle(exported.novaBundle), config, config);
  assert.equal(extensions.installedExtensions().length, 2);
  assert.throws(() => bundle.validateConfigBundle({ schema: 1, extensions: ['unknown-script'] }), /Unknown/);
});
test('Calculator parses arithmetic without executing code and text measurements are real', async () => {
  const { extensions } = environment();
  assert.equal(extensions.calculate('-2^2 + 3 * (4 + 1)'), 11);
  assert.equal(extensions.calculate('2^-3'), .125);
  assert.equal(extensions.calculate('2^3^2'), 512);
  for (const value of ['1/0', 'process.exit()', 'globalThis.secret', '', '2 2', '(', '5+']) assert.throws(() => extensions.calculate(value));
  const result = await extensions.executeExtension({ function: { name: 'analyze_text', arguments: JSON.stringify({ text: 'سلام دنیا\n\nHello world' }) } });
  assert.equal(result.words, 4); assert.equal(result.paragraphs, 2);
  await assert.rejects(extensions.executeExtension({ function: { name: 'analyze_text', arguments: '{"text":10}' } }), /Invalid/);
  await assert.rejects(extensions.executeExtension({ function: { name: 'shell_exec', arguments: '{}' } }), /Unregistered/);
});
test('JSON and date extensions validate data and never guess invalid dates', async () => {
  const { extensions } = environment();
  const call = (name, args) => extensions.executeExtension({ function: { name, arguments: JSON.stringify(args) } });
  assert.equal((await call('inspect_json', { json: '[1,2]' })).count, 2);
  assert.equal((await call('inspect_json', { json: '{bad}' })).valid, false);
  assert.equal((await call('date_interval', { start: '2024-02-28', end: '2024-03-01' })).days, 2);
  await assert.rejects(call('date_interval', { start: '2025-02-30', end: '2025-03-01' }), /Invalid/);
});
test('Executable manifests cannot install unknown code or grant permissions', async () => {
  const { prompts, globals, extensions } = environment();
  const fetchManifest = manifest => load('../src/lib/packs.ts', { './prompts': prompts, './extensions': extensions }, { ...globals, fetch: async () => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(manifest)).buffer }) });
  const valid = { id: 'calculator', version: '1.0', tool: 'calculate', runtime: 'nova-builtin', permissions: [] };
  await fetchManifest(valid).downloadExtension('calculator', '/packs/calculator.json', () => {});
  assert.equal(extensions.installedExtensions()[0], 'calculator');
  for (const change of [{ permissions: ['terminal'] }, { runtime: 'javascript' }, { tool: 'shell_exec' }, { version: 'unknown' }]) await assert.rejects(fetchManifest({ ...valid, ...change }).downloadExtension('calculator', '/packs/calculator.json', () => {}), /Invalid/);
  assert.equal(extensions.installedExtensions().length, 1);
});
