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
  const fa = url.searchParams.get('lang') !== 'en', theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
  const t = fa ? ['به فضای کارتان وارد شوید','نام کاربری سازمانی','رمز عبور','مرا به خاطر بسپار','ادامه','ورود امن از طریق سرویس هویت داخلی شرکت انجام می‌شود.','این فقط پیش‌نمایش ظاهر است؛ اطلاعات ورود وارد نکنید.','نام کاربری یا رمز عبور صحیح نیست.'] : ['Welcome to your workspace','Company username','Password','Remember me','Continue','Sign in securely through your company’s identity service.','Visual preview only. Do not enter credentials.','Invalid username or password.'];
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; img-src 'self'; form-action 'none'; frame-ancestors 'none'");
  res.end(`<!doctype html><html class="login-pf" lang="${fa ? 'fa' : 'en'}" dir="${fa ? 'rtl' : 'ltr'}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nova · Login preview</title><link rel="stylesheet" href="/resources/css/nova.css"><link rel="stylesheet" href="/resources/css/brand.css"></head><body><main class="login-pf-page"><div id="kc-header"><div id="kc-header-wrapper">Nova</div></div><section class="card-pf"><header class="login-pf-header"><h1 id="kc-page-title">${t[0]}</h1></header><div id="kc-content"><div id="kc-content-wrapper">${url.searchParams.has('error') ? `<div class="pf-c-alert alert-error" role="alert"><span class="kc-feedback-text">${t[7]}</span></div>` : ''}<div id="kc-form"><div class="form-group"><label for="username">${t[1]}</label><input id="username" readonly autocomplete="off" placeholder="name@company.internal"></div><div class="form-group"><label for="password">${t[2]}</label><input id="password" type="password" readonly autocomplete="off" placeholder="••••••••"></div><div id="kc-form-options"><label><input type="checkbox" disabled>${t[3]}</label></div><div id="kc-form-buttons"><button class="pf-m-primary" type="button" aria-disabled="true">${t[4]}</button></div></div></div></div><p class="nova-security-note">${t[5]}</p></section><nav class="preview-controls"><a href="/?lang=fa&theme=${theme}">فارسی</a><a href="/?lang=en&theme=${theme}">English</a><a href="/?lang=${fa ? 'fa' : 'en'}&theme=${theme === 'dark' ? 'light' : 'dark'}">${theme === 'dark' ? 'Light' : 'Dark'}</a><a href="/?lang=${fa ? 'fa' : 'en'}&theme=${theme}&error=1">${fa ? 'حالت خطا' : 'Error state'}</a></nav><p class="preview-banner">${t[6]}</p></main></body></html>`);
});
server.listen(Number(process.env.NOVA_PREVIEW_PORT || 1435), '127.0.0.1', () => console.log('Visual login preview (not authentication): http://127.0.0.1:' + server.address().port));
