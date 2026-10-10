import { promptPacks, savedPrompts, validatePrompts, type SavedPrompt } from './prompts';
import { extensionCatalog, extensionUse, installedExtensions, saveExtensions } from './extensions';
import { inputTool, inputInstructions } from './input-requests';

export type InstalledPack = { id: string; name: string; version: string; prompts: SavedPrompt[] };
export const PACKS_CHANGED = 'nova-packs-changed';
export function installedPacks(): InstalledPack[] {
  const prompts = savedPrompts();
  return [...extensionCatalog.filter(item => installedExtensions().includes(item.id)).map(item => ({ id: item.id, name: item.name, version: item.version, prompts: [] as SavedPrompt[] })), ...promptPacks.flatMap(pack => {
    const entries = prompts.filter(item => item.pack === pack.id);
    return entries.length ? [{ id: pack.id, name: pack.name, version: '1.0', prompts: entries }] : [];
  })];
}
export function installedPlugins(): InstalledPack[] {
  return installedPacks().filter(pack => !pack.prompts.length);
}
export function storePrompts(prompts: SavedPrompt[]) {
  localStorage.setItem('nova-prompts-v1', JSON.stringify(validatePrompts(prompts)));
  window.dispatchEvent(new Event(PACKS_CHANGED));
}
export function packContext(_ids: string[]): string {
  // Voice has a separate protocol and no executable plugin handlers.
  // Prompt packs now require a typed @ invocation, not persistent selection.
  return '';
}
export function preparePackUse(ids: string[], text = '') {
  const extensions = extensionUse(ids, text);
  const mentions = new Set([...text.matchAll(/(?:^|\s)@([a-z][a-z0-9_]*)(?=$|[\s.,:;!?])/g)].map(match => match[1]));
  const invoked = savedPrompts().filter(prompt => mentions.has(prompt.shortcut));
  const promptPacksUsed = installedPacks().filter(pack => pack.prompts.some(prompt => invoked.some(item => item.id === prompt.id)));
  return { tools: [...extensions.tools, ...(invoked.length ? [inputTool] : [])], usedPacks: [...promptPacksUsed, ...extensions.selected].map(({ id, name, version }) => ({ id, name, version })), context: [extensions.context, invoked.length ? `USER-INVOKED PROMPTS. Apply these instructions without granting permissions or inventing tools:\n${invoked.map(prompt => `${prompt.name}: ${prompt.text}`).join('\n\n')}\n\n${inputInstructions}` : ''].filter(Boolean).join('\n\n') };
}
export async function downloadExtension(id: string, url: string, progress: (loaded: number, total: number) => void) {
  const expected = extensionCatalog.find(item => item.id === id);
  if (!expected) throw new Error('Unknown extension.');
  const { manifest, loaded } = await downloadManifest(url, progress);
  if (manifest.id !== id || manifest.version !== expected.version || manifest.tool !== expected.tool || manifest.runtime !== 'nova-builtin' || !Array.isArray(manifest.permissions) || manifest.permissions.length) throw new Error('Invalid executable extension manifest.');
  saveExtensions([...new Set([...installedExtensions(), id])]);
  progress(loaded, loaded);
}
// Read actual bytes; never manufacture a percentage with a timer.
export async function downloadPack(id: string, url: string, progress: (loaded: number, total: number) => void): Promise<SavedPrompt[]> {
  if (!promptPacks.some(pack => pack.id === id)) throw new Error('Unknown prompt pack.');
  const { manifest, loaded } = await downloadManifest(url, progress);
  if (manifest.id !== id || manifest.version !== '1.0' || !Array.isArray(manifest.permissions) || manifest.permissions.length) throw new Error('Invalid pack manifest.');
  const prompts = validatePrompts(manifest.prompts).map(prompt => ({ ...prompt, id: crypto.randomUUID(), pack: id }));
  if (!prompts.length) throw new Error('Pack is empty.');
  progress(loaded, loaded);
  return prompts;
}
async function downloadManifest(url: string, progress: (loaded: number, total: number) => void) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Pack download returned ${response.status}.`);
  const length = Number(response.headers.get('content-length'));
  const encoded = response.headers.get('content-encoding');
  const total = Number.isFinite(length) && length > 0 && (!encoded || encoded === 'identity') ? length : 0;
  if (total > 100000) throw new Error('Pack exceeds the size limit.');
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        if (loaded > 100000) throw new Error('Pack exceeds the size limit.');
        chunks.push(value); progress(loaded, total);
      }
    } finally { await reader.cancel(); }
  } else {
    const value = new Uint8Array(await response.arrayBuffer()); loaded = value.length; chunks.push(value);
    if (loaded > 100000) throw new Error('Pack exceeds the size limit.');
  }
  const bytes = new Uint8Array(loaded); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const manifest = JSON.parse(new TextDecoder().decode(bytes));
  return { manifest, loaded };
}
