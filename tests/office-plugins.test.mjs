import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url), module = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL('../src/lib/office-plugins.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
vm.runInNewContext(code, { module, exports: module.exports, require, Uint8Array, Blob, btoa, Error });
const { createOfficeFile } = module.exports;
const bytes = result => Buffer.from(result.__novaAttachment.url.split(',')[1], 'base64');
test('Word generates a real DOCX containing Persian RTL paragraphs', async () => {
  const result = await createOfficeFile('create_word_document', { filename: 'letter', title: 'نامه', paragraphs: ['سلام همکار عزیز'], rtl: true });
  const zip = await require('jszip').loadAsync(bytes(result));
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /سلام همکار عزیز/); assert.match(xml, /w:bidi/); assert.equal(result.filename, 'letter.docx');
});
test('Excel generates actual multiple-sheet XLSX with typed values and literal formula-like text', async () => {
  const result = await createOfficeFile('create_excel_workbook', { filename: 'report', sheets: [{ name: 'Sales', rows: [['Name', 'Total'], ['Product', 125], ['=HYPERLINK("bad")', true]] }, { name: 'Notes', rows: [['سلام']] }] });
  const workbook = new (require('exceljs').Workbook)(); await workbook.xlsx.load(bytes(result));
  assert.equal(workbook.worksheets.length, 2); assert.equal(workbook.getWorksheet('Sales').getCell('B2').value, 125); assert.equal(typeof workbook.getWorksheet('Sales').getCell('A3').value, 'string');
  assert.equal(workbook.getWorksheet('Notes').getCell('A1').value, 'سلام');
});
test('Office rejects paths, macro/formula objects and cancelled work', async () => {
  await assert.rejects(createOfficeFile('create_word_document', { filename: '../bad', title: '', paragraphs: ['x'], rtl: false }));
  await assert.rejects(createOfficeFile('create_excel_workbook', { filename: 'bad', sheets: [{ name: 'test', rows: [[{ formula: '1+1' }]] }] }));
  await assert.rejects(createOfficeFile('create_word_document', {}, AbortSignal.abort()));
});
