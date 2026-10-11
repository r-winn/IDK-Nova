import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun, Header, Footer, Table, TableRow, TableCell, WidthType, PageNumber } from 'docx';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import type { Attachment } from '../types';

const checkedName = (value: unknown, extension: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\\/:*?"<>|\x00-\x1f]/.test(value)) throw new Error('Use a simple filename without folder paths.');
  return value.replace(/\.(docx|xlsx|pptx)$/i, '') + extension;
};
async function attachment(name: string, type: string, bytes: Uint8Array): Promise<Attachment> {
  if (bytes.length > 10_000_000) throw new Error('Generated Office file exceeds 10 MB.');
  let binary = '';
  for (let start = 0; start < bytes.length; start += 16000) binary += String.fromCharCode(...bytes.subarray(start, start + 16000));
  return { name, type, url: `data:${type};base64,${btoa(binary)}` };
}
export { attachment as officeAttachment, checkedName as officeName };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const color = (value: unknown, fallback: string) => typeof value === 'string' && /^[A-Fa-f0-9]{6}$/.test(value) ? value : fallback;
const size = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
export async function createOfficeFile(tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (tool === 'create_word_document') {
    if (Object.keys(args).some(key => !['filename', 'title', 'paragraphs', 'rtl', 'layout', 'blocks'].includes(key)) || typeof args.title !== 'string' || args.title.length > 200 || typeof args.rtl !== 'boolean' || !Array.isArray(args.paragraphs) || args.paragraphs.length > 500 || args.paragraphs.some(text => typeof text !== 'string') || (!args.paragraphs.length && !Array.isArray(args.blocks)) || JSON.stringify(args).length > 150000) throw new Error('Supply a title, paragraphs or formatted blocks and an RTL flag within 150 KB.');
    const name = checkedName(args.filename, '.docx');
    const rtl = args.rtl, layout = record(args.layout), font = typeof layout.font === 'string' && layout.font.length <= 50 ? layout.font : 'Arial';
    const fontSize = size(layout.fontSize, 12, 8, 36), accent = color(layout.accent, '355B70');
    const paragraph = (text: string, heading = false, options: Record<string, unknown> = {}) => new Paragraph({
      bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      ...(heading ? { heading: options.level === 2 ? HeadingLevel.HEADING_2 : options.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.TITLE } : {}), spacing: { after: 180, line: 300 },
      pageBreakBefore: options.pageBreak === true, keepNext: heading,
      children: [new TextRun({ text, rightToLeft: rtl, font, size: 2 * size(options.fontSize, heading ? 22 : fontSize, 8, 48), bold: heading || options.bold === true, italics: options.italic === true, color: color(options.color, heading ? accent : '222222') })],
    });
    const children: (Paragraph | Table)[] = [paragraph(args.title, true), ...args.paragraphs.map(text => paragraph(text as string))];
    if (args.blocks !== undefined && args.blocks !== null) {
      if (!Array.isArray(args.blocks) || args.blocks.length > 500) throw new Error('Use at most 500 document blocks.');
      for (const item of args.blocks) {
        const block = record(item);
        if (block.type === 'table') {
          if (!Array.isArray(block.rows) || !block.rows.length || block.rows.length > 100 || block.rows.some(row => !Array.isArray(row) || !row.length || row.length > 12 || row.some(cell => typeof cell !== 'string'))) throw new Error('Tables require 1–100 rows, 1–12 plain text cells per row.');
          children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: block.rows.map((row, index) => new TableRow({ tableHeader: index === 0, children: (row as string[]).map(text => new TableCell({ shading: index === 0 ? { fill: accent } : undefined, children: [paragraph(text, false, index === 0 ? { bold: true, color: 'FFFFFF' } : {})] })) })) }));
        } else if (block.type === 'pageBreak') children.push(new Paragraph({ pageBreakBefore: true }));
        else if (['heading', 'paragraph'].includes(String(block.type)) && typeof block.text === 'string') children.push(paragraph(block.text, block.type === 'heading', block));
        else throw new Error('Unknown document block. Use heading, paragraph, table or pageBreak.');
      }
    }
    const header = typeof layout.header === 'string' ? layout.header.slice(0, 200) : '';
    const footer = typeof layout.footer === 'string' ? layout.footer.slice(0, 200) : '';
    const document = new Document({ creator: 'Nova', title: args.title, sections: [{ properties: { page: { size: { width: layout.landscape ? 16838 : 11906, height: layout.landscape ? 11906 : 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, headers: { default: new Header({ children: [paragraph(header)] }) }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: footer ? `${footer} · ` : '', font, size: 18 }), new TextRun({ children: [PageNumber.CURRENT] })] })] }) }, children }] });
    const bytes = new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer());
    signal?.throwIfAborted();
    return { ok: true, filename: name, paragraphs: args.paragraphs.length, blocks: Array.isArray(args.blocks) ? args.blocks.length : 0, __novaAttachment: await attachment(name, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes) };
  }
  if (tool === 'create_powerpoint') {
    if (Object.keys(args).some(key => !['filename', 'title', 'slides', 'rtl', 'theme'].includes(key)) || typeof args.title !== 'string' || args.title.length > 200 || typeof args.rtl !== 'boolean' || !Array.isArray(args.slides) || !args.slides.length || args.slides.length > 40 || JSON.stringify(args).length > 200000) throw new Error('Supply 1–40 slides, a title and RTL flag within 200 KB.');
    const name = checkedName(args.filename, '.pptx'), theme = record(args.theme), deck = new PptxGenJS();
    deck.layout = 'LAYOUT_WIDE'; deck.title = args.title; deck.author = 'Nova'; deck.subject = args.title;
    const background = color(theme.background, 'F6F8FA'), foreground = color(theme.foreground, '18242D'), accent = color(theme.accent, '355B70');
    const fontFace = typeof theme.font === 'string' && theme.font.length <= 50 ? theme.font : 'Arial';
    deck.theme = { headFontFace: fontFace, bodyFontFace: fontFace };
    for (const [index, item] of args.slides.entries()) {
      const spec = record(item);
      if (typeof spec.title !== 'string' || spec.title.length > 160 || !Array.isArray(spec.bullets) || spec.bullets.length > 8 || spec.bullets.some(text => typeof text !== 'string' || text.length > 350) || (spec.notes !== undefined && typeof spec.notes !== 'string')) throw new Error('Each slide needs a title, up to 8 concise bullet points and optional notes.');
      const slide = deck.addSlide(); slide.background = { color: background };
      slide.addShape(deck.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.12, fill: { color: accent }, line: { color: accent } });
      slide.addText(spec.title, { x: 0.7, y: 0.55, w: 11.9, h: 1, fontFace, fontSize: 30, bold: true, color: accent, align: args.rtl ? 'right' : 'left', rtlMode: args.rtl, breakLine: false, fit: 'shrink' });
      slide.addText((spec.bullets as string[]).map(text => ({ text, options: { bullet: { indent: 22 }, breakLine: true } })), { x: 0.8, y: 1.85, w: 11.7, h: 4.75, fontFace, fontSize: 22, color: foreground, paraSpaceAfter: 18, valign: 'top', align: args.rtl ? 'right' : 'left', rtlMode: args.rtl, fit: 'shrink' });
      slide.addText(`${args.title} · ${index + 1}`, { x: 0.7, y: 7.05, w: 11.9, h: 0.25, fontSize: 10, color: foreground, align: args.rtl ? 'right' : 'left', rtlMode: args.rtl });
      if (spec.notes) slide.addNotes(spec.notes as string);
    }
    const bytes = new Uint8Array(await deck.write({ outputType: 'arraybuffer' }) as ArrayBuffer); signal?.throwIfAborted();
    return { ok: true, filename: name, slides: args.slides.length, __novaAttachment: await attachment(name, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes) };
  }
  if (tool === 'create_excel_workbook') {
    if (Object.keys(args).some(key => !['filename', 'sheets'].includes(key)) || !Array.isArray(args.sheets) || !args.sheets.length || args.sheets.length > 10 || JSON.stringify(args).length > 400000) throw new Error('Supply 1–10 sheets within 400 KB.');
    const name = checkedName(args.filename, '.xlsx'), workbook = new ExcelJS.Workbook();
    workbook.creator = 'Nova'; const names = new Set<string>(); let cells = 0;
    for (const value of args.sheets) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid sheet.');
      const sheet = value as Record<string, unknown>;
      if (Object.keys(sheet).some(key => !['name', 'rows'].includes(key)) || typeof sheet.name !== 'string' || !sheet.name.trim() || sheet.name.length > 31 || /[\\/*?:\[\]]/.test(sheet.name) || names.has(sheet.name.toLowerCase()) || !Array.isArray(sheet.rows) || !sheet.rows.length || sheet.rows.length > 2000) throw new Error('Use unique sheet names and 1–2000 rows per sheet.');
      names.add(sheet.name.toLowerCase());
      const worksheet = workbook.addWorksheet(sheet.name);
      for (const row of sheet.rows) {
        if (!Array.isArray(row) || row.length > 100 || row.some(cell => cell !== null && typeof cell !== 'string' && typeof cell !== 'boolean' && (typeof cell !== 'number' || !Number.isFinite(cell)))) throw new Error('Cells must be plain text, finite numbers, booleans or null. Formula/code objects are not accepted.');
        cells += row.length; if (cells > 20000) throw new Error('Workbook exceeds 20,000 cells.');
        worksheet.addRow(row);
      }
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF355B70' } };
      worksheet.columns.forEach(column => { column.width = 22; });
      worksheet.eachRow(row => { row.alignment = { vertical: 'middle', wrapText: true }; });
    }
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer()); signal?.throwIfAborted();
    return { ok: true, filename: name, sheets: workbook.worksheets.length, cells, __novaAttachment: await attachment(name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes) };
  }
  throw new Error('Unknown Office tool.');
}
