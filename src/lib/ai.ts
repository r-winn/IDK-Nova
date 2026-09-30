import type { Config, Message, Provider } from '../types';
import { getActiveProvider } from '../types';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';

const isDesktop = () => '__TAURI_INTERNALS__' in window;
const request: typeof fetch = (input, init) =>
  isDesktop() ? nativeFetch(input, init) : window.fetch(input, init);

const headers = (provider: Provider) => ({ 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) });

const endpoint = (provider: Provider, path: string) => {
  const base = provider.baseUrl.replace(/\/$/, '');
  const url = new URL(`${base}${path}`);
  const desktop = isDesktop();
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!desktop && location.protocol === 'https:' && url.protocol === 'http:' && !local) {
    throw new Error('The web app cannot connect to an HTTP provider. Use the Windows desktop app or enable HTTPS on the AI server.');
  }
  return url.toString();
};

export async function discoverModels(provider: Provider): Promise<string[]> {
  const response = await request(endpoint(provider, '/models'), { headers: headers(provider) });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.data)) throw new Error('This provider did not return an OpenAI-compatible model list');
  const ids: string[] = payload.data.map((item: any) => item?.id).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set<string>(ids)].sort();
}

export async function testModel(provider: Provider, model: string): Promise<number> {
  const started = performance.now();
  const response = await request(endpoint(provider, '/chat/completions'), { method: 'POST', headers: headers(provider), body: JSON.stringify({ model, stream: false, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with OK' }] }) });
  if (!response.ok) throw new Error(`Model test failed (${response.status})`);
  const payload = await response.json();
  if (!payload.choices?.[0]?.message) throw new Error('Provider returned an invalid completion');
  return Math.round(performance.now() - started);
}

export async function streamCompletion(config: Config, messages: Message[], onToken: (token: string) => void, signal?: AbortSignal, systemContext?: string) {
  const provider = getActiveProvider(config);
  if (!provider) throw new Error('Add a provider in Settings first');
  if (!config.activeModel) throw new Error('Select a model first');
  const content = messages.map((message, index) => ({
    role: message.role,
    content: index === messages.length - 1 && message.attachments?.length ? [
      { type: 'text', text: `${message.quote ? `Replying to this excerpt:\n\"${message.quote}\"\n\n` : ''}${message.content || 'Describe this attachment.'}` },
      ...message.attachments.filter(file => file.type.startsWith('image/')).map(file => ({ type: 'image_url', image_url: { url: file.url } })),
    ] : `${message.quote ? `Replying to this excerpt:\n\"${message.quote}\"\n\n` : ''}${message.content || (message.attachments?.length ? '[Image shared in an earlier turn]' : '')}`,
  }));
  const providerMessages = systemContext ? [{ role: 'system', content: systemContext }, ...content] : content;
  const response = await request(endpoint(provider, '/chat/completions'), { method: 'POST', headers: { ...headers(provider), Accept: 'text/event-stream' }, body: JSON.stringify({ model: config.activeModel, temperature: config.temperature, stream: true, messages: providerMessages }), signal });
  if (!response.ok) throw new Error(`Provider returned ${response.status}: ${await response.text()}`);
  if (!response.body) throw new Error('The provider did not return a response stream');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines) { const raw = line.replace(/^data:\s*/, '').trim(); if (!raw || raw === '[DONE]') continue; try { onToken(JSON.parse(raw).choices?.[0]?.delta?.content || ''); } catch { /* partial SSE */ } } }
}

export type AgentTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type AgentToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export async function runAgentCompletion(
  config: Config,
  messages: Message[],
  systemContext: string,
  tools: AgentTool[],
  execute: (call: AgentToolCall) => Promise<unknown>,
  onStep: (label: string) => void,
  onToken: (token: string) => void,
  signal?: AbortSignal,
) {
  const provider = getActiveProvider(config);
  if (!provider || !config.activeModel) throw new Error('Connect an agent-capable model first');
  const conversation: any[] = [
    { role: 'system', content: systemContext },
    ...messages.map((message) => ({ role: message.role, content: `${message.quote ? `Replying to this excerpt:\n"${message.quote}"\n\n` : ''}${message.content}` })),
  ];
  for (let turn = 0; turn < 30; turn += 1) {
    const response = await request(endpoint(provider, '/chat/completions'), {
      method: 'POST', headers: headers(provider), signal,
      body: JSON.stringify({ model: config.activeModel, temperature: config.temperature, stream: false, messages: conversation, tools, tool_choice: 'auto' }),
    });
    if (!response.ok) throw new Error(`Agent provider returned ${response.status}: ${await response.text()}`);
    const payload = await response.json();
    const assistant = payload.choices?.[0]?.message;
    if (!assistant) throw new Error('Agent provider returned an invalid completion');
    conversation.push({ role: 'assistant', content: assistant.content ?? null, ...(assistant.tool_calls ? { tool_calls: assistant.tool_calls } : {}) });
    const calls: AgentToolCall[] = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    if (!calls.length) { onToken(assistant.content || 'Task complete.'); return; }
    for (const call of calls) {
      onStep(call.function.name);
      let result: unknown;
      try { result = await execute(call); }
      catch (error) {
        if (error instanceof Error && error.message.includes('__NOVA_PERMISSION_DENIED__')) throw error;
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      const resultObject = result && typeof result === 'object' ? result as Record<string, unknown> : null;
      const screenImage = typeof resultObject?.__novaImage === 'string' ? resultObject.__novaImage : null;
      const serializableResult = resultObject ? Object.fromEntries(Object.entries(resultObject).filter(([key]) => key !== '__novaImage')) : result;
      conversation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(serializableResult) });
      if (screenImage) {
        conversation.push({
          role: 'user',
          content: [
            { type: 'text', text: 'This is the current primary display. Coordinates for click_screen are normalized: top-left is (0,0), center is (500,500), and bottom-right is (1000,1000). Inspect it carefully before acting.' },
            { type: 'image_url', image_url: { url: screenImage } },
          ],
        });
      }
    }
  }
  throw new Error('Agent paused after 30 tool steps to prevent an infinite loop. Ask it to continue if more work remains.');
}
