import { invoke, isTauri } from '@tauri-apps/api/core';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { registerSecrets } from './secrets';
const account = 'nova-plugin:github', marker = 'nova-github-account';
let token = '', sessionLogin = '';
export function githubLogin() { return sessionLogin || (isTauri() ? localStorage.getItem(marker) || '' : ''); }
export async function connectGithub(value: string) {
  const candidate = value.trim();
  if (!candidate || candidate.length > 255 || /\s/.test(candidate)) throw new Error('Enter a GitHub access token.');
  registerSecrets([candidate]);
  const response = await (isTauri() ? nativeFetch : fetch)('https://api.github.com/user', { headers: { Authorization: `Bearer ${candidate}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error(`GitHub authentication failed (${response.status}). Check token access and expiry.`);
  const user = await response.json();
  if (typeof user.login !== 'string') throw new Error('Invalid GitHub account response.');
  if (isTauri()) await invoke('write_provider_credential', { account, secret: candidate });
  token = candidate; sessionLogin = user.login;
  if (isTauri()) localStorage.setItem(marker, user.login);
  return user.login as string;
}
export async function disconnectGithub() {
  if (isTauri()) await invoke('write_provider_credential', { account, secret: '' });
  token = ''; sessionLogin = ''; localStorage.removeItem(marker);
}
export const githubFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== 'https://api.github.com' || (init?.method || 'GET').toUpperCase() !== 'GET' || url.username || url.password) throw new Error('GitHub connection permits read-only GitHub API requests only.');
  if (!token && githubLogin()) {
    token = await invoke<string | null>('read_provider_credential', { account, allowPrompt: false }) || '';
    if (!token) throw new Error('Reconnect GitHub in Marketplace to unlock its credentials.');
    registerSecrets([token]);
  }
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return (isTauri() ? nativeFetch : fetch)(url.href, { ...init, headers, redirect: 'error' });
};
