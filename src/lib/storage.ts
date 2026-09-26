import type { Chat, Config } from '../types';
import { defaultConfig } from '../types';
export function loadValue<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; } }
export function saveChats(chats: Chat[]) { const safe = chats.map(chat => ({ ...chat, messages: chat.messages.map(message => ({ ...message, attachments: undefined })) })); localStorage.setItem('idk-nova-history', JSON.stringify(safe)); }
export function loadConfig(): Config {
  const stored = loadValue<any>('idk-nova-config', null) || loadValue<any>('nova-chat-config', null);
  if (!stored) return defaultConfig;
  if (Array.isArray(stored.providers)) return { ...defaultConfig, ...stored, providers: stored.providers.map((provider: any) => ({ ...provider, models: Array.isArray(provider.models) ? provider.models : [] })) };
  const provider = { id: 'migrated-provider', name: stored.name || 'Local provider', baseUrl: stored.baseUrl || defaultConfig.providers[0].baseUrl, apiKey: stored.apiKey || '', models: stored.model ? [stored.model] : [] };
  return { providers: [provider], activeProviderId: provider.id, activeModel: stored.model || '', temperature: stored.temperature ?? 0.5 };
}
export function saveConfig(config: Config) { localStorage.setItem('idk-nova-config', JSON.stringify({ ...config, providers: config.providers.map(provider => ({ ...provider, apiKey: '' })) })); }
