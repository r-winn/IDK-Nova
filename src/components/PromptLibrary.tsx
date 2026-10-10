import { useRef, useState } from 'react';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { savedPrompts, validatePrompts, type SavedPrompt } from '../lib/prompts';
import { storePrompts } from '../lib/packs';

export function PromptLibrary({ onUse }: { onUse: (text: string) => void }) {
  const [items, setItems] = useState(savedPrompts);
  const [draft, setDraft] = useState({ name: '', shortcut: '', text: '' });
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const save = (next: SavedPrompt[]) => { try { const valid = validatePrompts(next); storePrompts(valid); setItems(valid); setError(''); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; } };
  return <div className="intelligence-center prompt-library">
    <p className="settings-description">Save repeatable instructions. Use @shortcut in a message, or insert a prompt below. Exported libraries contain your prompt text; do not include secrets.</p>
    {error && <p className="connection-diagnostic" role="alert">{error}</p>}
    <>
      <section className="settings-section"><h3>Your prompts</h3><div className="tool-command-actions"><button className="secondary" onClick={() => { const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'nova-prompts.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download />Export</button><button className="secondary" onClick={() => file.current?.click()}><Upload />Import</button></div><input ref={file} type="file" hidden accept=".json,application/json" onChange={async event => { const selected = event.target.files?.[0]; event.target.value = ''; if (!selected) return; try { if (selected.size > 2_000_000) throw new Error('Library file exceeds 2 MB.'); const imported = validatePrompts(JSON.parse(await selected.text())); const existing = new Set(items.map(item => item.shortcut)); save([...items, ...imported.filter(item => !existing.has(item.shortcut))]); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} />
      {!items.length && <p>No prompts yet. Create one below or install a pack from Marketplace.</p>}
      {items.map(item => <div className="prompt-library-row" key={item.id}><span><b>{item.name}</b><code>@{item.shortcut}</code></span><button className="secondary" onClick={() => onUse(`@${item.shortcut} `)}>Use</button><button className="icon-button" aria-label={`Delete ${item.name}`} onClick={() => save(items.filter(entry => entry.id !== item.id))}><Trash2 /></button></div>)}</section>
      <section className="settings-section"><h3>New prompt</h3><label>Name<input value={draft.name} maxLength={100} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label>Shortcut<input placeholder="formal_email" value={draft.shortcut} onChange={e => setDraft({ ...draft, shortcut: e.target.value })} /></label><label>Instructions<textarea dir="auto" rows={6} maxLength={20000} value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} /></label><button className="primary-button" onClick={() => { if (save([...items, { ...draft, id: crypto.randomUUID() }])) setDraft({ name: '', shortcut: '', text: '' }); }}><Plus />Save prompt</button></section>
    </>
  </div>;
}
