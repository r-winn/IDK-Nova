import { useState } from 'react';
import { Pin, Plus, Trash2, Workflow, BookOpen, Activity, Wrench, ChartNoAxesCombined, History } from 'lucide-react';
import type { Chat, Config, WorkProject } from '../types';
import { contextEstimate, intelligenceSettings, memoryNotes, type MemoryNote, type RouteRole } from '../lib/intelligence';
import { loadValue } from '../lib/storage';
import { NOVA_TOOLS } from '../agent/catalog';
import type { AgentTask } from '../agent/protocol';
import { UsagePanel } from './UsagePanel';
import { CheckpointsPanel } from './CheckpointsPanel';

const sections = [
  { id: 'memory', title: 'Memory', icon: BookOpen },
  { id: 'routing', title: 'Model routing', icon: Workflow },
  { id: 'activity', title: 'Activity', icon: Activity },
  { id: 'tools', title: 'Built-in tools', icon: Wrench },
  { id: 'usage', title: 'Usage & cost', icon: ChartNoAxesCombined },
  { id: 'recovery', title: 'Recovery', icon: History },
] as const;
const toolGroups = [
  { scope: 'filesystem', title: 'Project files & planning' },
  { scope: 'terminal', title: 'Terminal' },
  { scope: 'browser', title: 'Browser' },
  { scope: 'computer', title: 'Desktop control' },
  { scope: 'user-input', title: 'User input' },
] as const;
const routeLabels: Record<RouteRole, string> = { fast: 'Simple questions', strong: 'Analysis & coding', vision: 'Images & vision', private: 'Private requests (local only)' };

export function IntelligenceCenter({ config, chat, projects, onProjectMemory, running }: { config: Config; chat: Chat; projects: WorkProject[]; onProjectMemory: (scope: string, notes: MemoryNote[]) => void; running: boolean }) {
  const [tab, setTab] = useState<'memory' | 'routing' | 'activity' | 'tools' | 'usage' | 'recovery'>('memory');
  const [settings, setSettings] = useState(intelligenceSettings);
  const [notes, setNotes] = useState(memoryNotes);
  const [scope, setScope] = useState(chat.workspaceId || 'personal');
  const [draft, setDraft] = useState('');
  const [excluded, setExcluded] = useState(() => loadValue<number[]>(`nova-context-excluded-${chat.id}`, []));
  const tasks = loadValue<AgentTask[]>('idk-nova-agent-tasks-v1', []).slice().reverse();
  const saveNotes = (value: MemoryNote[]) => { setNotes(value); localStorage.setItem('nova-memory-notes', JSON.stringify(value)); if (scope !== 'personal') onProjectMemory(scope, value.filter(note => note.scope === scope)); };
  const saveSettings = (value: typeof settings) => { setSettings(value); localStorage.setItem('nova-intelligence', JSON.stringify(value)); };
  const models = config.providers.flatMap(provider => provider.models.map(model => ({ value: `${provider.id}::${model}`, label: `${provider.name} · ${model}` })));
  return <div className="intelligence-center">
    <nav className="intelligence-tabs" aria-label="Intelligence sections">{sections.map(({ id, title, icon: Icon }) => <button key={id} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon />{title}</button>)}</nav>
    {tab === 'usage' && <UsagePanel config={config} />}
    {tab === 'recovery' && <CheckpointsPanel projects={projects} running={running} />}
    {tab === 'memory' && <>
      <section className="settings-section"><h3>Memory scope</h3><p>Notes in a Work project are available only to that project's chats. Changes apply to the next request.</p><select value={scope} onChange={event => setScope(event.target.value)}><option value="personal">Personal chats</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        {notes.filter(note => note.scope === scope).map(note => <div className="memory-note" key={note.id}><textarea dir="auto" value={note.text} onChange={event => saveNotes(notes.map(item => item.id === note.id ? { ...item, text: event.target.value.slice(0, 4000) } : item))} /><button className={note.pinned ? 'active' : ''} aria-label="Pin memory" onClick={() => saveNotes(notes.map(item => item.id === note.id ? { ...item, pinned: !item.pinned } : item))}><Pin /></button><button aria-label="Delete memory" onClick={() => saveNotes(notes.filter(item => item.id !== note.id))}><Trash2 /></button></div>)}
        <textarea dir="auto" placeholder="Add a fact or preference to remember…" maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)} /><button className="primary-button" disabled={!draft.trim()} onClick={() => { saveNotes([...notes, { id: crypto.randomUUID(), scope, text: draft.trim(), pinned: false }]); setDraft(''); }}><Plus />Add memory</button><small>Memory and intelligence preferences save immediately on this device. Do not store API keys or passwords in memory notes.</small>
      </section>
      <section className="settings-section"><h3>Current conversation context</h3><p>About {contextEstimate(chat.messages).toLocaleString()} text tokens before filtering. This is an estimate, not provider billing or image usage.</p><label>Recent messages to include<input type="number" min={2} max={200} value={settings.contextMessages} onChange={event => saveSettings({ ...settings, contextMessages: Math.max(2, Math.min(200, Number(event.target.value) || 2)) })} /></label>
        <div className="context-message-list">{chat.messages.map((message, index) => <label key={index}><input type="checkbox" checked={!excluded.includes(index)} onChange={() => { const next = excluded.includes(index) ? excluded.filter(item => item !== index) : [...excluded, index]; setExcluded(next); localStorage.setItem(`nova-context-excluded-${chat.id}`, JSON.stringify(next)); }} /><span><b>{message.role}</b><small>{message.content.slice(0, 160)}</small></span></label>)}</div>
      </section>
    </>}
    {tab === 'routing' && <section className="settings-section"><h3>Automatic model routing</h3><p>Choose a model for each kind of request. Private requests require a local endpoint.</p><label className="include-provider-keys"><input type="checkbox" checked={settings.enabled} onChange={event => saveSettings({ ...settings, enabled: event.target.checked })} />Enable routing</label>{(['fast', 'strong', 'vision', 'private'] as RouteRole[]).map(role => <label key={role}>{routeLabels[role]}<select value={settings.routes[role] || ''} onChange={event => saveSettings({ ...settings, routes: { ...settings.routes, [role]: event.target.value } })}><option value="">{role === 'private' ? 'Choose a local model (required)' : 'Use selected model'}</option>{models.map(model => <option value={model.value} key={model.value}>{model.label}</option>)}</select></label>)}</section>}
    {tab === 'activity' && <section className="settings-section"><h3>Agent activity</h3><p>Recorded plans, approvals, actions, failures and completion for this device.</p>{tasks.length === 0 && <p>No Work tasks have run yet.</p>}{tasks.map(task => <details className="task-record" key={task.id}><summary><b>{task.goal.slice(0, 100)}</b><small>{task.state} · {new Date(task.updatedAt).toLocaleString()}</small></summary>{task.events.map(event => <div key={event.id}><b>{event.label}</b><small>{event.toolName || event.kind} · {new Date(event.at).toLocaleTimeString()}</small>{event.detail && <p>{event.detail}</p>}</div>)}</details>)}</section>}
    {tab === 'tools' && <section className="settings-section"><h3>Built-in Work tools</h3><p>Included with Nova; no installation is needed. Work access permissions control their use in the desktop app. This is a tool catalog, not a third-party marketplace.</p>{toolGroups.map(group => <details className="tool-group" key={group.scope}><summary><b>{group.title}</b><span>{NOVA_TOOLS.filter(tool => tool.nova.scope === group.scope).length} tools</span></summary>{NOVA_TOOLS.filter(tool => tool.nova.scope === group.scope).map(tool => <details className="task-record" key={tool.function.name}><summary><b>{tool.nova.label.replace(/…$/, '')}</b><small>{tool.nova.risk} risk · {tool.nova.effect}</small></summary><p>{tool.function.description}</p><code>{tool.function.name}</code></details>)}</details>)}</section>}
  </div>;
}
