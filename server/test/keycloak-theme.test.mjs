import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, cp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const source = new URL('../keycloak/', import.meta.url);
test('theme inherits native authentication forms, has no credential scripts or remote assets', () => {
  const login = new URL('themes/nova/login/', source);
  const properties = readFileSync(new URL('theme.properties', login), 'utf8');
  assert.match(properties, /parent=keycloak\n/); assert.match(properties, /locales=en,fa/);
  assert.deepEqual(readdirSync(login).filter(x => x.endsWith('.ftl')), ['footer.ftl']);
  const css = readFileSync(new URL('resources/css/nova.css', login), 'utf8');
  assert.doesNotMatch(css, /https?:\/\/|@import/); assert.match(css, /prefers-reduced-motion/); assert.match(css, /prefers-color-scheme/);
  for (const locale of ['en', 'fa']) assert.match(readFileSync(new URL(`messages/messages_${locale}.properties`, login), 'utf8'), /novaSignInNotice=/);
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
