import { useState } from 'react';
import { Search, ChevronRight } from 'lucide-react';
import { NOVA_TOOLS } from '../agent/catalog';

const groups = [
  { scope: 'filesystem', title: 'Project files & planning' },
  { scope: 'terminal', title: 'Terminal' },
  { scope: 'browser', title: 'Browser' },
  { scope: 'computer', title: 'Desktop control' },
  { scope: 'user-input', title: 'User input' },
];

export function ToolsCatalog() {
  const [query, setQuery] = useState('');
  const [risk, setRisk] = useState('all');
  const tools = NOVA_TOOLS.filter(tool => (risk === 'all' || tool.nova.risk === risk) && `${tool.function.name} ${tool.function.description} ${tool.nova.label}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="intelligence-center tools-catalog">
    <p className="settings-description">Built into Nova. Desktop Work permissions control access; nothing needs to be installed.</p>
    <div className="tools-filters"><label className="tool-search"><Search /><input aria-label="Search tools" placeholder="Search capabilities…" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Filter tools by risk" value={risk} onChange={event => setRisk(event.target.value)}><option value="all">All permissions</option><option value="low">Low risk</option><option value="medium">Medium risk</option><option value="high">High risk</option></select></div>
    <small className="tools-count">{tools.length} available capabilities</small>
    {groups.map(group => { const items = tools.filter(tool => tool.nova.scope === group.scope); return items.length > 0 && <section className="settings-section" key={group.scope}><h3>{group.title}</h3>{items.map(tool => <details className="tool-entry" key={tool.function.name}><summary><ChevronRight /><span>{tool.nova.label.replace(/…$/, '')}</span><small className={`tool-risk ${tool.nova.risk}`}>{tool.nova.risk}</small></summary><div><p>{tool.function.description}</p><code>{tool.function.name}</code></div></details>)}</section>; })}
    {tools.length === 0 && <p className="settings-description">No matching tools. Try a different search or permission filter.</p>}
  </div>;
}
