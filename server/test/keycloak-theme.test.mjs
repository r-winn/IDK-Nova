import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, cp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
const source = new URL('../keycloak/', import.meta.url);
test('minimal preview stays English/system-themed even with old URL parameters and never accepts credentials', async () => {
  const child = spawn(process.execPath, [new URL('preview.mjs', source).pathname], { env: { ...process.env, NOVA_PREVIEW_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview startup timed out')), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stdout.on('data', data => { const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    });
    const html = await (await fetch(`${origin}/?lang=fa&theme=dark`)).text();
    assert.match(html, /lang="en" dir="ltr"/);
    assert.doesNotMatch(html, /data-theme|<nav|preview-controls|preview-banner|nova-security-note|[\u0600-\u06ff]/);
    assert.equal((html.match(/class="form-group"/g) || []).length, 2);
    assert.match(html, /Remember me/); assert.match(html, />Sign in<\/button>/);
    assert.equal((await fetch(origin, { method: 'POST', body: 'never-a-password' })).status, 405);
  } finally { child.kill(); }
});
test('theme inherits native authentication forms, has no credential scripts or remote assets', () => {
  const login = new URL('themes/nova/login/', source);
  const properties = readFileSync(new URL('theme.properties', login), 'utf8');
  assert.match(properties, /parent=keycloak\n/); assert.match(properties, /locales=en\s*$/);
  assert.deepEqual(readdirSync(login).filter(x => x.endsWith('.ftl')), ['footer.ftl']);
  const css = readFileSync(new URL('resources/css/nova.css', login), 'utf8');
  assert.doesNotMatch(css, /https?:\/\/|@import/); assert.match(css, /prefers-reduced-motion/); assert.match(css, /prefers-color-scheme/);
  assert.doesNotMatch(css, /data-theme|preview-controls|preview-banner/);
  assert.match(css, /background:transparent; box-shadow:none/);
  assert.match(readFileSync(new URL('messages/messages_en.properties', login), 'utf8'), /doLogIn=Sign in/);
  assert.doesNotMatch(readFileSync(new URL('footer.ftl', login), 'utf8'), /<p/);
});
test('branding exports only validated colors/logo/name, never provider or OIDC credentials', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'nova-brand-test-'));
  try {
    const target = path.join(temp, 'keycloak'); await cp(source, target, { recursive: true });
    const config = path.join(temp, 'config.json');
    await writeFile(config, JSON.stringify({ ui: { branding: { appName: 'Company', accent: '#ffffff' } }, secret: 'must-not-be-exported', providers: [{ apiKey: 'private-key' }] }));
    execFileSync(process.execPath, [path.join(target, 'sync-brand.mjs'), config]);
    const css = await readFile(path.join(target, 'themes/nova/login/resources/css/brand.css'), 'utf8');
    assert.match(css, /--nova-accent-text: #111111/); assert.doesNotMatch(css, /private-key|must-not-be-exported/);
    assert.deepEqual(JSON.parse(await readFile(path.join(target, 'realm-branding.patch.json'), 'utf8')), { displayName: 'Company', loginTheme: 'nova' });
    await writeFile(config, JSON.stringify({ ui: { branding: { accent: 'red; background:url(https://evil)' } } }));
    assert.throws(() => execFileSync(process.execPath, [path.join(target, 'sync-brand.mjs'), config], { stdio: 'pipe' }));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
