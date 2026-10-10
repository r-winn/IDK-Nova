import { useEffect, useRef, useState } from 'react';
import { Check, Puzzle, X } from 'lucide-react';
import { installedPlugins, PACKS_CHANGED } from '../lib/packs';
import { PluginIcon } from './PluginIcon';

export function PackPicker({ selected, onChange, disabled }: { selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const [packs, setPacks] = useState(installedPlugins);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { const update = () => setPacks(installedPlugins()); window.addEventListener(PACKS_CHANGED, update); return () => window.removeEventListener(PACKS_CHANGED, update); }, []);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && root.current?.contains(document.activeElement)) { setOpen(false); root.current.querySelector<HTMLButtonElement>('button')?.focus(); } };
    document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => { setOpen(false); }, [disabled]);
  useEffect(() => { const valid = selected.filter(id => packs.some(pack => pack.id === id)); if (valid.length !== selected.length) onChange(valid); }, [packs, selected, onChange]);
  return <div className="pack-picker" ref={root}>
    <button type="button" disabled={disabled} title="Plugins · executable tools" aria-label="Plugins" aria-expanded={open} onClick={() => setOpen(!open)}><Puzzle /></button>
    {open && <div className="pack-menu" role="menu" aria-label="Installed plugins"><b>Installed plugins</b>{!packs.length && <p>Install an executable tool in Settings → Marketplace.</p>}{packs.map(pack => <button type="button" role="menuitemcheckbox" aria-checked={selected.includes(pack.id)} key={pack.id} onClick={() => { onChange(selected.includes(pack.id) ? selected.filter(id => id !== pack.id) : [...selected, pack.id]); setOpen(false); }}><PluginIcon id={pack.id} /><span>{pack.name}<small>{pack.id === 'github' ? 'Public GitHub · read-only network access' : 'On-device tool · no network access'}</small></span>{selected.includes(pack.id) && <Check />}</button>)}<small>Prompt packs use @commands. Work permissions stay unchanged.</small></div>}
    {packs.filter(pack => selected.includes(pack.id)).map(pack => <button type="button" className="pack-pill" key={pack.id} disabled={disabled} title={`Remove ${pack.name}`} onClick={() => onChange(selected.filter(id => id !== pack.id))}><span>{pack.name}</span><X /></button>)}
  </div>;
}
