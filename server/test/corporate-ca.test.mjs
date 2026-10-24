import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
test('internal OIDC discovery needs the company CA and succeeds without disabling certificate validation', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'nova-ca-test-'));
  let server;
  try {
    const cert = path.join(temp, 'ca.pem'), key = path.join(temp, 'key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=Nova internal test CA', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
    let issuer;
    server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    issuer = `https://127.0.0.1:${server.address().port}`;
    const config = { publicOrigin: 'https://nova.company.internal', oidc: { issuer, clientId: 'nova-web', clientSecretEnv: 'TEST_OIDC_SECRET' }, providers: [{ id: 'internal', baseUrl: 'https://ai.company.internal/v1', models: ['test'] }] };
    const code = `import {createApplication} from ${JSON.stringify(new URL('../app.mjs', import.meta.url).href)}; try { const app = await createApplication(${JSON.stringify(config)}, {webRoot:${JSON.stringify(temp)}}); app.close(); console.log('trusted internal discovery ready'); } catch(e) { console.error(e.code || e.name); process.exitCode=1; }`;
    const run = trusted => new Promise((resolve, reject) => {
      const env = { ...process.env, TEST_OIDC_SECRET: 'test-only-secret' };
      delete env.NODE_TLS_REJECT_UNAUTHORIZED;
      if (trusted) env.NODE_EXTRA_CA_CERTS = cert; else delete env.NODE_EXTRA_CA_CERTS;
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env });
      let out = ''; child.stdout.on('data', data => out += data); child.stderr.on('data', data => out += data);
      const timer = setTimeout(() => { child.kill(); reject(new Error('Internal TLS discovery test timed out')); }, 15000);
      child.on('error', reject); child.on('close', status => { clearTimeout(timer); resolve({ status, out }); });
    });
    const untrusted = await run(false); assert.notEqual(untrusted.status, 0);
    const trusted = await run(true); assert.equal(trusted.status, 0, trusted.out); assert.match(trusted.out, /trusted internal discovery ready/);
  } finally {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await rm(temp, { recursive: true, force: true });
  }
});
