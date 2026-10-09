import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
test('Desktop recovery tests use an explicit Cargo manifest on both platforms', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.equal((workflow.match(/cargo test --manifest-path src-tauri\/Cargo\.toml --locked --lib checkpoint_tests/g) || []).length, 2);
  assert.doesNotMatch(workflow, /run: cargo test --lib/);
  assert.match(workflow, /needs: \[windows, macos\]/);
  assert.equal((workflow.match(/releaseDraft: true/g) || []).length, 3);
});
test('Web, desktop and update metadata share one release version', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.equal(JSON.parse(read('package-lock.json')).version, version);
  assert.equal(JSON.parse(read('src-tauri/tauri.conf.json')).version, version);
  assert.match(read('src-tauri/Cargo.toml'), new RegExp(`version = "${version.replaceAll('.', '\\.') }"`));
  assert.ok(read('src/version.ts').includes(`APP_VERSION = '${version}'`));
  const update = JSON.parse(read('public/version.json'));
  assert.equal(update.version, version);
  assert.ok(update.releaseUrl.endsWith(`/v${version}`));
});
