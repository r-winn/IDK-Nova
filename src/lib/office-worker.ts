import { createOfficeFile } from './office-plugins';
import { editOfficeFile } from './office-edit';
import type { Attachment } from '../types';
const scope = self as unknown as { onmessage: (event: MessageEvent<{ tool: string; args: Record<string, unknown>; attachments: Attachment[] }>) => void; postMessage: (data: unknown) => void };
scope.onmessage = async ({ data }) => {
  try {
    if (!['create_excel_workbook', 'inspect_office_file', 'edit_office_file'].includes(data.tool)) throw new Error('Unsupported Office job');
    const result = data.tool === 'create_excel_workbook' ? await createOfficeFile(data.tool, data.args) : await editOfficeFile(data.tool, data.args, data.attachments);
    scope.postMessage({ ok: true, result });
  } catch (error) { scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
