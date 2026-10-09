import type { Dispatch, SetStateAction } from 'react';
import type { Config } from '../types';
import { ThemedSelect } from './ThemedSelect';
type Props = { config: Config; onChange: Dispatch<SetStateAction<Config>> };

export function ResponseSettings({ config, onChange }: Props) {
  return <section className="settings-section"><div className="section-copy"><h3>Response style</h3><p>Choose how creative or predictable supported model responses should be. Some reasoning models ignore temperature.</p></div><label className="range-control"><span>Creativity <b>{config.temperature.toFixed(1)}</b></span><input type="range" min="0" max="1" step="0.1" value={config.temperature} onChange={event => onChange(current => ({ ...current, temperature: Number(event.target.value) }))} /><span className="range-labels"><small>Precise</small><small>Creative</small></span></label></section>;
}

export function StorageSettings({ config, onChange }: Props) {
  return <details className="settings-section advanced-storage"><summary>Advanced storage configuration (reserved)</summary><p>External database retrieval is not implemented. These settings preserve imported configurations; current memory stays local or in the Work folder.</p><label className="include-provider-keys"><input type="checkbox" checked={config.database.enabled} onChange={event => onChange(current => ({ ...current, database: { ...current.database, enabled: event.target.checked, kind: event.target.checked ? 'postgresql' : 'none' } }))} />Keep a database configuration</label>{config.database.enabled && <><label>Database type<ThemedSelect label="Database type" value={config.database.kind} onValueChange={value => onChange(current => ({ ...current, database: { ...current.database, kind: value as Config['database']['kind'] } }))}><option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option><option value="sqlite">SQLite</option><option value="http">HTTP API</option></ThemedSelect></label><label>Connection URL<input type="password" autoComplete="off" value={config.database.url} onChange={event => onChange(current => ({ ...current, database: { ...current.database, url: event.target.value } }))} /></label><small>Do not include secrets in prompt or memory exports.</small></>}</details>;
}
