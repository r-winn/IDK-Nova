import type { Config, Message, Provider, ResponseMemory } from '../types';
import { getActiveProvider } from '../types';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { AgentLoopWatchdog } from '../agent/loop-watchdog';

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

const conversationInput = (messages: Message[]) => {
  const recent = messages.slice(-40);
  let remainingImages = 8;
  const imageAllowance = new Map<number, number>();
  for (let index = recent.length - 1; index >= 0 && remainingImages > 0; index -= 1) {
    const count = Math.min(remainingImages, recent[index].attachments?.filter((file) => file.type.startsWith('image/') && file.url.startsWith('data:')).length || 0);
    if (count) imageAllowance.set(index, count);
    remainingImages -= count;
  }
  return recent.map((message, index) => {
    const prefix = message.quote ? `Replying to this excerpt:\n\"${message.quote}\"\n\n` : '';
    const images = message.attachments?.filter((file) => file.type.startsWith('image/') && file.url.startsWith('data:')).slice(0, imageAllowance.get(index) || 0) || [];
    if (message.role === 'user' && images.length) return {
      role: message.role,
      content: [
        { type: 'text', text: `${prefix}${message.content || 'Describe this attachment.'}` },
        ...images.map((file) => ({ type: 'image_url', image_url: { url: file.url } })),
      ],
    };
    return { role: message.role, content: `${prefix}${message.content || (message.attachments?.length ? '[Attachment shared earlier]' : '')}` };
  });
};

const responsesInput = (messages: Message[]) => conversationInput(messages).map((message: any) => ({
  role: message.role,
  content: Array.isArray(message.content)
    ? message.content.map((part: any) => part.type === 'image_url'
      ? { type: 'input_image', image_url: part.image_url.url }
      : { type: 'input_text', text: part.text })
    : [{ type: 'input_text', text: message.content }],
}));

const isUnsupportedResponsesError = (status: number) => [404, 405, 501].includes(status);
const unsupportedResponsesProviders = new Set<string>();
const statelessResponsesProviders = new Set<string>();
const responsesProviderKey = (provider: Provider) => `${provider.id}:${provider.baseUrl.replace(/\/$/, '')}`;
const isStaleResponseError = (status: number, detail: string) => [400, 404].includes(status) && /previous.{0,30}response|response.{0,30}(not found|expired|missing)/i.test(detail);
const requiresStatelessResponses = (status: number, detail: string) => status === 400 && /(store.{0,30}(not supported|unsupported|must be false)|previous_response_id.{0,30}(not supported|unsupported)|each response request is independent)/i.test(detail);
const responseMemoryMatches = (memory: ResponseMemory | undefined, provider: Provider, model: string) =>
  Boolean(memory?.previousResponseId && memory.providerId === provider.id && memory.model === model);

const readResponseStream = async (response: Response, onToken: (token: string) => void) => {
  if (!response.body) throw new Error('The provider did not return a response stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let responseId = '';
  const handle = (raw: string) => {
    if (!raw || raw === '[DONE]') return;
    try {
      const event = JSON.parse(raw);
      responseId = event.response?.id || event.id || responseId;
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') onToken(event.delta);
      else if (event.type === 'response.refusal.delta' && typeof event.delta === 'string') onToken(event.delta);
    } catch { /* an incomplete event remains buffered by the caller */ }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    for (const event of events) {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
      handle(data);
    }
  }
  if (buffer.trim()) {
    const data = buffer.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
    handle(data);
  }
  return responseId;
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

export async function streamCompletion(config: Config, messages: Message[], onToken: (token: string) => void, signal?: AbortSignal, systemContext?: string, memory?: ResponseMemory, onMemory?: (memory?: ResponseMemory) => void) {
  const provider = getActiveProvider(config);
  if (!provider) throw new Error('Add a provider in Settings first');
  if (!config.activeModel) throw new Error('Select a model first');
  const chained = responseMemoryMatches(memory, provider, config.activeModel);
  const providerKey = responsesProviderKey(provider);
  if (!unsupportedResponsesProviders.has(providerKey)) {
    let stateless = statelessResponsesProviders.has(providerKey);
    const createResponse = (useChain: boolean, store: boolean) => request(endpoint(provider, '/responses'), {
      method: 'POST',
      headers: { ...headers(provider), Accept: 'text/event-stream' },
      body: JSON.stringify({
        model: config.activeModel,
        instructions: systemContext || undefined,
        input: responsesInput(useChain && store ? messages.slice(-1) : messages),
        previous_response_id: useChain ? memory?.previousResponseId : undefined,
        temperature: config.temperature,
        stream: true,
        store,
      }),
      signal,
    });
    let responseRequest = await createResponse(chained && !stateless, !stateless);
    if (!responseRequest.ok) {
      const detail = await responseRequest.text();
      if (requiresStatelessResponses(responseRequest.status, detail)) {
        statelessResponsesProviders.add(providerKey);
        stateless = true;
        responseRequest = await createResponse(false, false);
      }
      else if (chained && isStaleResponseError(responseRequest.status, detail)) responseRequest = await createResponse(false, true);
      else if (isUnsupportedResponsesError(responseRequest.status)) unsupportedResponsesProviders.add(providerKey);
      else throw new Error(`Provider returned ${responseRequest.status}: ${detail}`);
    }
    if (responseRequest.ok) {
      const responseId = await readResponseStream(responseRequest, onToken);
      if (!stateless && !responseId) throw new Error('The Responses API did not return a response id');
      if (stateless) onMemory?.(undefined);
      else onMemory?.({ providerId: provider.id, model: config.activeModel, previousResponseId: responseId });
      return;
    }
    if (isUnsupportedResponsesError(responseRequest.status)) unsupportedResponsesProviders.add(providerKey);
    else throw new Error(`Provider returned ${responseRequest.status}: ${await responseRequest.text()}`);
  }
  onMemory?.(undefined);
  const content = conversationInput(messages);
  const providerMessages = systemContext ? [{ role: 'system', content: systemContext }, ...content] : content;
  const response = await request(endpoint(provider, '/chat/completions'), { method: 'POST', headers: { ...headers(provider), Accept: 'text/event-stream' }, body: JSON.stringify({ model: config.activeModel, temperature: config.temperature, stream: true, messages: providerMessages }), signal });
  if (!response.ok) throw new Error(`Provider returned ${response.status}: ${await response.text()}`);
  if (!response.body) throw new Error('The provider did not return a response stream');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines) { const raw = line.replace(/^data:\s*/, '').trim(); if (!raw || raw === '[DONE]') continue; try { onToken(JSON.parse(raw).choices?.[0]?.delta?.content || ''); } catch { /* partial SSE */ } } }
}

export type AgentTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type AgentToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

const compactScreenFingerprint = (dataUrl: string) => {
  let hash = 2166136261;
  const stride = Math.max(1, Math.floor(dataUrl.length / 2048));
  for (let index = 0; index < dataUrl.length; index += stride) hash = Math.imul(hash ^ dataUrl.charCodeAt(index), 16777619);
  return `${dataUrl.length}:${(hash >>> 0).toString(16)}`;
};

export async function runAgentCompletion(
  config: Config,
  messages: Message[],
  systemContext: string,
  tools: AgentTool[],
  execute: (call: AgentToolCall) => Promise<unknown>,
  onStep: (label: string) => void,
  onToken: (token: string) => void,
  signal?: AbortSignal,
  memory?: ResponseMemory,
  onMemory?: (memory?: ResponseMemory) => void,
  requireTool = false,
) {
  const provider = getActiveProvider(config);
  if (!provider || !config.activeModel) throw new Error('Connect an agent-capable model first');
  const chained = responseMemoryMatches(memory, provider, config.activeModel);
  const providerKey = responsesProviderKey(provider);
  let stateless = statelessResponsesProviders.has(providerKey);
  let previousResponseId = !stateless && chained ? memory!.previousResponseId : '';
  let responseInput: any[] = responsesInput(!stateless && chained ? messages.slice(-1) : messages);
  let statelessContext: any[] = stateless ? [...responseInput] : [];
  const responseTools = tools.map((tool) => ({ type: 'function', name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters }));
  let responsesSupported = !unsupportedResponsesProviders.has(providerKey);
  const watchdog = new AgentLoopWatchdog();
  if (!responsesSupported) previousResponseId = '';
  let turn = 0;
  while (responsesSupported) {
    if (signal?.aborted) throw new DOMException('The task was stopped', 'AbortError');
    const response = await request(endpoint(provider, '/responses'), {
      method: 'POST', headers: headers(provider), signal,
      body: JSON.stringify({ model: config.activeModel, instructions: systemContext, input: responseInput, previous_response_id: stateless ? undefined : previousResponseId || undefined, temperature: config.temperature, store: !stateless, tools: responseTools, tool_choice: turn === 0 && requireTool ? 'required' : 'auto' }),
    });
    if (!response.ok) {
      const detail = await response.text();
      if (requiresStatelessResponses(response.status, detail)) {
        statelessResponsesProviders.add(providerKey);
        stateless = true;
        previousResponseId = '';
        responseInput = responsesInput(messages);
        statelessContext = [...responseInput];
        continue;
      }
      if (turn === 0 && chained && isStaleResponseError(response.status, detail)) {
        previousResponseId = '';
        responseInput = responsesInput(messages);
        continue;
      }
      if (turn === 0 && (isUnsupportedResponsesError(response.status) || (response.status === 400 && /tools?|tool_choice|function.?call/i.test(detail)))) {
        if (isUnsupportedResponsesError(response.status)) unsupportedResponsesProviders.add(providerKey);
        responsesSupported = false;
        break;
      }
      throw new Error(`Agent provider returned ${response.status}: ${detail}`);
    }
    const payload = await response.json();
    if (!stateless) previousResponseId = payload.id || previousResponseId;
    if (stateless && Array.isArray(payload.output)) statelessContext.push(...payload.output);
    const calls = (Array.isArray(payload.output) ? payload.output : []).filter((item: any) => item?.type === 'function_call');
    if (!calls.length) {
      const output = typeof payload.output_text === 'string' ? payload.output_text : (payload.output || []).flatMap((item: any) => item?.content || []).filter((item: any) => item?.type === 'output_text').map((item: any) => item.text || '').join('');
      onToken(output || 'Task complete.');
      if (stateless) onMemory?.(undefined);
      else if (previousResponseId) onMemory?.({ providerId: provider.id, model: config.activeModel, previousResponseId });
      return;
    }
    responseInput = [];
    const screenImages: string[] = [];
    for (const item of calls) {
      const call: AgentToolCall = { id: item.call_id || item.id, type: 'function', function: { name: item.name, arguments: item.arguments || '{}' } };
      onStep(call.function.name);
      let result: unknown;
      try { result = await execute(call); }
      catch (error) {
        if (error instanceof Error && error.message.includes('__NOVA_PERMISSION_DENIED__')) throw error;
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      onStep('thinking');
      const resultObject = result && typeof result === 'object' ? result as Record<string, unknown> : null;
      const screenImage = typeof resultObject?.__novaImage === 'string' ? resultObject.__novaImage : null;
      const serializableResult = resultObject ? Object.fromEntries(Object.entries(resultObject).filter(([key]) => key !== '__novaImage')) : result;
      watchdog.observe(call, { result: serializableResult, screen: screenImage ? compactScreenFingerprint(screenImage) : undefined });
      responseInput.push({ type: 'function_call_output', call_id: call.id, output: JSON.stringify(serializableResult) });
      if (screenImage) screenImages.push(screenImage);
    }
    if (screenImages.length) responseInput.push({ role: 'user', content: [{ type: 'input_text', text: 'This is the newest primary-display state after the requested actions. Coordinates are normalized from 0 to 1000. Inspect it carefully and continue until the result is visibly verified.' }, { type: 'input_image', image_url: screenImages.at(-1) }] });
    if (stateless) {
      statelessContext.push(...responseInput);
      responseInput = statelessContext;
    }
    turn += 1;
  }
  onMemory?.(undefined);
  const conversation: any[] = [
    { role: 'system', content: systemContext },
    ...conversationInput(messages),
  ];
  let forceFirstTool = requireTool;
  turn = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException('The task was stopped', 'AbortError');
    const response = await request(endpoint(provider, '/chat/completions'), {
      method: 'POST', headers: headers(provider), signal,
      body: JSON.stringify({ model: config.activeModel, temperature: config.temperature, stream: false, messages: conversation, tools, tool_choice: turn === 0 && forceFirstTool ? 'required' : 'auto' }),
    });
    if (!response.ok) {
      const detail = await response.text();
      if (turn === 0 && forceFirstTool && response.status === 400 && /tool_choice|required/i.test(detail)) { forceFirstTool = false; continue; }
      throw new Error(`Agent provider returned ${response.status}: ${detail}`);
    }
    const payload = await response.json();
    const assistant = payload.choices?.[0]?.message;
    if (!assistant) throw new Error('Agent provider returned an invalid completion');
    conversation.push({ role: 'assistant', content: assistant.content ?? null, ...(assistant.tool_calls ? { tool_calls: assistant.tool_calls } : {}) });
    const calls: AgentToolCall[] = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    if (!calls.length) { onToken(assistant.content || 'Task complete.'); return; }
    const screenImages: string[] = [];
    for (const call of calls) {
      onStep(call.function.name);
      let result: unknown;
      try { result = await execute(call); }
      catch (error) {
        if (error instanceof Error && error.message.includes('__NOVA_PERMISSION_DENIED__')) throw error;
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      onStep('thinking');
      const resultObject = result && typeof result === 'object' ? result as Record<string, unknown> : null;
      const screenImage = typeof resultObject?.__novaImage === 'string' ? resultObject.__novaImage : null;
      const serializableResult = resultObject ? Object.fromEntries(Object.entries(resultObject).filter(([key]) => key !== '__novaImage')) : result;
      watchdog.observe(call, { result: serializableResult, screen: screenImage ? compactScreenFingerprint(screenImage) : undefined });
      conversation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(serializableResult) });
      if (screenImage) screenImages.push(screenImage);
    }
    if (screenImages.length) conversation.push({
      role: 'user',
      content: [
        { type: 'text', text: 'This is the newest primary-display state after the requested actions. Coordinates for click_screen are normalized: top-left is (0,0), center is (500,500), and bottom-right is (1000,1000). Inspect it carefully and continue until the result is visibly verified.' },
        { type: 'image_url', image_url: { url: screenImages.at(-1) } },
      ],
    });
    turn += 1;
  }
}
