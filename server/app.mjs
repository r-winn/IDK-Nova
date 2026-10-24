import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as oidc from 'openid-client';

const here = path.dirname(fileURLToPath(import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const bounded = (value, fallback, min, max) => Number.isInteger(value) && value >= min && value <= max ? value : fallback;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };

export function validateConfig(input, env = process.env, { testHTTP = false } = {}) {
  const config = structuredClone(input);
  const origin = new URL(config.publicOrigin);
  if (origin.origin !== config.publicOrigin || origin.username || origin.password || (origin.protocol !== 'https:' && !(testHTTP && origin.hostname === '127.0.0.1'))) throw new Error('publicOrigin must be an HTTPS origin without a path.');
  if (!config.oidc?.clientId || !config.oidc?.issuer || !env[config.oidc.clientSecretEnv]) throw new Error('Set the OIDC issuer, client ID and client-secret environment variable.');
  const issuer = new URL(config.oidc.issuer);
  if (issuer.username || issuer.password || issuer.hash || issuer.search || (issuer.protocol !== 'https:' && !(testHTTP && issuer.hostname === '127.0.0.1'))) throw new Error('OIDC issuer must use HTTPS.');
  config.oidc.allowedGroups ??= [];
  if (!Array.isArray(config.oidc.allowedGroups) || config.oidc.allowedGroups.some(x => typeof x !== 'string')) throw new Error('allowedGroups must contain group IDs/names.');
  if (!(config.oidc.scopes || 'openid profile email').split(/\s+/).includes('openid')) throw new Error('OIDC scopes must include openid.');
  if (config.oidc.uiLocales !== undefined && (typeof config.oidc.uiLocales !== 'string' || config.oidc.uiLocales.length > 128 || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*(?: +[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*)*$/.test(config.oidc.uiLocales))) throw new Error('uiLocales must be space-separated language tags such as fa en.');
  if (!Array.isArray(config.providers) || !config.providers.length) throw new Error('Configure at least one company provider.');
  const ids = new Set();
  for (const provider of config.providers) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(provider.id) || ids.has(provider.id)) throw new Error('Provider IDs must be unique lowercase URL-safe names.');
    ids.add(provider.id);
    const url = new URL(provider.baseUrl);
    if (url.username || url.password || url.hash || url.search || (url.protocol !== 'https:' && !(provider.allowHttp === true && url.protocol === 'http:'))) throw new Error('Provider URL must use HTTPS (allowHttp is only for trusted internal servers).');
    if (!Array.isArray(provider.models) || !provider.models.length || provider.models.some(x => typeof x !== 'string' || !x.trim() || x.length > 256)) throw new Error('Each provider needs a non-empty model allowlist.');
    if (provider.apiKeyEnv && !env[provider.apiKeyEnv]) throw new Error(`Missing environment secret for provider ${provider.id}.`);
    provider.baseUrl = provider.baseUrl.replace(/\/+$/, '');
  }
  config.sessionHours = bounded(config.sessionHours, 8, 1, 24);
  config.maxBodyMB = bounded(config.maxBodyMB, 12, 1, 64);
  config.requestTimeoutSeconds = bounded(config.requestTimeoutSeconds, 900, 30, 3600);
  config.requestsPerMinute = bounded(config.requestsPerMinute, 60, 1, 1000);
  config.concurrentRequestsPerUser = bounded(config.concurrentRequestsPerUser, 4, 1, 20);
  if (config.defaultProviderId && !ids.has(config.defaultProviderId)) throw new Error('defaultProviderId must reference a configured provider.');
  const defaultProvider = config.providers.find(p => p.id === config.defaultProviderId) || config.providers[0];
  if (config.defaultModel && !defaultProvider.models.includes(config.defaultModel)) throw new Error('defaultModel must be enabled on the default provider.');
  return config;
}

export async function createApplication(input, { env = process.env, webRoot = path.join(here, 'web'), testHTTP = false } = {}) {
  const config = validateConfig(input, env, { testHTTP });
  const root = await realpath(webRoot);
  const version = env.NOVA_VERSION || JSON.parse(await readFile(path.join(here, 'package.json'), 'utf8')).version;
  const client = await oidc.discovery(new URL(config.oidc.issuer), config.oidc.clientId, env[config.oidc.clientSecretEnv], undefined, testHTTP ? { execute: [oidc.allowInsecureRequests] } : undefined);
  const sessions = new Map(), pending = new Map(), usage = new Map();
  const cookieName = testHTTP ? 'nova_session' : '__Host-nova_session';
  const loginCookie = testHTTP ? 'nova_login' : '__Host-nova_login';
  const secure = testHTTP ? '' : '; Secure';
  const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${age}`;
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const map of [sessions, pending]) for (const [key, value] of map) if (value.expires <= now) map.delete(key);
    for (const [key, value] of usage) if (!value.active && value.since < now - 60000) usage.delete(key);
  }, 60000).unref();
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const redirect = (res, to) => { res.writeHead(303, { Location: to }); res.end(); };
  const publicConfig = () => ({
    theme: ['light', 'dark', 'system'].includes(config.ui?.theme) ? config.ui.theme : 'system',
    ...(config.ui?.branding ? { branding: config.ui.branding } : {}),
    providers: config.providers.map(p => ({ id: `server-${p.id}`, name: p.name || p.id, models: p.models, apiKey: '', baseUrl: `${config.publicOrigin}/api/providers/${p.id}/v1` })),
    activeProviderId: `server-${config.defaultProviderId || config.providers[0].id}`,
    activeModel: config.defaultModel || config.providers[0].models[0],
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=()');
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=')));
    let url;
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) return json(res, 400, { error: 'Invalid path.' });
      url = new URL(req.url, config.publicOrigin);
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { status: 'ok', version });
      if (req.method === 'GET' && url.pathname === '/auth/login') {
        if (pending.size >= 2000 || sessions.size >= 10000) return json(res, 503, { error: 'Sign-in capacity reached. Try again shortly.' });
        if (cookies[loginCookie]) pending.delete(digest(cookies[loginCookie]));
        const sid = token(), state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier();
        pending.set(digest(sid), { state, nonce, verifier, expires: Date.now() + 600000 });
        const to = oidc.buildAuthorizationUrl(client, { redirect_uri: `${config.publicOrigin}/auth/callback`, scope: config.oidc.scopes || 'openid profile email', ...(config.oidc.uiLocales ? { ui_locales: config.oidc.uiLocales } : {}), state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256' });
        res.setHeader('Set-Cookie', cookie(loginCookie, sid, 600));
        return redirect(res, to.href);
      }
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        const key = digest(cookies[loginCookie] || '');
        const login = pending.get(key); pending.delete(key);
        res.setHeader('Set-Cookie', cookie(loginCookie, '', 0));
        if (!login || login.expires <= Date.now()) return json(res, 401, { error: 'Sign-in expired. Open /auth/login to try again.' });
        const tokens = await oidc.authorizationCodeGrant(client, url, { pkceCodeVerifier: login.verifier, expectedState: login.state, expectedNonce: login.nonce, idTokenExpected: true });
        const claims = tokens.claims();
        if (!claims?.sub) throw new Error('No subject');
        if (sessions.size >= 10000) return json(res, 503, { error: 'Session capacity reached. Try again shortly.' });
        const groups = claims[config.oidc.groupsClaim || 'groups'];
        if (config.oidc.allowedGroups.length && (!Array.isArray(groups) || !config.oidc.allowedGroups.some(group => groups.includes(group)))) return json(res, 403, { error: 'This account is not in an allowed company group. Contact IT.' });
        const sid = token();
        // Stable, opaque browser namespace; never expose tokens, email, or group claims.
        const userId = digest(`${claims.iss}\0${claims.sub}`);
        const expires = Math.min(Date.now() + config.sessionHours * 3600000, claims.exp * 1000);
        sessions.set(digest(sid), { userId, expires });
        res.setHeader('Set-Cookie', [cookie(loginCookie, '', 0), cookie(cookieName, sid, Math.floor((expires - Date.now()) / 1000))]);
        return redirect(res, '/');
      }
      const session = sessions.get(digest(cookies[cookieName] || ''));
      if (!session || session.expires <= Date.now()) {
        if (session) sessions.delete(digest(cookies[cookieName]));
        if (url.pathname.startsWith('/api/') || url.pathname === '/idk-nova.config.json') return json(res, 401, { error: 'Company session expired. Reload Nova to sign in.' });
        return redirect(res, '/auth/login');
      }
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== config.publicOrigin) return json(res, 403, { error: 'Origin not allowed.' });
      if (req.method === 'POST' && url.pathname === '/auth/logout') {
        sessions.delete(digest(cookies[cookieName]));
        res.setHeader('Set-Cookie', cookie(cookieName, '', 0));
        return json(res, 200, { signedOut: true });
      }
      if (req.method === 'GET' && url.pathname === '/auth/logout') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Sign out — Nova</title><form method="post" action="/auth/logout"><button>Sign out of Nova on this browser</button></form>');
      }
      if (req.method === 'GET' && url.pathname === '/server-session.js') {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        return res.end(`window.__NOVA_SERVER__=${JSON.stringify({ userId: session.userId })};`);
      }
      if (req.method === 'GET' && url.pathname === '/idk-nova.config.json') return json(res, 200, publicConfig());
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['x-nova-user'] !== session.userId) return json(res, 409, { error: 'Account changed in another tab. Reload Nova before continuing.' });
        const match = /^\/api\/providers\/([a-z0-9-]+)\/v1\/(models|responses|chat\/completions)$/.exec(url.pathname);
        const provider = match && config.providers.find(p => p.id === match[1]);
        if (!provider || url.search) return json(res, 404, { error: 'Unknown provider operation.' });
        if (match[2] === 'models' && req.method === 'GET') return json(res, 200, { object: 'list', data: provider.models.map(id => ({ id, object: 'model', owned_by: provider.name || provider.id })) });
        if (req.method !== 'POST' || match[2] === 'models') return json(res, 405, { error: 'Method not allowed.' });
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'JSON required.' });
        const now = Date.now();
        let meter = usage.get(session.userId);
        if (!meter) { meter = { since: now, count: 0, active: 0 }; usage.set(session.userId, meter); }
        if (now - meter.since >= 60000) { meter.since = now; meter.count = 0; }
        if (meter.count >= config.requestsPerMinute || meter.active >= config.concurrentRequestsPerUser) { res.setHeader('Retry-After', '60'); return json(res, 429, { error: 'Company request limit reached. Try again shortly.' }); }
        meter.count++; meter.active++;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.requestTimeoutSeconds * 1000).unref();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', abort);
        try {
          const chunks = []; let size = 0, tooLarge = Number(req.headers['content-length']) > config.maxBodyMB * 1024 * 1024;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > config.maxBodyMB * 1024 * 1024) { tooLarge = true; chunks.length = 0; }
            // Drain without buffering on overflow. Destroying a partially uploaded
            // request hides its 413 from fetch and corrupts keep-alive reuse.
            if (!tooLarge) chunks.push(chunk);
          }
          if (tooLarge) return json(res, 413, { error: 'Request too large. Send fewer or smaller attachments.' });
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { error: 'Invalid JSON.' }); }
          if (!body || Array.isArray(body) || !provider.models.includes(body.model)) return json(res, 403, { error: 'Model is not enabled by IT.' });
          const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
          if (provider.apiKeyEnv) headers.Authorization = `Bearer ${env[provider.apiKeyEnv]}`;
          // Only configured upstreams, fixed operation paths, and server credentials. No redirects or client headers.
          const upstream = await fetch(`${provider.baseUrl}/${match[2]}`, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'error' });
          res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json', 'X-Accel-Buffering': 'no', ...(upstream.headers.get('retry-after') ? { 'Retry-After': upstream.headers.get('retry-after') } : {}) });
          if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res);
          else res.end();
        } finally { clearTimeout(timeout); res.off('close', abort); meter.active--; }
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
      let name;
      try { name = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Invalid path encoding.' }); }
      if (name.includes('\0') || name.includes('\\') || name.split('/').some(part => part.startsWith('.'))) return json(res, 404, { error: 'Not found.' });
      if (name === '/') name = '/index.html';
      let file;
      try { file = await realpath(path.join(root, name)); } catch { return json(res, 404, { error: 'Not found.' }); }
      if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) return json(res, 404, { error: 'Not found.' });
      let data = await readFile(file);
      if (name === '/index.html') {
        data = Buffer.from(data.toString('utf8').replace('<head>', '<head><script src="/server-session.js"></script>'));
        // Inline script permission is needed by existing sandboxed HTML artifact
        // previews (srcdoc inherits this policy). They never get allow-same-origin.
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; worker-src 'self' blob:; frame-src 'self' blob: data: https:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
      }
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      // Never log provider bodies, URLs, tokens, callback query strings, or secrets.
      console.error(JSON.stringify({ event: 'request_failed', route: url?.pathname?.startsWith('/auth/') ? 'auth' : 'request', code: error?.code || error?.name || 'Error' }));
      if (!res.headersSent) json(res, url?.pathname === '/auth/callback' ? 401 : 502, { error: url?.pathname === '/auth/callback' ? 'Company sign-in failed. Contact IT or retry /auth/login.' : 'Upstream request failed or timed out. Check the provider connection.' });
      else res.destroy();
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 30000;
  server.on('close', () => clearInterval(cleanup));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = JSON.parse(await readFile(process.env.NOVA_CONFIG || path.join(here, 'config.json'), 'utf8'));
    const server = await createApplication(config);
    server.listen(config.port || 8080, process.env.NOVA_BIND || '127.0.0.1', () => console.log('Nova server ready. OIDC required; secrets stay on the server.'));
    const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); };
    process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  } catch (error) { console.error('Nova startup failed:', error.message); process.exitCode = 1; }
}
