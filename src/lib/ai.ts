import type { Config, Message, Provider } from '../types';
import { getActiveProvider } from '../types';

const headers = (provider: Provider) => ({ 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) });

const endpoint = (provider: Provider, path: string) => {
  const base = provider.baseUrl.replace(/\/$/, '');
  const url = new URL(`${base}${path}`);
  const desktop = '__TAURI_INTERNALS__' in window;
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!desktop && location.protocol === 'https:' && url.protocol === 'http:' && !local) {
    throw new Error('The web app cannot connect to an HTTP provider. Use the Windows desktop app or enable HTTPS on the AI server.');
  }
  return url.toString();
};

export async function discoverModels(provider: Provider): Promise<string[]> {
  const response = await fetch(endpoint(provider, '/models'), { headers: headers(provider) });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.data)) throw new Error('This provider did not return an OpenAI-compatible model list');
  const ids: string[] = payload.data.map((item: any) => item?.id).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set<string>(ids)].sort();
}

export async function testModel(provider: Provider, model: string): Promise<number> {
  const started = performance.now();
  const response = await fetch(endpoint(provider, '/chat/completions'), { method: 'POST', headers: headers(provider), body: JSON.stringify({ model, stream: false, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with OK' }] }) });
  if (!response.ok) throw new Error(`Model test failed (${response.status})`);
  const payload = await response.json();
  if (!payload.choices?.[0]?.message) throw new Error('Provider returned an invalid completion');
  return Math.round(performance.now() - started);
}

export async function streamCompletion(config: Config, messages: Message[], onToken: (token: string) => void) {
  const provider = getActiveProvider(config);
  if (!provider) throw new Error('Add a provider in Settings first');
  if (!config.activeModel) throw new Error('Select a model first');
  const content = messages.map(message => ({ role: message.role, content: message.attachments?.length ? [
    { type: 'text', text: message.content || 'Describe this attachment.' },
    ...message.attachments.filter(file => file.type.startsWith('image/')).map(file => ({ type: 'image_url', image_url: { url: file.url } })),
  ] : message.content }));
  const response = await fetch(endpoint(provider, '/chat/completions'), { method: 'POST', headers: { ...headers(provider), Accept: 'text/event-stream' }, body: JSON.stringify({ model: config.activeModel, temperature: config.temperature, stream: true, messages: content }) });
  if (!response.ok) throw new Error(`Provider returned ${response.status}: ${await response.text()}`);
  if (!response.body) throw new Error('The provider did not return a response stream');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines) { const raw = line.replace(/^data:\s*/, '').trim(); if (!raw || raw === '[DONE]') continue; try { onToken(JSON.parse(raw).choices?.[0]?.delta?.content || ''); } catch { /* partial SSE */ } } }
}
