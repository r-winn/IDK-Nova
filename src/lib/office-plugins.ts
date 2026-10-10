import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import ExcelJS from 'exceljs';
import type { Attachment } from '../types';

const checkedName = (value: unknown, extension: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\\/:*?"<>|\x00-\x1f]/.test(value)) throw new Error('Use a simple filename without folder paths.');
  return value.replace(/\.(docx|xlsx)$/i, '') + extension;
};
async function attachment(name: string, type: string, bytes: Uint8Array): Promise<Attachment> {
  if (bytes.length > 2_000_000) throw new Error('Generated Office file exceeds 2 MB.');
  let binary = '';
  for (let start = 0; start < bytes.length; start += 16000) binary += String.fromCharCode(...bytes.subarray(start, start + 16000));
  return { name, type, url: `data:${type};base64,${btoa(binary)}` };
}
export async function createOfficeFile(tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (tool === 'create_word_document') {
    if (Object.keys(args).some(key => !['filename', 'title', 'paragraphs', 'rtl'].includes(key)) || typeof args.title !== 'string' || args.title.length > 200 || typeof args.rtl !== 'boolean' || !Array.isArray(args.paragraphs) || !args.paragraphs.length || args.paragraphs.length > 500 || args.paragraphs.some(text => typeof text !== 'string') || JSON.stringify(args).length > 150000) throw new Error('Supply a title, 1–500 text paragraphs and an RTL flag within 150 KB.');
    const name = checkedName(args.filename, '.docx');
    const rtl = args.rtl;
    const paragraph = (text: string, heading = false) => new Paragraph({
      bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      ...(heading ? { heading: HeadingLevel.TITLE } : {}), spacing: { after: 180 },
      children: [new TextRun({ text, rightToLeft: rtl, font: 'Arial', size: heading ? 36 : 24 })],
    });
    const document = new Document({ creator: 'Nova', title: args.title, sections: [{ children: [paragraph(args.title, true), ...args.paragraphs.map(text => paragraph(text as string))] }] });
    const bytes = new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer());
    signal?.throwIfAborted();
    return { ok: true, filename: name, paragraphs: args.paragraphs.length, __novaAttachment: await attachment(name, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes) };
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
