import { useEffect, useState } from 'react';
import { ThemedSelect } from './ThemedSelect';
import type { Config } from '../types';
import { modelPrices, usageRecords, type ModelPrice } from '../lib/usage';

export function UsagePanel({ config }: { config: Config }) {
  const [records, setRecords] = useState(usageRecords);
  const [prices, setPrices] = useState(modelPrices);
  const [period, setPeriod] = useState<'day' | 'month'>('month');
  useEffect(() => { const update = () => setRecords(usageRecords()); window.addEventListener('nova-usage-updated', update); return () => window.removeEventListener('nova-usage-updated', update); }, []);
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); if (period === 'month') cutoff.setDate(1);
  const selected = records.filter(record => record.at >= cutoff.getTime());
  const reported = selected.filter(record => record.requests > 0 && record.requests === record.reportedRequests);
  const cost = selected.reduce((sum, record) => sum + (record.cost || 0), 0);
  const savePrice = (key: string, field: keyof ModelPrice, text: string) => {
    const next = { ...prices };
    if (text === '') { next[key] = { ...next[key] }; delete next[key][field]; }
    else { const value = Number(text); if (!Number.isFinite(value) || value < 0) return; next[key] = { ...next[key], [field]: value }; }
    setPrices(next); localStorage.setItem('nova-prices-v1', JSON.stringify(next));
  };
  return <section className="settings-section usage-panel"><h3>Usage & latency</h3><p>Only provider-reported tokens are counted. Missing usage is shown as unavailable, never estimated. First text measures the first visible response, including planning time for Work.</p>
    <ThemedSelect value={period} onValueChange={value => setPeriod(value as typeof period)}><option value="day">Today</option><option value="month">This month</option></ThemedSelect>
    <div className="usage-summary"><div><strong>{selected.length}</strong><span>Responses</span></div><div><strong>{selected.reduce((sum, item) => sum + item.input + item.output, 0).toLocaleString()}</strong><span>Reported tokens · {reported.length}/{selected.length} complete records</span></div><div><strong>${cost.toFixed(4)}</strong><span>Recorded estimate · {selected.filter(item => item.cost !== undefined).length}/{selected.length} priced</span></div></div>
    <details className="task-record"><summary>Model prices · USD per million tokens</summary><p>Enter your provider's actual rates. Estimates exclude tool fees, taxes and negotiated discounts. Prices apply to future responses; empty fields remove pricing for that model.</p>{config.providers.flatMap(provider => provider.models.map(model => { const key = `${provider.id}::${model}`; return <div className="usage-price" key={key}><b>{provider.name} · {model}</b>{(['input', 'output', 'cached'] as const).map(field => <label key={field}>{field}<input type="number" min={0} step="any" value={prices[key]?.[field] ?? ''} placeholder="Not configured" onChange={event => savePrice(key, field, event.target.value)} /></label>)}</div>; }))}</details>
    <div className="usage-records">{selected.slice().reverse().map(record => <div className="task-record" key={record.id}><b>{record.providerName} · {record.model}</b><small>{new Date(record.at).toLocaleString()} · {record.status}{record.workId ? ' · Work' : ''}</small><p>{record.reportedRequests ? `${record.input.toLocaleString()} input / ${record.output.toLocaleString()} output` : 'Token usage unavailable'}{record.reportedRequests !== record.requests && record.reportedRequests > 0 ? ' · Partial usage' : ''} · {(record.durationMs / 1000).toFixed(1)}s total{record.firstTextMs !== undefined ? ` · ${(record.firstTextMs / 1000).toFixed(1)}s first text` : ''}{record.cost !== undefined ? ` · ~$${record.cost.toFixed(5)}` : ' · Cost unavailable'}</p></div>)}</div>
  </section>;
}
