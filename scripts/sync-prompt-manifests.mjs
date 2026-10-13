// Mechanical generation: the TypeScript catalog is the source of truth.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const module = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL('../src/lib/prompts.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(code, { module, exports: module.exports, require: name => name === '../agent/catalog' ? { NOVA_TOOLS: [] } : { extensionCatalog: [] } });
for (const pack of module.exports.promptPacks) {
  writeFileSync(new URL(`../public/packs/${pack.id}.json`, import.meta.url), JSON.stringify({ id: pack.id, version: '1.0', permissions: [], prompts: pack.prompts }) + '\n');
}
