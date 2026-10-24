import { loadBrowserStorage } from './helpers/client-storage.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { inflateSync } from 'node:zlib';
function load(path, dependencies = {}, globals = {}) {
  dependencies = { ...dependencies, './client-storage': loadBrowserStorage(globals), '../lib/client-storage': loadBrowserStorage(globals) };
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports: module.exports, module, require: name => dependencies[name], URL, Error, DOMException, performance, crypto, ...globals });
  return module.exports;
}
test('Tool commands are registered, unique and not email addresses', () => {
  const api = load('../src/agent/commands.ts');
  assert.deepEqual(Array.from(api.toolCommands('@fs_checkpoint then @fs_list. @fs_checkpoint @unknown user@fs_list.com', ['fs_checkpoint', 'fs_list'])), ['fs_checkpoint', 'fs_list']);
  assert.match(api.commandInstructions(['fs_checkpoint']), /not permission to bypass/);
});
test('Diagnostics distinguish authentication and avoid guessing CORS', () => {
  const api = load('../src/lib/diagnostics.ts');
  assert.equal(api.diagnoseConnection('Provider returned 401').title, 'Authentication rejected');
  assert.equal(api.diagnoseConnection('500').title, 'Provider server error');
  assert.match(api.diagnoseConnection('Failed to fetch').action, /cannot distinguish/);
  assert.equal(api.diagnoseConnection('url not allowed on the configured scope: http://127.0.0.1:11434/v1/chat/completions').title, 'Desktop connection permission blocked');
  assert.equal(api.diagnoseConnection('GGUF_IMAGE_MODEL: flux').title, 'Not a chat model');
  assert.equal(api.diagnoseConnection('Agent provider returned 500: Jinja Exception: No user query found in messages.').title, 'Model conversation template failed');
});
function agent(responses) {
  const requests = [];
  const api = load('../src/lib/ai.ts', {
    '../types': { getActiveProvider: config => config.providers[0] },
    '@tauri-apps/plugin-http': {},
    '../agent/loop-watchdog': { AgentLoopWatchdog: class { observe() {} } },
    './usage': { UsageTracker: class { text() {} report() {} finish() {} } },
  }, { window: { fetch: async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); const value = responses.shift(); if (!value) throw new Error('Unexpected request'); return { ok: value.status ? value.status < 400 : true, status: value.status || 200, json: async () => value.body, text: async () => value.text || '' }; } }, location: { protocol: 'https:' } });
  return { api, requests };
}
const config = { providers: [{ id: 'test', baseUrl: 'https://test.invalid/v1', apiKey: '', models: ['model'] }], activeModel: 'model', temperature: .5 };
test('Ollama tests reject an existing image model from actual metadata before inference', async () => {
  const { api, requests } = agent([{ body: { details: { family: 'flux' }, capabilities: ['completion'] } }]);
  await assert.rejects(api.testModel({ id: 'local', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', models: ['image'] }, 'image'), /GGUF_NOT_CHAT/);
  assert.equal(requests.length, 1); assert.equal(requests[0].url, 'http://127.0.0.1:11434/api/show');
});
test('Compatible Ollama metadata continues to a real chat-completion test', async () => {
  const { api, requests } = agent([{ body: { model_info: { 'general.architecture': 'qwen3' } } }, { body: { choices: [{ message: { role: 'assistant', content: 'OK' } }] } }]);
  assert.equal(typeof await api.testModel({ id: 'local', baseUrl: 'http://localhost:11434/v1', apiKey: '', models: ['chat'] }, 'chat'), 'number');
  assert.equal(requests[1].url, 'http://localhost:11434/v1/chat/completions');
});
test('Vision readiness sends an actual image rather than a text-only ping', async () => {
  const { api, requests } = agent([{ body: { details: { family: 'qwen35' }, capabilities: ['completion', 'vision'] } }, { body: { choices: [{ message: { content: 'OK' } }] } }]);
  await api.testModel({ id: 'local', baseUrl: 'http://localhost:11434/v1', apiKey: '', models: ['vision'] }, 'vision', true);
  assert.equal(requests[1].body.messages[0].content[1].type, 'image_url');
  assert.match(requests[1].body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  const image = Buffer.from(requests[1].body.messages[0].content[1].image_url.url.split(',')[1], 'base64');
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  let raster;
  for (let offset = 8; offset < image.length;) { const length = image.readUInt32BE(offset); assert.equal(crc(image.subarray(offset + 4, offset + 8 + length)), image.readUInt32BE(offset + 8 + length)); if (image.toString('ascii', offset + 4, offset + 8) === 'IDAT') raster = inflateSync(image.subarray(offset + 8, offset + 8 + length)); offset += length + 12; }
  assert.equal(image.readUInt32BE(16), 32); assert.equal(raster.length, 32 * 97);
});
const tools = [{ type: 'function', function: { name: 'fs_checkpoint', parameters: { type: 'object' }, description: 'Checkpoint' } }];
const run = (api, execute, onToken = () => {}) => api.runAgentCompletion(config, [{ role: 'user', content: '@fs_checkpoint' }], '', tools, execute, () => {}, onToken, undefined, undefined, undefined, true, 'work', ['fs_checkpoint']);
test('Context overflow replays compacted completed tool exchanges without repeating execution', async () => {
  const { api, requests } = agent([{ body: { id: 'r1', output: [{ type: 'function_call', name: 'fs_checkpoint', call_id: 'c1', arguments: JSON.stringify({ source: 'large.xlsx', content: 'x'.repeat(30000) }) }] } }, { status: 400, text: 'Response context is too long' }, { body: { id: 'r3', output_text: 'Recovered' } }]);
  let executions = 0;
  await run(api, async () => { executions++; return { ok: true, filename: 'result.xlsx', rows: 'x'.repeat(30000) }; });
  assert.equal(executions, 1); assert.equal(requests[2].body.store, false);
  assert.equal(requests[2].body.input[0].content[0].text, '@fs_checkpoint');
  assert.equal(requests[2].body.input[1].call_id, 'c1'); assert.equal(requests[2].body.input[2].call_id, 'c1');
  assert.ok(JSON.stringify(requests[2].body.input).length < 8000);
  assert.equal(JSON.parse(requests[2].body.input[2].output).filename, 'result.xlsx');
});
test('A transient model failure after a tool result does not repeat that tool', async () => {
  const { api } = agent([{ body: { id: 'r1', output: [{ type: 'function_call', name: 'fs_checkpoint', call_id: 'c1', arguments: '{}' }] } }, { status: 503, text: 'upstream timeout' }, { body: { id: 'r3', output_text: 'Complete' } }]);
  let executions = 0; await run(api, async () => { executions++; return { ok: true }; });
  assert.equal(executions, 1);
});
test('An Ollama tool continuation sends the user, call and output together without response IDs', async () => {
  const { api, requests } = agent([{ body: { id: 'r1', output: [{ type: 'function_call', name: 'fs_checkpoint', call_id: 'c1', arguments: '{}' }] } }, { body: { id: 'r2', output_text: 'Verified.' } }]);
  const localConfig = { ...config, providers: [{ ...config.providers[0], baseUrl: 'http://127.0.0.1:11434/v1' }] };
  let calls = 0, memory = 'unchanged';
  await api.runAgentCompletion(localConfig, [{ role: 'user', content: 'Create a checkpoint' }], '', tools, async () => { calls++; return { ok: true }; }, () => {}, () => {}, undefined, { providerId: 'test', model: 'model', previousResponseId: 'stale' }, value => memory = value);
  assert.equal(calls, 1); assert.equal(memory, undefined);
  for (const request of requests) { assert.equal(request.body.store, false); assert.equal(request.body.previous_response_id, undefined); }
  assert.deepEqual(requests[1].body.input.map(item => item.role || item.type), ['user', 'function_call', 'function_call_output']);
});
test('A proxy losing a chain after successful execution replays results, not side effects', async () => {
  const { api, requests } = agent([{ body: { id: 'r1', output: [{ type: 'function_call', name: 'fs_checkpoint', call_id: 'c1', arguments: '{}' }] } }, { status: 500, text: 'Jinja Exception: No user query found in messages.' }, { body: { id: 'r3', output_text: 'Recovered.' } }]);
  let calls = 0;
  await run(api, async () => { calls++; return { ok: true }; });
  assert.equal(calls, 1); assert.equal(requests[1].body.previous_response_id, 'r1');
  assert.equal(requests[2].body.store, false); assert.equal(requests[2].body.previous_response_id, undefined);
  assert.deepEqual(requests[2].body.input.map(item => item.role || item.type), ['user', 'function_call', 'function_call_output']);
  assert.equal(JSON.parse(requests[2].body.input[2].output).ok, true);
});
test('A persistent template error is retried once, not indefinitely', async () => {
  const { api, requests } = agent([{ status: 500, text: 'No user query found in messages.' }, { status: 500, text: 'No user query found in messages.' }]);
  await assert.rejects(run(api, async () => assert.fail('No tool should run')), /No user query/);
  assert.equal(requests.length, 2);
});
test('Responses executes an explicit tool before declaring completion', async () => {
  const { api, requests } = agent([{ body: { id: 'r1', output: [{ type: 'function_call', name: 'fs_checkpoint', call_id: 'c1', arguments: '{}' }] } }, { body: { id: 'r2', output_text: 'Verified.' } }]);
  let calls = 0; let text = '';
  await run(api, async () => { calls++; return { status: 'success' }; }, value => text += value);
  assert.equal(calls, 1); assert.equal(text, 'Verified.');
  assert.equal(requests[0].body.tool_choice, 'required'); assert.equal(requests[1].body.tool_choice, 'auto');
});
test('Ignoring a command cannot produce false success; retries are bounded', async () => {
  const { api, requests } = agent(Array.from({ length: 3 }, (_, i) => ({ body: { id: `r${i}`, output_text: 'Done without tools' } })));
  let text = '';
  await assert.rejects(run(api, async () => ({ ok: true }), value => text += value), /not completed/);
  assert.equal(text, ''); assert.equal(requests.length, 3);
});
test('Chat Completions fallback also enforces commands', async () => {
  const { api, requests } = agent([{ status: 404 }, { body: { choices: [{ message: { tool_calls: [{ id: 'c', type: 'function', function: { name: 'fs_checkpoint', arguments: '{}' } }] } }] } }, { body: { choices: [{ message: { content: 'Completed' } }] } }]);
  let calls = 0; await run(api, async () => { calls++; return { status: 'success' }; });
  assert.equal(calls, 1); assert.match(requests[1].url, /chat\/completions/);
});
test('An executable extension returns real local output into the provider tool loop', async () => {
  const extension = load('../src/lib/extensions.ts', {}, { localStorage: { getItem: () => '["calculator"]' } });
  const use = extension.extensionUse(['calculator']);
  const { api, requests } = agent([{ body: { id: 'r1', output: [{ type: 'function_call', name: 'calculate', call_id: 'c1', arguments: '{"expression":"12*7"}' }] } }, { body: { id: 'r2', output_text: '84' } }]);
  let answer = '';
  await api.runAgentCompletion(config, [{ role: 'user', content: '@calculate 12*7' }], use.context, use.tools, extension.executeExtension, () => {}, token => answer += token, undefined, undefined, undefined, false, undefined, ['calculate']);
  assert.equal(requests[0].body.tools[0].name, 'calculate');
  assert.match(JSON.stringify(requests[1].body.input), /result.*84/);
  assert.equal(answer, '84');
});
test('A clarification tool pauses Responses until real answers and resumes the same call', async () => {
  const form = load('../src/lib/input-requests.ts');
  const request = { title: 'Email', questions: [{ id: 'language', question: 'Language?', options: ['English', 'فارسی'] }] };
  const { api, requests } = agent([{ body: { id: 'r1', output: [{ type: 'function_call', name: 'collect_user_input', call_id: 'input1', arguments: JSON.stringify(request) }] } }, { body: { id: 'r2', output_text: 'English email ready' } }]);
  const controller = new AbortController(); let session, output = '';
  const pending = api.runAgentCompletion(config, [{ role: 'user', content: '@formal_email' }], form.inputInstructions, [form.inputTool], async () => ({ ok: true, answers: await form.waitForInput(request, controller.signal, value => { session = value; }) }), () => {}, token => output += token, controller.signal);
  for (let i = 0; i < 20 && !session; i++) await Promise.resolve();
  assert.ok(session); assert.equal(requests.length, 1); assert.equal(output, '');
  session.submit({ language: 'English' }); await pending;
  assert.match(JSON.stringify(requests[1].body.input), /English/);
  assert.equal(requests[1].body.input[0].call_id, 'input1'); assert.equal(output, 'English email ready');
});
test('Cancellation ends both tool protocols rather than asking again or reporting success', async () => {
  const form = load('../src/lib/input-requests.ts');
  for (const fallback of [false, true]) {
    const toolCall = { id: 'input1', type: 'function', function: { name: 'collect_user_input', arguments: '{}' } };
    const responses = fallback ? [{ status: 404 }, { body: { choices: [{ message: { tool_calls: [toolCall] } }] } }] : [{ body: { id: 'r1', output: [{ type: 'function_call', name: 'collect_user_input', call_id: 'input1', arguments: '{}' }] } }];
    const { api, requests } = agent(responses); let output = '';
    await assert.rejects(api.runAgentCompletion(config, [{ role: 'user', content: '@formal_email' }], '', [form.inputTool], async () => { throw new Error('__NOVA_INPUT_CANCELLED__'); }, () => {}, token => output += token), /__NOVA_INPUT_CANCELLED__/);
    assert.equal(output, ''); assert.equal(requests.length, fallback ? 2 : 1);
  }
});
test('Clarification answers stay in subsequent conversation context', async () => {
  const { api, requests } = agent([{ body: { id: 'r1', output_text: 'Remembered' } }]);
  await api.runAgentCompletion(config, [{ role: 'user', content: 'Draft email', inputAnswers: [{ id: 'recipient', question: 'Recipient?', answer: 'Sam' }] }, { role: 'assistant', content: 'Welcome' }, { role: 'user', content: 'Make it shorter' }], '', [], async () => {}, () => {}, () => {});
  assert.match(JSON.stringify(requests[0].body.input), /Recipient.*Sam/);
});
test('Prompt imports reserve tool names and expand only matching mentions', () => {
  const data = new Map();
  const api = load('../src/lib/prompts.ts', { './extensions': { extensionCatalog: [{ tool: 'calculate' }, { tool: 'analyze_text' }] }, '../agent/catalog': { NOVA_TOOLS: [{ function: { name: 'fs_checkpoint' } }] } }, { localStorage: { getItem: key => data.get(key) } });
  assert.throws(() => api.validatePrompts([{ name: 'Test', text: 'Do it', shortcut: 'fs_checkpoint' }]), /reserved/);
  data.set('nova-prompts-v1', JSON.stringify(api.validatePrompts([{ name: 'Email', text: 'Draft an email', shortcut: 'email' }])));
  assert.equal(api.expandPrompts('@email for Sam'), 'Draft an email for Sam');
  assert.equal(api.expandPrompts('user@email.com'), 'user@email.com');
});
test('Recovery preserves past evidence without replaying tasks', () => {
  const data = new Map([['idk-nova-agent-tasks-v1', JSON.stringify([{ id: 'a', state: 'running', goal: 'Build', events: [{ kind: 'result', label: 'Wrote index.html' }] }, { id: 'b', state: 'completed', events: [] }])]]);
  const api = load('../src/agent/task-store.ts', { '../lib/secrets': { redactSecrets: value => value } }, { localStorage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) } });
  assert.equal(api.recoverInterruptedTasks(), 1);
  const tasks = JSON.parse(data.get('idk-nova-agent-tasks-v1'));
  assert.equal(tasks[0].state, 'interrupted'); assert.equal(tasks[1].state, 'completed');
  assert.match(api.recoveryPrompt(tasks[0]), /Wrote index.html/); assert.match(api.recoveryPrompt(tasks[0]), /Do not repeat/);
});
test('Local-only Work rejects remote endpoints before sending any data', () => {
  const api = load('../src/lib/intelligence.ts', { './storage': { loadValue: (_, fallback) => fallback } });
  const project = { localOnly: true };
  assert.throws(() => api.enforceWorkPrivacy(project, { activeProviderId: 'a', providers: [{ id: 'a', baseUrl: 'https://cloud.invalid/v1' }] }), /not sent/);
  assert.doesNotThrow(() => api.enforceWorkPrivacy(project, { activeProviderId: 'a', providers: [{ id: 'a', baseUrl: 'http://[::1]:11434/v1' }] }));
  assert.equal(api.isLocalEndpoint('http://localhost.evil.example/v1'), false);
});
test('Voice rejects remote HTTP and closes the microphone, channel and peer on end', async () => {
  let stopped = 0, peerClosed = 0, channelClosed = 0, nativeCalls = 0;
  const audio = { pause() {}, play: async () => {} };
  class Peer { connectionState = 'new'; addTrack() {} createDataChannel() { return { close() { channelClosed++; } }; } async createOffer() { return { sdp: 'mock-offer' }; } async setLocalDescription() {} async setRemoteDescription() {} close() { peerClosed++; } }
  const api = load('../src/lib/voice.ts', { '@tauri-apps/api/core': { invoke: async () => { nativeCalls++; return 'short-lived-test-token'; } }, './secrets': { redactSecrets: value => value } }, { window: { __TAURI_INTERNALS__: {}, RTCPeerConnection: Peer }, RTCPeerConnection: Peer, Audio: class { constructor() { return audio; } }, AbortController, setTimeout, clearTimeout, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }], getAudioTracks: () => [] }) } }, fetch: async () => ({ ok: true, text: async () => 'mock-answer' }) });
  const insecure = new api.VoiceSession(() => {}, () => {});
  await assert.rejects(insecure.start({ baseUrl: 'http://remote.invalid/v1' }, 'test'), /HTTPS/);
  assert.equal(nativeCalls, 0);
  const session = new api.VoiceSession(() => {}, () => {});
  await session.start({ baseUrl: 'https://voice.invalid/v1' }, 'test'); session.stop();
  assert.equal(stopped, 1); assert.equal(peerClosed, 1); assert.equal(channelClosed, 1); assert.equal(audio.srcObject, null);
});
test('Live voice availability is negotiated for the selected model without microphone access', async () => {
  let microphoneCalls = 0; const models = [];
  const api = load('../src/lib/voice.ts', { '@tauri-apps/api/core': { invoke: async (_name, args) => { models.push(args.model); if (args.model === 'text-only') throw new Error('Unsupported'); return 'temporary-token'; } }, './secrets': {} }, { window: { __TAURI_INTERNALS__: {}, RTCPeerConnection: class {} }, navigator: { mediaDevices: { getUserMedia() { microphoneCalls++; } } } });
  const provider = { baseUrl: 'https://voice.invalid/v1', apiKey: 'test-only' };
  assert.equal(await api.checkVoiceSupport(provider, 'text-only'), false);
  assert.equal(await api.checkVoiceSupport(provider, 'company-realtime-alias'), true);
  assert.deepEqual(models, ['text-only', 'company-realtime-alias']); assert.equal(microphoneCalls, 0);
});
