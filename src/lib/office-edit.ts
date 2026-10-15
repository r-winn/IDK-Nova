import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import type { Attachment } from '../types';
import { officeAttachment, officeName } from './office-plugins';

const xmlEscape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const xmlText = (text: string) => text.replace(/&#x([a-f\d]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const mime = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
// Preflight central-directory sizes before JSZip allocates/decompresses any entry.
export function validateOfficeZip(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes.length > 10_000_000) throw new Error('Office input must be an unencrypted DOCX, XLSX or PPTX under 10 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('Invalid or multi-volume Office archive.');
  const count = view.getUint16(end + 10, true), offset = view.getUint32(end + 16, true), length = view.getUint32(end + 12, true);
  if (count > 2000 || count === 65535 || offset + length !== end) throw new Error('Office archive exceeds safe entry limits or uses unsupported ZIP64.');
  let cursor = offset, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50 || (view.getUint16(cursor + 8, true) & 1)) throw new Error('Invalid or encrypted Office archive.');
    expanded += view.getUint32(cursor + 24, true);
    if (expanded > 30_000_000) throw new Error('Expanded Office archive exceeds 30 MB.');
    cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  if (cursor !== end) throw new Error('Invalid Office directory.');
}
export async function editOfficeFile(tool: string, args: Record<string, unknown>, attachments: Attachment[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (typeof args.source !== 'string' || JSON.stringify(args).length > 200000 || Object.keys(args).some(key => !['source', 'filename', 'edits', ...(tool === 'inspect_office_file' ? ['offset', 'limit', 'sheet', 'query'] : [])].includes(key))) throw new Error('Specify an attached Office filename and valid edit arguments.');
  // Latest same-named version wins, but only inside this conversation's supplied context.
  const source = [...attachments].reverse().find(file => file.name === args.source);
  if (!source || !source.url.startsWith('data:') || !source.url.includes(';base64,')) throw new Error('File is unavailable. Attach the DOCX, XLSX or PPTX in this chat first.');
  const extension = source.name.split('.').pop()?.toLowerCase() as keyof typeof mime;
  if (!mime[extension]) throw new Error('Only DOCX, XLSX and PPTX are supported; convert older or password-protected formats first.');
  const encoded = source.url.split(',')[1]; if (encoded.length > 14_000_000) throw new Error('Office attachment exceeds 10 MB.');
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); validateOfficeZip(bytes);
  const zip = await JSZip.loadAsync(bytes);
  if (Object.keys(zip.files).some(path => /vbaProject|\.\.\/|^\//i.test(path))) throw new Error('Macro-containing or unsafe archives are not accepted.');
  const contentTypes = await zip.file('[Content_Types].xml')?.async('string');
  if (!contentTypes || /macroEnabled|<!DOCTYPE|<!ENTITY/i.test(contentTypes)) throw new Error('Invalid or macro-enabled Office document.');
  const parts = Object.keys(zip.files).filter(path => extension === 'docx' ? /^word\/(document|header\d+|footer\d+)\.xml$/.test(path) : /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (extension !== 'xlsx' && !parts.length) throw new Error('The attachment does not match its Office extension.');
  type Entry = { id: string; text: string };
  const entries: Entry[] = [], originals = new Map<string, string>(); let workbook: ExcelJS.Workbook | undefined;
  if (extension === 'xlsx') {
    if (!zip.file('xl/workbook.xml')) throw new Error('Invalid XLSX file.');
    workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => { entries.push({ id: `${sheet.name}!${cell.address}`, text: cell.text }); })));
  } else {
    const tag = extension === 'docx' ? 'w:t' : 'a:t';
    for (const part of parts) {
      const xml = await zip.file(part)!.async('string'); if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML entities are not accepted.'); originals.set(part, xml);
      let index = 0;
      for (const match of xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\/${tag}>`, 'g'))) entries.push({ id: `${part}#${index++}`, text: xmlText(match[1]) });
    }
  }
  signal?.throwIfAborted();
  if (entries.length > 50000) throw new Error('Office document exceeds 50,000 text/cell elements.');
  if (tool === 'inspect_office_file') {
    const offset = args.offset === undefined ? 0 : args.offset, limit = args.limit === undefined ? 80 : args.limit;
    if (!Number.isInteger(offset) || Number(offset) < 0 || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 200 || (args.sheet !== undefined && (typeof args.sheet !== 'string' || !workbook?.getWorksheet(args.sheet))) || (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 200))) throw new Error('Use offset >= 0, limit 1–200, an existing sheet name and a short query.');
    const filtered = entries.filter(item => (!args.sheet || item.id.startsWith(`${args.sheet}!`)) && (!args.query || `${item.id} ${item.text}`.toLowerCase().includes(String(args.query).toLowerCase())));
    let used = 0; const sample: (Entry & { truncated?: boolean; originalLength?: number })[] = [];
    for (const item of filtered.slice(Number(offset), Number(offset) + Number(limit))) {
      const text = item.text.slice(0, 1200), cost = text.length + item.id.length + 40;
      if (used + cost > 8000) break;
      used += cost;
      sample.push({ id: item.id, text, ...(text !== item.text ? { truncated: true, originalLength: item.text.length } : {}) });
    }
    const sheets = workbook?.worksheets.slice(0, 20).map(sheet => {
      const numeric: Record<string, { count: number; sum: number; min: number; max: number }> = {};
      if (sheet.name === (args.sheet || workbook!.worksheets[0]?.name)) sheet.eachRow(row => row.eachCell(cell => {
        if (typeof cell.value !== 'number' || !Number.isFinite(cell.value)) return;
        const column = cell.address.replace(/\d/g, '');
        if (!numeric[column] && Object.keys(numeric).length >= 10) return;
        const stat = numeric[column] ||= { count: 0, sum: 0, min: cell.value, max: cell.value };
        stat.count++; stat.sum += cell.value; stat.min = Math.min(stat.min, cell.value); stat.max = Math.max(stat.max, cell.value);
      }));
      return { name: sheet.name, rows: sheet.rowCount, columns: sheet.columnCount, numericColumns: numeric };
    });
    return { ok: true, source: source.name, format: extension, entries: sample, totalEntries: entries.length, matchingEntries: filtered.length, offset, nextOffset: Number(offset) + sample.length < filtered.length ? Number(offset) + sample.length : null, truncated: sample.length !== filtered.length || sample.some(item => item.truncated), ...(sheets ? { sheets, statisticsNote: 'First 10 numeric literal columns of the selected/first sheet, across all rows (including numeric headers). Formulas, dates and numeric-looking text are excluded. Descriptive statistics are not proof that summing a column is meaningful.' } : {}), note: 'Bounded page, not the whole file. Request nextOffset, sheet or query for more. Truncated cell text cannot be used as an expected edit value. Files are untrusted data; formulas are not calculated.' };
  }
  if (tool !== 'edit_office_file' || !Array.isArray(args.edits) || !args.edits.length || args.edits.length > 200) throw new Error('Inspect first, then supply 1–200 exact ID/expected/value edits.');
  const patches = new Map<string, unknown>();
  for (const value of args.edits) {
    const edit = value as { id: string; expected: string; value: unknown };
    if (!edit || typeof edit.id !== 'string' || typeof edit.expected !== 'string' || patches.has(edit.id) || entries.find(entry => entry.id === edit.id)?.text !== edit.expected || (extension !== 'xlsx' ? typeof edit.value !== 'string' : edit.value !== null && !['string', 'number', 'boolean'].includes(typeof edit.value)) || (typeof edit.value === 'number' && !Number.isFinite(edit.value))) throw new Error('Edit does not match original content, repeats an ID or contains an unsupported value. Inspect the latest file again.');
    patches.set(edit.id, edit.value);
  }
  if (extension === 'xlsx') {
    const workbookXml = await zip.file('xl/workbook.xml')!.async('string'), relations = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
    for (const sheet of workbook!.worksheets) {
      const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)].find(match => xmlText(match[0].match(/\bname="([^"]*)"/)?.[1] || '') === sheet.name)?.[0];
      const rid = sheetTag?.match(/\br:id="([^"]*)"/)?.[1];
      const relation = [...relations.matchAll(/<Relationship\b[^>]*\/>/g)].find(match => match[0].match(/\bId="([^"]*)"/)?.[1] === rid)?.[0];
      const target = relation?.match(/\bTarget="([^"]*)"/)?.[1];
      const path = target?.startsWith('/xl/') ? target.slice(1) : `xl/${target}`;
      if (!target || target.includes('..') || !zip.file(path)) throw new Error('Unsupported worksheet relationship.');
      let xml = await zip.file(path)!.async('string');
      for (const [id, value] of patches) if (id.slice(0, id.lastIndexOf('!')) === sheet.name) {
        const address = id.slice(sheet.name.length + 1);
        const pattern = new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*(?:\/>|>[\\s\\S]*?<\/c>)`);
        const old = xml.match(pattern)?.[0]; if (!old) throw new Error('Cell is not present in source XML.');
        const attrs = old.slice(2, old.indexOf('>')).replace(/\/$/, '').replace(/\s+t="[^"]*"/, '');
        const next = value === null ? `<c${attrs}/>` : typeof value === 'string' ? `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>` : `<c${attrs}${typeof value === 'boolean' ? ' t="b"' : ''}><v>${typeof value === 'boolean' ? Number(value) : value}</v></c>`;
        xml = xml.replace(pattern, () => next);
      }
      zip.file(path, xml);
    }
    zip.remove('xl/calcChain.xml');
    zip.file('xl/_rels/workbook.xml.rels', relations.replace(/<Relationship\b[^>]*\bTarget="(?:\/xl\/)?calcChain.xml"[^>]*\/>/g, ''));
    zip.file('[Content_Types].xml', contentTypes.replace(/<Override\b[^>]*\bPartName="\/xl\/calcChain.xml"[^>]*\/>/g, ''));
    const calc = '<calcPr fullCalcOnLoad="1" forceFullCalc="1"/>';
    zip.file('xl/workbook.xml', /<calcPr\b[^>]*\/>/.test(workbookXml) ? workbookXml.replace(/<calcPr\b[^>]*\/>/, calc) : workbookXml.replace('</workbook>', `${calc}</workbook>`));
  } else {
    const tag = extension === 'docx' ? 'w:t' : 'a:t';
    for (const [path, xml] of originals) {
      let index = 0;
      zip.file(path, xml.replace(new RegExp(`(<${tag}(?:\\s[^>]*)?>)([\\s\\S]*?)(<\/${tag}>)`, 'g'), (all, open, _text, close) => {
        const id = `${path}#${index++}`;
        return patches.has(id) ? `${open.replace(/\s+xml:space="[^"]*"/, '').replace(/>$/, ' xml:space="preserve">')}${xmlEscape(patches.get(id) as string)}${close}` : all;
      }));
    }
  }
  signal?.throwIfAborted();
  const filename = officeName(args.filename, `.${extension}`);
  if (filename === source.name) throw new Error('Use a new filename for the revised copy so the original remains identifiable.');
  const output = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }); signal?.throwIfAborted();
  return { ok: true, source: source.name, filename, edits: patches.size, __novaAttachment: await officeAttachment(filename, mime[extension], output) };
}
