import { useEffect, useState } from 'react';
import { checkVoiceSupport } from '../lib/voice';
import type { Provider } from '../types';

export function useVoiceAvailability(provider: Provider | undefined, model: string, loading: boolean) {
  const identity = `${provider?.id}:${provider?.baseUrl}:${model}`;
  const [result, setResult] = useState({ identity: '', available: false, reason: 'Checking live voice support…' });
  useEffect(() => {
    let cancelled = false;
    setResult({ identity, available: false, reason: 'Checking live voice support…' });
    if (loading || !provider || !model) return;
    if (!('__TAURI_INTERNALS__' in window)) { setResult({ identity, available: false, reason: 'Live voice needs the desktop app or a secure web token server.' }); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) { setResult({ identity, available: false, reason: 'Microphone/WebRTC is not supported on this system.' }); return; }
    // Negotiate with the provider without accessing the microphone or sending audio.
    const timer = setTimeout(() => {
      void checkVoiceSupport(provider, model).then(available => {
        if (!cancelled) setResult({ identity, available, reason: available ? 'Live voice · microphone audio goes to this provider' : 'This model/provider did not confirm Realtime support. Check model access and the API key.' });
      });
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [identity, provider?.apiKey, model, loading]);
  return result.identity === identity ? result : { identity, available: false, reason: 'Checking live voice support…' };
}
