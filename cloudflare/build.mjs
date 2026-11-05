// Roda na Cloudflare antes de publicar: separa na pasta "public" só os arquivos
// que devem ficar abertos no site (páginas, fotos, scripts). O código do servidor,
// as configurações e a pasta netlify ficam de fora.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'public');
const SKIP_DIRS = new Set(['.git', '.github', '.wrangler', 'node_modules', 'netlify', 'cloudflare', 'public']);
const SKIP_FILES = new Set(['wrangler.jsonc', 'wrangler.toml', 'wrangler.json', 'package.json', 'package-lock.json',
  'netlify.toml', 'create-payment-link.js', 'infinitepay-webhook.js', '.gitignore', '.assetsignore']);
const OK_EXT = /\.(html?|jpe?g|png|webp|gif|svg|ico|avif|js|css|txt|xml|json|webmanifest|woff2?|ttf|otf|mp4|webm|pdf)$/i;

fs.rmSync(OUT, { recursive: true, force: true });
let n = 0;
function copyDir(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const src = path.join(from, e.name), dst = path.join(to, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) copyDir(src, dst); continue; }
    if (from === ROOT && SKIP_FILES.has(e.name)) continue;
    if (!OK_EXT.test(e.name)) continue;
    fs.mkdirSync(to, { recursive: true });
    fs.copyFileSync(src, dst);
    n++;
  }
}
copyDir(ROOT, OUT);
if (!fs.existsSync(path.join(OUT, 'index.html'))) { console.error('index.html não encontrado!'); process.exit(1); }
console.log(`Bielyy Store: ${n} arquivos públicos prontos em /public`);
