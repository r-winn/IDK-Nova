import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, dependencies = {}, globals = {}) {
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
const tools = [{ type: 'function', function: { name: 'fs_checkpoint', parameters: { type: 'object' }, description: 'Checkpoint' } }];
const run = (api, execute, onToken = () => {}) => api.runAgentCompletion(config, [{ role: 'user', content: '@fs_checkpoint' }], '', tools, execute, () => {}, onToken, undefined, undefined, undefined, true, 'work', ['fs_checkpoint']);
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
