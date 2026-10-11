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
const editing = { exports: {} };
const editCode = ts.transpileModule(readFileSync(new URL('../src/lib/office-edit.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
vm.runInNewContext(editCode, { module: editing, exports: editing.exports, require: name => name === './office-plugins' ? module.exports : require(name), Uint8Array, DataView, atob, Error });
const { editOfficeFile, validateOfficeZip } = editing.exports;
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
test('Word renders styled blocks, a real table, header/footer and page breaks', async () => {
  const result = await createOfficeFile('create_word_document', { filename: 'styled', title: 'Report', paragraphs: [], rtl: false, layout: { font: 'Arial', fontSize: 14, accent: '245B7A', header: 'Company', footer: 'Confidential', landscape: true }, blocks: [{ type: 'heading', text: 'Results', level: 1 }, { type: 'table', rows: [['Item', 'Count'], ['A', '5']] }, { type: 'pageBreak' }, { type: 'paragraph', text: 'Next page', fontSize: 16, bold: true }] });
  const zip = await require('jszip').loadAsync(bytes(result)), xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /w:tbl/); assert.match(xml, /w:pageBreakBefore/); assert.match(xml, /w:sz w:val="32"/);
  assert.match(await zip.file('word/header1.xml').async('string'), /Company/); assert.match(await zip.file('word/footer1.xml').async('string'), /Confidential/);
});
test('PPTX contains actual themed editable slides and speaker notes', async () => {
  const result = await createOfficeFile('create_powerpoint', { filename: 'deck', title: 'Presentation', rtl: true, theme: { accent: '245B7A' }, slides: [{ title: 'مقدمه', bullets: ['نکته اول', 'نکته دوم'], notes: 'Speaker detail' }, { title: 'نتیجه', bullets: ['Summary'], notes: '' }] });
  const zip = await require('jszip').loadAsync(bytes(result));
  assert.ok(zip.file('ppt/slides/slide2.xml')); assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /مقدمه/); assert.match(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string'), /Speaker detail/);
});
test('DOCX exact edits preserve unrelated formatting and reject stale/unknown sources', async () => {
  const original = await createOfficeFile('create_word_document', { filename: 'source', title: 'Title', paragraphs: ['Hello colleague'], rtl: false });
  const files = [original.__novaAttachment], inspected = await editOfficeFile('inspect_office_file', { source: 'source.docx' }, files);
  const entry = inspected.entries.find(entry => entry.text === 'Hello colleague');
  const revised = await editOfficeFile('edit_office_file', { source: 'source.docx', filename: 'revised', edits: [{ id: entry.id, expected: entry.text, value: 'Hello & welcome' }] }, files);
  const zip = await require('jszip').loadAsync(bytes(revised)); assert.match(await zip.file('word/document.xml').async('string'), /Hello &amp; welcome/);
  await assert.rejects(editOfficeFile('edit_office_file', { source: 'source.docx', filename: 'revised', edits: [{ id: entry.id, expected: 'stale', value: 'oops' }] }, files));
  await assert.rejects(editOfficeFile('inspect_office_file', { source: 'other.docx' }, files));
});
test('XLSX edits exact cells while preserving worksheet styles and unrelated package parts', async () => {
  const original = await createOfficeFile('create_excel_workbook', { filename: 'table', sheets: [{ name: 'Sales', rows: [['Item', 'Total'], ['A', 100]] }] });
  const zip = await require('jszip').loadAsync(bytes(original)); zip.file('xl/custom-proof.txt', 'untouched');
  original.__novaAttachment.url = original.__novaAttachment.url.split(',')[0] + ',' + (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
  const files = [original.__novaAttachment], inspected = await editOfficeFile('inspect_office_file', { source: 'table.xlsx' }, files);
  assert.ok(inspected.entries.some(entry => entry.id === 'Sales!B2' && entry.text === '100'));
  const revised = await editOfficeFile('edit_office_file', { source: 'table.xlsx', filename: 'table-revised', edits: [{ id: 'Sales!B2', expected: '100', value: 250 }] }, files);
  const workbook = new (require('exceljs').Workbook)(); await workbook.xlsx.load(bytes(revised)); assert.equal(workbook.getWorksheet('Sales').getCell('B2').value, 250); assert.equal(workbook.getWorksheet('Sales').getCell('A1').font.bold, true);
  const revisedZip = await require('jszip').loadAsync(bytes(revised)); assert.equal(await revisedZip.file('xl/custom-proof.txt').async('string'), 'untouched');
});
test('PPTX revisions preserve slide layout and validate archive expansion limits', async () => {
  const original = await createOfficeFile('create_powerpoint', { filename: 'slides', title: 'Title', rtl: false, slides: [{ title: 'Before', bullets: ['Bullet'], notes: '' }] });
  const files = [original.__novaAttachment], inspected = await editOfficeFile('inspect_office_file', { source: 'slides.pptx' }, files), entry = inspected.entries.find(entry => entry.text === 'Before');
  const revised = await editOfficeFile('edit_office_file', { source: 'slides.pptx', filename: 'slides-after', edits: [{ id: entry.id, expected: entry.text, value: 'After' }] }, files);
  const zip = await require('jszip').loadAsync(bytes(revised)); assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /After/); assert.ok(zip.file('ppt/slideMasters/slideMaster1.xml'));
  const bomb = new Uint8Array(bytes(original)); const view = new DataView(bomb.buffer); let offset = -1; for (let i = 0; i < bomb.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) { offset = i; break; } view.setUint32(offset + 24, 31_000_000, true); assert.throws(() => validateOfficeZip(bomb), /30 MB/);
});
