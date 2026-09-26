import type { Chat, Config } from '../types';
export function loadValue<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; } }
export function saveChats(chats: Chat[]) { const safe = chats.map(chat => ({ ...chat, messages: chat.messages.map(message => ({ ...message, attachments: undefined })) })); localStorage.setItem('nova-chat-history', JSON.stringify(safe)); }
export function saveConfig(config: Config) { localStorage.setItem('nova-chat-config', JSON.stringify({ ...config, apiKey: '' })); }
