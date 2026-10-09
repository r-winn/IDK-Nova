import { NOVA_TOOLS } from '../agent/catalog';
export type SavedPrompt = { id: string; name: string; shortcut: string; text: string; pack?: string };
export const promptPacks = [
  { id: 'writing', name: 'Professional writing', description: 'Email drafts and concise reports.', prompts: [{ name: 'Formal email', shortcut: 'formal_email', text: 'Draft a professional email. Ask me for the recipient, purpose and language if missing. Separate subject and body.' }, { name: 'Report summary', shortcut: 'report_summary', text: 'Summarize the following report. Separate key findings, uncertainties and next actions. Do not invent missing facts.' }] },
  { id: 'development', name: 'Project review', description: 'Evidence-based code review for Work.', prompts: [{ name: 'Review project', shortcut: 'review_project', text: 'Review this Work project using read-only tools. Cite file paths and line numbers for concrete issues. Do not change files without my request.' }] },
  { id: 'research', name: 'Research checklist', description: 'Organize sources and distinguish evidence from assumptions.', prompts: [{ name: 'Research brief', shortcut: 'research_brief', text: 'Prepare a research brief for the topic below. Distinguish verified sources from assumptions. If web tools are unavailable, say so and do not fabricate citations.' }] },
] as const;
export function savedPrompts(): SavedPrompt[] {
  try { return validatePrompts(JSON.parse(localStorage.getItem('nova-prompts-v1') || '[]')); } catch { return []; }
}
export function validatePrompts(value: unknown): SavedPrompt[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('A prompt library must contain at most 200 entries.');
  const used = new Set<string>();
  const reserved = new Set(NOVA_TOOLS.map(tool => tool.function.name));
  return value.map(item => {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 20000 || typeof item.shortcut !== 'string' || !/^[a-z][a-z0-9_]{1,49}$/.test(item.shortcut) || used.has(item.shortcut) || reserved.has(item.shortcut)) throw new Error('Use unique shortcuts (letters, numbers and underscores), a name and non-empty prompt. Tool names are reserved.');
    used.add(item.shortcut);
    return { id: typeof item.id === 'string' ? item.id : crypto.randomUUID(), name: item.name, text: item.text, shortcut: item.shortcut, ...(typeof item.pack === 'string' ? { pack: item.pack } : {}) };
  });
}
export function expandPrompts(text: string): string {
  const library = savedPrompts();
  return text.replace(/(^|\s)@([a-z][a-z0-9_]*)(?=$|[\s.,:;!?])/g, (original, prefix, shortcut) => {
    const prompt = library.find(item => item.shortcut === shortcut);
    return prompt ? `${prefix}${prompt.text}` : original;
  });
}
