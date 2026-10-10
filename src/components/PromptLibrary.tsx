import { useRef, useState } from 'react';
import { BookOpen, Download, Plus, Trash2, Upload } from 'lucide-react';
import { promptPacks, savedPrompts, validatePrompts, type SavedPrompt } from '../lib/prompts';
import { downloadPack, downloadExtension, storePrompts } from '../lib/packs';
import { extensionCatalog, installedExtensions, saveExtensions } from '../lib/extensions';

export function PromptLibrary({ marketplace = false, onUse }: { marketplace?: boolean; onUse: (text: string) => void }) {
  const [items, setItems] = useState(savedPrompts);
  const [extensions, setExtensions] = useState(installedExtensions);
  const [draft, setDraft] = useState({ name: '', shortcut: '', text: '' });
  const [error, setError] = useState('');
  const [downloads, setDownloads] = useState<Record<string, { loaded: number; total: number; done?: boolean }>>({});
  const installing = useRef(new Set<string>());
  const file = useRef<HTMLInputElement>(null);
  const save = (next: SavedPrompt[]) => { try { const valid = validatePrompts(next); storePrompts(valid); setItems(valid); setError(''); return true; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; } };
  const install = async (id: string) => {
    if (installing.current.has(id)) return;
    installing.current.add(id); setError(''); setDownloads(current => ({ ...current, [id]: { loaded: 0, total: 0 } }));
    try {
      if (extensionCatalog.some(item => item.id === id)) {
        await downloadExtension(id, `${import.meta.env.BASE_URL}packs/${id}.json`, (loaded, total) => setDownloads(current => ({ ...current, [id]: { loaded, total } })));
        setExtensions(installedExtensions()); setDownloads(current => ({ ...current, [id]: { ...current[id], done: true } })); return;
      }
      const prompts = await downloadPack(id, `${import.meta.env.BASE_URL}packs/${id}.json`, (loaded, total) => setDownloads(current => ({ ...current, [id]: { loaded, total } })));
      if (save([...savedPrompts().filter(prompt => prompt.pack !== id), ...prompts])) setDownloads(current => ({ ...current, [id]: { ...current[id], done: true } }));
      else setDownloads(current => { const next = { ...current }; delete next[id]; return next; });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setDownloads(current => { const next = { ...current }; delete next[id]; return next; }); }
    finally { installing.current.delete(id); }
  };
  return <div className="intelligence-center prompt-library">
    <p className="settings-description">{marketplace ? 'Audited local tools and separate prompt packs. Tools run only when selected or explicitly mentioned. A tool-calling provider is required. Installing never grants system access.' : 'Save repeatable instructions. Use @shortcut in a message, or insert a prompt below. Exported libraries contain your prompt text; do not include secrets.'}</p>
    {error && <p className="connection-diagnostic" role="alert">{error}</p>}
    {marketplace && <><h3>Executable tools</h3>{extensionCatalog.map(pack => {
      const installed = extensions.includes(pack.id), download = downloads[pack.id];
      return <section className="settings-section marketplace-pack" key={pack.id}><BookOpen /><h3>{pack.name}</h3><p>{pack.description}</p><small>Nova · {pack.version} · local computation · no network or file access · @{pack.tool}</small><button className={`secondary ${installed ? 'pack-remove' : ''}`} disabled={Boolean(download && !download.done)} onClick={() => { if (installed) { const next = installedExtensions().filter(id => id !== pack.id); saveExtensions(next); setExtensions(next); setDownloads(current => { const next = { ...current }; delete next[pack.id]; return next; }); } else void install(pack.id); }}>{installed ? <><Trash2 />Remove tool</> : download ? 'Installing…' : <><Download />Install tool</>}</button>{download && <div className="pack-download" role="status"><progress max={download.total || undefined} value={download.total ? download.loaded : undefined} /><span>{download.done ? 'Installed · select in the chat Plugins menu' : `${download.loaded} / ${download.total || 'unknown'} bytes`}</span></div>}</section>;
    })}<h3>Prompt packs · use @commands</h3><p className="settings-description">Invoke these with @ in a message. Missing details can be collected in an inline form when your model supports tool calling. Prompt packs do not appear in Plugins.</p></>}
    {marketplace ? promptPacks.map(pack => {
      const installed = items.some(item => item.pack === pack.id);
      const download = downloads[pack.id];
      return <section className="settings-section marketplace-pack" key={pack.id}><BookOpen /><h3>{pack.name}</h3><p>{pack.description}</p><small>Source: Nova · 1.0 · prompt instructions · no executable tools</small><button className={`secondary ${installed ? 'pack-remove' : ''}`} disabled={Boolean(download && !download.done)} onClick={() => { if (installed) { save(savedPrompts().filter(item => item.pack !== pack.id)); setDownloads(current => { const next = { ...current }; delete next[pack.id]; return next; }); } else void install(pack.id); }}>{installed ? <><Trash2 />Remove pack</> : download ? 'Installing…' : <><Download />Install pack</>}</button>{download && <div className="pack-download" role="status"><progress max={download.total || undefined} value={download.total ? download.loaded : undefined} /><span>{download.done ? 'Installed · ready in the chat Plugins menu' : `${download.loaded.toLocaleString()} / ${download.total ? download.total.toLocaleString() : 'unknown'} bytes`}</span></div>}</section>;
    }) : <>
      <section className="settings-section"><h3>Your prompts</h3><div className="tool-command-actions"><button className="secondary" onClick={() => { const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'nova-prompts.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download />Export</button><button className="secondary" onClick={() => file.current?.click()}><Upload />Import</button></div><input ref={file} type="file" hidden accept=".json,application/json" onChange={async event => { const selected = event.target.files?.[0]; event.target.value = ''; if (!selected) return; try { if (selected.size > 2_000_000) throw new Error('Library file exceeds 2 MB.'); const imported = validatePrompts(JSON.parse(await selected.text())); const existing = new Set(items.map(item => item.shortcut)); save([...items, ...imported.filter(item => !existing.has(item.shortcut))]); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }} />
      {!items.length && <p>No prompts yet. Create one below or install a pack from Marketplace.</p>}
      {items.map(item => <div className="prompt-library-row" key={item.id}><span><b>{item.name}</b><code>@{item.shortcut}</code></span><button className="secondary" onClick={() => onUse(`@${item.shortcut} `)}>Use</button><button className="icon-button" aria-label={`Delete ${item.name}`} onClick={() => save(items.filter(entry => entry.id !== item.id))}><Trash2 /></button></div>)}</section>
      <section className="settings-section"><h3>New prompt</h3><label>Name<input value={draft.name} maxLength={100} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label>Shortcut<input placeholder="formal_email" value={draft.shortcut} onChange={e => setDraft({ ...draft, shortcut: e.target.value })} /></label><label>Instructions<textarea dir="auto" rows={6} maxLength={20000} value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} /></label><button className="primary-button" onClick={() => { if (save([...items, { ...draft, id: crypto.randomUUID() }])) setDraft({ name: '', shortcut: '', text: '' }); }}><Plus />Save prompt</button></section>
    </>}
  </div>;
}
