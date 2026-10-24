import { cp, mkdir, readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Server patches can ship independently of desktop installers/UI versions.
const { version } = JSON.parse(await readFile(path.join(root, 'server/package.json'), 'utf8'));
const stage = await mkdtemp(path.join(tmpdir(), 'nova-server-package-'));
const output = path.join(root, 'server-dist');
try {
  for (const name of ['app.mjs', 'package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', 'compose.yaml', 'Caddyfile', '.env.example', 'config.example.json', 'install.sh', 'manage.sh', 'README.fa.md', 'README.md']) await cp(path.join(root, 'server', name), path.join(stage, name));
  await cp(path.join(root, 'server/onprem'), path.join(stage, 'onprem'), { recursive: true });
  await cp(path.join(root, 'server/keycloak'), path.join(stage, 'keycloak'), { recursive: true });
  await cp(path.join(root, 'dist'), path.join(stage, 'web'), { recursive: true });
  await writeFile(path.join(stage, 'VERSION'), `${version}\n`);
  await mkdir(output, { recursive: true });
  const name = `IDK-Nova-Server-${version}.tar.gz`, asset = path.join(output, name);
  execFileSync('tar', ['-czf', asset, '-C', stage, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const sha = createHash('sha256').update(await readFile(asset)).digest('hex');
  await writeFile(`${asset}.sha256`, `${sha}  ${name}\n`);
  console.log(`Server bundle: ${asset}\nSHA-256: ${sha}`);
} finally { await rm(stage, { recursive: true, force: true }); }
