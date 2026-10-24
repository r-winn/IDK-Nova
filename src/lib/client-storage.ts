// Server deployments isolate browser data by the verified OIDC subject. Desktop
// and standalone static hosting keep their existing keys and migration behavior.
declare global { interface Window { __NOVA_SERVER__?: { userId: string } } }
const account = () => typeof window !== 'undefined' ? window.__NOVA_SERVER__?.userId : undefined;
export const browserDataName = (name: string) => account() ? `nova-account:${account()}:${name}` : name;
export const clientStorage = {
  getItem: (key: string) => localStorage.getItem(browserDataName(key)),
  setItem: (key: string, value: string) => localStorage.setItem(browserDataName(key), value),
  removeItem: (key: string) => localStorage.removeItem(browserDataName(key)),
};
export function initializeServerSession() {
  if (!account()) return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/providers/')) return originalFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('X-Nova-User', account()!);
    return originalFetch(input, { ...init, headers });
  };
}
