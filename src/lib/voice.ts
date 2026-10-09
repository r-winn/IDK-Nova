import { invoke } from '@tauri-apps/api/core';
import type { Provider } from '../types';
import { redactSecrets } from './secrets';

export class VoiceSession {
  private peer?: RTCPeerConnection;
  private microphone?: MediaStream;
  private channel?: RTCDataChannel;
  private audio = new Audio();
  private stopped = false;
  private abort = new AbortController();
  private timeout?: ReturnType<typeof setTimeout>;
  constructor(private status: (value: string, ended?: boolean) => void, private transcript: (role: 'user' | 'assistant', text: string) => void) {}
  async start(provider: Provider, model: string) {
    if (!('__TAURI_INTERNALS__' in window)) throw new Error('Live voice currently requires the desktop app; the web app needs a secure token server.');
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('This system webview does not support microphone/WebRTC.');
    const base = provider.baseUrl.replace(/\/+$/, '');
    const url = new URL(base);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use HTTPS for remote voice providers.');
    this.status('Connecting…');
    const token = await invoke<string>('create_voice_token', { baseUrl: base, apiKey: provider.apiKey, model });
    if (this.stopped) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.stopped) { stream.getTracks().forEach(track => track.stop()); return; }
    this.microphone = stream;
    const peer = this.peer = new RTCPeerConnection();
    this.timeout = setTimeout(() => { if (!this.connected && !this.stopped) { this.stop(); this.status('Voice connection timed out. Check network and WebRTC support.', true); } }, 30000);
    peer.ontrack = event => { this.audio.srcObject = event.streams[0] || new MediaStream([event.track]); this.audio.play().catch(() => this.status('Audio playback was blocked. Check system audio permissions.')); };
    peer.onconnectionstatechange = () => {
      if (this.stopped) return;
      if (peer.connectionState === 'connected') { clearTimeout(this.timeout); this.status('Listening'); }
      if (['failed', 'disconnected'].includes(peer.connectionState)) { this.stop(); this.status('Voice disconnected. Start again to reconnect.', true); }
    };
    for (const track of stream.getTracks()) peer.addTrack(track, stream);
    const channel = this.channel = peer.createDataChannel('oai-events');
    channel.onmessage = ({ data }) => {
      if (this.stopped) return;
      let event: any; try { event = JSON.parse(data); } catch { return; }
      if (event.type === 'input_audio_buffer.speech_started') this.status('Listening');
      if (event.type === 'response.created') this.status('Responding');
      if (event.type === 'response.done') this.status('Listening');
      if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) this.transcript('user', event.transcript);
      if (['response.output_audio_transcript.done', 'response.audio_transcript.done'].includes(event.type) && event.transcript) this.transcript('assistant', event.transcript);
      if (event.type === 'error') { this.stop(); this.status(redactSecrets(event.error?.message || 'Voice provider error'), true); }
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const response = await fetch(`${base}/realtime/calls`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/sdp' }, body: offer.sdp, signal: this.abort.signal });
    if (!response.ok) throw new Error(`Voice connection returned ${response.status}. Check Realtime support and model permissions.`);
    const sdp = await response.text();
    if (!this.stopped) await peer.setRemoteDescription({ type: 'answer', sdp });
  }
  get connected() { return !this.stopped && this.peer?.connectionState === 'connected'; }
  mute(muted: boolean) { this.microphone?.getAudioTracks().forEach(track => { track.enabled = !muted; }); }
  playAudio() { return this.audio.play(); }
  stop() {
    this.stopped = true; this.abort.abort();
    clearTimeout(this.timeout);
    this.microphone?.getTracks().forEach(track => track.stop());
    this.channel?.close(); this.peer?.close(); this.audio.pause(); this.audio.srcObject = null;
  }
}
