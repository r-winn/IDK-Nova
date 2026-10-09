import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, dependencies = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports: module.exports, module, require: name => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; }, DOMException, performance, URL });
  return module.exports;
}
test('Pause retains the same task; resume releases it, and stop rejects a paused task', async () => {
  const { AgentControl } = load('../src/agent/control.ts');
  const gate = new AgentControl();
  const controller = new AbortController();
  gate.pause();
  let advanced = false;
  const wait = gate.checkpoint(controller.signal).then(() => { advanced = true; });
  await Promise.resolve();
  assert.equal(advanced, false);
  gate.resume(); await wait;
  assert.equal(advanced, true);
  gate.pause();
  const aborted = gate.checkpoint(controller.signal);
  controller.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
});
test('Context excludes selected messages and private requests never fall through to cloud', () => {
  const data = new Map();
  const api = load('../src/lib/intelligence.ts', { './storage': { loadValue: (key, fallback) => data.get(key) ?? fallback } });
  const config = { providers: [{ id: 'cloud', baseUrl: 'https://example.com/v1', models: ['fast'] }, { id: 'local', baseUrl: 'http://127.0.0.1:11434/v1', models: ['private'] }], activeProviderId: 'cloud', activeModel: 'fast' };
  data.set('nova-intelligence', { enabled: true, routes: {}, contextMessages: 40 });
  assert.throws(() => api.routeRequest(config, 'محرمانه', false), /private local model/);
  data.set('nova-intelligence', { enabled: true, routes: { private: 'local::private' }, contextMessages: 40 });
  assert.equal(api.routeRequest(config, 'محرمانه', false).config.activeProviderId, 'local');
  data.set('nova-context-excluded-1', [1]);
  assert.equal(api.selectedContext({ id: 1 }, [{ content: 'first' }, { content: 'excluded' }, { content: 'last' }]).length, 2);
  data.set('nova-memory-notes', [{ id: 'a', scope: 'work-one', text: 'first work', pinned: true }, { id: 'b', scope: 'work-two', text: 'second work', pinned: false }]);
  assert.match(api.memoryContext({ workspaceId: 'work-one' }), /first work/);
  assert.doesNotMatch(api.memoryContext({ workspaceId: 'work-one' }), /second work/);
});
test('Loop detection ignores variable call IDs and execution times', () => {
  const { AgentLoopWatchdog } = load('../src/agent/loop-watchdog.ts');
  const watchdog = new AgentLoopWatchdog();
  const call = { function: { name: 'fs_read', arguments: '{"path":"same.txt"}' } };
  for (let index = 0; index < 3; index++) watchdog.observe(call, { result: { status: 'success', callId: String(index), durationMs: index + 10, structuredData: { content: 'unchanged' } } });
  assert.throws(() => watchdog.observe(call, { result: { status: 'success', callId: 'different', durationMs: 1000, structuredData: { content: 'unchanged' } } }), /__NOVA_AGENT_STALLED__/);
});
test('Tool schemas reject missing fields, wrong types, unexpected keys and invalid ranges', () => {
  const { validateArguments } = load('../src/agent/protocol.ts');
  const schema = { type: 'object', additionalProperties: false, required: ['path', 'line'], properties: { path: { type: 'string' }, line: { type: 'integer', minimum: 1 }, steps: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } } } };
  assert.throws(() => validateArguments({ path: 'file.txt' }, schema), /missing line/);
  assert.throws(() => validateArguments({ path: 'file.txt', line: 0 }, schema), /below minimum/);
  assert.throws(() => validateArguments({ path: 'file.txt', line: 1.5 }, schema), /valid number/);
  assert.throws(() => validateArguments({ path: 'file.txt', line: 1, surprise: true }, schema), /unknown property/);
  assert.throws(() => validateArguments({ path: 'file.txt', line: 1, steps: [1] }, schema), /expected text/);
  validateArguments({ path: 'file.txt', line: 1, steps: ['inspect', 'verify'] }, schema);
});
