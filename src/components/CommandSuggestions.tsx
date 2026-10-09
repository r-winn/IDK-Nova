import { cloneElement, isValidElement, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { savedPrompts } from '../lib/prompts';
import { extensionCatalog, installedExtensions } from '../lib/extensions';
import { providerTools } from '../agent/catalog';
import { mentionAt, suggestCommands } from '../lib/command-suggestions';

export function CommandSuggestions({ value, onChange, work = false, disabled = false, children }: { value: string; onChange: (value: string) => void; work?: boolean; disabled?: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null), id = useId();
  const [caret, setCaret] = useState(value.length), [focused, setFocused] = useState(false), [dismissed, setDismissed] = useState(''), [active, setActive] = useState(0);
  const mention = mentionAt(value, caret);
  const installed = installedExtensions();
  const options = [...savedPrompts().map(item => ({ name: item.shortcut, label: item.name, kind: 'Prompt' })), ...extensionCatalog.filter(item => installed.includes(item.id)).map(item => ({ name: item.tool, label: item.name, kind: 'Tool' })), ...(work ? providerTools.map(item => ({ name: item.function.name, label: item.function.description, kind: 'Work tool' })) : [])];
  const matches = mention ? suggestCommands(options, mention.query) : [];
  const visible = focused && !disabled && !!mention && !!matches.length && dismissed !== `${value}:${caret}`;
  const choose = (index: number) => {
    if (!mention || !matches[index]) return;
    const inserted = `@${matches[index].name} `, next = value.slice(0, mention.start) + inserted + value.slice(mention.end);
    onChange(next); setCaret(mention.start + inserted.length); setDismissed(`${next}:${mention.start + inserted.length}`);
    requestAnimationFrame(() => { const input = root.current?.querySelector('textarea'); input?.focus(); input?.setSelectionRange(mention.start + inserted.length, mention.start + inserted.length); });
  };
  return <div className="command-composer" ref={root} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false); }} onSelectCapture={event => { if (event.target instanceof HTMLTextAreaElement) setCaret(event.target.selectionStart); }} onInputCapture={event => { if (event.target instanceof HTMLTextAreaElement) { setCaret(event.target.selectionStart); setActive(0); setDismissed(''); } }} onKeyDownCapture={event => {
    if (event.nativeEvent.isComposing || !visible) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length); }
    else if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); choose(Math.min(active, matches.length - 1)); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(`${value}:${caret}`); }
  }}>
    {visible && <div className="command-suggestions" role="listbox" id={id} aria-label="Command suggestions">{matches.map((item, index) => <button type="button" id={`${id}-${index}`} role="option" aria-selected={index === Math.min(active, matches.length - 1)} className={index === Math.min(active, matches.length - 1) ? 'active' : ''} key={item.name} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}><span><b>@{item.name}</b><small>{item.label}</small></span><em>{item.kind}</em></button>)}<small>↑ ↓ to choose · Enter or Tab to insert · Esc to close</small></div>}
    {isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, { 'aria-autocomplete': 'list', 'aria-controls': visible ? id : undefined, 'aria-activedescendant': visible ? `${id}-${Math.min(active, matches.length - 1)}` : undefined }) : children}
  </div>;
}
