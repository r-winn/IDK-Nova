import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserStorage } from './helpers/client-storage.mjs';
test('server storage separates identities while desktop and static hosting retain existing keys', () => {
  const data = new Map(), localStorage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  const ordinary = loadBrowserStorage({ localStorage });
  ordinary.clientStorage.setItem('idk-nova-config', 'desktop');
  const alice = loadBrowserStorage({ localStorage, window: { __NOVA_SERVER__: { userId: 'alice' } } });
  const bob = loadBrowserStorage({ localStorage, window: { __NOVA_SERVER__: { userId: 'bob' } } });
  assert.equal(alice.clientStorage.getItem('idk-nova-config'), undefined);
  alice.clientStorage.setItem('idk-nova-config', 'private-a'); bob.clientStorage.setItem('idk-nova-config', 'private-b');
  assert.equal(alice.clientStorage.getItem('idk-nova-config'), 'private-a'); assert.equal(bob.clientStorage.getItem('idk-nova-config'), 'private-b');
  assert.equal(ordinary.clientStorage.getItem('idk-nova-config'), 'desktop');
  assert.notEqual(alice.browserDataName('idk-nova-memory'), bob.browserDataName('idk-nova-memory'));
  bob.clientStorage.removeItem('idk-nova-config'); assert.equal(alice.clientStorage.getItem('idk-nova-config'), 'private-a');
});
test('only same-origin company requests receive the account guard; other providers remain unchanged', async () => {
  const calls = [], window = { __NOVA_SERVER__: { userId: 'alice' }, fetch: async (...args) => { calls.push(args); return new Response('ok'); } };
  const api = loadBrowserStorage({ window, location: { href: 'https://nova.example/', origin: 'https://nova.example' } });
  api.initializeServerSession();
  await window.fetch('/api/providers/company/v1/models');
  await window.fetch('https://external.example/v1/models');
  assert.equal(calls[0][1].headers.get('X-Nova-User'), 'alice'); assert.equal(calls[1][1], undefined);
});
