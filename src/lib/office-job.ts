import type { Attachment } from '../types';
// Spreadsheet parsing/generation runs outside the UI thread. Cancellation ends
// this job, rather than leaving a large workbook blocking the chat interface.
export async function runOfficeJob(tool: string, args: Record<string, unknown>, attachments: Attachment[], signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  if (typeof Worker === 'undefined') return tool === 'create_excel_workbook'
    ? (await import('./office-plugins')).createOfficeFile(tool, args, signal, attachments)
    : (await import('./office-edit')).editOfficeFile(tool, args, attachments, signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./office-worker.ts', import.meta.url), { type: 'module' });
    const clean = () => { signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { clean(); reject(new DOMException('Office job stopped', 'AbortError')); };
    worker.onmessage = event => { clean(); if (event.data.ok) resolve(event.data.result); else reject(new Error(event.data.error || 'Office processing failed')); };
    worker.onerror = () => { clean(); reject(new Error('Office processing worker failed. The original file is unchanged.')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage({ tool, args, attachments: tool === 'create_excel_workbook' ? [] : attachments.filter(file => file.name === args.source) }); } catch (error) { clean(); reject(error); }
  });
}
