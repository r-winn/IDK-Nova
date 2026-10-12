import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { validateOfficeZip } from './office-edit';

export { officeFormat } from './office-format';
export async function officePackage(dataUrl: string) {
  if (!/^data:[^,]*;base64,/.test(dataUrl) || dataUrl.length > 14_000_000) throw new Error('Choose an Office attachment under 10 MB.');
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
  validateOfficeZip(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const types = await zip.file('[Content_Types].xml')?.async('string');
  if (!types || /macroEnabled|<!DOCTYPE|<!ENTITY/i.test(types) || Object.keys(zip.files).some(path => /vbaProject/i.test(path))) throw new Error('Macro-enabled or invalid Office files cannot be previewed.');
  // External resources never load while previewing a local document.
  for (const path of Object.keys(zip.files).filter(path => path.endsWith('.rels'))) {
    const xml = await zip.file(path)!.async('string');
    zip.file(path, xml.replace(/<Relationship\b[^>]*\bTargetMode\s*=\s*(["'])External\1[^>]*\/>/gi, ''));
  }
  return { bytes, zip };
}
export async function spreadsheetPreview(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return workbook.worksheets.map(sheet => ({ name: sheet.name, rows: Array.from({ length: Math.min(sheet.rowCount, 1000) }, (_, index) => {
    const row = sheet.getRow(index + 1);
    return Array.from({ length: Math.min(sheet.columnCount, 60) }, (_, col) => {
      const cell = row.getCell(col + 1), fill = cell.fill;
      return { address: cell.address, text: cell.text, bold: cell.font?.bold, color: cell.font?.color?.argb?.slice(-6), background: fill?.type === 'pattern' ? fill.fgColor?.argb?.slice(-6) : undefined, align: cell.alignment?.horizontal, size: cell.font?.size };
    });
  }), truncated: sheet.rowCount > 1000 || sheet.columnCount > 60 }));
}
