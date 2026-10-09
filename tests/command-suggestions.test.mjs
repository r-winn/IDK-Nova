import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/command-suggestions.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports });
const { mentionAt, suggestCommands } = module.exports;
test('Suggestions follow caret, filter each character and never match email addresses', () => {
  assert.equal(mentionAt('email@test', 10), null);
  assert.equal(mentionAt('سلام @ca', 8).query, 'ca');
  const options = [{ name: 'calculate' }, { name: 'fs_checkpoint' }, { name: 'analyze_text' }, { name: 'calculate' }];
  assert.equal(suggestCommands(options, 'cal').length, 1);
  assert.equal(suggestCommands(options, 'check')[0].name, 'fs_checkpoint');
  const mention = mentionAt('do @calculate now', 6);
  assert.equal(mention.start, 3); assert.equal(mention.end, 13);
  assert.equal(mentionAt('hello @', 7).query, '');
});
