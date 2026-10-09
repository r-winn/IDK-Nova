import { useState } from 'react';
import { Search, ChevronRight, Plus, Copy } from 'lucide-react';
import { NOVA_TOOLS } from '../agent/catalog';
import { ThemedSelect } from './ThemedSelect';

const groups = [
  { scope: 'filesystem', title: 'Project files & planning' },
  { scope: 'terminal', title: 'Terminal' },
  { scope: 'browser', title: 'Browser' },
  { scope: 'computer', title: 'Desktop control' },
  { scope: 'user-input', title: 'User input' },
];

export function ToolsCatalog({ onInsertCommand }: { onInsertCommand: (command: string) => void }) {
  const [query, setQuery] = useState('');
  const [risk, setRisk] = useState('all');
  const tools = NOVA_TOOLS.filter(tool => (risk === 'all' || tool.nova.risk === risk) && `${tool.function.name} ${tool.function.description} ${tool.nova.label}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="intelligence-center tools-catalog">
    <p className="settings-description">Request a tool in a desktop Work chat with @tool_name and describe what it should do. Commands follow your Work permissions and require a tool-capable model.</p>
    <div className="tools-filters"><label className="tool-search"><Search /><input aria-label="Search tools" placeholder="Search capabilities…" value={query} onChange={event => setQuery(event.target.value)} /></label><ThemedSelect label="Filter tools by risk" value={risk} onValueChange={setRisk}><option value="all">All permissions</option><option value="low">Low risk</option><option value="medium">Medium risk</option><option value="high">High risk</option></ThemedSelect></div>
    <small className="tools-count">{tools.length} available capabilities</small>
    {groups.map(group => { const items = tools.filter(tool => tool.nova.scope === group.scope); return items.length > 0 && <section className="settings-section" key={group.scope}><h3>{group.title}</h3>{items.map(tool => <ToolEntry key={tool.function.name} tool={tool} onInsertCommand={onInsertCommand} />)}</section>; })}
    {tools.length === 0 && <p className="settings-description">No matching tools. Try a different search or permission filter.</p>}
  </div>;
}

function ToolEntry({ tool, onInsertCommand }: { tool: typeof NOVA_TOOLS[number]; onInsertCommand: (command: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const command = `@${tool.function.name}`;
  return <details className="tool-entry"><summary><ChevronRight /><span>{tool.nova.label.replace(/…$/, '')}</span><small className={`tool-risk ${tool.nova.risk}`}>{tool.nova.risk}</small></summary><div><p>{tool.function.description}</p><div className="tool-command-actions"><code>{command}</code><button className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(command); setCopied(true); setCopyError(false); } catch { setCopyError(true); } }}><Copy />{copied ? 'Copied' : 'Copy'}</button><button className="secondary" onClick={() => onInsertCommand(command)}><Plus />Use in chat</button></div>{copyError && <small role="alert">Clipboard access was denied. Select the command to copy it manually.</small>}</div></details>;
}
