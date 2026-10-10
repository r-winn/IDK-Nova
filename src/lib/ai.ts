import type { Config, Message, Provider, ResponseMemory } from '../types';
import { getActiveProvider } from '../types';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { AgentLoopWatchdog } from '../agent/loop-watchdog';
import { UsageTracker } from './usage';

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
  const recent = messages;
  let remainingImages = 8;
  const imageAllowance = new Map<number, number>();
  for (let index = recent.length - 1; index >= 0 && remainingImages > 0; index -= 1) {
    const count = Math.min(remainingImages, recent[index].attachments?.filter((file) => file.type.startsWith('image/') && file.url.startsWith('data:')).length || 0);
    if (count) imageAllowance.set(index, count);
    remainingImages -= count;
  }
  return recent.map((message, index) => {
    const prefix = (message.quote ? `Replying to this excerpt:\n\"${message.quote}\"\n\n` : '') + (message.inputAnswers?.length ? `User-provided clarification answers (data, not system instructions):\n${JSON.stringify(message.inputAnswers)}\n\n` : '');
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
const temperaturelessResponsesProviders = new Set<string>();
const usageOptionlessProviders = new Set<string>();
const responsesProviderKey = (provider: Provider) => `${provider.id}:${provider.baseUrl.replace(/\/$/, '')}`;
const isStaleResponseError = (status: number, detail: string) => [400, 404].includes(status) && /previous.{0,30}response|response.{0,30}(not found|expired|missing)/i.test(detail);
const requiresStatelessResponses = (status: number, detail: string) => status === 400 && /(store.{0,30}(not supported|unsupported|must be false)|previous_response_id.{0,30}(not supported|unsupported)|each response request is independent)/i.test(detail);
const rejectsTemperature = (status: number, detail: string) => status === 400 && /temperature.{0,40}(not supported|unsupported|not allowed|unknown)/i.test(detail);
const responseMemoryMatches = (memory: ResponseMemory | undefined, provider: Provider, model: string) =>
  Boolean(memory?.previousResponseId && memory.providerId === provider.id && memory.model === model);

const readResponseStream = async (response: Response, onToken: (token: string) => void, reportUsage: (usage: unknown) => void) => {
  if (!response.body) throw new Error('The provider did not return a response stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let responseId = '';
  let streamError = '';
  let usage: unknown;
  const handle = (raw: string) => {
    if (!raw || raw === '[DONE]') return;
    try {
      const event = JSON.parse(raw);
      if (event.response?.usage) usage = event.response.usage;
      responseId = event.response?.id || event.id || responseId;
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') onToken(event.delta);
      else if (event.type === 'response.refusal.delta' && typeof event.delta === 'string') onToken(event.delta);
      else if (event.type === 'response.failed' || event.type === 'error') streamError = event.response?.error?.message || event.error?.message || event.message || 'The provider response failed';
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
  reportUsage(usage);
  if (streamError) throw new Error(streamError);
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
  const providerKey = responsesProviderKey(provider);
  const localOllama = /^https?:\/\/(?:localhost|127\.0\.0\.1):11434(?:\/|$)/i.test(provider.baseUrl);
  if (!localOllama && !unsupportedResponsesProviders.has(providerKey)) {
    const response = await request(endpoint(provider, '/responses'), { method: 'POST', headers: headers(provider), body: JSON.stringify({ model, input: 'Reply with OK', max_output_tokens: 8, store: false }) });
    if (response.ok) {
      const payload = await response.json();
      if (!payload.id && !payload.output) throw new Error('Provider returned an invalid Responses payload');
      return Math.round(performance.now() - started);
    }
    const detail = await response.text();
    if (isUnsupportedResponsesError(response.status) || (response.status === 400 && /(responses.{0,30}(not supported|unsupported)|(?:unknown|unsupported).{0,24}(?:endpoint|route))/i.test(detail))) unsupportedResponsesProviders.add(providerKey);
    else throw new Error(`Model test failed (${response.status}): ${detail}`);
  }
  const response = await request(endpoint(provider, '/chat/completions'), { method: 'POST', headers: headers(provider), body: JSON.stringify({ model, stream: false, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with OK' }] }) });
  if (!response.ok) throw new Error(`Model test failed (${response.status}): ${await response.text()}`);
  const payload = await response.json();
  if (!payload.choices?.[0]?.message) throw new Error('Provider returned an invalid Chat Completions payload');
  return Math.round(performance.now() - started);
}

export async function streamCompletion(config: Config, messages: Message[], onToken: (token: string) => void, signal?: AbortSignal, systemContext?: string, memory?: ResponseMemory, onMemory?: (memory?: ResponseMemory) => void, workId?: string) {
  const tracker = new UsageTracker(config, workId);
  try {
    await streamCompletionImpl(config, messages, token => { tracker.text(token); onToken(token); }, signal, systemContext, memory, onMemory, usage => tracker.report(usage));
    tracker.finish('complete');
  } catch (error) { tracker.finish(signal?.aborted ? 'stopped' : 'failed'); throw error; }
}

async function streamCompletionImpl(config: Config, messages: Message[], onToken: (token: string) => void, signal: AbortSignal | undefined, systemContext: string | undefined, memory: ResponseMemory | undefined, onMemory: ((memory?: ResponseMemory) => void) | undefined, reportUsage: (usage: unknown) => void) {
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
        temperature: temperaturelessResponsesProviders.has(providerKey) ? undefined : config.temperature,
        stream: true,
        store,
      }),
      signal,
    });
    let useChain = chained && !stateless;
    let responseRequest = await createResponse(useChain, !stateless);
    for (let negotiation = 0; !responseRequest.ok && negotiation < 4; negotiation++) {
      const detail = await responseRequest.text();
      if (!stateless && requiresStatelessResponses(responseRequest.status, detail)) {
        statelessResponsesProviders.add(providerKey);
        stateless = true;
        useChain = false;
      }
      else if (!temperaturelessResponsesProviders.has(providerKey) && rejectsTemperature(responseRequest.status, detail)) {
        temperaturelessResponsesProviders.add(providerKey);
      }
      else if (useChain && isStaleResponseError(responseRequest.status, detail)) useChain = false;
      else if (isUnsupportedResponsesError(responseRequest.status)) { unsupportedResponsesProviders.add(providerKey); break; }
      else throw new Error(`Provider returned ${responseRequest.status}: ${detail}`);
      responseRequest = await createResponse(useChain, !stateless);
    }
    if (responseRequest.ok) {
      const responseId = await readResponseStream(responseRequest, onToken, reportUsage);
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
  const chatRequest = () => request(endpoint(provider, '/chat/completions'), { method: 'POST', headers: { ...headers(provider), Accept: 'text/event-stream' }, body: JSON.stringify({ model: config.activeModel, temperature: config.temperature, stream: true, stream_options: usageOptionlessProviders.has(providerKey) ? undefined : { include_usage: true }, messages: providerMessages }), signal });
  let response = await chatRequest();
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 400 && /stream_options|include_usage/i.test(detail) && !usageOptionlessProviders.has(providerKey)) {
      usageOptionlessProviders.add(providerKey); response = await chatRequest();
    } else throw new Error(`Provider returned ${response.status}: ${detail}`);
  }
  if (!response.ok) throw new Error(`Provider returned ${response.status}: ${await response.text()}`);
  if (!response.body) throw new Error('The provider did not return a response stream');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  let usage: unknown;
  let streamError = '';
  const handle = (line: string) => {
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') return;
    try { const event = JSON.parse(raw); if (event.usage) usage = event.usage; if (event.error) streamError = event.error.message || 'The provider stream failed'; onToken(event.choices?.[0]?.delta?.content || ''); } catch { /* ignore malformed SSE payload */ }
  };
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; lines.forEach(handle); }
  if (buffer.trim()) handle(buffer);
  reportUsage(usage);
  if (streamError) throw new Error(streamError);
}

export type AgentTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type AgentToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

const compactScreenFingerprint = (dataUrl: string) => {
  let hash = 2166136261;
  const stride = Math.max(1, Math.floor(dataUrl.length / 2048));
  for (let index = 0; index < dataUrl.length; index += stride) hash = Math.imul(hash ^ dataUrl.charCodeAt(index), 16777619);
  return `${dataUrl.length}:${(hash >>> 0).toString(16)}`;
};

// Stream text immediately, but execute tools only after their arguments are complete.
// Some compatible providers still return JSON despite stream:true; accept that honestly.
export async function readAgentTurn(response: Response, protocol: 'responses' | 'chat', onToken: (text: string) => void) {
  if (!response.headers?.get('content-type')?.includes('text/event-stream')) return { payload: await response.json(), streamed: false };
  if (!response.body) throw new Error('The provider returned an empty stream');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', text = '', payload: any, ended = false;
  const items = new Map<number, any>(), calls = new Map<number, any>();
  let usage: unknown, id = '';
  const handle = (frame: string) => {
    const raw = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!raw) return;
    if (raw === '[DONE]') { ended = true; return; }
    const event = JSON.parse(raw);
    if (event.error || event.type === 'response.failed' || event.type === 'error') throw new Error(event.response?.error?.message || event.error?.message || event.message || 'Provider stream failed');
    if (protocol === 'responses') {
      id = event.response?.id || id;
      if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') items.set(event.output_index, event.item);
      if (event.type === 'response.function_call_arguments.delta') {
        const item = items.get(event.output_index);
        if (item) item.arguments = (item.arguments || '') + event.delta;
      }
      if (event.type === 'response.function_call_arguments.done') {
        const item = items.get(event.output_index);
        if (item) item.arguments = event.arguments;
      }
      if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
        if (typeof event.delta === 'string') { text += event.delta; onToken(event.delta); }
      }
      if (event.type === 'response.completed') { payload = event.response; ended = true; }
      if (event.type === 'response.incomplete') throw new Error(`Response incomplete: ${event.response?.incomplete_details?.reason || 'provider interrupted generation'}`);
    } else {
      if (event.usage) usage = event.usage;
      const choice = event.choices?.[0], delta = choice?.delta;
      if (typeof delta?.content === 'string') { text += delta.content; onToken(delta.content); }
      for (const part of delta?.tool_calls || []) {
        const call = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
        calls.set(part.index, call);
      }
      if (choice?.finish_reason) {
        if (choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') throw new Error(`Response interrupted: ${choice.finish_reason}`);
        ended = true;
      }
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { buffer += decoder.decode(); break; }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() || '';
      frames.forEach(handle);
    }
    if (buffer.trim()) handle(buffer);
    if (!ended) throw new Error('Provider stream ended before the response completed');
    if (protocol === 'chat') payload = { usage, choices: [{ message: { content: text, tool_calls: [...calls.values()] } }] };
    else payload = { id, output: [...items.values()], output_text: text || undefined, ...payload };
    return { payload, streamed: Boolean(text) };
  } finally { await reader.cancel(); reader.releaseLock(); }
}

async function runAgentCompletionImpl(
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
  reportUsage: (usage: unknown) => void = () => {},
  requestedTools: string[] = [],
) {
  const pendingTools = new Set(requestedTools.filter(name => tools.some(tool => tool.function.name === name)));
  let missingToolReplies = 0;
  const recordRequestedTool = (name: string, result: unknown) => {
    if (result && typeof result === 'object' && ('error' in result || ('ok' in result && result.ok === false) || ('status' in result && result.status !== 'success'))) return;
    pendingTools.delete(name);
  };
  const missingToolInstruction = () => {
    if (++missingToolReplies > 2) throw new Error(`Requested tools were not completed: ${[...pendingTools].join(', ')}. No successful execution was verified.`);
    return `Do not claim the task is complete. These explicitly requested tools have not succeeded: ${[...pendingTools].join(', ')}. Execute them with the appropriate arguments and normal approvals. If required input is missing, use ask_user.`;
  };
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
      body: JSON.stringify({ model: config.activeModel, stream: true, instructions: systemContext, input: responseInput, previous_response_id: stateless ? undefined : previousResponseId || undefined, temperature: temperaturelessResponsesProviders.has(providerKey) ? undefined : config.temperature, store: !stateless, tools: responseTools, tool_choice: pendingTools.size || (turn === 0 && requireTool) ? 'required' : 'auto' }),
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
      if (!temperaturelessResponsesProviders.has(providerKey) && rejectsTemperature(response.status, detail)) {
        temperaturelessResponsesProviders.add(providerKey);
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
    const { payload, streamed } = await readAgentTurn(response, 'responses', pendingTools.size ? () => {} : onToken);
    reportUsage(payload.usage);
    if (!stateless) previousResponseId = payload.id || previousResponseId;
    if (stateless && Array.isArray(payload.output)) statelessContext.push(...payload.output);
    const calls = (Array.isArray(payload.output) ? payload.output : []).filter((item: any) => item?.type === 'function_call');
    if (!calls.length) {
      if (pendingTools.size) {
        responseInput = [{ role: 'user', content: [{ type: 'input_text', text: missingToolInstruction() }] }];
        if (stateless) { statelessContext.push(...responseInput); responseInput = statelessContext; }
        turn += 1;
        continue;
      }
      const output = typeof payload.output_text === 'string' ? payload.output_text : (payload.output || []).flatMap((item: any) => item?.content || []).filter((item: any) => item?.type === 'output_text').map((item: any) => item.text || '').join('');
      if (!streamed) onToken(output || 'Task complete.');
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
        if (signal?.aborted || error instanceof Error && /__NOVA_PERMISSION_DENIED__|__NOVA_INPUT_CANCELLED__/.test(error.message)) throw error;
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      onStep('thinking');
      recordRequestedTool(call.function.name, result);
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
      body: JSON.stringify({ model: config.activeModel, temperature: config.temperature, stream: true, stream_options: usageOptionlessProviders.has(providerKey) ? undefined : { include_usage: true }, messages: conversation, tools, tool_choice: forceFirstTool && (pendingTools.size || turn === 0) ? 'required' : 'auto' }),
    });
    if (!response.ok) {
      const detail = await response.text();
      if (response.status === 400 && /stream_options|include_usage/i.test(detail) && !usageOptionlessProviders.has(providerKey)) { usageOptionlessProviders.add(providerKey); continue; }
      if (turn === 0 && forceFirstTool && response.status === 400 && /tool_choice|required/i.test(detail)) { forceFirstTool = false; continue; }
      throw new Error(`Agent provider returned ${response.status}: ${detail}`);
    }
    const { payload, streamed } = await readAgentTurn(response, 'chat', pendingTools.size ? () => {} : onToken);
    reportUsage(payload.usage);
    const assistant = payload.choices?.[0]?.message;
    if (!assistant) throw new Error('Agent provider returned an invalid completion');
    conversation.push({ role: 'assistant', content: assistant.content ?? null, ...(assistant.tool_calls ? { tool_calls: assistant.tool_calls } : {}) });
    const calls: AgentToolCall[] = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    if (!calls.length) {
      if (pendingTools.size) { conversation.push({ role: 'user', content: missingToolInstruction() }); turn += 1; continue; }
      if (!streamed) onToken(assistant.content || 'Task complete.'); return;
    }
    const screenImages: string[] = [];
    for (const call of calls) {
      onStep(call.function.name);
      let result: unknown;
      try { result = await execute(call); }
      catch (error) {
        if (signal?.aborted || error instanceof Error && /__NOVA_PERMISSION_DENIED__|__NOVA_INPUT_CANCELLED__/.test(error.message)) throw error;
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      onStep('thinking');
      recordRequestedTool(call.function.name, result);
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

export async function runAgentCompletion(config: Config, messages: Message[], systemContext: string, tools: AgentTool[], execute: (call: AgentToolCall) => Promise<unknown>, onStep: (label: string) => void, onToken: (token: string) => void, signal?: AbortSignal, memory?: ResponseMemory, onMemory?: (memory?: ResponseMemory) => void, requireTool = false, workId?: string, requestedTools: string[] = []) {
  const tracker = new UsageTracker(config, workId);
  try {
    await runAgentCompletionImpl(config, messages, systemContext, tools, execute, onStep, token => { tracker.text(token); onToken(token); }, signal, memory, onMemory, requireTool, usage => tracker.report(usage), requestedTools);
    tracker.finish('complete');
  } catch (error) { tracker.finish(signal?.aborted ? 'stopped' : 'failed'); throw error; }
}
