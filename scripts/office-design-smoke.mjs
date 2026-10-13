// Generate representative files with the same engine used by all Nova clients.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
const require = createRequire(import.meta.url), module = { exports: {} };
const source = ts.transpileModule(readFileSync(new URL('../src/lib/office-plugins.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
vm.runInNewContext(source, { module, exports: module.exports, require, Uint8Array, Blob, btoa, Error });
const output = path.resolve(process.argv[2] || 'office-smoke-output');
mkdirSync(output, { recursive: true });
const slide = (layout, title, extra = {}) => ({ layout, title, bullets: [], notes: 'Design validation only. Figures are synthetic demonstration data.', ...extra });
const slides = [
  slide('cover', 'A clearer story, a better decision', { eyebrow: 'NOVA DESIGN STUDIO', bullets: ['Editable evidence. Deliberate typography. Purposeful composition.'] }),
  slide('chart', 'Demonstration: results by category', { chart: { type: 'bar', labels: ['Alpha', 'Beta', 'Gamma'], series: [{ name: 'Sample count', values: [12, 28, 19] }], unit: 'Synthetic sample count' }, source: 'Synthetic demonstration data · not business results' }),
  slide('comparison', 'Two approaches to the same problem', { columns: [{ title: 'Focused pilot', items: ['Small initial scope', 'Quick feedback', 'Reversible investment'] }, { title: 'Full rollout', items: ['Broader reach', 'More dependencies', 'Higher upfront effort'] }] }),
  slide('timeline', 'From evidence to delivery', { steps: [{ label: '01', title: 'Discover', detail: 'Clarify the actual problem' }, { label: '02', title: 'Design', detail: 'Choose a useful structure' }, { label: '03', title: 'Validate', detail: 'Check evidence and layout' }, { label: '04', title: 'Deliver', detail: 'An editable final file' }] }),
  slide('table', 'Evidence stays editable', { rows: [['Category', 'Count', 'Source'], ['Alpha', '12', 'Demonstration'], ['Beta', '28', 'Demonstration'], ['Gamma', '19', 'Demonstration']] }),
];
const requests = [
  ['create_powerpoint', { filename: 'nova-studio', title: 'Nova design studio', rtl: false, theme: { preset: 'studio' }, slides }],
  ['create_powerpoint', { filename: 'nova-editorial', title: 'Nova editorial', rtl: false, theme: { preset: 'editorial' }, slides }],
  ['create_powerpoint', { filename: 'nova-technical', title: 'Nova technical', rtl: false, theme: { preset: 'technical' }, slides }],
  ['create_word_document', { filename: 'nova-proposal', title: 'A proposal designed for decisions', paragraphs: [], rtl: false, layout: { preset: 'proposal', subtitle: 'Sample editorial hierarchy · demonstration only', header: 'Nova Design Studio', footer: 'Demonstration', marginCm: 2.2 }, blocks: [{ type: 'heading', level: 1, text: 'A clear purpose' }, { type: 'paragraph', text: 'A useful document starts with the reader. This sample demonstrates clear hierarchy, legible typography and purposeful formatting rather than a plain text export.' }, { type: 'callout', text: 'The key decision belongs in a visible, concise callout.' }, { type: 'heading', level: 2, text: 'Scope and deliverables' }, { type: 'bullets', items: ['An editable document with real heading styles', 'A coherent color and typography system', 'Tables that preserve their actual meaning'] }, { type: 'table', rows: [['Stage', 'Deliverable'], ['Discovery', 'A concise brief'], ['Design', 'An editable draft'], ['Validation', 'A checked final file']] }] }],
];
for (const [tool, args] of requests) {
  const result = await module.exports.createOfficeFile(tool, args);
  writeFileSync(path.join(output, result.filename), Buffer.from(result.__novaAttachment.url.split(',')[1], 'base64'));
}
console.log(output);
