import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const resources = await realpath(path.join(root, 'themes/nova/login/resources'));
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Visual preview only. No credentials accepted.'); }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/resources/')) {
    try {
      const file = await realpath(path.join(resources, decodeURIComponent(url.pathname.slice('/resources/'.length))));
      if (!file.startsWith(resources + path.sep)) throw new Error('path');
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : /\.jpe?g$/.test(file) ? 'image/jpeg' : file.endsWith('.webp') ? 'image/webp' : 'application/octet-stream');
      return res.end(await readFile(file));
    } catch { res.writeHead(404); return res.end(); }
  }
  if (url.pathname !== '/') { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; img-src 'self'; form-action 'none'; frame-ancestors 'none'");
  // English-only, OS theme: legacy language/theme query parameters are intentionally ignored.
  res.end(`<!doctype html><html class="login-pf" lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nova · Login visual preview (no authentication)</title><link rel="stylesheet" href="/resources/css/nova.css"><link rel="stylesheet" href="/resources/css/brand.css"></head><body data-page-id="login-login"><main class="login-pf-page"><div id="kc-header"><div id="kc-header-wrapper" role="img" aria-label="Nova">Nova</div></div><section class="card-pf" aria-label="Sign in preview"><div id="kc-content"><div id="kc-content-wrapper">${url.searchParams.has('error') ? '<div class="pf-c-alert alert-error" role="alert">Invalid username or password.</div>' : ''}<div id="kc-form"><div class="form-group"><label for="username">Username</label><input id="username" name="username" readonly autocomplete="off"></div><div class="form-group"><label for="password">Password</label><input id="password" name="password" type="password" readonly autocomplete="off"></div><div id="kc-form-options"><label><input type="checkbox" name="rememberMe">Remember me</label></div><div id="kc-form-buttons"><button class="pf-m-primary" type="button" aria-disabled="true">Sign in</button></div></div></div></div></section></main></body></html>`);
});
server.listen(Number(process.env.NOVA_PREVIEW_PORT || 1435), '127.0.0.1', () => console.log('Visual login preview (not authentication): http://127.0.0.1:' + server.address().port));
