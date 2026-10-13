import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const module = { exports: {} };
const source = ts.transpileModule(readFileSync(new URL('../src/lib/feature-availability.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(source, { module, exports: module.exports });
const { pluginAvailability, availablePluginIds } = module.exports;

test('Chrome automation requires both desktop and Work', () => {
  assert.equal(pluginAvailability('chrome', false, true).available, false);
  assert.equal(pluginAvailability('chrome', true, false).available, false);
  assert.equal(pluginAvailability('chrome', true, true).available, true);
});
test('Browser-capable plugins remain available and filtering preserves saved selections', () => {
  const selected = ['chrome', 'word', 'excel', 'powerpoint', 'github', 'pdf'];
  assert.deepEqual(Array.from(availablePluginIds(selected, false, false)), selected.slice(1));
  assert.equal(selected[0], 'chrome');
  assert.equal(selected.length, 6);
  assert.deepEqual(Array.from(availablePluginIds(selected, true, true)), selected);
});
