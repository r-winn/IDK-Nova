import { Check, Laptop, Moon, Sun } from 'lucide-react';
import type { ThemePreference } from '../types';

const options = [
  { id: 'system', label: 'System', detail: 'Automatic', Icon: Laptop },
  { id: 'light', label: 'Light', detail: 'Always light', Icon: Sun },
  { id: 'dark', label: 'Dark', detail: 'Always dark', Icon: Moon },
] as const;

export function ThemeSelector({ value, onChange }: { value: ThemePreference; onChange: (theme: ThemePreference) => void }) {
  return <div className="theme-selector" role="radiogroup" aria-label="Color theme">
    {options.map(({ id, label, detail, Icon }) => <button key={id} role="radio" aria-checked={value === id} className={value === id ? 'selected' : ''} onClick={() => onChange(id)}><Icon/><span><b>{label}</b><small>{detail}</small></span>{value === id && <Check className="theme-check"/>}</button>)}
  </div>;
}
