import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, readlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
test('Linux deployment scripts preserve configuration, verify updates and restore a failed deployment', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'nova-deploy-test-'));
  try {
    const source = path.join(temp, 'source'), root = path.join(temp, 'installed'), bin = path.join(temp, 'bin'), fixtures = path.join(temp, 'fixtures');
    await mkdir(bin); await mkdir(fixtures);
    await cp(new URL('..', import.meta.url), source, { recursive: true, filter: src => !src.includes('node_modules') && !src.includes('/test') });
    await writeFile(path.join(source, 'VERSION'), '0.31.0\n');
    await writeFile(path.join(bin, 'docker'), '#!/bin/sh\nprintf "%s %s\\n" "$NOVA_VERSION" "$*" >> "$DEPLOY_LOG"\ncase "$*" in *" up "*) [ "$NOVA_VERSION" != "$FAIL_VERSION" ] || exit 1;; esac\n', { mode: 0o755 });
    await writeFile(path.join(bin, 'curl'), '#!/bin/sh\nurl=""\nout=""\nwhile [ "$#" -gt 0 ]; do case "$1" in https:*) url="$1";; -o) shift; out="$1";; esac; shift; done\ncp "$FIXTURES/$(basename "$url")" "$out"\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DEPLOY_LOG: path.join(temp, 'deploy.log'), FIXTURES: fixtures };
    const run = (file, args = [], extra = {}) => spawnSync('bash', [file, ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
    assert.equal(run(path.join(source, 'install.sh'), [root]).status, 0);
    await writeFile(path.join(root, 'config/config.json'), '{"kept":"company-config"}');
    await writeFile(path.join(root, 'config/.env'), 'COMPANY_KEY=must-survive\n');
    const manager = path.join(root, 'manage.sh');
    const start = run(manager, ['start']); assert.equal(start.status, 0, start.stderr);
    async function release(version, corrupt = false) {
      const staging = path.join(temp, `stage-${version}`); await mkdir(staging);
      for (const file of ['manage.sh', 'compose.yaml']) await cp(path.join(source, file), path.join(staging, file));
      await writeFile(path.join(staging, 'VERSION'), version + '\n');
      const asset = path.join(fixtures, `IDK-Nova-Server-${version}.tar.gz`);
      execFileSync('tar', ['-czf', asset, '-C', staging, '.'], { env: { ...env, COPYFILE_DISABLE: '1' } });
      const checksum = corrupt ? '0'.repeat(64) : createHash('sha256').update(await readFile(asset)).digest('hex');
      await writeFile(`${asset}.sha256`, `${checksum}  ${path.basename(asset)}\n`);
    }
    await release('0.31.1');
    const update = run(manager, ['update', 'v0.31.1']);
    assert.equal(update.status, 0, update.stderr);
    assert.match(await readlink(path.join(root, 'current')), /0\.31\.1$/);
    assert.equal(await readFile(path.join(root, 'config/.env'), 'utf8'), 'COMPANY_KEY=must-survive\n');
    assert.equal(await readFile(path.join(root, 'config/config.json'), 'utf8'), '{"kept":"company-config"}');
    await release('0.31.2');
    const fail = run(manager, ['update', 'v0.31.2'], { FAIL_VERSION: '0.31.2' });
    assert.notEqual(fail.status, 0); assert.match(fail.stderr, /restoring/);
    assert.match(await readlink(path.join(root, 'current')), /0\.31\.1$/);
    assert.match(await readFile(env.DEPLOY_LOG, 'utf8'), /0\.31\.1 .*up -d --no-build/);
    await release('0.31.3', true);
    const corrupt = run(manager, ['update', 'v0.31.3']);
    assert.notEqual(corrupt.status, 0); assert.match(corrupt.stderr, /Checksum mismatch/);
    const rollback = run(manager, ['rollback']); assert.equal(rollback.status, 0, rollback.stderr);
    assert.match(await readlink(path.join(root, 'current')), /0\.31\.0$/);
    assert.notEqual(run(manager, ['update', '../../bad']).status, 0);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
