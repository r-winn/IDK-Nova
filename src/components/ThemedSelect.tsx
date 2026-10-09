import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export function ThemedSelect({ value, onValueChange, children, disabled = false, label = 'Choose an option' }: { value: string; onValueChange: (value: string) => void; children: ReactNode; disabled?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const options = Children.toArray(children).filter(isValidElement).map(item => { const props = item.props as { value: string; children: ReactNode; disabled?: boolean }; return props; });
  const selected = options.findIndex(option => option.value === value);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div className="themed-select" ref={root}>
    <button type="button" role="combobox" aria-label={label} aria-expanded={open} aria-controls={id} aria-activedescendant={open ? `${id}-${active}` : undefined} disabled={disabled} onClick={() => { setActive(Math.max(0, selected)); setOpen(!open); }} onKeyDown={event => {
      if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(index => Math.max(0, Math.min(options.length - 1, (open ? index : Math.max(0, selected)) + (event.key === 'ArrowDown' ? 1 : -1)))); }
      if (event.key === 'Enter' && open) { event.preventDefault(); const option = options[active]; if (option && !option.disabled) onValueChange(option.value); setOpen(false); }
      if (event.key === 'Tab') setOpen(false);
    }}><span>{options[selected]?.children || 'Choose…'}</span><ChevronDown /></button>
    {open && <div className="themed-select-options" role="listbox" id={id} aria-label={label}>{options.map((option, index) => <button type="button" role="option" tabIndex={-1} id={`${id}-${index}`} aria-selected={option.value === value} disabled={option.disabled} className={active === index ? 'highlighted' : ''} key={option.value} onPointerDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => { onValueChange(option.value); setOpen(false); }}><span>{option.children}</span>{option.value === value && <Check />}</button>)}</div>}
  </div>;
}
