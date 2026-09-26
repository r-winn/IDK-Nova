export type Attachment = { name: string; type: string; url: string };
export type Message = { role: 'user' | 'assistant'; content: string; attachments?: Attachment[]; liked?: boolean };
export type Chat = { id: number; title: string; time: string; messages: Message[]; archived?: boolean };
export type Provider = { id: string; name: string; baseUrl: string; apiKey: string; models: string[] };
export type Config = { providers: Provider[]; activeProviderId: string; activeModel: string; temperature: number };
export const defaultProvider: Provider = { id: 'ollama-local', name: 'Ollama Local', baseUrl: 'http://localhost:11434/v1', apiKey: '', models: [] };
export const defaultConfig: Config = { providers: [defaultProvider], activeProviderId: defaultProvider.id, activeModel: '', temperature: 0.5 };
export const getActiveProvider = (config: Config) => config.providers.find(provider => provider.id === config.activeProviderId) || config.providers[0];
