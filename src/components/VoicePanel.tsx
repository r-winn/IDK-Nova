import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Square, X } from 'lucide-react';
import { VoiceSession } from '../lib/voice';
import type { Config } from '../types';
import { getActiveProvider } from '../types';
import { redactSecrets } from '../lib/secrets';

export function VoicePanel({ config, instructions = '', onClose }: { config: Config; instructions?: string; onClose: () => void }) {
  const provider = getActiveProvider(config);
  const [status, setStatus] = useState('Connecting…');
  const [busy, setBusy] = useState(true);
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<{ role: string; text: string }[]>([]);
  const session = useRef<VoiceSession>();
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!provider || !config.activeModel) return;
    let mounted = true;
    setBusy(true); setMuted(false); setStatus('Connecting…');
    const voice = new VoiceSession((value, ended) => { if (mounted) { setStatus(value); if (ended) setBusy(false); } }, (role, text) => { if (mounted) setLines(current => [...current, { role, text }].slice(-100)); });
    session.current = voice;
    void voice.start(provider, config.activeModel, instructions).catch(e => {
      voice.stop(); if (mounted) { setBusy(false); setStatus(redactSecrets(e instanceof Error ? e.message : String(e))); }
    });
    return () => { mounted = false; voice.stop(); };
  }, [provider?.id, config.activeModel, attempt]);
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); } }; document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape); }, []);
  return <section className="voice-panel" role="region" aria-label="Live voice conversation">
    <header><span>Live voice · {config.activeModel}</span><button className="icon-button" aria-label="Cancel live voice" onClick={onClose}><X /></button></header>
    <div className="voice-stage"><div className={`voice-orb ${busy ? 'active' : ''} ${muted ? 'muted' : ''} ${status === 'Responding' ? 'responding' : ''}`} aria-hidden="true"><i /><i /><i /></div><p role="status">{muted && busy ? 'Microphone muted' : status}</p><small>Audio is sent to {provider?.name}. This voice session is temporary and has no Work tools.</small></div>
    <div className="voice-transcript">{lines.slice(-4).map((line, index) => <p key={`${lines.length}-${index}`} dir="auto"><b>{line.role === 'user' ? 'You' : 'Nova'}:</b> {line.text}</p>)}</div>
    <div className="voice-controls">{busy ? <><button className={`secondary ${muted ? 'selected' : ''}`} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} onClick={() => { session.current?.mute(!muted); setMuted(!muted); }}>{muted ? <MicOff /> : <Mic />}</button><button className="secondary" aria-label="Stop live voice" onClick={() => { session.current?.stop(); setBusy(false); setMuted(false); setStatus('Conversation ended'); }}><Square />Stop</button></> : <button className="primary-button" onClick={() => setAttempt(current => current + 1)}>Start again</button>}<button className="secondary" onClick={onClose}>Cancel</button></div>
  </section>;
}
