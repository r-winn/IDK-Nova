import type { Attachment, Chat, Config } from '../types';
import { defaultConfig, defaultProvider } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { registerSecrets } from './secrets';
export function loadValue<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; } }
const ATTACHMENT_DB = 'idk-nova-memory';
const ATTACHMENT_STORE = 'attachments';
const persistedAttachmentKeys = new Set<string>();
const openAttachmentDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(ATTACHMENT_DB, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(ATTACHMENT_STORE);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const putAttachment = async (key: string, attachment: Attachment) => {
  const db = await openAttachmentDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(ATTACHMENT_STORE, 'readwrite').objectStore(ATTACHMENT_STORE).put(attachment.url, key);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  db.close();
};
const getAttachment = async (key: string) => {
  const db = await openAttachmentDb();
  const value = await new Promise<string | undefined>((resolve, reject) => {
    const request = db.transaction(ATTACHMENT_STORE).objectStore(ATTACHMENT_STORE).get(key);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : undefined); request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
};
export function saveChats(chats: Chat[]) {
  const safe = chats.filter(chat => !chat.temporary).map(chat => ({ ...chat, messages: chat.messages.map((message, messageIndex) => ({
    ...message,
    attachments: message.attachments?.map((attachment, attachmentIndex) => {
      const key = `${chat.id}:${messageIndex}:${attachmentIndex}`;
      if (!attachment.url.startsWith('idb:') && !persistedAttachmentKeys.has(key)) {
        persistedAttachmentKeys.add(key);
        void putAttachment(key, attachment).catch(() => persistedAttachmentKeys.delete(key));
      }
      return { ...attachment, url: `idb:${key}` };
    }),
  })) }));
  localStorage.setItem('idk-nova-history', JSON.stringify(safe));
}
export async function restoreChatAttachments(chats: Chat[]): Promise<Chat[]> {
  return Promise.all(chats.map(async (chat) => ({ ...chat, messages: await Promise.all(chat.messages.map(async (message) => ({
    ...message,
    attachments: message.attachments ? await Promise.all(message.attachments.map(async (attachment) => {
      if (!attachment.url.startsWith('idb:')) return attachment;
      const url = await getAttachment(attachment.url.slice(4)).catch(() => undefined);
      return url ? { ...attachment, url } : attachment;
    })) : undefined,
  }))) })));
}
export function loadConfig(): Config {
  const stored = loadValue<any>('idk-nova-config', null) || loadValue<any>('nova-chat-config', null);
  if (!stored) return defaultConfig;
  if (Array.isArray(stored.providers)) return { ...defaultConfig, ...stored, theme: stored.theme || 'system', branding: { ...defaultConfig.branding, ...stored.branding }, database: { ...defaultConfig.database, ...stored.database }, providers: stored.providers.map((provider: any) => ({ ...provider, models: Array.isArray(provider.models) ? provider.models : [] })) };
  const provider = { id: 'migrated-provider', name: stored.name || 'Local provider', baseUrl: stored.baseUrl || defaultProvider.baseUrl, apiKey: stored.apiKey || '', models: stored.model ? [stored.model] : [] };
  return { ...defaultConfig, providers: [provider], activeProviderId: provider.id, activeModel: stored.model || '', temperature: stored.temperature ?? 0.5 };
}
let credentialQueue: Promise<void> = Promise.resolve();
const credentialAccount = (provider: Config['providers'][number]) => `${provider.id}:${provider.baseUrl.replace(/\/+$/, '')}`;
export async function hydrateProviderCredentials(config: Config): Promise<Config> {
  if (!('__TAURI_INTERNALS__' in window)) return config;
  const providers = [];
  for (const provider of config.providers) {
    if (!provider.apiKey && provider.apiKeyStored) {
      const apiKey = await invoke<string | null>('read_provider_credential', { account: credentialAccount(provider) });
      providers.push({ ...provider, apiKey: apiKey || '', apiKeyStored: Boolean(apiKey) });
    } else providers.push(provider);
  }
  registerSecrets(providers.map(provider => provider.apiKey));
  return { ...config, providers };
}
export function saveConfig(config: Config) {
  registerSecrets(config.providers.map(provider => provider.apiKey));
  if (!('__TAURI_INTERNALS__' in window)) { localStorage.setItem('idk-nova-config', JSON.stringify(config)); return; }
  const snapshot = structuredClone(config);
  credentialQueue = credentialQueue.catch(() => {}).then(async () => {
    for (const provider of snapshot.providers) {
      if (!provider.apiKey && provider.apiKeyStored) continue; // Still loading: preserve the existing vault entry.
      await invoke('write_provider_credential', { account: credentialAccount(provider), secret: provider.apiKey });
    }
    localStorage.setItem('idk-nova-config', JSON.stringify({ ...snapshot, providers: snapshot.providers.map(provider => ({ ...provider, apiKey: '', apiKeyStored: Boolean(provider.apiKey || provider.apiKeyStored) })) }));
    localStorage.removeItem('nova-chat-config'); // Remove the migrated legacy credential copy only after vault writes succeed.
  });
  void credentialQueue.catch(() => window.dispatchEvent(new CustomEvent('nova-credential-error', { detail: 'Could not save credentials securely. Settings were not persisted; unlock the system vault and save again.' })));
}

export async function loadManagedConfig(): Promise<Partial<Config> | null> {
  try { const response = await fetch(`${import.meta.env.BASE_URL}idk-nova.config.json`, { cache: 'no-store' }); return response.ok ? await response.json() : null; } catch { return null; }
}
