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
const inkOn = (hex: string) => {
  const channels = [0, 2, 4].map(offset => { const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2] > .179 ? '18242D' : 'FFFFFF';
};
const size = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
const presentationPresets: Record<string, { background: string; foreground: string; accent: string; surface: string; font: string }> = {
  minimal: { background: 'F6F8FA', foreground: '18242D', accent: '245B7A', surface: 'E9EFF4', font: 'Arial' },
  midnight: { background: '152A36', foreground: 'F3F7FA', accent: '8FD6C8', surface: '213B47', font: 'Arial' },
  editorial: { background: 'FAF5ED', foreground: '302820', accent: '9A6245', surface: 'EEE4D7', font: 'Georgia' },
  executive: { background: 'FFFFFF', foreground: '172D46', accent: '2866B1', surface: 'EEF3FA', font: 'Aptos' },
  botanical: { background: 'F5F7F0', foreground: '24392E', accent: '3F7252', surface: 'E5EDDF', font: 'Aptos' },
  studio: { background: 'FFF9F1', foreground: '282327', accent: 'C44732', surface: 'F6E6D9', font: 'Aptos Display' },
  technical: { background: '101827', foreground: 'F1F5FA', accent: '77A9FF', surface: '1D2B40', font: 'Aptos' },
  luxury: { background: '211D24', foreground: 'F6F0E5', accent: 'D6B77A', surface: '342E38', font: 'Georgia' },
};
export const presentationLayouts = ['cover', 'section', 'cards', 'content', 'quote', 'comparison', 'metrics', 'timeline', 'chart', 'table', 'image'] as const;
export async function createOfficeFile(tool: string, args: Record<string, unknown>, signal?: AbortSignal, files: Attachment[] = []) {
  signal?.throwIfAborted();
  if (tool === 'create_word_document') {
    if (Object.keys(args).some(key => !['filename', 'title', 'paragraphs', 'rtl', 'layout', 'blocks'].includes(key)) || typeof args.title !== 'string' || args.title.length > 200 || typeof args.rtl !== 'boolean' || !Array.isArray(args.paragraphs) || args.paragraphs.length > 500 || args.paragraphs.some(text => typeof text !== 'string') || (!args.paragraphs.length && !Array.isArray(args.blocks)) || JSON.stringify(args).length > 150000) throw new Error('Supply a title, paragraphs or formatted blocks and an RTL flag within 150 KB.');
    const name = checkedName(args.filename, '.docx');
    const rtl = args.rtl, layout = record(args.layout);
    const documentPresets: Record<string, { font: string; accent: string; titleSize: number; spacing: number }> = {
      report: { font: 'Aptos', accent: '245B7A', titleSize: 32, spacing: 320 },
      editorial: { font: 'Georgia', accent: '76523D', titleSize: 36, spacing: 350 },
      letter: { font: 'Aptos', accent: '344454', titleSize: 24, spacing: 300 },
      proposal: { font: 'Aptos', accent: '3F7252', titleSize: 34, spacing: 330 },
      academic: { font: 'Times New Roman', accent: '243342', titleSize: 26, spacing: 360 },
    };
    if (layout.preset && !documentPresets[String(layout.preset)]) throw new Error('Unknown document preset.');
    const documentPreset = documentPresets[String(layout.preset)] || documentPresets.report;
    const font = typeof layout.font === 'string' && layout.font.length <= 50 ? layout.font : rtl ? 'Arial' : documentPreset.font;
    const headingFont = typeof layout.headingFont === 'string' && layout.headingFont.length <= 50 ? layout.headingFont : font;
    const fontSize = size(layout.fontSize, 11, 8, 36), accent = color(layout.accent, documentPreset.accent);
    const paragraph = (text: string, heading = false, options: Record<string, unknown> = {}) => new Paragraph({
      bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      ...(heading ? { heading: options.level === 3 ? HeadingLevel.HEADING_3 : options.level === 2 ? HeadingLevel.HEADING_2 : options.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.TITLE } : {}), spacing: { before: heading && options.level ? 280 : 0, after: heading ? 240 : 180, line: documentPreset.spacing },
      ...(options.bullet ? { bullet: { level: 0 } } : {}),
      ...(options.callout ? { shading: { fill: 'F0F4F6' }, border: { [rtl ? 'right' : 'left']: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 12 } }, indent: { left: 200, right: 200 } } : {}),
      pageBreakBefore: options.pageBreak === true, keepNext: heading, widowControl: true,
      children: [new TextRun({ text, rightToLeft: rtl, font: heading ? headingFont : font, size: 2 * size(options.fontSize, heading ? options.level === 3 ? 12 : options.level === 2 ? 14 : options.level === 1 ? 18 : documentPreset.titleSize : fontSize, 8, 48), bold: heading || options.bold === true, italics: options.italic === true, color: color(options.color, heading ? accent : '243342') })],
    });
    const children: (Paragraph | Table)[] = [paragraph(args.title, true)];
    if (typeof layout.subtitle === 'string' && layout.subtitle.trim()) children.push(paragraph(layout.subtitle.slice(0, 300), false, { fontSize: 14, color: accent }));
    children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: accent, space: 8 } }, spacing: { after: 320 } }));
    if (layout.coverPage === true) children.push(new Paragraph({ pageBreakBefore: true }));
    children.push(...args.paragraphs.map(text => paragraph(text as string)));
    if (args.blocks !== undefined && args.blocks !== null) {
      if (!Array.isArray(args.blocks) || args.blocks.length > 500) throw new Error('Use at most 500 document blocks.');
      for (const item of args.blocks) {
        const block = record(item);
        if (block.type === 'table') {
          if (!Array.isArray(block.rows) || !block.rows.length || block.rows.length > 100 || block.rows.some(row => !Array.isArray(row) || !row.length || row.length > 12 || row.some(cell => typeof cell !== 'string'))) throw new Error('Tables require 1–100 rows, 1–12 plain text cells per row.');
          children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8EF' }, insideVertical: { style: BorderStyle.NONE } }, rows: block.rows.map((row, index) => new TableRow({ tableHeader: index === 0, children: (row as string[]).map(text => new TableCell({ margins: { top: 120, bottom: 120, left: 160, right: 160 }, shading: { fill: index === 0 ? accent : index % 2 ? 'F2F6FA' : 'FFFFFF' }, children: [paragraph(text, false, index === 0 ? { bold: true, color: 'FFFFFF' } : {})] })) })) }));
        } else if (block.type === 'pageBreak') children.push(new Paragraph({ pageBreakBefore: true }));
        else if (block.type === 'bullets') {
          if (!Array.isArray(block.items) || !block.items.length || block.items.length > 30 || block.items.some(item => typeof item !== 'string' || item.length > 1000)) throw new Error('Document bullet lists require 1–30 concise items.');
          children.push(...block.items.map(item => paragraph(item as string, false, { ...block, bullet: true })));
        } else if (['heading', 'paragraph', 'callout'].includes(String(block.type)) && typeof block.text === 'string') children.push(paragraph(block.text, block.type === 'heading', { ...block, callout: block.type === 'callout' }));
        else throw new Error('Unknown document block. Use heading, paragraph, callout, bullets, table or pageBreak.');
      }
    }
    const header = typeof layout.header === 'string' ? layout.header.slice(0, 200) : '';
    const footer = typeof layout.footer === 'string' ? layout.footer.slice(0, 200) : '';
    const margin = Math.round(size(layout.marginCm, 2, 1.2, 3.5) * 567);
    const document = new Document({ creator: 'Nova', title: args.title, styles: { default: { document: { run: { font, size: fontSize * 2, color: '243342' } } } }, sections: [{ properties: { page: { size: { width: layout.landscape ? 16838 : 11906, height: layout.landscape ? 11906 : 16838 }, margin: { top: margin, bottom: margin, left: margin, right: margin } } }, headers: { default: new Header({ children: [paragraph(header, false, { fontSize: 9, color: accent })] }) }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: footer ? `${footer} · ` : '', font, size: 18 }), new TextRun({ children: [PageNumber.CURRENT] })] })] }) }, children }] });
    const bytes = new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer());
    signal?.throwIfAborted();
    return { ok: true, filename: name, paragraphs: args.paragraphs.length, blocks: Array.isArray(args.blocks) ? args.blocks.length : 0, __novaAttachment: await attachment(name, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes) };
  }
  if (tool === 'create_powerpoint') {
    if (Object.keys(args).some(key => !['filename', 'title', 'slides', 'rtl', 'theme'].includes(key)) || typeof args.title !== 'string' || args.title.length > 200 || typeof args.rtl !== 'boolean' || !Array.isArray(args.slides) || !args.slides.length || args.slides.length > 40 || JSON.stringify(args).length > 200000) throw new Error('Supply 1–40 slides, a title and RTL flag within 200 KB.');
    const name = checkedName(args.filename, '.pptx'), theme = record(args.theme), deck = new PptxGenJS();
    deck.layout = 'LAYOUT_WIDE'; deck.title = args.title; deck.author = 'Nova'; deck.subject = args.title;
    if (theme.preset && !presentationPresets[String(theme.preset)]) throw new Error('Unknown presentation theme.');
    const preset = presentationPresets[String(theme.preset)] || presentationPresets.minimal;
    const background = color(theme.background, preset.background), foreground = color(theme.foreground, preset.foreground), accent = color(theme.accent, preset.accent);
    const fontFace = typeof theme.font === 'string' && theme.font.length <= 50 ? theme.font : args.rtl ? 'Arial' : preset.font;
    const headingFont = typeof theme.headingFont === 'string' && theme.headingFont.length <= 50 ? theme.headingFont : fontFace;
    deck.theme = { headFontFace: headingFont, bodyFontFace: fontFace };
    const plain = (value: unknown, max: number, label: string) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} must be non-empty text within ${max} characters.`); return value; };
    const list = (value: unknown, min: number, max: number, label: string) => { if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label} requires ${min}–${max} entries.`); return value; };
    for (const [index, item] of args.slides.entries()) {
      signal?.throwIfAborted();
      const spec = record(item);
      if (typeof spec.title !== 'string' || spec.title.length > 160 || !Array.isArray(spec.bullets) || spec.bullets.length > 8 || spec.bullets.some(text => typeof text !== 'string' || text.length > 350) || (spec.notes !== undefined && typeof spec.notes !== 'string')) throw new Error('Each slide needs a title, up to 8 concise bullet points and optional notes.');
      const layout = typeof spec.layout === 'string' ? spec.layout : index === 0 ? 'cover' : spec.bullets.length >= 2 && spec.bullets.length <= 4 ? 'cards' : 'content';
      if (!presentationLayouts.includes(layout as typeof presentationLayouts[number])) throw new Error('Unknown presentation layout.');
      if ((['cover', 'section', 'quote', 'image'].includes(layout) && spec.bullets.join(' ').length > 450) || (layout === 'cards' && spec.bullets.some(text => text.length > 180)) || (layout === 'content' && (spec.bullets.length > 6 || spec.bullets.join(' ').length > 1000))) throw new Error('Slide text is too dense for readable design. Shorten visible text, move detail to notes or split the slide.');
      const slide = deck.addSlide(); slide.background = { color: background };
      const rtl = args.rtl as boolean, bullets = spec.bullets as string[];
      const text = (value: string, x: number, y: number, w: number, h: number, fontSize = 22, bold = false, color = foreground) => slide.addText(value, { x, y, w, h, fontFace: bold ? headingFont : fontFace, fontSize, bold, color, align: rtl ? 'right' : 'left', rtlMode: rtl, margin: 0, fit: 'shrink', valign: 'middle' });
      slide.addShape(deck.ShapeType.rect, { x: .72, y: .55, w: .7, h: .06, fill: { color: accent }, line: { color: accent } });
      text(typeof spec.eyebrow === 'string' ? spec.eyebrow.slice(0, 90) : `0${index + 1}`.slice(-2), .72, .72, 11.85, .3, 11, true, accent);
      if (layout === 'cover' || layout === 'section') {
        if (layout === 'cover' && ['studio', 'technical'].includes(String(theme.preset))) {
          const x = rtl ? 6.65 : .72;
          slide.addShape(deck.ShapeType.rect, { x: rtl ? 0 : 7.8, y: 1.25, w: 5.53, h: 5.4, fill: { color: accent }, line: { color: accent } });
          text(spec.title, x, 1.55, 5.95, 2.65, 42, true);
          text(bullets.join('\n'), x, 4.6, 5.95, 1.4, 21);
          slide.addText(typeof spec.eyebrow === 'string' ? spec.eyebrow : args.title, { x: rtl ? .65 : 8.4, y: 2.2, w: 4.35, h: 3.4, fontFace: headingFont, fontSize: 28, color: inkOn(accent), bold: true, margin: 0, rtlMode: rtl, align: rtl ? 'right' : 'left', fit: 'shrink' });
        } else if (layout === 'cover' && ['editorial', 'luxury'].includes(String(theme.preset))) {
          text(spec.title, 1.2, 1.65, 10.9, 2.2, 44, true);
          slide.addShape(deck.ShapeType.line, { x: 1.2, y: 4.25, w: 10.9, h: 0, line: { color: accent, width: 1 } });
          text(bullets.join('\n'), 1.2, 4.65, 9.8, 1.45, 23);
        } else {
          slide.addShape(deck.ShapeType.rect, { x: 12.15, y: 1.5, w: .45, h: 4.7, fill: { color: accent }, line: { color: accent } });
          text(spec.title, .72, 1.5, 10.9, 2.1, layout === 'cover' ? 42 : 36, true);
          text(bullets.join('\n'), .75, 4, 10.4, 2.2, spec.bullets.length > 4 ? 18 : 23, false, accent);
        }
      } else if (layout === 'quote') {
        text('“', .72, 1.25, 1, 1.1, 76, true, accent);
        text((spec.bullets as string[]).join('\n'), 1, 2.3, 11, 2.9, 30, false);
        text(spec.title, 1, 5.7, 11, .7, 18, true, accent);
      } else {
        text(spec.title, .72, 1.25, 11.85, 1, 31, true);
        if (layout === 'comparison') {
          const columns = list(spec.columns, 2, 2, 'Comparison columns');
          columns.forEach((item, i) => {
            const column = record(item), x = .72 + (rtl ? 1 - i : i) * 6.08;
            text(plain(column.title, 70, 'Column title'), x, 2.55, 5.7, .6, 24, true, accent);
            const entries = list(column.items, 1, 4, 'Column items').map(item => plain(item, 150, 'Comparison item'));
            entries.forEach((item, row) => text(item, x, 3.4 + row * .7, 5.7, .6, 20));
          });
        } else if (layout === 'metrics') {
          const metrics = list(spec.metrics, 1, 4, 'Metrics');
          const width = 11.85 / metrics.length;
          metrics.forEach((item, i) => {
            const metric = record(item), x = .72 + (rtl ? metrics.length - 1 - i : i) * width;
            text(plain(metric.value, 24, 'Metric value'), x, 2.9, width - .25, 1.1, 46, true, accent);
            text(plain(metric.label, 70, 'Metric label'), x, 4.2, width - .25, .8, 20, true);
            if (metric.detail) text(plain(metric.detail, 100, 'Metric detail'), x, 5.1, width - .25, .8, 17);
          });
        } else if (layout === 'timeline') {
          const steps = list(spec.steps, 2, 5, 'Timeline');
          const width = 11.85 / steps.length;
          slide.addShape(deck.ShapeType.line, { x: .9, y: 3.1, w: 11.3, h: 0, line: { color: accent, width: 2 } });
          steps.forEach((item, i) => {
            const step = record(item), x = .72 + (rtl ? steps.length - 1 - i : i) * width;
            slide.addShape(deck.ShapeType.ellipse, { x: x + .13, y: 2.99, w: .22, h: .22, fill: { color: accent }, line: { color: accent } });
            text(plain(step.label, 45, 'Step label'), x, 2.35, width - .3, .5, 16, true, accent);
            text(plain(step.title, 70, 'Step title'), x, 3.5, width - .3, .9, 21, true);
            if (step.detail) text(plain(step.detail, 120, 'Step detail'), x, 4.7, width - .3, 1.1, 17);
          });
        } else if (layout === 'chart') {
          const chart = record(spec.chart);
          if (!['bar', 'line', 'pie', 'doughnut'].includes(String(chart.type))) throw new Error('Chart type must be bar, line, pie or doughnut.');
          const labels = list(chart.labels, 1, 12, 'Chart labels').map(item => plain(item, 45, 'Chart label'));
          const series = list(chart.series, 1, 4, 'Chart series').map(item => {
            const entry = record(item);
            if (!Array.isArray(entry.values) || entry.values.length !== labels.length || entry.values.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Chart values must be finite numbers matching label count.');
            if (['pie', 'doughnut'].includes(String(chart.type)) && (entry.values.some(value => (value as number) < 0) || !entry.values.some(value => (value as number) > 0))) throw new Error('Pie charts require non-negative values and a positive total.');
            return { name: plain(entry.name, 60, 'Series name'), labels, values: entry.values as number[] };
          });
          if (['pie', 'doughnut'].includes(String(chart.type)) && series.length !== 1) throw new Error('Pie charts support one series.');
          slide.addChart(chart.type as 'bar' | 'line' | 'pie' | 'doughnut', series, { x: .85, y: 2.5, w: 11.5, h: 3.9, chartArea: { fill: { color: background } }, plotArea: { fill: { color: background } }, chartColors: [accent, '7F91AB', 'C7A577', '7BA78D'], dataLabelColor: foreground, showLegend: series.length > 1 || ['pie', 'doughnut'].includes(String(chart.type)), showValue: true, showTitle: false, catAxisLabelFontFace: fontFace, catAxisLabelFontSize: 14, catAxisLabelColor: foreground, valAxisLabelColor: foreground, valAxisLabelFontSize: 12, legendColor: foreground, legendFontSize: 13 });
          if (chart.unit) text(plain(chart.unit, 60, 'Chart unit'), .85, 6.48, 11.5, .3, 11, false, accent);
        } else if (layout === 'table') {
          const rows = list(spec.rows, 2, 8, 'Table rows');
          const columns = Array.isArray(rows[0]) ? rows[0].length : 0;
          if (columns < 1 || columns > 5 || rows.some(row => !Array.isArray(row) || row.length !== columns || row.some(cell => typeof cell !== 'string' || cell.length > 100))) throw new Error('Slide tables require 1–5 columns with equal lengths and short text.');
          slide.addTable((rows as string[][]).map((row, i) => row.map(value => ({ text: value, options: { fill: { color: i === 0 ? accent : i % 2 ? preset.surface : background }, color: i === 0 ? inkOn(accent) : foreground, bold: i === 0 } }))), { x: .72, y: 2.55, w: 11.85, h: 3.85, fontFace, fontSize: 16, margin: .12, border: { type: 'solid', color: preset.surface, pt: .5 }, align: rtl ? 'right' : 'left', autoPage: false });
        } else if (layout === 'image') {
          const image = record(spec.image), source = plain(image.source, 100, 'Image attachment name');
          const matches = files.filter(file => file.name === source);
          if (matches.length !== 1 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(matches[0].url) || matches[0].url.length > 7_000_000) throw new Error('Use one exact attached PNG/JPEG image under 5 MB; remote URLs are not fetched.');
          const data = matches[0].url, x = rtl ? .72 : 6.6;
          slide.addImage({ data, x, y: 2.5, w: 6, h: 3.9, sizing: { type: 'contain', w: 6, h: 3.9 } });
          text(bullets.join('\n\n'), rtl ? 7.15 : .72, 2.65, 5.1, 3.45, 22);
          if (image.caption) text(plain(image.caption, 180, 'Image caption'), x, 6.45, 6, .35, 11);
        } else if (layout === 'cards') {
          if (spec.bullets.length > 4) throw new Error('Card layouts support at most four concise cards.');
          (spec.bullets as string[]).forEach((bullet, i) => {
            const cols = bullets.length <= 2 ? Math.max(1, bullets.length) : 2, width = (11.85 - .3 * (cols - 1)) / cols;
            const x = .72 + (rtl ? cols - 1 - i % cols : i % cols) * (width + .3), y = 2.65 + Math.floor(i / cols) * 1.8;
            slide.addShape(deck.ShapeType.roundRect, { x, y, w: width, h: 1.55, fill: { color: preset.surface }, line: { color: preset.surface } });
            text(String(i + 1).padStart(2, '0'), x + .22, y + .15, width - .44, .25, 11, true, accent);
            text(bullet, x + .22, y + .55, width - .44, .8, 20, false);
          });
        } else slide.addText((spec.bullets as string[]).map(value => ({ text: value, options: { bullet: { indent: 22 }, breakLine: true } })), { x: .85, y: 2.65, w: 11.6, h: 3.95, fontFace, fontSize: 23, color: foreground, paraSpaceAfter: 16, valign: 'top', align: args.rtl ? 'right' : 'left', rtlMode: args.rtl, fit: 'shrink' });
      }
      const source = typeof spec.source === 'string' ? spec.source.slice(0, 200) : '';
      text(source || `${args.title} · ${index + 1}`, .72, 7.02, 11.85, .2, 9);
      if (spec.notes) slide.addNotes(spec.notes as string);
    }
    const bytes = new Uint8Array(await deck.write({ outputType: 'arraybuffer' }) as ArrayBuffer); signal?.throwIfAborted();
    return { ok: true, filename: name, slides: args.slides.length, design: { preset: theme.preset || 'minimal', layouts: args.slides.map(item => record(item).layout || 'auto'), editableCharts: args.slides.filter(item => record(item).layout === 'chart').length }, __novaAttachment: await attachment(name, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes) };
  }
  if (tool === 'create_excel_workbook') {
    if (Object.keys(args).some(key => !['filename', 'sheets', 'style'].includes(key)) || !Array.isArray(args.sheets) || !args.sheets.length || args.sheets.length > 10 || JSON.stringify(args).length > 400000) throw new Error('Supply 1–10 sheets within 400 KB.');
    const name = checkedName(args.filename, '.xlsx'), workbook = new ExcelJS.Workbook();
    const style = record(args.style), accent = color(style.accent, '355B70'), font = typeof style.font === 'string' && style.font.length <= 50 ? style.font : 'Arial';
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
      worksheet.views = [{ state: 'frozen', ySplit: 1, rightToLeft: style.rtl === true }];
      worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, worksheet.rowCount), column: Math.max(1, worksheet.columnCount) } };
      worksheet.properties.defaultRowHeight = 25;
      worksheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' };
      worksheet.headerFooter.oddFooter = '&L' + sheet.name + '&RPage &P of &N';
      worksheet.eachRow((row, index) => { row.font = { name: font, size: 11, color: { argb: 'FF243342' } }; row.alignment = { vertical: 'middle', wrapText: true, readingOrder: style.rtl === true ? 'rtl' : 'ltr' }; if (index > 1 && index % 2 === 0) row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F8' } }; }); });
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(1).height = 32;
      worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + accent } };
      worksheet.columns.forEach(column => { let width = 12; column.eachCell?.({ includeEmpty: false }, cell => { width = Math.max(width, Math.min(40, [...cell.text].length + 3)); }); column.width = width; });
    }
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer()); signal?.throwIfAborted();
    return { ok: true, filename: name, sheets: workbook.worksheets.length, cells, __novaAttachment: await attachment(name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes) };
  }
  throw new Error('Unknown Office tool.');
}
