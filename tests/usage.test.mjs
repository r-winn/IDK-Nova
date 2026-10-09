import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, dependencies = {}, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports: module.exports, module, require: name => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; }, DOMException, performance, crypto: webcrypto, Response, TextDecoder, URL, Event, ...globals });
  return module.exports;
}
const config = { providers: [{ id: 'test', name: 'Test provider', baseUrl: 'https://example.com/v1', apiKey: '', models: ['model'] }], activeProviderId: 'test', activeModel: 'model', temperature: 0.5 };
test('Usage accepts both schemas, counts cached tokens once and does not price incomplete totals', () => {
  const data = new Map([['nova-prices-v1', { 'test::model': { input: 10, output: 20, cached: 2 } }]]);
  const storage = { loadValue: (key, fallback) => data.get(key) ?? fallback };
  const api = load('../src/lib/usage.ts', { '../types': { getActiveProvider: () => config.providers[0] }, './storage': storage }, { localStorage: { setItem: (key, value) => data.set(key, JSON.parse(value)) }, window: { dispatchEvent: () => {} } });
  assert.equal(api.parseUsage({ input_tokens: -1, output_tokens: 4 }), undefined);
  const tracker = new api.UsageTracker(config, 'work-one');
  tracker.report({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 30 } });
  tracker.text('answer'); tracker.finish('complete'); tracker.finish('complete');
  const records = data.get('nova-usage-v1');
  assert.equal(records.length, 1); assert.equal(records[0].cost, (70 * 10 + 30 * 2 + 20 * 20) / 1e6);
  const partial = new api.UsageTracker(config); partial.report(null); partial.report({ input_tokens: 100, output_tokens: 5 }); partial.finish('complete');
  assert.equal(data.get('nova-usage-v1')[1].cost, undefined);
});
function aiWithFetch(fetch) {
  const reported = [];
  class Tracker { text() {} report(value) { reported.push(value); } finish() {} }
  const api = load('../src/lib/ai.ts', { '../types': { getActiveProvider: value => value.providers[0] }, '@tauri-apps/plugin-http': { fetch }, '../agent/loop-watchdog': { AgentLoopWatchdog: class { observe() {} } }, './usage': { UsageTracker: Tracker } }, { window: { fetch }, location: { protocol: 'https:' } });
  return { api, reported };
}
test('Responses negotiates stateless and temperature compatibility together without losing history', async () => {
  const bodies = [];
  const { api, reported } = aiWithFetch(async (_, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (body.store) return new Response('store: true is not supported; each response request is independent', { status: 400 });
    if ('temperature' in body) return new Response('temperature not supported', { status: 400 });
    return new Response('data: {"type":"response.output_text.delta","delta":"OK"}\n\ndata: {"type":"response.completed","response":{"id":"resp_test","usage":{"input_tokens":12,"output_tokens":2}}}\n\n');
  });
  let output = '', memory = 'unchanged';
  await api.streamCompletion(config, [{ role: 'user', content: 'hello' }], token => output += token, undefined, undefined, undefined, value => memory = value);
  assert.equal(output, 'OK'); assert.equal(memory, undefined); assert.equal(bodies.length, 3);
  assert.equal(bodies[2].input[0].content[0].text, 'hello'); assert.equal(reported.length, 1);
});
test('Chat Completions tolerates unsupported usage options and consumes final SSE data without a newline', async () => {
  let requests = 0;
  const { api, reported } = aiWithFetch(async (url, options) => {
    requests++;
    if (url.endsWith('/responses')) return new Response('not found', { status: 404 });
    if (JSON.parse(options.body).stream_options) return new Response('unknown stream_options', { status: 400 });
    return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":1}}');
  });
  let output = '';
  await api.streamCompletion(config, [{ role: 'user', content: 'hello' }], token => output += token);
  assert.equal(output, 'Hello'); assert.equal(requests, 3); assert.equal(reported[0].prompt_tokens, 20);
});
test('Known keys and authorization headers are redacted before logs are stored', () => {
  const api = load('../src/lib/secrets.ts');
  api.registerSecrets(['company-key-very-private']);
  const result = api.redactSecrets('company-key-very-private Authorization: Bearer token123 api_key=another123');
  assert.doesNotMatch(result, /company-key|token123|another123/);
});
