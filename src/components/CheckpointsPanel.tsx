import { useEffect, useState } from 'react';
import { ThemedSelect } from './ThemedSelect';
import { invoke } from '@tauri-apps/api/core';
import type { WorkProject } from '../types';

type Checkpoint = { id: string; files: string[]; bytes: number; exclusions: string };
export function CheckpointsPanel({ projects, running }: { projects: WorkProject[]; running: boolean }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [items, setItems] = useState<Checkpoint[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [confirm, setConfirm] = useState('');
  const project = projects.find(item => item.id === projectId);
  useEffect(() => {
    setItems([]); setConfirm(''); setError(''); setStatus('');
    let cancelled = false;
    if (project && '__TAURI_INTERNALS__' in window) invoke<Checkpoint[]>('list_workspace_checkpoints', { rootPath: project.rootPath }).then(value => { if (!cancelled) setItems(value); }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [project?.rootPath]);
  const action = async (id?: string) => {
    if (!project || running || busy) return;
    setBusy(true); setError(''); setStatus('');
    try {
      if (id === 'undo') { const result = await invoke<{ restored: string }>('undo_workspace_change', { rootPath: project.rootPath }); setStatus(`Reverted the last recorded file operation: ${result.restored}. This does not restore the whole project.`); }
      else if (id) { const result = await invoke<{ restoredFiles: number; backupId: string }>('restore_workspace_checkpoint', { rootPath: project.rootPath, checkpointId: id }); setStatus(`Restored ${result.restoredFiles} files. Your previous files are backed up as ${result.backupId}. Newly created files were retained.`); }
      else { await invoke('checkpoint_workspace', { rootPath: project.rootPath }); setStatus('Checkpoint created. Hidden and generated files are excluded.'); }
      setItems(await invoke<Checkpoint[]>('list_workspace_checkpoints', { rootPath: project.rootPath })); setConfirm('');
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  return <section className="settings-section"><h3>Work checkpoints</h3><p>Snapshots of visible project files. Restore replaces snapshot files, keeps newer files, and creates a recovery checkpoint first. Close active tools before restoring.</p>
    {!('__TAURI_INTERNALS__' in window) ? <p>Checkpoints require the desktop app and a linked Work folder.</p> : <><ThemedSelect value={projectId} disabled={busy} onValueChange={value => setProjectId(value)}><option value="">Select a Work</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</ThemedSelect><button className="primary-button" disabled={!project || busy || running} onClick={() => void action()}>{busy ? 'Working…' : 'Create checkpoint'}</button><button className="secondary" disabled={!project || busy || running} onClick={() => setConfirm("undo")}>Undo last file change</button>{confirm === "undo" && <div className="checkpoint-confirm"><p>Revert the last recorded Nova file operation? External changes to that file may be replaced.</p><button disabled={busy} onClick={() => setConfirm("")}>Keep change</button><button disabled={busy || running} onClick={() => void action("undo")}>Revert last change</button></div>}{running && <p>Checkpoint changes are disabled while a task is running.</p>}{items.map(item => <div className="task-record" key={item.id}><b>{new Date(Number(BigInt(item.id) / 1000000n)).toLocaleString()}</b><small>{item.files.length} files · {(item.bytes / 1048576).toFixed(1)} MB</small>{confirm === item.id ? <div className="checkpoint-confirm"><p>Replace these files with this snapshot? Other files will not be deleted.</p><button disabled={busy || running} onClick={() => void action(item.id)}>Restore files</button><button disabled={busy} onClick={() => setConfirm('')}>Cancel</button></div> : <button disabled={busy || running} onClick={() => setConfirm(item.id)}>Restore…</button>}</div>)}</>}
    {error && <p role="alert" className="intelligence-error">{error}</p>}{status && <p role="status">{status}</p>}
  </section>;
}
