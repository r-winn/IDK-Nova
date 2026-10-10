import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, deps = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => deps[name], TextDecoder, URL, Error, AbortController, setTimeout, clearTimeout, ...globals });
  return module.exports;
}
const ai = load('../src/lib/ai.ts', { '../types': {}, '@tauri-apps/plugin-http': {}, '../agent/loop-watchdog': {}, './usage': {} });
const encode = value => new TextEncoder().encode(`data: ${JSON.stringify(value)}\r\n\r\n`);
const response = stream => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
test('Responses text is delivered before stream completion, Unicode chunks survive and final text is not repeated', async () => {
  let controller;
  const tokens = [];
  const stream = new ReadableStream({ start(c) { controller = c; } });
  const pending = ai.readAgentTurn(response(stream), 'responses', text => tokens.push(text));
  const bytes = encode({ type: 'response.output_text.delta', delta: 'سلام ' });
  controller.enqueue(bytes.slice(0, bytes.length - 5)); controller.enqueue(bytes.slice(bytes.length - 5));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(tokens.join(''), 'سلام ');
  controller.enqueue(encode({ type: 'response.output_text.delta', delta: 'world' }));
  controller.enqueue(encode({ type: 'response.completed', response: { id: 'r', output_text: 'سلام world', output: [], usage: { output_tokens: 2 } } })); controller.close();
  const result = await pending;
  assert.equal(tokens.join(''), 'سلام world'); assert.equal(result.streamed, true); assert.equal(result.payload.id, 'r');
});
test('Responses fragmented tool arguments are complete before execution', async () => {
  const stream = new ReadableStream({ start(c) {
    c.enqueue(encode({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'c', name: 'calculate', arguments: '' } }));
    c.enqueue(encode({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"expression":' }));
    c.enqueue(encode({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '"2+2"}' }));
    c.enqueue(encode({ type: 'response.completed', response: { id: 'r' } })); c.close();
  } });
  const result = await ai.readAgentTurn(response(stream), 'responses', () => assert.fail('Tool arguments must not appear as text'));
  assert.equal(result.payload.output[0].arguments, '{"expression":"2+2"}');
});
test('Chat streaming reconstructs parallel indexed tools, keeps usage and accepts final frame without newline', async () => {
  const stream = new ReadableStream({ start(c) {
    c.enqueue(encode({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'analyze_text', arguments: '{"text":' } }, { index: 0, id: 'a', function: { name: 'calculate', arguments: '{"expression":"' } }] } }] }));
    c.enqueue(encode({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '2+2"}' } }, { index: 1, function: { arguments: '"test"}' } }] }, finish_reason: 'tool_calls' }] }));
    c.enqueue(new TextEncoder().encode('data: {"choices":[],"usage":{"total_tokens":8}}')); c.close();
  } });
  const { payload } = await ai.readAgentTurn(response(stream), 'chat', () => {});
  assert.equal(payload.usage.total_tokens, 8);
  assert.equal(payload.choices[0].message.tool_calls.find(call => call.id === 'a').function.arguments, '{"expression":"2+2"}');
});
test('Dropped, failed and incomplete streams cannot be reported as successful', async () => {
  for (const event of [{ type: 'response.failed', response: { error: { message: 'failed' } } }, { type: 'response.incomplete' }, { type: 'response.output_text.delta', delta: 'partial' }]) {
    await assert.rejects(ai.readAgentTurn(response(new ReadableStream({ start(c) { c.enqueue(encode(event)); c.close(); } })), 'responses', () => {}), /failed|incomplete|before/);
  }
});
test('Both agent protocols stream final answers after real tool results without replaying tokens', async () => {
  for (const protocol of ['responses', 'chat']) {
    let outputController, finished = false, firstToken;
    const visible = new Promise(resolve => { firstToken = resolve; });
    const finalStream = new ReadableStream({ start(c) { outputController = c; } });
    const toolStream = new ReadableStream({ start(c) {
      c.enqueue(encode(protocol === 'responses' ? { type: 'response.completed', response: { id: 'r1', output: [{ type: 'function_call', call_id: 'call', name: 'calculate', arguments: '{"expression":"2+2"}' }] } } : { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'calculate', arguments: '{"expression":"2+2"}' } }] }, finish_reason: 'tool_calls' }] })); c.close();
    } });
    const queue = [...(protocol === 'chat' ? [new Response('', { status: 404 })] : []), response(toolStream), response(finalStream)], bodies = [];
    const runner = load('../src/lib/ai.ts', { '../types': { getActiveProvider: config => config.providers[0] }, '@tauri-apps/plugin-http': {}, '../agent/loop-watchdog': { AgentLoopWatchdog: class { observe() {} } }, './usage': { UsageTracker: class { text() {} report() {} finish() {} } } }, { performance, DOMException, window: { fetch: async (_url, init) => { bodies.push(JSON.parse(init.body)); return queue.shift(); } }, location: { protocol: 'https:' } });
    const config = { providers: [{ id: protocol, baseUrl: 'https://test.invalid/v1' }], activeModel: 'test' };
    const tools = [{ type: 'function', function: { name: 'calculate', parameters: {} } }];
    let calls = 0, text = '';
    const task = runner.runAgentCompletion(config, [{ role: 'user', content: '2+2' }], '', tools, async () => { calls++; return { ok: true, result: 4 }; }, () => {}, token => { text += token; firstToken(); }).then(() => { finished = true; });
    outputController.enqueue(encode(protocol === 'responses' ? { type: 'response.output_text.delta', delta: 'Four' } : { choices: [{ delta: { content: 'Four' } }] }));
    await visible; assert.equal(finished, false); assert.equal(calls, 1);
    outputController.enqueue(encode(protocol === 'responses' ? { type: 'response.completed', response: { id: 'r2', output_text: 'Four', output: [] } } : { choices: [{ delta: {}, finish_reason: 'stop' }] })); outputController.close();
    await task; assert.equal(text, 'Four'); assert.equal(bodies.at(-1).stream, true); assert.match(JSON.stringify(bodies.at(-1)), /result.*4/);
  }
});
test('CSV plugin measures actual quoted data and rejects malformed rows', async () => {
  const extensions = load('../src/lib/extensions.ts');
  const call = csv => extensions.executeExtension({ function: { name: 'analyze_csv', arguments: JSON.stringify({ csv }) } });
  const result = await call('name,amount\r\n"Ali, A",10\r\nSara,20\r\n');
  assert.equal(result.rows, 2); assert.equal(result.columns[1].mean, 15); assert.equal(result.sample[0][0], 'Ali, A');
  await assert.rejects(call('a,b\n1'), /match/); await assert.rejects(call('a\n"open'), /quote/);
});
test('GitHub connector permits only audited read endpoints and reports genuine failures', async () => {
  const extensions = load('../src/lib/extensions.ts');
  const call = args => ({ function: { name: 'github_read', arguments: JSON.stringify(args) } });
  const args = { owner: 'octocat', repo: 'Hello-World', resource: 'repository', path: '' };
  let url;
  const result = await extensions.executeExtension(call(args), undefined, async (target, init) => { url = target; assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, undefined); return new Response(JSON.stringify({ full_name: 'octocat/Hello-World', html_url: 'https://github.com/octocat/Hello-World' })); });
  assert.equal(url, 'https://api.github.com/repos/octocat/Hello-World'); assert.equal(result.repository.name, 'octocat/Hello-World');
  await assert.rejects(extensions.executeExtension(call({ ...args, owner: 'http://evil' })), /Invalid/);
  await assert.rejects(extensions.executeExtension(call({ ...args, resource: 'file', path: '../secret' })), /Invalid/);
  await assert.rejects(extensions.executeExtension(call(args), undefined, async () => new Response('', { status: 403 })), /rate limit/);
});
