import { Fragment, useEffect, useRef, useState } from 'react';
import { Check, Download, Search, Trash2 } from 'lucide-react';
import { extensionCatalog, installedExtensions, saveExtensions } from '../lib/extensions';
import { promptPacks, savedPrompts } from '../lib/prompts';
import { downloadExtension, downloadPack, PACKS_CHANGED, storePrompts } from '../lib/packs';
import { PluginIcon } from './PluginIcon';
import { connectGithub, disconnectGithub, githubLogin } from '../lib/github-connection';
import { isTauri } from '@tauri-apps/api/core';
import { pluginAvailability } from '../lib/feature-availability';

export function Marketplace() {
  const [tab, setTab] = useState<'plugins' | 'prompts'>('plugins');
  const [query, setQuery] = useState(''), [onlyInstalled, setOnlyInstalled] = useState(false);
  const [extensions, setExtensions] = useState(installedExtensions), [prompts, setPrompts] = useState(savedPrompts);
  const [error, setError] = useState('');
  const [login, setLogin] = useState(githubLogin), [connecting, setConnecting] = useState(false), [connectOpen, setConnectOpen] = useState(false), [token, setToken] = useState('');
  const [downloads, setDownloads] = useState<Record<string, { loaded: number; total: number }>>({});
  const installing = useRef(new Set<string>());
  useEffect(() => {
    const update = () => { setExtensions(installedExtensions()); setPrompts(savedPrompts()); };
    window.addEventListener(PACKS_CHANGED, update); return () => window.removeEventListener(PACKS_CHANGED, update);
  }, []);
  const catalog = tab === 'plugins' ? extensionCatalog.filter(item => ['word', 'excel', 'powerpoint', 'chrome', 'github', 'pdf-reader', 'archive', 'csv-analysis'].includes(item.id) || (onlyInstalled && extensions.includes(item.id))) : promptPacks;
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
    if (id === 'github') { setConnectOpen(false); setToken(''); }
    try { if (extensions.includes(id)) saveExtensions(installedExtensions().filter(value => value !== id)); else storePrompts(savedPrompts().filter(prompt => prompt.pack !== id)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <div className="nova-marketplace">
    <div className="marketplace-tabs" role="tablist" aria-label="Marketplace categories">
      <button role="tab" aria-selected={tab === 'plugins'} onClick={() => { setTab('plugins'); setQuery(''); setOnlyInstalled(false); }}>Plugins</button>
      <button role="tab" aria-selected={tab === 'prompts'} onClick={() => { setTab('prompts'); setQuery(''); setOnlyInstalled(false); }}>Prompt packs</button>
    </div>
    <header><h2>{tab === 'plugins' ? 'Plugins' : 'Prompt packs'}</h2><p>{tab === 'plugins' ? 'Give your model real tools, not just extra instructions.' : 'Thoughtful instructions, ready when you need them.'}</p></header>
    <div className="marketplace-search-dock"><label className="marketplace-search"><Search /><input aria-label="Search marketplace" placeholder={tab === 'plugins' ? 'Search plugins' : 'Search prompt packs'} value={query} onChange={event => setQuery(event.target.value)} /></label></div>
    {error && <p className="connection-diagnostic" role="alert">{error}</p>}
    <section className="marketplace-installed"><div><h3>Installed <span>{installedItems.length}</span></h3><button aria-pressed={onlyInstalled} onClick={() => setOnlyInstalled(value => !value)}>{onlyInstalled ? 'Browse all' : 'Show installed'}</button></div>
      {installedItems.length ? <div className="marketplace-icon-strip">{installedItems.map(item => <button key={item.id} title={item.name} aria-label={`Find ${item.name}`} onClick={() => { setQuery(item.name); setOnlyInstalled(true); }}><PluginIcon id={item.id} /></button>)}</div> : <p>Nothing installed yet. Choose a package below to get started.</p>}
    </section>
    <section><h3>{onlyInstalled ? 'Your collection' : tab === 'plugins' ? 'Explore plugins' : 'Writing, development & research'}</h3>
      <div className="marketplace-grid">{items.map(item => {
        const ready = installed(item.id), download = downloads[item.id], tool = 'tool' in item ? item.tool : '';
        const availability = pluginAvailability(item.id, isTauri(), true);
        return <Fragment key={item.id}><article className="marketplace-item">
          <PluginIcon id={item.id} /><div className="marketplace-item-content"><h4>{item.name}{ready && <Check aria-label="Installed" />}</h4><p>{item.description}</p>
            <small>Nova · v{'version' in item ? item.version : '1.0'} · {item.id === 'chrome' ? 'Desktop Work · separate Chrome profile · browser permissions' : item.id === 'github' ? 'GitHub API · read-only access' : ['word', 'excel', 'powerpoint'].includes(item.id) ? 'On-device · read, create & revise Office files' : tool ? 'On-device · no network access' : 'Instructions · no executable access'}</small>
            <code>{!availability.available ? availability.reason : tool ? 'Select in chat' : 'prompts' in item ? item.prompts.map(prompt => `@${prompt.shortcut}`).join(' · ') : ''}</code>
            {item.id === 'github' && ready && <div className="github-connect">
              {login ? <><span>Connected as {login}</span><button disabled={connecting} onClick={async () => { setConnecting(true); try { await disconnectGithub(); setLogin(''); } catch { setError('Could not disconnect GitHub. Try again.'); } finally { setConnecting(false); } }}>Disconnect</button></> : <button onClick={() => setConnectOpen(value => !value)}>Connect GitHub</button>}
            </div>}
            <div className="pack-download-slot" data-active={Boolean(download)}>{download && <div className="pack-download" role="status"><progress max={download.total || undefined} value={download.total ? download.loaded : undefined} /><span>{download.loaded.toLocaleString()} / {download.total ? download.total.toLocaleString() : 'unknown'} bytes</span></div>}</div>
          </div>
          <button className={`marketplace-action ${ready ? 'pack-remove' : ''}`} disabled={Boolean(download) || (!availability.available && !ready)} title={availability.reason} aria-label={`${ready ? 'Remove' : 'Install'} ${item.name}`} onClick={() => ready ? remove(item.id) : availability.available && void install(item.id)}>{ready ? <Trash2 /> : <Download />}<span>{download ? 'Installing…' : ready ? 'Remove' : !availability.available ? 'Desktop' : 'Install'}</span></button>
</article>{item.id === 'github' && <div className="github-connection-panel" data-open={ready && connectOpen && !login} aria-hidden={!ready || !connectOpen || Boolean(login)}><div><form onSubmit={async event => { event.preventDefault(); setConnecting(true); setError(''); try { setLogin(await connectGithub(token)); setToken(''); setConnectOpen(false); } catch (e) { setError(e instanceof Error ? e.message : 'Connection failed.'); } finally { setConnecting(false); } }}>
          <h4>Connect your GitHub account</h4><p>Use a personal access token, not a connection string or your GitHub password.</p>
          <ol><li>Open GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens.</li><li>Create a token, choose an expiry and select only the repositories you need.</li><li>Set Contents, Issues and Pull requests to Read-only. Copy the token and paste it below.</li></ol>
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" tabIndex={connectOpen ? 0 : -1}>Create a fine-grained token on GitHub ↗</a>
          <label>Personal access token<input type="password" aria-label="GitHub access token" placeholder="github_pat_…" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" disabled={!connectOpen || connecting} /></label>
          <div className="github-connection-actions"><button type="button" disabled={connecting} tabIndex={connectOpen ? 0 : -1} onClick={() => { setConnectOpen(false); setToken(''); }}>Cancel</button><button disabled={!connectOpen || connecting || !token.trim()}>{connecting ? 'Connecting…' : 'Test & connect'}</button></div>
          <small>Never share this token. Desktop saves it in the OS vault; web keeps it for this session only. Tokens are never exported. Organization repositories may require administrator approval.</small>
        </form></div></div>}</Fragment>;
      })}</div>{!items.length && <p className="marketplace-empty">No matching packages. Try another search.</p>}
    </section>
    <p className="marketplace-note">{tab === 'plugins' ? 'Select installed plugins beside attachments. Plugins are not activated with @. A tool-calling model is required. Office plugins read, create and revise actual files; previews may differ from Microsoft Office for complex objects. PDF research extracts real page text, not OCR. Delivery bundles package selected chat files. Chrome requires desktop Work and a separate browser profile. GitHub is read-only.' : 'Type @ in the composer to invoke an installed prompt. Missing details can be collected in an inline form; replies stream normally when your provider supports streaming.'}</p>
  </div>;
}
