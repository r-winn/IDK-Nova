import type { Chat, Config } from '../types';
import { defaultConfig } from '../types';
export function loadValue<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; } }
export function saveChats(chats: Chat[]) { const safe = chats.filter(chat => !chat.temporary).map(chat => ({ ...chat, messages: chat.messages.map(message => ({ ...message, attachments: undefined })) })); localStorage.setItem('idk-nova-history', JSON.stringify(safe)); }
export function loadConfig(): Config {
  const stored = loadValue<any>('idk-nova-config', null) || loadValue<any>('nova-chat-config', null);
  if (!stored) return defaultConfig;
  if (Array.isArray(stored.providers)) return { ...defaultConfig, ...stored, theme: stored.theme || 'system', branding: { ...defaultConfig.branding, ...stored.branding }, database: { ...defaultConfig.database, ...stored.database }, providers: stored.providers.map((provider: any) => ({ ...provider, models: Array.isArray(provider.models) ? provider.models : [] })) };
  const provider = { id: 'migrated-provider', name: stored.name || 'Local provider', baseUrl: stored.baseUrl || defaultConfig.providers[0].baseUrl, apiKey: stored.apiKey || '', models: stored.model ? [stored.model] : [] };
  return { ...defaultConfig, providers: [provider], activeProviderId: provider.id, activeModel: stored.model || '', temperature: stored.temperature ?? 0.5 };
}
export function saveConfig(config: Config) { localStorage.setItem('idk-nova-config', JSON.stringify(config)); }

export async function loadManagedConfig(): Promise<Partial<Config> | null> {
  try { const response = await fetch(`${import.meta.env.BASE_URL}idk-nova.config.json`, { cache: 'no-store' }); return response.ok ? await response.json() : null; } catch { return null; }
}
