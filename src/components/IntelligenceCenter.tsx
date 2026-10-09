import { useState, type ReactNode } from 'react';
import { ThemedSelect } from './ThemedSelect';
import { Pin, Plus, Trash2, Workflow, BookOpen, Activity, ChartNoAxesCombined, History } from 'lucide-react';
import type { Chat, Config, WorkProject } from '../types';
import { contextEstimate, intelligenceSettings, memoryNotes, type MemoryNote, type RouteRole } from '../lib/intelligence';
import { loadValue } from '../lib/storage';
import type { AgentTask } from '../agent/protocol';
import { UsagePanel } from './UsagePanel';
import { CheckpointsPanel } from './CheckpointsPanel';

const sections = [
  { id: 'memory', title: 'Memory', icon: BookOpen },
  { id: 'response', title: 'Response style', icon: Workflow },
  { id: 'routing', title: 'Model routing', icon: Workflow },
  { id: 'activity', title: 'Activity', icon: Activity },
  { id: 'usage', title: 'Usage & cost', icon: ChartNoAxesCombined },
  { id: 'recovery', title: 'Recovery', icon: History },
] as const;
const routeLabels: Record<RouteRole, string> = { fast: 'Simple questions', strong: 'Analysis & coding', vision: 'Images & vision', private: 'Private requests (local only)' };

export function IntelligenceCenter({ config, chat, projects, onProjectMemory, running, responsePanel, storagePanel, onResume, onPrivacy }: { config: Config; chat: Chat; projects: WorkProject[]; onProjectMemory: (scope: string, notes: MemoryNote[]) => void; running: boolean; responsePanel: ReactNode; storagePanel: ReactNode; onResume: (task: AgentTask) => void; onPrivacy: (id: string, localOnly: boolean) => void }) {
  const [tab, setTab] = useState<'memory' | 'response' | 'routing' | 'activity' | 'usage' | 'recovery'>('memory');
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
    {tab === 'recovery' && <section className="settings-section"><h3>Interrupted work</h3><p>Review the last recorded actions, then prepare a continuation in the original chat. Nothing runs until you send it; Nova rechecks the files and does not replay old actions automatically.</p>{tasks.filter(task => ['interrupted', 'failed', 'paused'].includes(task.state)).map(task => <div className="prompt-library-row" key={task.id}><span><b>{task.goal.slice(0, 100)}</b><small>{task.state} · {new Date(task.updatedAt).toLocaleString()}</small></span><button className="secondary" disabled={running || !projects.some(project => project.id === task.workspaceId)} onClick={() => onResume(task)}>Prepare continuation</button></div>)}</section>}
    {tab === 'response' && responsePanel}
    {tab === 'memory' && <>
      {scope !== 'personal' && <section className="settings-section"><h3>Work privacy</h3><label className="include-provider-keys"><input type="checkbox" disabled={running} checked={Boolean(projects.find(project => project.id === scope)?.localOnly)} onChange={event => onPrivacy(scope, event.target.checked)} />Local models only</label><p>Blocks every chat request for this Work unless the selected model uses a loopback endpoint. It does not disable browser or terminal network access; those still follow Work permissions.</p></section>}
      <section className="settings-section"><h3>Memory scope</h3><p>Notes in a Work project are available only to that project's chats. Changes apply to the next request.</p><ThemedSelect value={scope} onValueChange={value => setScope(value)}><option value="personal">Personal chats</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</ThemedSelect>
        {notes.filter(note => note.scope === scope).map(note => <div className="memory-note" key={note.id}><textarea dir="auto" value={note.text} onChange={event => saveNotes(notes.map(item => item.id === note.id ? { ...item, text: event.target.value.slice(0, 4000) } : item))} /><button className={note.pinned ? 'active' : ''} aria-label="Pin memory" onClick={() => saveNotes(notes.map(item => item.id === note.id ? { ...item, pinned: !item.pinned } : item))}><Pin /></button><button aria-label="Delete memory" onClick={() => saveNotes(notes.filter(item => item.id !== note.id))}><Trash2 /></button></div>)}
        <textarea dir="auto" placeholder="Add a fact or preference to remember…" maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)} /><button className="primary-button" disabled={!draft.trim()} onClick={() => { saveNotes([...notes, { id: crypto.randomUUID(), scope, text: draft.trim(), pinned: false }]); setDraft(''); }}><Plus />Add memory</button><small>Do not store API keys or passwords in memory notes.</small>
      </section>
      <section className="settings-section"><h3>Current conversation context</h3><p>About {contextEstimate(chat.messages).toLocaleString()} text tokens before filtering. This is an estimate, not provider billing or image usage.</p><label>Recent messages to include<input type="number" min={2} max={200} value={settings.contextMessages} onChange={event => saveSettings({ ...settings, contextMessages: Math.max(2, Math.min(200, Number(event.target.value) || 2)) })} /></label>
        <div className="context-message-list">{chat.messages.map((message, index) => <label key={index}><input type="checkbox" checked={!excluded.includes(index)} onChange={() => { const next = excluded.includes(index) ? excluded.filter(item => item !== index) : [...excluded, index]; setExcluded(next); localStorage.setItem(`nova-context-excluded-${chat.id}`, JSON.stringify(next)); }} /><span><b>{message.role}</b><small>{message.content.slice(0, 160)}</small></span></label>)}</div>
      </section>
      {storagePanel}
    </>}
    {tab === 'routing' && <section className="settings-section"><h3>Automatic model routing</h3><p>Choose a model for each kind of request. Private requests require a local endpoint.</p><label className="include-provider-keys"><input type="checkbox" checked={settings.enabled} onChange={event => saveSettings({ ...settings, enabled: event.target.checked })} />Enable routing</label>{(['fast', 'strong', 'vision', 'private'] as RouteRole[]).map(role => <label key={role}>{routeLabels[role]}<ThemedSelect value={settings.routes[role] || ''} onValueChange={value => saveSettings({ ...settings, routes: { ...settings.routes, [role]: value } })}><option value="">{role === 'private' ? 'Choose a local model (required)' : 'Use selected model'}</option>{models.map(model => <option value={model.value} key={model.value}>{model.label}</option>)}</ThemedSelect></label>)}</section>}
    {tab === 'activity' && <section className="settings-section"><h3>Agent activity</h3><p>Recorded plans, approvals, actions, failures and completion for this device.</p>{tasks.length === 0 && <p>No Work tasks have run yet.</p>}{tasks.map(task => <details className="task-record" key={task.id}><summary><b>{task.goal.slice(0, 100)}</b><small>{task.state} · {new Date(task.updatedAt).toLocaleString()}</small></summary>{task.events.map(event => <div key={event.id}><b>{event.label}</b><small>{event.toolName || event.kind} · {new Date(event.at).toLocaleTimeString()}</small>{event.detail && <p>{event.detail}</p>}</div>)}</details>)}</section>}
  </div>;
}
