// Optional live diagnostic. Only connects to local Ollama and executes an
// in-memory constant tool; no project files, credentials or user data are sent.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const module = { exports: {} }, bodies = [];
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 120000);
const localFetch = (url, options) => {
  if (!String(url).startsWith('http://127.0.0.1:11434/')) throw new Error('Diagnostic only permits local Ollama');
  const body = JSON.parse(options.body); bodies.push(body);
  return fetch(url, { ...options, body: JSON.stringify({ ...body, reasoning: { effort: 'none' } }) });
};
const code = ts.transpileModule(readFileSync(new URL('../src/lib/ai.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(code, { exports: module.exports, module, require: name => ({ '../types': { getActiveProvider: config => config.providers[0] }, '@tauri-apps/plugin-http': {}, '../agent/loop-watchdog': { AgentLoopWatchdog: class { observe() {} } }, './usage': { UsageTracker: class { text() {} report() {} finish() {} } } })[name], window: { fetch: localFetch }, location: { protocol: 'http:' }, URL, TextDecoder, DOMException, Error, performance, crypto });
const model = process.argv[2] || 'qwen3.5-9b-q4_k_m';
const officeMode = process.argv.includes('--powerpoint');
const require = createRequire(import.meta.url);
const officeModule = { exports: {} }, pluginModule = { exports: {} };
if (officeMode) {
  const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compile('../src/lib/office-plugins.ts'), { module: officeModule, exports: officeModule.exports, require, Uint8Array, Blob, btoa, Error });
  vm.runInNewContext(compile('../src/lib/extensions.ts'), { module: pluginModule, exports: pluginModule.exports, require, localStorage: { getItem: () => '["powerpoint"]' }, Error });
}
const config = { providers: [{ id: 'diagnostic-local', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', models: [model] }], activeModel: model, temperature: 0 };
let calls = 0, output = '', fileBytes = 0;
try {
  const tools = officeMode ? pluginModule.exports.extensionUse(['powerpoint']).tools.filter(tool => tool.function.name === 'create_powerpoint') : [{ type: 'function', function: { name: 'diagnostic_value', description: 'Returns an in-memory diagnostic value.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }];
  const prompt = officeMode ? 'Create a modern PowerPoint named local-smoke.pptx with exactly one cover slide titled Local tool test, one bullet reading A verified local file, notes reading Diagnostic only, rtl false and theme preset minimal. Use the actual file tool once, then acknowledge the filename in one sentence.' : 'Call diagnostic_value exactly once. Then report its returned value in one short sentence.';
  await module.exports.runAgentCompletion(config, [{ role: 'user', content: prompt }], 'This is a transport test. Do not invent results. Use the provided tool.', tools, async call => {
    calls++;
    if (!officeMode) return { ok: true, value: 42 };
    const { __novaAttachment, ...result } = await officeModule.exports.createOfficeFile(call.function.name, JSON.parse(call.function.arguments), controller.signal);
    const bytes = Buffer.from(__novaAttachment.url.split(',')[1], 'base64');
    const zip = await require('jszip').loadAsync(bytes);
    if (!zip.file('ppt/slides/slide1.xml') || zip.file('ppt/slides/slide2.xml')) throw new Error('Unexpected generated deck');
    fileBytes = bytes.length;
    return result;
  }, () => {}, token => output += token, controller.signal, undefined, undefined, true);
  if (calls !== 1 || !(officeMode ? fileBytes > 0 && output.trim() : output.includes('42')) || bodies.length < 2 || bodies.some(body => body.store !== false || body.previous_response_id)) throw new Error('The live tool continuation did not pass');
  console.log(JSON.stringify({ model, mode: officeMode ? 'powerpoint' : 'constant', calls, requests: bodies.length, fileBytes, result: output, passed: true }));
} finally { clearTimeout(timer); }
