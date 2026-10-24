// CI-only HTTP rendering smoke test against an isolated Keycloak, not company AD.
import assert from 'node:assert/strict';
const origin = 'http://127.0.0.1:18080';
let ready = false;
for (let attempt = 0; attempt < 90; attempt++) {
  try { ready = (await fetch(`${origin}/realms/nova-theme-test/.well-known/openid-configuration`, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* container starting */ }
  if (ready) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.ok(ready, 'Isolated Keycloak must become ready');
for (const locale of ['en', 'fa']) {
  const url = new URL('/realms/nova-theme-test/protocol/openid-connect/auth', origin);
  url.search = new URLSearchParams({ client_id: 'nova-theme-test', redirect_uri: 'http://127.0.0.1:1430/', response_type: 'code', scope: 'openid', code_challenge: 'A'.repeat(43), code_challenge_method: 'S256', state: 'isolated-theme-render-test', nonce: 'isolated-test-nonce', ui_locales: locale }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) }), html = await response.text();
  assert.equal(response.status, 200, html.slice(0, 1000));
  assert.match(html, /lang="en"/, 'Unsupported locale requests must still render English');
  assert.match(html, /Sign in/);
  assert.doesNotMatch(html, /nova-security-note/);
  assert.match(html, /name="rememberMe"/);
  assert.match(html, /data-page-id="login-login"/);
  assert.match(html, /name="username"/); assert.match(html, /name="password"/);
  assert.match(html, /action="[^"]*login-actions\/authenticate/);
  const stylesheet = html.match(/href="([^"]*\/css\/nova\.css[^"]*)"/);
  assert.ok(stylesheet, 'Nova CSS must be loaded by the native template');
  const css = await fetch(new URL(stylesheet[1].replaceAll('&amp;', '&'), origin), { signal: AbortSignal.timeout(10000) });
  assert.equal(css.status, 200); assert.match(await css.text(), /--nova-bg/);
  console.log(`Native minimal English Keycloak login rendered successfully (requested ${locale})`);
}
