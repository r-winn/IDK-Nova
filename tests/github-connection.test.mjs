import { loadBrowserStorage } from './helpers/client-storage.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
test('Mac GitHub credentials persist locally without any system vault calls', async () => {
  const module = { exports: {} }, stored = new Map();
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/github-connection.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fetcher = async () => ({ ok: true, json: async () => ({ login: 'test-account' }) });
  vm.runInNewContext(code, { module, exports: module.exports, navigator: { platform: 'MacIntel' }, URL, Headers, AbortSignal, Error, fetch: fetcher, localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) }, require: name => name === './client-storage' ? loadBrowserStorage({ localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } }) : name === '@tauri-apps/api/core' ? { isTauri: () => true, invoke: () => assert.fail('Mac must not use the vault') } : name === './secrets' ? { registerSecrets: () => {} } : { fetch: fetcher } });
  await module.exports.connectGithub('test-mac-token');
  assert.equal(stored.get('nova-github-token-local'), 'test-mac-token');
  await module.exports.disconnectGithub(); assert.equal(stored.has('nova-github-token-local'), false);
});
test('GitHub session credentials never persist on web or leave the read-only API host', async () => {
  const module = { exports: {} }, calls = [], stored = new Map();
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/github-connection.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fetcher = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ login: 'test-account' }) }; };
  vm.runInNewContext(code, { module, exports: module.exports, URL, Headers, AbortSignal, Error, fetch: fetcher, localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) }, require: name => name === './client-storage' ? loadBrowserStorage({ localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } }) : name === '@tauri-apps/api/core' ? { isTauri: () => false } : name === './secrets' ? { registerSecrets: () => {} } : { fetch: fetcher } });
  const api = module.exports;
  await api.connectGithub('test-token-12345'); assert.equal(api.githubLogin(), 'test-account'); assert.equal(stored.size, 0);
  await api.githubFetch('https://api.github.com/repos/test/repo'); assert.equal(calls.at(-1).init.headers.get('Authorization'), 'Bearer test-token-12345');
  await assert.rejects(api.githubFetch('https://evil.test/')); await assert.rejects(api.githubFetch('https://api.github.com/repos/test/repo', { method: 'POST' })); assert.equal(calls.length, 2);
  await api.disconnectGithub(); await api.githubFetch('https://api.github.com/repos/test/repo'); assert.equal(calls.at(-1).init.headers.get('Authorization'), null);
});
