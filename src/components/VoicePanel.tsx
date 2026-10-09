import { useEffect, useRef, useState } from 'react';
import { AudioLines, Mic, MicOff, X } from 'lucide-react';
import { VoiceSession } from '../lib/voice';
import { ThemedSelect } from './ThemedSelect';
import type { Config } from '../types';
import { redactSecrets } from '../lib/secrets';

export function VoicePanel({ config, onClose }: { config: Config; onClose: () => void }) {
  const [providerId, setProviderId] = useState(config.activeProviderId);
  const provider = config.providers.find(item => item.id === providerId);
  const [model, setModel] = useState(() => provider?.models.find(item => /realtime/i.test(item)) || '');
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<{ role: string; text: string }[]>([]);
  const session = useRef<VoiceSession>();
  useEffect(() => () => session.current?.stop(), []);
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }; document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape); }, [onClose]);
  const end = () => { session.current?.stop(); session.current = undefined; setBusy(false); setMuted(false); setStatus('Ended'); };
  const start = async () => {
    if (!provider || !model.trim() || busy) return;
    setBusy(true); setLines([]); setMuted(false);
    const voice = new VoiceSession((value, ended) => { setStatus(value); if (ended) setBusy(false); }, (role, text) => setLines(current => [...current, { role, text }].slice(-100)));
    session.current = voice;
    try { await voice.start(provider, model.trim()); } catch (e) { voice.stop(); setBusy(false); setStatus(redactSecrets(e instanceof Error ? e.message : String(e))); }
  };
  return <div className="voice-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="voice-panel" role="dialog" aria-modal="true" aria-label="Live voice"><header><h2>Live voice</h2><button className="icon-button" aria-label="Close voice" onClick={onClose}><X /></button></header><p>Starting sends microphone audio to the selected provider. This session has no Work tools and is not saved in chat history. End or close to stop the microphone.</p><ThemedSelect label="Voice provider" disabled={busy} value={providerId} onValueChange={value => { setProviderId(value); setModel(config.providers.find(item => item.id === value)?.models.find(item => /realtime/i.test(item)) || ''); }}>{config.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</ThemedSelect><label>Realtime model<input disabled={busy} value={model} placeholder="Enter an available Realtime model" onChange={event => setModel(event.target.value)} /></label><div className={`voice-orb ${busy ? 'active' : ''}`}><AudioLines /></div><p role="status">{status}</p><div className="voice-transcript">{lines.map((line, index) => <p key={index} dir="auto"><b>{line.role === 'user' ? 'You' : 'Nova'}:</b> {line.text}</p>)}</div><div className="tool-command-actions">{busy ? <><button className="secondary" onClick={() => { session.current?.mute(!muted); setMuted(!muted); }}>{muted ? <MicOff /> : <Mic />}{muted ? 'Unmute' : 'Mute'}</button><button className="secondary" onClick={() => { void session.current?.playAudio().catch(() => setStatus("Could not play audio. Check your output device.")); }}>Play audio</button><button className="primary-button" onClick={end}>End conversation</button></> : <button className="primary-button" disabled={!provider || !model.trim() || !('__TAURI_INTERNALS__' in window)} onClick={() => void start()}>Start voice</button>}</div>{!('__TAURI_INTERNALS__' in window) && <small>Desktop preview only. A secure token server is required for web voice.</small>}</section></div>;
}
