import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun, Header, Footer, Table, TableRow, TableCell, WidthType, PageNumber } from 'docx';
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
    const rtl = args.rtl, layout = record(args.layout), font = typeof layout.font === 'string' && layout.font.length <= 50 ? layout.font : layout.preset === 'editorial' ? 'Georgia' : 'Arial';
    const fontSize = size(layout.fontSize, 11, 8, 36), accent = color(layout.accent, layout.preset === 'editorial' ? '76523D' : '245B7A');
    const paragraph = (text: string, heading = false, options: Record<string, unknown> = {}) => new Paragraph({
      bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      ...(heading ? { heading: options.level === 2 ? HeadingLevel.HEADING_2 : options.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.TITLE } : {}), spacing: { before: heading && options.level ? 280 : 0, after: heading ? 240 : 180, line: 320 },
      pageBreakBefore: options.pageBreak === true, keepNext: heading,
      children: [new TextRun({ text, rightToLeft: rtl, font, size: 2 * size(options.fontSize, heading ? options.level === 2 ? 14 : options.level === 1 ? 18 : 32 : fontSize, 8, 48), bold: heading || options.bold === true, italics: options.italic === true, color: color(options.color, heading ? accent : '243342') })],
    });
    const children: (Paragraph | Table)[] = [paragraph(args.title, true)];
    if (typeof layout.subtitle === 'string' && layout.subtitle.trim()) children.push(paragraph(layout.subtitle.slice(0, 300), false, { fontSize: 14, color: accent }));
    children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: accent, space: 8 } }, spacing: { after: 320 } }), ...args.paragraphs.map(text => paragraph(text as string)));
    if (args.blocks !== undefined && args.blocks !== null) {
      if (!Array.isArray(args.blocks) || args.blocks.length > 500) throw new Error('Use at most 500 document blocks.');
      for (const item of args.blocks) {
        const block = record(item);
        if (block.type === 'table') {
          if (!Array.isArray(block.rows) || !block.rows.length || block.rows.length > 100 || block.rows.some(row => !Array.isArray(row) || !row.length || row.length > 12 || row.some(cell => typeof cell !== 'string'))) throw new Error('Tables require 1–100 rows, 1–12 plain text cells per row.');
          children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8EF' }, insideVertical: { style: BorderStyle.NONE } }, rows: block.rows.map((row, index) => new TableRow({ tableHeader: index === 0, children: (row as string[]).map(text => new TableCell({ margins: { top: 120, bottom: 120, left: 160, right: 160 }, shading: { fill: index === 0 ? accent : index % 2 ? 'F2F6FA' : 'FFFFFF' }, children: [paragraph(text, false, index === 0 ? { bold: true, color: 'FFFFFF' } : {})] })) })) }));
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
    const dark = theme.preset === 'midnight';
    const background = color(theme.background, dark ? '152A36' : 'F6F8FA'), foreground = color(theme.foreground, dark ? 'F3F7FA' : '18242D'), accent = color(theme.accent, dark ? '8FD6C8' : theme.preset === 'editorial' ? '9A6245' : '245B7A');
    const fontFace = typeof theme.font === 'string' && theme.font.length <= 50 ? theme.font : 'Arial';
    deck.theme = { headFontFace: fontFace, bodyFontFace: fontFace };
    for (const [index, item] of args.slides.entries()) {
      const spec = record(item);
      if (typeof spec.title !== 'string' || spec.title.length > 160 || !Array.isArray(spec.bullets) || spec.bullets.length > 8 || spec.bullets.some(text => typeof text !== 'string' || text.length > 350) || (spec.notes !== undefined && typeof spec.notes !== 'string')) throw new Error('Each slide needs a title, up to 8 concise bullet points and optional notes.');
      const layout = typeof spec.layout === 'string' ? spec.layout : index === 0 ? 'cover' : spec.bullets.length >= 2 && spec.bullets.length <= 4 ? 'cards' : 'content';
      if (!['cover', 'section', 'cards', 'content', 'quote'].includes(layout)) throw new Error('Choose cover, section, cards, content or quote slide layout.');
      const slide = deck.addSlide(); slide.background = { color: background };
      const rtl = args.rtl as boolean, bullets = spec.bullets as string[];
      const text = (value: string, x: number, y: number, w: number, h: number, fontSize = 22, bold = false, color = foreground) => slide.addText(value, { x, y, w, h, fontFace, fontSize, bold, color, align: rtl ? 'right' : 'left', rtlMode: rtl, margin: 0, fit: 'shrink', valign: 'middle' });
      slide.addShape(deck.ShapeType.rect, { x: .72, y: .55, w: .7, h: .06, fill: { color: accent }, line: { color: accent } });
      text(typeof spec.eyebrow === 'string' ? spec.eyebrow.slice(0, 90) : `0${index + 1}`.slice(-2), .72, .72, 11.85, .3, 11, true, accent);
      if (layout === 'cover' || layout === 'section') {
        slide.addShape(deck.ShapeType.rect, { x: 12.15, y: 1.5, w: .45, h: 4.7, fill: { color: accent }, line: { color: accent } });
        text(spec.title, .72, 1.5, 10.9, 2.1, layout === 'cover' ? 42 : 36, true);
        text((spec.bullets as string[]).join('\n'), .75, 4, 10.4, 2.2, spec.bullets.length > 4 ? 18 : 23, false, accent);
      } else if (layout === 'quote') {
        text('“', .72, 1.25, 1, 1.1, 76, true, accent);
        text((spec.bullets as string[]).join('\n'), 1, 2.3, 11, 2.9, 30, false);
        text(spec.title, 1, 5.7, 11, .7, 18, true, accent);
      } else {
        text(spec.title, .72, 1.25, 11.85, 1, 31, true);
        if (layout === 'cards') {
          if (spec.bullets.length > 4) throw new Error('Card layouts support at most four concise cards.');
          (spec.bullets as string[]).forEach((bullet, i) => {
            const cols = bullets.length <= 2 ? Math.max(1, bullets.length) : 2, width = (11.85 - .3 * (cols - 1)) / cols;
            const x = .72 + (i % cols) * (width + .3), y = 2.65 + Math.floor(i / cols) * 1.8;
            slide.addShape(deck.ShapeType.roundRect, { x, y, w: width, h: 1.55, fill: { color: dark ? '213B47' : 'E9EFF4' }, line: { color: dark ? '213B47' : 'E9EFF4' } });
            text(String(i + 1).padStart(2, '0'), x + .22, y + .15, width - .44, .25, 11, true, accent);
            text(bullet, x + .22, y + .55, width - .44, .8, 20, false);
          });
        } else slide.addText((spec.bullets as string[]).map(value => ({ text: value, options: { bullet: { indent: 22 }, breakLine: true } })), { x: .85, y: 2.65, w: 11.6, h: 3.95, fontFace, fontSize: 23, color: foreground, paraSpaceAfter: 16, valign: 'top', align: args.rtl ? 'right' : 'left', rtlMode: args.rtl, fit: 'shrink' });
      }
      text(`${args.title} · ${index + 1}`, .72, 7.02, 11.85, .2, 9);
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
