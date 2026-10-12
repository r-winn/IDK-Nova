import JSZip from 'jszip';
import type { Attachment } from '../types';
import { officeAttachment } from './office-plugins';

export async function createArchive(args: Record<string, unknown>, attachments: Attachment[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (typeof args.filename !== 'string' || !/^[^\\/:*?"<>|\x00-\x1f]{1,95}$/.test(args.filename) || !Array.isArray(args.files) || !args.files.length || args.files.length > 20 || args.files.some(name => typeof name !== 'string') || new Set(args.files).size !== args.files.length || Object.keys(args).some(key => !['filename', 'files'].includes(key))) throw new Error('Choose 1–20 exact attachment names and a simple ZIP filename.');
  const zip = new JSZip(); let total = 0;
  for (const name of args.files as string[]) {
    if (/[\\/\x00-\x1f]/.test(name) || ['.', '..'].includes(name)) throw new Error('Archive paths are not allowed.');
    const file = [...attachments].reverse().find(file => file.name === name);
    if (!file || !/^data:[^,]*;base64,/.test(file.url)) throw new Error(`Attach ${name} in this chat first.`);
    const bytes = Uint8Array.from(atob(file.url.split(',')[1]), c => c.charCodeAt(0));
    total += bytes.length; if (total > 20_000_000) throw new Error('Archive inputs exceed 20 MB.');
    zip.file(name, bytes);
  }
  const filename = args.filename.replace(/\.zip$/i, '') + '.zip';
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }); signal?.throwIfAborted();
  return { ok: true, filename, files: args.files, __novaAttachment: await officeAttachment(filename, 'application/zip', bytes) };
}
