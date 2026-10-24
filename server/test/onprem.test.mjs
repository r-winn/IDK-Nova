import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateConfig } from '../app.mjs';
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
test('company defaults use internal OIDC and model endpoints with an explicit group restriction', () => {
  const example = JSON.parse(read('config.example.json'));
  const config = validateConfig(example, { NOVA_OIDC_CLIENT_SECRET: 'test-only', NOVA_COMPANY_AI_KEY: 'test-only' });
  assert.equal(config.oidc.issuer, 'https://sso.company.internal/realms/company');
  assert.equal(config.oidc.uiLocales, 'en');
  assert.deepEqual(config.oidc.allowedGroups, ['nova-users']);
  assert.equal(config.providers[0].baseUrl, 'https://ai.company.internal/v1');
  assert.doesNotMatch(read('config.example.json') + read('.env.example'), /microsoftonline|TENANT-ID|Entra/);
});
test('corporate TLS override trusts the company CA without disabling TLS verification', () => {
  const override = read('onprem/compose.override.yaml'), caddy = read('onprem/Caddyfile');
  assert.match(override, /NODE_EXTRA_CA_CERTS: \/run\/nova\/ca\/company-ca.pem/);
  assert.match(override, /NOVA_CONFIG_DIR\}\/tls/);
  assert.match(caddy, /tls \/run\/nova\/tls\/server.crt \/run\/nova\/tls\/server.key/);
  assert.doesNotMatch(override + caddy, /NODE_TLS_REJECT_UNAUTHORIZED|tls_insecure_skip_verify|acme_ca|tls internal/);
});
