import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/chat-deletion.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports });
const { chatsAfterDeletion } = module.exports;
const conversation = (id, workspaceId) => ({ id, title: 'Test', messages: [{ role: 'user', content: 'Hello' }], workspaceId });
test('Deleting the last real conversation ignores empty Work drafts and starts normal chat', () => {
  const original = [conversation(10, 'work'), { ...conversation(11, 'work'), messages: [] }];
  const result = chatsAfterDeletion(original, 10, 10, 99);
  assert.equal(result.active, 99);
  assert.equal(result.chats.length, 1);
  assert.equal(result.chats[0].workspaceId, undefined);
  assert.equal(result.workspaceId, null);
  assert.equal(result.resetNavigation, true);
  assert.equal(original.length, 2);
});
test('Deleting a Work conversation still retains its Work context when other history exists', () => {
  const result = chatsAfterDeletion([conversation(10, 'work'), conversation(20)], 10, 10, 99);
  assert.equal(result.workspaceId, 'work');
  assert.equal(result.chats[0].workspaceId, 'work');
  assert.equal(result.active, 99);
  assert.equal(result.resetNavigation, false);
  const existing = chatsAfterDeletion([conversation(10, 'work'), conversation(12, 'work')], 10, 10, 99);
  assert.equal(existing.active, 12);
});
