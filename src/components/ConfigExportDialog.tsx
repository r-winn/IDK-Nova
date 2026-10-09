import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { defaultExportSections, type ExportSections } from '../lib/config-bundle';

const choices: { id: keyof ExportSections; label: string; detail: string }[] = [
  { id: 'appearance', label: 'Appearance & preferences', detail: 'Theme, branding and response temperature' },
  { id: 'providers', label: 'Providers & models', detail: 'Connections and model lists; keys are optional below' },
  { id: 'prompts', label: 'Personal prompts', detail: 'Your saved instructions and shortcuts' },
  { id: 'packs', label: 'Installed prompt packs', detail: 'Pack content, ready to select after import' },
  { id: 'intelligence', label: 'Intelligence & routing', detail: 'Context settings and model routes; requires providers' },
  { id: 'prices', label: 'Model pricing', detail: 'Your configured token rates; requires providers' },
];
export function ConfigExportDialog({ onClose, onExport }: { onClose: () => void; onExport: (sections: ExportSections, keys: boolean, memory: boolean) => void }) {
  const [sections, setSections] = useState(defaultExportSections);
  const [keys, setKeys] = useState(false);
  const [memory, setMemory] = useState(false);
  const anySelected = Object.values(sections).some(Boolean) || memory;
  return <div className="config-export-backdrop" onClick={onClose}>
    <section className="config-export-dialog" role="dialog" aria-modal="true" aria-labelledby="config-export-title" onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header><div><h2 id="config-export-title">Export configuration</h2><p>Choose what to share with another device.</p></div><button autoFocus className="icon-button" aria-label="Close export" onClick={onClose}><X /></button></header>
      <div className="config-export-choices">
        {choices.map(choice => <label key={choice.id}><input type="checkbox" checked={sections[choice.id]} disabled={!sections.providers && (choice.id === 'intelligence' || choice.id === 'prices')} onChange={event => { const checked = event.target.checked; setSections(current => ({ ...current, [choice.id]: checked, ...(choice.id === 'providers' && !checked ? { intelligence: false, prices: false } : {}) })); if (choice.id === 'providers' && !checked) setKeys(false); }} /><span><b>{choice.label}</b><small>{choice.detail}</small></span></label>)}
        <label className="sensitive-export"><input type="checkbox" disabled={!sections.providers} checked={keys} onChange={event => setKeys(event.target.checked)} /><span><b>Include API keys</b><small>Private credentials will be readable in the file. Share securely.</small></span></label>
        <label><input type="checkbox" checked={memory} onChange={event => setMemory(event.target.checked)} /><span><b>Personal memory</b><small>Optional private notes; Work memory is not included.</small></span></label>
      </div>
      <p className="config-export-note">Chat history and project files use Work export. Database credentials are never included.</p>
      <footer><button className="secondary" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!anySelected} onClick={() => onExport(sections, keys, memory)}><Download />Export selected</button></footer>
    </section>
  </div>;
}
