import type { Config, Message } from '../types';

export async function streamCompletion(config: Config, messages: Message[], onToken: (token: string) => void) {
  const content = messages.map(message => ({ role: message.role, content: message.attachments?.length ? [
    { type: 'text', text: message.content || 'Describe this attachment.' },
    ...message.attachments.filter(file => file.type.startsWith('image/')).map(file => ({ type: 'image_url', image_url: { url: file.url } })),
  ] : message.content }));
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, body: JSON.stringify({ model: config.model, temperature: config.temperature, stream: true, messages: content }) });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  if (!response.body) throw new Error('The provider did not return a response stream');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines) { const raw = line.replace(/^data:\s*/, '').trim(); if (!raw || raw === '[DONE]') continue; try { onToken(JSON.parse(raw).choices?.[0]?.delta?.content || ''); } catch { /* partial SSE */ } } }
}
