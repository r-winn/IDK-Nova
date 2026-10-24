import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
if (!process.argv[2]) throw new Error('Usage: node sync-brand.mjs /path/to/config.json');
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const brand = config.ui?.branding || {};
const lines = ['/* Generated branding only. No credentials are exported. */'];
if (brand.accent) {
  if (!/^#[0-9a-f]{6}$/i.test(brand.accent)) throw new Error('Brand accent must be #RRGGBB.');
  const rgb = brand.accent.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  const contrast = (luminance + .05) / .05 > 1.05 / (luminance + .05) ? '#111111' : '#ffffff';
  lines.push(`:root { --nova-accent: ${brand.accent}; --nova-accent-text: ${contrast}; }`);
}
let logo = '../img/logo.png';
if (brand.logoDataUrl) {
  const match = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i.exec(brand.logoDataUrl);
  if (!match || match[2].length > 2800000) throw new Error('Use a PNG/JPEG/WebP logo data URL smaller than 2 MB. SVG/remote URLs are not exported.');
  const file = `company-logo.${match[1] === 'jpeg' ? 'jpg' : match[1].toLowerCase()}`;
  await writeFile(path.join(root, 'themes/nova/login/resources/img', file), Buffer.from(match[2], 'base64'));
  logo = `../img/${file}`;
}
lines.push(`:root { --nova-logo: url('${logo}'); }`);
await writeFile(path.join(root, 'themes/nova/login/resources/css/brand.css'), lines.join('\n') + '\n');
// Review/apply only these realm settings. This is NOT a realm import or LDAP configuration.
await writeFile(path.join(root, 'realm-branding.patch.json'), JSON.stringify({ displayName: String(brand.appName || 'Nova').slice(0, 100), loginTheme: 'nova' }, null, 2) + '\n');
console.log('Brand CSS/logo and realm-branding.patch.json prepared. No provider or OIDC secrets were copied.');
