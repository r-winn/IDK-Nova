import type { Config } from '../types';
import { intelligenceSettings, type IntelligenceSettings } from './intelligence';
import { modelPrices, type ModelPrice } from './usage';
import { savedPrompts, validatePrompts, type SavedPrompt } from './prompts';
import { PACKS_CHANGED } from './packs';
import type { MemoryNote } from './intelligence';
import { EXTENSIONS_KEY, installedExtensions, validateExtensions } from './extensions';

type Bundle = { schema: 1; extensions?: string[]; prompts?: SavedPrompt[]; intelligence?: IntelligenceSettings; prices?: Record<string, ModelPrice>; personalMemory?: MemoryNote[] };
export type ExportSections = { appearance: boolean; providers: boolean; prompts: boolean; packs: boolean; intelligence: boolean; prices: boolean };
export const defaultExportSections: ExportSections = { appearance: true, providers: true, prompts: true, packs: true, intelligence: true, prices: true };
export function configPreferences(value: unknown): Partial<Config> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid config.');
  const raw = value as Partial<Config>;
  const result: Partial<Config> = {};
  if (raw.providers !== undefined) {
    if (!Array.isArray(raw.providers) || raw.providers.length > 100) throw new Error('Invalid provider list.');
    result.providers = raw.providers.map(provider => {
      if (!provider || typeof provider.baseUrl !== 'string' || provider.baseUrl.length > 2000 || typeof provider.id !== 'string' || provider.id.length > 200 || typeof provider.name !== 'string' || provider.name.length > 200 || !Array.isArray(provider.models) || provider.models.length > 2000 || provider.models.some(model => typeof model !== 'string' || model.length > 500) || (provider.apiKey !== undefined && (typeof provider.apiKey !== 'string' || provider.apiKey.length > 20000))) throw new Error('Invalid provider.');
      const url = new URL(provider.baseUrl);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('Use a plain HTTP(S) provider Base URL.');
      return { id: provider.id, name: provider.name, baseUrl: provider.baseUrl, apiKey: provider.apiKey || '', models: provider.models };
    });
  }
  if (raw.temperature !== undefined) {
    if (typeof raw.temperature !== 'number' || !Number.isFinite(raw.temperature) || raw.temperature < 0 || raw.temperature > 2) throw new Error('Invalid temperature.');
    result.temperature = raw.temperature;
  }
  if (raw.theme !== undefined) {
    if (!['light', 'dark', 'system'].includes(raw.theme)) throw new Error('Invalid theme.');
    result.theme = raw.theme;
  }
  for (const field of ['activeProviderId', 'activeModel'] as const) {
    if (raw[field] !== undefined) { if (typeof raw[field] !== 'string' || raw[field].length > 500) throw new Error('Invalid model selection.'); result[field] = raw[field]; }
  }
  if (raw.branding !== undefined) {
    const brand = raw.branding;
    if (!brand || typeof brand.appName !== 'string' || brand.appName.length > 200 || typeof brand.workspaceName !== 'string' || brand.workspaceName.length > 200 || typeof brand.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(brand.accent) || typeof brand.logoDataUrl !== 'string' || brand.logoDataUrl.length > 2800000 || (brand.logoDataUrl && !brand.logoDataUrl.startsWith('data:image/'))) throw new Error('Invalid branding.');
    result.branding = { appName: brand.appName, workspaceName: brand.workspaceName, accent: brand.accent, logoDataUrl: brand.logoDataUrl };
  }
  if (raw.database !== undefined) {
    const database = raw.database;
    if (!database || typeof database.enabled !== 'boolean' || !['none', 'postgresql', 'mysql', 'sqlite', 'http'].includes(database.kind) || typeof database.url !== 'string' || database.url.length > 2000 || typeof database.useForMemory !== 'boolean') throw new Error('Invalid storage config.');
    result.database = { enabled: database.enabled, kind: database.kind, url: database.url, useForMemory: database.useForMemory };
  }
  return result;
}
export function exportConfigBundle(config: Config, includeKeys = false, includeMemory = false, sections: ExportSections = defaultExportSections) {
  const personalMemory: MemoryNote[] = includeMemory ? JSON.parse(localStorage.getItem('nova-memory-notes') || '[]').filter((note: MemoryNote) => note.scope === 'personal') : [];
  return {
    ...(sections.appearance ? { theme: config.theme, temperature: config.temperature, branding: config.branding, database: { ...config.database, url: '' } } : {}),
    ...(sections.providers ? { activeProviderId: config.activeProviderId, activeModel: config.activeModel, providers: config.providers.map(provider => ({ id: provider.id, name: provider.name, baseUrl: provider.baseUrl, models: provider.models, apiKey: includeKeys ? provider.apiKey : '', apiKeyStored: false })) } : {}),
    novaBundle: { schema: 1,
      ...(sections.packs ? { extensions: installedExtensions() } : {}),
      ...(sections.prompts || sections.packs ? { prompts: savedPrompts().filter(prompt => prompt.pack ? sections.packs : sections.prompts) } : {}),
      ...(sections.intelligence ? { intelligence: intelligenceSettings() } : {}),
      ...(sections.prices ? { prices: modelPrices() } : {}),
      ...(includeMemory ? { personalMemory } : {}) } satisfies Bundle,
  };
}
export function validateConfigBundle(value: unknown): Bundle | undefined {
  if (value === undefined) return; // Older config files are still supported.
  if (!value || typeof value !== 'object') throw new Error('Invalid configuration bundle.');
  const bundle = value as Bundle;
  if (bundle.extensions !== undefined) validateExtensions(bundle.extensions);
  if (bundle.schema !== 1 || (bundle.intelligence !== undefined && (!bundle.intelligence || typeof bundle.intelligence.enabled !== 'boolean' || !Number.isInteger(bundle.intelligence.contextMessages) || bundle.intelligence.contextMessages < 2 || bundle.intelligence.contextMessages > 200))) throw new Error('Invalid Intelligence settings.');
  const routes: IntelligenceSettings['routes'] = {};
  for (const role of ['fast', 'strong', 'vision', 'private'] as const) {
    const route = bundle.intelligence?.routes?.[role];
    if (route !== undefined && (typeof route !== 'string' || route.length > 500)) throw new Error('Invalid model route.');
    if (route) routes[role] = route;
  }
  if (bundle.prices !== undefined && (!bundle.prices || typeof bundle.prices !== 'object' || Array.isArray(bundle.prices) || Object.keys(bundle.prices).length > 2000)) throw new Error('Invalid model prices.');
  const prices: Record<string, ModelPrice> = {};
  for (const [key, price] of Object.entries(bundle.prices || {})) {
    if (key.length > 500 || !price || typeof price !== 'object') throw new Error('Invalid model price.');
    const entry: ModelPrice = {};
    for (const field of ['input', 'output', 'cached'] as const) {
      const rate = price[field];
      if (rate !== undefined && (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0)) throw new Error('Invalid model price.');
      if (rate !== undefined) entry[field] = rate;
    }
    Object.defineProperty(prices, key, { value: entry, enumerable: true, configurable: true });
  }
  let personalMemory: MemoryNote[] | undefined;
  if (bundle.personalMemory !== undefined) {
    if (!Array.isArray(bundle.personalMemory) || bundle.personalMemory.length > 200) throw new Error('Invalid personal memory.');
    personalMemory = bundle.personalMemory.map(note => {
      if (!note || typeof note.id !== 'string' || note.id.length > 100 || note.scope !== 'personal' || typeof note.text !== 'string' || !note.text.trim() || note.text.length > 20000 || typeof note.pinned !== 'boolean') throw new Error('Invalid personal memory note.');
      return { id: note.id, scope: 'personal', text: note.text, pinned: note.pinned };
    });
  }
  return { schema: 1, ...(bundle.extensions !== undefined ? { extensions: validateExtensions(bundle.extensions) } : {}), ...(bundle.prompts !== undefined ? { prompts: validatePrompts(bundle.prompts) } : {}), ...(bundle.intelligence ? { intelligence: { enabled: bundle.intelligence.enabled, contextMessages: bundle.intelligence.contextMessages, routes } } : {}), ...(bundle.prices !== undefined ? { prices } : {}), ...(personalMemory ? { personalMemory } : {}) };
}
export function importConfigBundle(bundle: Bundle | undefined, source: Config, merged: Config) {
  if (!bundle) return;
  // Imported provider IDs may change when the same endpoint already exists.
  const remap = (route: string) => {
    const provider = source.providers?.find(item => route.startsWith(`${item.id}::`));
    const target = provider && merged.providers.find(item => item.baseUrl.replace(/\/+$/, '').toLowerCase() === provider.baseUrl.replace(/\/+$/, '').toLowerCase());
    return target && provider ? `${target.id}${route.slice(provider.id.length)}` : route;
  };
  const existing = savedPrompts();
  const shortcuts = new Set((bundle.prompts || []).map(prompt => prompt.shortcut));
  const prompts = validatePrompts([...existing.filter(prompt => !shortcuts.has(prompt.shortcut)), ...(bundle.prompts || [])]);
  const intelligence = bundle.intelligence && { ...bundle.intelligence, routes: Object.fromEntries(Object.entries(bundle.intelligence.routes).map(([role, route]) => [role, remap(route!)])) };
  const prices = bundle.prices && { ...modelPrices(), ...Object.fromEntries(Object.entries(bundle.prices).map(([key, price]) => [remap(key), price])) };
  // Roll back portable settings together if storage is full.
  const keys = ['nova-prompts-v1', 'nova-intelligence', 'nova-prices-v1', 'nova-memory-notes'];
  const before = keys.map(key => localStorage.getItem(key));
  const extensionsBefore = localStorage.getItem(EXTENSIONS_KEY);
  try {
    if (bundle.extensions !== undefined) localStorage.setItem(EXTENSIONS_KEY, JSON.stringify(validateExtensions([...new Set([...installedExtensions(), ...validateExtensions(bundle.extensions)])])));
    if (bundle.prompts !== undefined) localStorage.setItem(keys[0], JSON.stringify(prompts));
    if (intelligence) localStorage.setItem(keys[1], JSON.stringify(intelligence));
    if (prices) localStorage.setItem(keys[2], JSON.stringify(prices));
    if (bundle.personalMemory) {
      const notes: MemoryNote[] = JSON.parse(localStorage.getItem(keys[3]) || '[]');
      const ids = new Set(bundle.personalMemory.map(note => note.id));
      localStorage.setItem(keys[3], JSON.stringify([...notes.filter(note => note.scope !== 'personal' || !ids.has(note.id)), ...bundle.personalMemory]));
    }
    if (bundle.prompts !== undefined || bundle.extensions !== undefined) window.dispatchEvent(new Event(PACKS_CHANGED));
  } catch (error) {
    if (extensionsBefore === null) localStorage.removeItem(EXTENSIONS_KEY); else localStorage.setItem(EXTENSIONS_KEY, extensionsBefore);
    keys.forEach(key => localStorage.removeItem(key));
    keys.forEach((key, index) => { if (before[index] !== null) localStorage.setItem(key, before[index]!); });
    throw error;
  }
}
