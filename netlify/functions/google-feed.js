// Lista de produtos para o Google Merchant Center (Google Shopping e anúncios de produtos)
// Endereço: https://bielyystore.com.br/google-feed.xml
//
// Monta sozinha, sempre atualizada, a partir do site + do que foi mudado no painel:
//   - nome, descrição, marca, foto, preço (o preço do cartão, o mesmo que aparece na página do produto)
//   - estoque: "em estoque" ou "esgotado"
//   - produtos escondidos no painel, "sob encomenda" e "aguardando chegada" ficam de fora
// No Merchant Center: Produtos → Fontes de dados → Adicionar fonte → "Adicionar produtos de um arquivo"
// → "Inserir um link" → https://bielyystore.com.br/google-feed.xml (busca diária).
const { getDoc } = require('../lib/catalog');

const SITE = 'https://bielyystore.com.br';

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
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; };

function photoUrl(key, images) {
  if (!key) return null;
  if (/^p\d+_/.test(key)) return SITE + '/.netlify/functions/product-photo?k=' + encodeURIComponent(key);
  return images[key] ? SITE + '/' + images[key] : null;
}

// Categoria do Google (taxonomia oficial, em inglês)
function googleCategory(f) {
  const cat = String(f.category || '');
  const gato = /gato|cat\b/i.test(f.name + ' ' + cat);
  const base = 'Animals & Pet Supplies > Pet Supplies';
  if (gato) {
    if (/petisc|snack|cremos|lata/i.test(f.name + ' ' + cat)) return base + ' > Cat Supplies > Cat Treats';
    if (/brinquedo|lickimat|enriquec/i.test(f.name + ' ' + cat)) return base + ' > Cat Supplies > Cat Toys';
    return base + ' > Cat Supplies';
  }
  if (/brinquedo|mordedor|enriquec/i.test(cat)) return base + ' > Dog Supplies > Dog Toys';
  if (/petisc/i.test(cat)) return base + ' > Dog Supplies > Dog Treats';
  if (/aliment/i.test(cat)) return base + ' > Dog Supplies > Dog Food';
  if (/higiene|banho/i.test(cat)) return base + ' > Pet Grooming Supplies';
  if (/comedouro|lambedor/i.test(cat)) return base + ' > Pet Bowls, Feeders & Waterers';
  if (/transporte|passeio/i.test(cat)) return base + ' > Dog Supplies';
  return base;
}

exports.handler = async function (event) {
  try {
    const base = process.env.URL || SITE;
    const res = await fetch(base + '/index.html', { headers: { 'Cache-Control': 'no-cache' } });
    const html = await res.text();
    const images = readImages(html);
    const products = readArray(html, 'PRODUCT_FAMILIES').filter(p => !p.kit);

    const doc = await getDoc(event);
    const P = doc.products || {}, A = doc.added || {};
    Object.keys(A).forEach(k => {
      const a = A[k]; const id = Number(a.id || k);
      if (!products.find(p => p.id === id)) products.push(Object.assign({ id, added: true }, a));
    });

    const items = [];
    const seen = new Set();
    products.forEach(p => {
      if (seen.has(p.id)) return; seen.add(p.id);
      const o = P[String(p.id)] || {};
      if (o.hidden) return;
      if (p.added && !A[String(p.id)]) return;
      const preorder = ('preorder' in o) ? !!o.preorder : !!p.preorder;
      if (preorder) return; // sob encomenda: fica fora dos anúncios
      const soldOut = ('soldOut' in o) ? !!o.soldOut : !!p.soon;
      if (!('soldOut' in o) && p.soon) return; // "aguardando chegada": ainda não está à venda
      const f = {
        id: p.id,
        name: o.name || p.name,
        desc: (o.desc != null && o.desc !== '') ? o.desc : (p.desc || ''),
        brand: o.brand || p.brand || 'Bielyy Store',
        category: o.category || p.category || '',
        photo: o.photo || p.photo,
        photos: (o.photos || p.photos || []).filter(Boolean)
      };
      if (!f.name) return;
      const img = photoUrl(f.photo, images);
      if (!img) return; // o Google não aceita produto sem foto
      const extra = f.photos.map(k => photoUrl(k, images)).filter(u => u && u !== img).slice(0, 5);
      const stock = Math.max(0, (Number(('stock' in o) ? o.stock : p.stock) || 0) - (Number(o.sold) || 0));
      const inStock = !soldOut && stock > 0;
      const variants = (o.variants || p.variants || []).filter(v => Number(v.cartao) > 0);
      if (!variants.length) return;
      const link = SITE + '/?produto=' + productSlug(f);
      const many = variants.length > 1 && new Set(variants.map(v => v.label)).size > 1;
      variants.forEach((v, i) => {
        const label = v.label && v.label !== 'Único' ? v.label : '';
        items.push({
          id: many ? `${f.id}-${i + 1}` : String(f.id),
          group: many ? String(f.id) : '',
          title: clip(f.name + (many && label && !f.name.includes(label) ? ' - ' + label : ''), 150),
          description: clip(f.desc || f.name, 4900),
          link, img, extra,
          price: Number(v.cartao).toFixed(2) + ' BRL',
          availability: inStock && v.available !== false && !(v.vstock != null && Number(v.vstock) <= 0) ? 'in_stock' : 'out_of_stock',
          brand: f.brand,
          category: googleCategory(f),
          productType: f.category,
          variantLabel: many ? label : '',
          variantAttr: (p.colors && p.colors.length) || /cor/i.test(p.colorWord || '') ? 'color' : 'size'
        });
      });
    });

    const xmlItems = items.map(it => `    <item>
      <g:id>${esc(it.id)}</g:id>
      <title>${esc(it.title)}</title>
      <description>${esc(it.description)}</description>
      <link>${esc(it.link)}</link>
      <g:image_link>${esc(it.img)}</g:image_link>
${it.extra.map(u => `      <g:additional_image_link>${esc(u)}</g:additional_image_link>\n`).join('')}      <g:availability>${it.availability}</g:availability>
      <g:price>${it.price}</g:price>
      <g:brand>${esc(it.brand)}</g:brand>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>
      <g:google_product_category>${esc(it.category)}</g:google_product_category>
${it.productType ? `      <g:product_type>${esc(it.productType)}</g:product_type>\n` : ''}${it.group ? `      <g:item_group_id>${esc(it.group)}</g:item_group_id>\n` : ''}${it.variantLabel ? `      <g:${it.variantAttr}>${esc(it.variantLabel)}</g:${it.variantAttr}>\n` : ''}    </item>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Bielyy Store</title>
    <link>${SITE}/</link>
    <description>Pet boutique com marcas premium para cães e gatos</description>
${xmlItems}
  </channel>
</rss>
`;
    return { statusCode: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }, body: xml };
  } catch (err) {
    console.error('Erro ao montar o feed do Google:', err);
    return { statusCode: 500, headers: { 'Cache-Control': 'no-store' }, body: 'Erro ao montar a lista de produtos' };
  }
};
