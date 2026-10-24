import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createApplication, validateConfig } from '../app.mjs';

let idp, upstream, app, base, issuer, temp, config, privateKey, publicJWK, upstreamCalls = [], nextClaims = {};
const codes = new Map();
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
const env = { OIDC_SECRET: 'test-client-secret', PROVIDER_SECRET: 'never-public-provider-secret' };
const sendJSON = (res, body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
before(async () => {
  ({ privateKey, publicKey: publicJWK } = await generateKeyPair('RS256'));
  publicJWK = { ...await exportJWK(publicJWK), kid: 'test', use: 'sig', alg: 'RS256' };
  idp = http.createServer(async (req, res) => {
    if (req.url === '/.well-known/openid-configuration') return sendJSON(res, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256'] });
    if (req.url === '/jwks') return sendJSON(res, { keys: [publicJWK] });
    if (req.url === '/token') {
      let body = ''; for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body), code = codes.get(params.get('code')); codes.delete(params.get('code'));
      if (!code || params.get('client_secret') !== env.OIDC_SECRET) { res.statusCode = 400; return sendJSON(res, { error: 'invalid_grant' }); }
      const { createHash } = await import('node:crypto');
      assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), code.challenge);
      const jwt = await new SignJWT({ nonce: code.nonce, groups: ['nova-users'], ...code.claims }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(issuer).setAudience('nova-test').setSubject(code.subject).setIssuedAt().setExpirationTime('1h').sign(privateKey);
      return sendJSON(res, { access_token: 'not-forwarded', token_type: 'Bearer', id_token: jwt });
    }
    res.statusCode = 404; res.end();
  });
  issuer = await listen(idp);
  upstream = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    upstreamCalls.push({ headers: req.headers, path: req.url, body: JSON.parse(text) });
    if (JSON.parse(text).stream) { res.setHeader('Content-Type', 'text/event-stream'); res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'); return setTimeout(() => res.end('data: [DONE]\n\n'), 20); }
    return sendJSON(res, { choices: [{ message: { content: 'OK' } }] });
  });
  const upstreamUrl = await listen(upstream);
  temp = await mkdtemp(path.join(tmpdir(), 'nova-server-test-'));
  await writeFile(path.join(temp, 'index.html'), '<!doctype html><html><head></head><body>unchanged Nova UI</body></html>');
  config = { publicOrigin: 'http://127.0.0.1', oidc: { issuer, clientId: 'nova-test', clientSecretEnv: 'OIDC_SECRET', allowedGroups: ['nova-users'] }, providers: [{ id: 'company', baseUrl: `${upstreamUrl}/v1`, apiKeyEnv: 'PROVIDER_SECRET', allowHttp: true, models: ['model-a'] }] };
  // Reserve a port before discovery so the canonical callback is never inferred from Host.
  const reserve = http.createServer(); base = await listen(reserve); await close(reserve);
  config.publicOrigin = base;
  app = await createApplication(config, { env, webRoot: temp, testHTTP: true });
  await new Promise(resolve => app.listen(Number(new URL(base).port), '127.0.0.1', resolve));
});
after(async () => { for (const server of [app, idp, upstream]) if (server) await close(server); if (temp) await rm(temp, { recursive: true, force: true }); });

async function login(subject = 'alice', { wrongState = false, claims = {} } = {}) {
  const start = await fetch(`${base}/auth/login`, { redirect: 'manual' });
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const url = new URL(start.headers.get('location'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const code = `code-${Math.random()}`;
  codes.set(code, { challenge: url.searchParams.get('code_challenge'), nonce: url.searchParams.get('nonce'), subject, claims: { ...nextClaims, ...claims } });
  const callback = `${base}/auth/callback?code=${code}&state=${wrongState ? 'bad' : url.searchParams.get('state')}`;
  const response = await fetch(callback, { headers: { Cookie: cookie }, redirect: 'manual' });
  return { response, cookie: response.headers.getSetCookie().find(x => x.startsWith('nova_session='))?.split(';')[0], callback, loginCookie: cookie };
}
async function session(subject) {
  const { response, cookie } = await login(subject);
  assert.equal(response.status, 303);
  const script = await fetch(`${base}/server-session.js`, { headers: { Cookie: cookie } });
  const userId = JSON.parse((await script.text()).split('=')[1].replace(/;$/, '')).userId;
  return { Cookie: cookie, 'X-Nova-User': userId, Origin: base, 'Content-Type': 'application/json' };
}

test('production config requires HTTPS, OIDC secret, model allowlists and unique provider IDs', () => {
  assert.throws(() => validateConfig(config, env));
  assert.throws(() => validateConfig(config, {}, { testHTTP: true }));
  assert.throws(() => validateConfig({ ...config, providers: [...config.providers, config.providers[0]] }, env, { testHTTP: true }));
  assert.throws(() => validateConfig({ ...config, providers: [{ ...config.providers[0], models: [] }] }, env, { testHTTP: true }));
});
test('unauthenticated HTML redirects to SSO; APIs return JSON 401, not a fake successful login page', async () => {
  const page = await fetch(base, { redirect: 'manual' }); assert.equal(page.status, 303); assert.equal(page.headers.get('location'), '/auth/login');
  const api = await fetch(`${base}/api/providers/company/v1/models`); assert.equal(api.status, 401);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
});
test('real OIDC code exchange verifies PKCE, signed ID token, state, nonce and group claims', async () => {
  const good = await login(); assert.equal(good.response.status, 303); assert.ok(good.cookie);
  assert.equal((await login('alice', { wrongState: true })).response.status, 401);
  assert.equal((await login('alice', { claims: { nonce: 'wrong-nonce' } })).response.status, 401);
  assert.equal((await login('alice', { claims: { groups: ['other'] } })).response.status, 403);
  const replay = await fetch(good.callback, { headers: { Cookie: good.loginCookie }, redirect: 'manual' }); assert.equal(replay.status, 401);
});
test('body size, concurrency and request rate limits are enforced before upstream work', async () => {
  const headers = await session('limits');
  const url = `${base}/api/providers/company/v1/responses`;
  const oversized = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ model: 'model-a', input: 'a'.repeat(13 * 1024 * 1024) }) });
  assert.equal(oversized.status, 413);
  const results = await Promise.all(Array.from({ length: 8 }, () => fetch(url, { method: 'POST', headers, body: JSON.stringify({ model: 'model-a', stream: true }) })));
  assert.ok(results.some(result => result.status === 429));
  await Promise.all(results.map(result => result.text()));
});
test('HTML remains the same application, gets a session bootstrap, secrets never enter public config', async () => {
  const headers = await session('alice');
  const html = await fetch(base, { headers }); const text = await html.text();
  assert.match(text, /unchanged Nova UI/); assert.match(text, /server-session.js/);
  assert.equal(html.headers.get('cache-control'), 'no-store');
  const settings = await fetch(`${base}/idk-nova.config.json`, { headers });
  const publicText = await settings.text(); assert.ok(!publicText.includes(env.PROVIDER_SECRET)); assert.ok(!publicText.includes(env.OIDC_SECRET));
  assert.equal(JSON.parse(publicText).providers[0].baseUrl, `${base}/api/providers/company/v1`);
});
test('user namespaces are stable per subject and differ between users', async () => {
  const a = await session('alice'), again = await session('alice'), b = await session('bob');
  assert.equal(a['X-Nova-User'], again['X-Nova-User']); assert.notEqual(a['X-Nova-User'], b['X-Nova-User']);
  const stale = await fetch(`${base}/api/providers/company/v1/models`, { headers: { ...b, 'X-Nova-User': a['X-Nova-User'] } }); assert.equal(stale.status, 409);
});
test('provider proxy strips client authorization/cookies and preserves live streaming', async () => {
  const headers = await session('alice');
  const response = await fetch(`${base}/api/providers/company/v1/chat/completions`, { method: 'POST', headers: { ...headers, Authorization: 'Bearer malicious-browser-key' }, body: JSON.stringify({ model: 'model-a', messages: [{ role: 'user', content: 'hello' }], stream: true }) });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.match(await response.text(), /Hello[\s\S]*\[DONE\]/);
  const call = upstreamCalls.at(-1);
  assert.equal(call.headers.authorization, `Bearer ${env.PROVIDER_SECRET}`); assert.equal(call.headers.cookie, undefined); assert.equal(call.path, '/v1/chat/completions');
});
test('proxy rejects cross-origin requests, unknown models, arbitrary URLs, query injection and malformed JSON', async () => {
  const headers = await session('alice'), url = `${base}/api/providers/company/v1/responses`;
  const request = (body, extra = {}, endpoint = url) => fetch(endpoint, { method: 'POST', headers: { ...headers, ...extra }, body });
  assert.equal((await request('{"model":"model-a"}', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('{"model":"not-allowed"}')).status, 403);
  assert.equal((await request('not json')).status, 400);
  assert.equal((await request('{"model":"model-a"}', {}, `${url}?url=http://evil.example`)).status, 404);
  assert.equal((await request('{"model":"model-a"}', {}, `${base}/api/proxy`)).status, 404);
});
test('static file traversal and dot files are never served', async () => {
  const headers = await session('alice');
  for (const endpoint of ['/.env', '/%2e%2e%2fpackage.json', '/%00', '/%5cpackage.json']) assert.equal((await fetch(`${base}${endpoint}`, { headers })).status, 404);
});
test('logout requires same-origin POST and immediately revokes the session', async () => {
  const headers = await session('charlie');
  assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers })).status, 200);
  assert.equal((await fetch(`${base}/api/providers/company/v1/models`, { headers })).status, 401);
});
