import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled = ts.transpileModule(readFileSync(new URL('../../src/lib/client-storage.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
export function loadBrowserStorage(globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, URL, Headers, Request, ...globals });
  return module.exports;
}
