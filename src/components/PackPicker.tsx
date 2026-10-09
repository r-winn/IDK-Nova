import { useEffect, useRef, useState } from 'react';
import { Check, Puzzle, X } from 'lucide-react';
import { installedPacks, PACKS_CHANGED } from '../lib/packs';

export function PackPicker({ selected, onChange, disabled }: { selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const [packs, setPacks] = useState(installedPacks);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { const update = () => setPacks(installedPacks()); window.addEventListener(PACKS_CHANGED, update); return () => window.removeEventListener(PACKS_CHANGED, update); }, []);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && root.current?.contains(document.activeElement)) { setOpen(false); root.current.querySelector<HTMLButtonElement>('button')?.focus(); } };
    document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => { setOpen(false); }, [disabled]);
  useEffect(() => { const valid = selected.filter(id => packs.some(pack => pack.id === id)); if (valid.length !== selected.length) onChange(valid); }, [packs, selected, onChange]);
  return <div className="pack-picker" ref={root}>
    <button type="button" disabled={disabled} title="Plugins · prompt packs" aria-label="Plugins" aria-expanded={open} onClick={() => setOpen(!open)}><Puzzle /></button>
    {open && <div className="pack-menu" role="menu" aria-label="Installed plugins"><b>Installed tools & prompt packs</b>{!packs.length && <p>Install a pack in Settings → Marketplace.</p>}{packs.map(pack => <button type="button" role="menuitemcheckbox" aria-checked={selected.includes(pack.id)} key={pack.id} onClick={() => { onChange(selected.includes(pack.id) ? selected.filter(id => id !== pack.id) : [...selected, pack.id]); setOpen(false); }}><Puzzle /><span>{pack.name}<small>{pack.prompts.length ? 'Prompt instructions' : 'Executable tool · tool-calling model required'}</small></span>{selected.includes(pack.id) && <Check />}</button>)}<small>Only selected tools are exposed. Work permissions stay unchanged.</small></div>}
    {packs.filter(pack => selected.includes(pack.id)).map(pack => <button type="button" className="pack-pill" key={pack.id} disabled={disabled} title={`Remove ${pack.name}`} onClick={() => onChange(selected.filter(id => id !== pack.id))}><span>{pack.name}</span><X /></button>)}
  </div>;
}
