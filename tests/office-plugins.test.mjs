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
const baseSlide = (layout, extra = {}) => ({ title: 'Verified demonstration', layout, bullets: [], notes: 'Demonstration values, not business results.', ...extra });
test('All eight art directions export actual distinct slide palettes', async () => {
  const palettes = new Set();
  for (const preset of ['minimal', 'midnight', 'editorial', 'executive', 'botanical', 'studio', 'technical', 'luxury']) {
    const result = await createOfficeFile('create_powerpoint', { filename: preset, title: 'Art direction', rtl: false, theme: { preset }, slides: [baseSlide('cover', { bullets: ['A deliberate visual direction'] })] });
    const zip = await require('jszip').loadAsync(bytes(result));
    const xml = await zip.file('ppt/slides/slide1.xml').async('string');
    palettes.add(/<p:bg>[\s\S]*?<a:srgbClr val="([A-Fa-f0-9]+)"/.exec(xml)?.[1]);
  }
  assert.equal(palettes.size, 8); assert.ok(!palettes.has(undefined));
});
test('Data layouts create editable chart data, table cells and ordered timelines', async () => {
  const result = await createOfficeFile('create_powerpoint', { filename: 'data-story', title: 'Data story', rtl: true, theme: { preset: 'executive' }, slides: [
    baseSlide('chart', { chart: { type: 'bar', labels: ['A', 'B'], series: [{ name: 'Observed', values: [10, 20] }], unit: 'People' }, source: 'Supplied demonstration dataset' }),
    baseSlide('table', { rows: [['Category', 'Count'], ['A', '10'], ['B', '20']] }),
    baseSlide('timeline', { steps: [{ label: 'Week 1', title: 'Review' }, { label: 'Week 2', title: 'Deliver' }] }),
    baseSlide('metrics', { metrics: [{ value: '30', label: 'Participants', detail: 'Provided count' }] }),
    baseSlide('comparison', { columns: [{ title: 'Option A', items: ['Lower effort'] }, { title: 'Option B', items: ['Broader scope'] }] }),
  ] });
  const zip = await require('jszip').loadAsync(bytes(result));
  assert.match(await zip.file('ppt/charts/chart1.xml').async('string'), /<c:v>20<\/c:v>/);
  assert.ok(Object.keys(zip.files).some(name => name.startsWith('ppt/embeddings/') && name.endsWith('.xlsx')));
  assert.match(await zip.file('ppt/slides/slide2.xml').async('string'), /<a:tbl>/);
  assert.match(await zip.file('ppt/slides/slide3.xml').async('string'), /Week 2/);
  assert.match(await zip.file('ppt/slides/slide4.xml').async('string'), /Participants/);
  assert.match(await zip.file('ppt/slides/slide5.xml').async('string'), /Option B/);
});
test('Presentation image layout embeds only an exact local attachment and rejects missing or remote images', async () => {
  const args = { filename: 'image-deck', title: 'Photo', rtl: false, slides: [baseSlide('image', { image: { source: 'photo.png', caption: 'Supplied image' } })] };
  await assert.rejects(createOfficeFile('create_powerpoint', args), /exact attached/);
  await assert.rejects(createOfficeFile('create_powerpoint', args, undefined, [{ name: 'photo.png', url: 'https://example.invalid/photo.png', type: 'image/png' }]), /exact attached/);
  const image = { name: 'photo.png', type: 'image/png', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=' };
  const result = await createOfficeFile('create_powerpoint', args, undefined, [image]);
  const zip = await require('jszip').loadAsync(bytes(result));
  assert.ok(Object.keys(zip.files).some(name => name.startsWith('ppt/media/') && name.endsWith('.png')));
});
test('Dense layouts and misleading chart inputs fail instead of silently creating illegible slides', async () => {
  const make = slide => createOfficeFile('create_powerpoint', { filename: 'bad', title: 'Bad', rtl: false, slides: [slide] });
  await assert.rejects(make(baseSlide('content', { bullets: Array(8).fill('A point') })), /too dense/);
  await assert.rejects(make(baseSlide('chart', { chart: { type: 'bar', labels: ['A'], series: [{ name: 'Count', values: [1, 2] }] } })), /matching label/);
  await assert.rejects(make(baseSlide('chart', { chart: { type: 'pie', labels: ['A'], series: [{ name: 'Count', values: [-1] }] } })), /non-negative/);
  await assert.rejects(make(baseSlide('comparison', { columns: [] })), /2–2/);
});
test('Word proposal and academic presets use real hierarchy, callouts, lists and margins', async () => {
  const result = await createOfficeFile('create_word_document', { filename: 'proposal', title: 'A clear proposal', paragraphs: [], rtl: true, layout: { preset: 'proposal', coverPage: true, marginCm: 2.5, headingFont: 'Arial' }, blocks: [{ type: 'heading', level: 3, text: 'Scope' }, { type: 'callout', text: 'Key decision' }, { type: 'bullets', items: ['First deliverable', 'Second deliverable'] }] });
  const zip = await require('jszip').loadAsync(bytes(result)), xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /Heading3/); assert.match(xml, /w:numPr/); assert.match(xml, /w:shd/); assert.match(xml, /w:top="1418"/); assert.match(xml, /3F7252/);
});
test('Excel styling is functional: filter, adaptive widths, frozen rows and RTL view', async () => {
  const result = await createOfficeFile('create_excel_workbook', { filename: 'styled-sheet', style: { accent: '3F7252', rtl: true }, sheets: [{ name: 'Results', rows: [['A longer descriptive column heading', 'Count'], ['Entry', 12]] }] });
  const workbook = new (require('exceljs').Workbook)(); await workbook.xlsx.load(bytes(result));
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.views[0].rightToLeft, true); assert.equal(sheet.views[0].ySplit, 1);
  assert.ok(sheet.autoFilter); assert.ok(sheet.getColumn(1).width > sheet.getColumn(2).width);
  assert.equal(sheet.getCell('A1').fill.fgColor.argb, 'FF3F7252');
});
const bytes = result => Buffer.from(result.__novaAttachment.url.split(',')[1], 'base64');
const editing = { exports: {} };
const editCode = ts.transpileModule(readFileSync(new URL('../src/lib/office-edit.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
vm.runInNewContext(editCode, { module: editing, exports: editing.exports, require: name => name === './office-plugins' ? module.exports : require(name), Uint8Array, DataView, atob, Error });
const { editOfficeFile, validateOfficeZip } = editing.exports;
test('Large spreadsheet inspections are paginated and numeric summaries use actual values', async () => {
  const result = await createOfficeFile('create_excel_workbook', { filename: 'large', sheets: [{ name: 'Sales', rows: [['Description', 'Value'], ...Array.from({ length: 600 }, (_, i) => [`Line ${i} ${'details '.repeat(20)}`, i + 1])] }] });
  const files = [result.__novaAttachment];
  const first = await editOfficeFile('inspect_office_file', { source: 'large.xlsx' }, files);
  assert.ok(first.entries.length <= 80); assert.ok(JSON.stringify(first).length < 14000); assert.ok(first.nextOffset > 0);
  assert.equal(first.sheets[0].numericColumns.B.sum, 600 * 601 / 2);
  const next = await editOfficeFile('inspect_office_file', { source: 'large.xlsx', offset: first.nextOffset, sheet: 'Sales', limit: 10 }, files);
  assert.notEqual(next.entries[0].id, first.entries[0].id);
  const found = await editOfficeFile('inspect_office_file', { source: 'large.xlsx', query: 'Line 599' }, files);
  assert.equal(found.entries.length, 1); assert.match(found.entries[0].text, /Line 599/);
  await assert.rejects(editOfficeFile('inspect_office_file', { source: 'large.xlsx', offset: -1 }, files), /offset/);
});
const preview = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/office-preview.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { module: preview, exports: preview.exports, require: name => name === './office-edit' ? editing.exports : name === './office-format' ? {} : require(name), Uint8Array, atob, Error });
const archive = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/file-tools.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { module: archive, exports: archive.exports, require: name => name === './office-plugins' ? module.exports : require(name), Uint8Array, atob, Error });
test('Modern slides have actual cover typography, dark colors and card geometry', async () => {
  const result = await createOfficeFile('create_powerpoint', { filename: 'modern', title: 'Studio', rtl: false, theme: { preset: 'midnight' }, slides: [{ title: 'Ideas into impact', bullets: ['One clear message'], layout: 'cover', notes: '' }, { title: 'Principles', bullets: ['Hierarchy', 'Whitespace', 'Clarity', 'Consistency'], layout: 'cards', notes: '' }] });
  const zip = await require('jszip').loadAsync(bytes(result));
  const cover = await zip.file('ppt/slides/slide1.xml').async('string'), cards = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(cover, /152A36/); assert.match(cover, /sz="4200"/); assert.match(cards, /Consistency/); assert.ok((cards.match(/<p:sp>/g) || []).length >= 12);
});
test('Office preview strips external relationships and extracts actual styled sheet cells', async () => {
  const result = await createOfficeFile('create_excel_workbook', { filename: 'preview', sheets: [{ name: 'Results', rows: [['Count'], [42]] }] });
  const zip = await require('jszip').loadAsync(bytes(result));
  zip.file('xl/_rels/external.xml.rels', '<Relationships><Relationship TargetMode="External" Target="https://example.invalid"/><Relationship TargetMode=\'External\' Target=\'https://example.invalid\'/></Relationships>');
  const encoded = 'data:application/zip;base64,' + (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
  const clean = await preview.exports.officePackage(encoded);
  assert.doesNotMatch(await clean.zip.file('xl/_rels/external.xml.rels').async('string'), /example.invalid/);
  const sheets = await preview.exports.spreadsheetPreview(bytes(result));
  assert.equal(sheets[0].name, 'Results'); assert.equal(sheets[0].rows[1][0].text, '42'); assert.equal(sheets[0].rows[0][0].bold, true);
});
test('Archive plugin packages only exact real chat attachments and rejects unsafe paths', async () => {
  const files = [{ name: 'notes.txt', url: 'data:text/plain;base64,' + Buffer.from('Actual notes').toString('base64') }];
  const result = await archive.exports.createArchive({ filename: 'delivery', files: ['notes.txt'] }, files);
  const zip = await require('jszip').loadAsync(bytes(result)); assert.equal(await zip.file('notes.txt').async('string'), 'Actual notes');
  await assert.rejects(archive.exports.createArchive({ filename: 'delivery', files: ['../secret'] }, files), /paths/);
  await assert.rejects(archive.exports.createArchive({ filename: 'delivery', files: ['missing.txt'] }, files), /Attach/);
});
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
