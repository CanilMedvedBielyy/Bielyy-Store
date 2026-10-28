// Netlify Function: mapa do site para o Google (https://bielyystore.com.br/sitemap.xml)
//
// Monta a lista de páginas sozinho, sempre atualizada:
//   - lê os produtos que vêm no index.html (PRODUCT_FAMILIES e PREORDER_FAMILIES)
//   - aplica o que foi mudado no painel admin (produtos novos, nomes, fotos e produtos ocultos)
// Assim, quando você cadastra ou esconde um produto no painel, o mapa já muda junto.
const { getDoc } = require('../lib/catalog');

const SITE = 'https://bielyystore.com.br';

// Mesmo "nome de link" que o site usa em ?produto=...
function productSlug(f) {
  return f.id + '-' + String(f.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function readArray(html, name) {
  const m = html.match(new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\]);\\n'));
  if (!m) return [];
  try { return JSON.parse(m[1]); } catch (e) { return []; }
}
function readImages(html) {
  const m = html.match(/const PRODUCT_IMAGES = (\{[\s\S]*?\});\n/);
  if (!m) return {};
  try { return JSON.parse(m[1]); } catch (e) { return {}; }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function photoUrl(key, images) {
  if (!key) return null;
  if (/^p\d+_/.test(key)) return SITE + '/.netlify/functions/product-photo?k=' + encodeURIComponent(key);
  return images[key] ? SITE + '/' + images[key] : null;
}

exports.handler = async function (event) {
  try {
    const base = process.env.URL || SITE;
    const res = await fetch(base + '/index.html', { headers: { 'Cache-Control': 'no-cache' } });
    const html = await res.text();
    const images = readImages(html);
    const products = [...readArray(html, 'PRODUCT_FAMILIES'), ...readArray(html, 'PREORDER_FAMILIES')];

    const doc = await getDoc(event);
    const P = doc.products || {}, A = doc.added || {};
    Object.keys(A).forEach(k => {
      const a = A[k]; const id = Number(a.id || k);
      if (!products.find(p => p.id === id)) products.push(Object.assign({ id }, a));
    });

    const today = new Date().toISOString().slice(0, 10);
    const lastmod = doc.updatedAt ? String(doc.updatedAt).slice(0, 10) : today;
    const urls = [
      `  <url><loc>${SITE}/</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
      `  <url><loc>${SITE}/fale-com-a-gente.html</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>`,
      `  <url><loc>${SITE}/trocas-e-devolucoes.html</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>`
    ];
    const seen = new Set();
    products.forEach(p => {
      const o = P[String(p.id)] || {};
      if (o.hidden || seen.has(p.id)) return;
      seen.add(p.id);
      const f = { id: p.id, name: o.name || p.name, photo: o.photo || p.photo, preorder: ('preorder' in o) ? !!o.preorder : !!p.preorder };
      if (!f.name) return;
      const img = photoUrl(f.photo, images);
      urls.push(
        `  <url><loc>${SITE}/?produto=${esc(productSlug(f))}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>${f.preorder ? '0.5' : '0.8'}</priority>` +
        (img ? `<image:image><image:loc>${esc(img)}</image:loc><image:title>${esc(f.name)}</image:title></image:image>` : '') +
        `</url>`
      );
    });

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
      urls.join('\n') + '\n</urlset>\n';
    return { statusCode: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }, body: xml };
  } catch (err) {
    console.error('Erro ao montar o sitemap:', err);
    return { statusCode: 500, headers: { 'Cache-Control': 'no-store' }, body: 'Erro ao montar o mapa do site' };
  }
};
