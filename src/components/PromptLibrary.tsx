import { useRef, useState } from 'react';
import { BookOpen, Download, Plus, Trash2, Upload } from 'lucide-react';
import { promptPacks, savedPrompts, validatePrompts, type SavedPrompt } from '../lib/prompts';

export function PromptLibrary({ marketplace = false, onUse }: { marketplace?: boolean; onUse: (text: string) => void }) {
  const [items, setItems] = useState(savedPrompts);
  const [draft, setDraft] = useState({ name: '', shortcut: '', text: '' });
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const save = (next: SavedPrompt[]) => { try { const valid = validatePrompts(next); localStorage.setItem('nova-prompts-v1', JSON.stringify(valid)); setItems(valid); setError(''); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; } };
  return <div className="intelligence-center prompt-library">
    <p className="settings-description">{marketplace ? 'Curated prompt packs • Nova • version 1.0. These contain text only, not executable plugins. Installing does not grant file, browser or terminal permissions.' : 'Save repeatable instructions. Use @shortcut in a message, or insert a prompt below. Exported libraries contain your prompt text; do not include secrets.'}</p>
    {error && <p className="connection-diagnostic" role="alert">{error}</p>}
    {marketplace ? promptPacks.map(pack => {
      const installed = items.some(item => item.pack === pack.id);
      return <section className="settings-section marketplace-pack" key={pack.id}><BookOpen /><h3>{pack.name}</h3><p>{pack.description}</p><small>Source: Nova · 1.0 · permissions: none at install</small><button className="secondary" onClick={() => installed ? save(items.filter(item => item.pack !== pack.id)) : save([...items, ...pack.prompts.map(prompt => ({ ...prompt, id: crypto.randomUUID(), pack: pack.id }))])}>{installed ? 'Uninstall pack' : 'Install pack'}</button></section>;
    }) : <>
      <section className="settings-section"><h3>Your prompts</h3><div className="tool-command-actions"><button className="secondary" onClick={() => { const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'nova-prompts.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download />Export</button><button className="secondary" onClick={() => file.current?.click()}><Upload />Import</button></div><input ref={file} type="file" hidden accept=".json,application/json" onChange={async event => { const selected = event.target.files?.[0]; event.target.value = ''; if (!selected) return; try { if (selected.size > 2_000_000) throw new Error('Library file exceeds 2 MB.'); const imported = validatePrompts(JSON.parse(await selected.text())); const existing = new Set(items.map(item => item.shortcut)); save([...items, ...imported.filter(item => !existing.has(item.shortcut))]); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} />
      {!items.length && <p>No prompts yet. Create one below or install a pack from Marketplace.</p>}
      {items.map(item => <div className="prompt-library-row" key={item.id}><span><b>{item.name}</b><code>@{item.shortcut}</code></span><button className="secondary" onClick={() => onUse(item.text)}>Use</button><button className="icon-button" aria-label={`Delete ${item.name}`} onClick={() => save(items.filter(entry => entry.id !== item.id))}><Trash2 /></button></div>)}</section>
      <section className="settings-section"><h3>New prompt</h3><label>Name<input value={draft.name} maxLength={100} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label>Shortcut<input placeholder="formal_email" value={draft.shortcut} onChange={e => setDraft({ ...draft, shortcut: e.target.value })} /></label><label>Instructions<textarea dir="auto" rows={6} maxLength={20000} value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} /></label><button className="primary-button" onClick={() => { if (save([...items, { ...draft, id: crypto.randomUUID() }])) setDraft({ name: '', shortcut: '', text: '' }); }}><Plus />Save prompt</button></section>
    </>}
  </div>;
}
