import { useEffect, useRef, useState } from 'react';
import { Check, Download, Search, Trash2 } from 'lucide-react';
import { extensionCatalog, installedExtensions, saveExtensions } from '../lib/extensions';
import { promptPacks, savedPrompts } from '../lib/prompts';
import { downloadExtension, downloadPack, PACKS_CHANGED, storePrompts } from '../lib/packs';
import { PluginIcon } from './PluginIcon';

export function Marketplace() {
  const [tab, setTab] = useState<'plugins' | 'prompts'>('plugins');
  const [query, setQuery] = useState(''), [onlyInstalled, setOnlyInstalled] = useState(false);
  const [extensions, setExtensions] = useState(installedExtensions), [prompts, setPrompts] = useState(savedPrompts);
  const [error, setError] = useState('');
  const [downloads, setDownloads] = useState<Record<string, { loaded: number; total: number }>>({});
  const installing = useRef(new Set<string>());
  useEffect(() => {
    const update = () => { setExtensions(installedExtensions()); setPrompts(savedPrompts()); };
    window.addEventListener(PACKS_CHANGED, update); return () => window.removeEventListener(PACKS_CHANGED, update);
  }, []);
  const catalog = tab === 'plugins' ? extensionCatalog : promptPacks;
  const installed = (id: string) => extensions.includes(id) || prompts.some(prompt => prompt.pack === id);
  const installedItems = catalog.filter(item => installed(item.id));
  const items = catalog.filter(item => (!onlyInstalled || installed(item.id)) && `${item.name} ${item.description} ${'tool' in item ? item.tool : item.prompts.map(prompt => prompt.shortcut).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const install = async (id: string) => {
    if (installing.current.has(id)) return;
    installing.current.add(id); setError(''); setDownloads(current => ({ ...current, [id]: { loaded: 0, total: 0 } }));
    const progress = (loaded: number, total: number) => setDownloads(current => ({ ...current, [id]: { loaded, total } }));
    try {
      const url = `${import.meta.env.BASE_URL}packs/${id}.json`;
      if (extensionCatalog.some(item => item.id === id)) await downloadExtension(id, url, progress);
      else storePrompts([...savedPrompts().filter(prompt => prompt.pack !== id), ...await downloadPack(id, url, progress)]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { installing.current.delete(id); setDownloads(current => { const next = { ...current }; delete next[id]; return next; }); }
  };
  const remove = (id: string) => {
    try { if (extensions.includes(id)) saveExtensions(installedExtensions().filter(value => value !== id)); else storePrompts(savedPrompts().filter(prompt => prompt.pack !== id)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <div className="nova-marketplace">
    <div className="marketplace-tabs" role="tablist" aria-label="Marketplace categories">
      <button role="tab" aria-selected={tab === 'plugins'} onClick={() => { setTab('plugins'); setQuery(''); setOnlyInstalled(false); }}>Plugins</button>
      <button role="tab" aria-selected={tab === 'prompts'} onClick={() => { setTab('prompts'); setQuery(''); setOnlyInstalled(false); }}>Prompt packs</button>
    </div>
    <header><h2>{tab === 'plugins' ? 'Plugins' : 'Prompt packs'}</h2><p>{tab === 'plugins' ? 'Give your model real tools, not just extra instructions.' : 'Thoughtful instructions, ready when you need them.'}</p></header>
    <label className="marketplace-search"><Search /><input aria-label="Search marketplace" placeholder={tab === 'plugins' ? 'Search plugins' : 'Search prompt packs'} value={query} onChange={event => setQuery(event.target.value)} /></label>
    {error && <p className="connection-diagnostic" role="alert">{error}</p>}
    <section className="marketplace-installed"><div><h3>Installed <span>{installedItems.length}</span></h3><button aria-pressed={onlyInstalled} onClick={() => setOnlyInstalled(value => !value)}>{onlyInstalled ? 'Browse all' : 'Show installed'}</button></div>
      {installedItems.length ? <div className="marketplace-icon-strip">{installedItems.map(item => <button key={item.id} title={item.name} aria-label={`Find ${item.name}`} onClick={() => { setQuery(item.name); setOnlyInstalled(true); }}><PluginIcon id={item.id} /></button>)}</div> : <p>Nothing installed yet. Choose a package below to get started.</p>}
    </section>
    <section><h3>{onlyInstalled ? 'Your collection' : tab === 'plugins' ? 'Explore plugins' : 'Writing, development & research'}</h3>
      <div className="marketplace-grid">{items.map(item => {
        const ready = installed(item.id), download = downloads[item.id], tool = 'tool' in item ? item.tool : '';
        return <article className="marketplace-item" key={item.id}>
          <PluginIcon id={item.id} /><div className="marketplace-item-content"><h4>{item.name}{ready && <Check aria-label="Installed" />}</h4><p>{item.description}</p>
            <small>Nova · v{'version' in item ? item.version : '1.0'} · {item.id === 'github' ? 'Public GitHub · read-only network access' : tool ? 'On-device · no network or file access' : 'Instructions · no executable access'}</small>
            <code>{tool ? `@${tool}` : 'prompts' in item ? item.prompts.map(prompt => `@${prompt.shortcut}`).join(' · ') : ''}</code>
            {download && <div className="pack-download" role="status"><progress max={download.total || undefined} value={download.total ? download.loaded : undefined} /><span>{download.loaded.toLocaleString()} / {download.total ? download.total.toLocaleString() : 'unknown'} bytes</span></div>}
          </div>
          <button className={`marketplace-action ${ready ? 'pack-remove' : ''}`} disabled={Boolean(download)} aria-label={`${ready ? 'Remove' : 'Install'} ${item.name}`} onClick={() => ready ? remove(item.id) : void install(item.id)}>{ready ? <Trash2 /> : <Download />}<span>{download ? 'Installing…' : ready ? 'Remove' : 'Install'}</span></button>
        </article>;
      })}</div>{!items.length && <p className="marketplace-empty">No matching packages. Try another search.</p>}
    </section>
    <p className="marketplace-note">{tab === 'plugins' ? 'Select installed plugins beside the chat attachment button, or invoke their @command. A tool-calling model is required. Selecting GitHub allows read-only requests to api.github.com; no account, private repository access or write permission is granted.' : 'Type @ in the composer to invoke an installed prompt. Missing details can be collected in an inline form; replies stream normally when your provider supports streaming.'}</p>
  </div>;
}
