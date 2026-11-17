// Achadinhos: produtos recomendados com link de afiliado (Shopee, Mercado Livre, Amazon...)
// GET  -> público: { items: [...] } só os que estão visíveis, na ordem escolhida no painel
// POST -> só com a senha do admin (cabeçalho x-admin-password):
//   { op:'list' }                         -> todos, inclusive os escondidos
//   { op:'save', item:{...}, dataUrl? }   -> cria (sem id) ou altera (com id); dataUrl = foto nova
//   { op:'delete', id }                   -> apaga o item e a foto
//   { op:'move', id, dir: -1 | 1 }        -> sobe ou desce na lista
const crypto = require('crypto');
const { blobStore } = require('../lib/blobs');

const KEY = 'recommended';
const PETS = ['cao', 'gato', 'todos'];
const MAX_ITEMS = 120;

function isAdmin(event, bodyPassword) {
  const given = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password'])) || bodyPassword || '';
  const real = process.env.ADMIN_PASSWORD || '';
  if (!given || !real) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}
const txt = (v, n) => String(v == null ? '' : v).replace(/[<>"\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const res = (code, obj, headers) => ({ statusCode: code, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(obj) });

// Descobre a loja pelo endereço do link
function storeOf(url) {
  let h = '';
  try { h = new URL(url).hostname.toLowerCase(); } catch (e) { return 'outra'; }
  if (/(^|\.)shopee\.com(\.br)?$|(^|\.)shope\.ee$/.test(h)) return 'shopee';
  if (/(^|\.)mercadoli(vre|bre)\.com(\.br)?$|(^|\.)meli\.la$|(^|\.)mlstatic\.com$/.test(h)) return 'mercadolivre';
  if (/(^|\.)amazon\.com(\.br)?$|(^|\.)amzn\.to$|(^|\.)a\.co$/.test(h)) return 'amazon';
  if (/(^|\.)magazineluiza\.com\.br$|(^|\.)magalu\.com(\.br)?$|(^|\.)divulgador\.magalu\.com$/.test(h)) return 'magalu';
  return 'outra';
}
function cleanUrl(u) {
  u = String(u || '').trim();
  // às vezes o app copia o texto junto ("Olha esse produto! https://...")
  const m = /https?:\/\/[^\s<>"']+/i.exec(u);
  if (!m) return '';
  u = m[0].replace(/^http:/i, 'https:');
  try { const x = new URL(u); if (x.protocol !== 'https:') return ''; } catch (e) { return ''; }
  return u.length <= 800 ? u : '';
}

async function load(event) {
  const d = await blobStore('config', event).get(KEY, { type: 'json' }).catch(() => null);
  return { items: d && Array.isArray(d.items) ? d.items : [] };
}
async function save(event, doc) {
  doc.updatedAt = new Date().toISOString();
  await blobStore('config', event).setJSON(KEY, doc);
}
async function savePhoto(event, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Foto inválida');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 1.5 * 1024 * 1024) throw new Error('Foto grande demais');
  // mesmo formato das fotos de produto (p<número>_<código>), para usar o mesmo endereço de foto
  const key = `p${crypto.randomInt(100000000, 999999999)}_${Date.now().toString(36)}`;
  await blobStore('product-photos', event).set(key, buf, { metadata: { type: 'image/' + m[1] } });
  return key;
}
async function dropPhoto(event, key) {
  if (key && /^p\d+_[a-z0-9]+$/.test(key)) { try { await blobStore('product-photos', event).delete(key); } catch (e) { /* ignora */ } }
}
const publicItem = (i) => ({ id: i.id, name: i.name, url: i.url, store: i.store, photo: i.photo || '', note: i.note || '', pet: i.pet || 'todos', tag: i.tag || '' });

exports.handler = async function (event) {
  try {
    if (event.httpMethod === 'GET') {
      const doc = await load(event);
      return res(200, { items: doc.items.filter(i => !i.hidden).map(publicItem) }, { 'Cache-Control': 'public, max-age=60' });
    }
    if (event.httpMethod !== 'POST') return res(405, { error: 'Método não permitido' });
    let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }
    if (!isAdmin(event, body.password)) return res(401, { error: 'Senha incorreta' });

    const doc = await load(event);
    if (body.op === 'list') return res(200, { items: doc.items });

    if (body.op === 'save') {
      const it = body.item || {};
      const name = txt(it.name, 90);
      const url = cleanUrl(it.url);
      if (!name) return res(400, { error: 'Coloque o nome do produto.' });
      if (!url) return res(400, { error: 'Cole o link de afiliado (começa com https://).' });
      const fields = {
        name, url, store: storeOf(url),
        note: txt(it.note, 220), tag: txt(it.tag, 24),
        pet: PETS.includes(it.pet) ? it.pet : 'todos',
        hidden: !!it.hidden
      };
      let item = it.id ? doc.items.find(x => x.id === it.id) : null;
      if (it.id && !item) return res(404, { error: 'Esse item não existe mais. Atualize a página.' });
      if (!item) {
        if (doc.items.length >= MAX_ITEMS) return res(400, { error: `Limite de ${MAX_ITEMS} achadinhos. Apague alguns antigos.` });
        if (!body.dataUrl) return res(400, { error: 'Coloque uma foto do produto.' });
        item = { id: 'r' + Date.now().toString(36) + crypto.randomInt(100, 999), createdAt: new Date().toISOString() };
        doc.items.unshift(item); // novo aparece primeiro
      }
      if (body.dataUrl) {
        const old = item.photo;
        item.photo = await savePhoto(event, body.dataUrl);
        if (old) await dropPhoto(event, old);
      }
      Object.assign(item, fields, { updatedAt: new Date().toISOString() });
      await save(event, doc);
      return res(200, { success: true, item, items: doc.items });
    }

    if (body.op === 'delete') {
      const i = doc.items.findIndex(x => x.id === body.id);
      if (i < 0) return res(404, { error: 'Item não encontrado.' });
      const [gone] = doc.items.splice(i, 1);
      await dropPhoto(event, gone.photo);
      await save(event, doc);
      return res(200, { success: true, items: doc.items });
    }

    if (body.op === 'move') {
      const i = doc.items.findIndex(x => x.id === body.id), j = i + (Number(body.dir) < 0 ? -1 : 1);
      if (i < 0) return res(404, { error: 'Item não encontrado.' });
      if (j >= 0 && j < doc.items.length) { const t = doc.items[i]; doc.items[i] = doc.items[j]; doc.items[j] = t; await save(event, doc); }
      return res(200, { success: true, items: doc.items });
    }

    return res(400, { error: 'Operação inválida' });
  } catch (err) {
    console.error('Erro nos achadinhos:', err);
    return res(500, { error: 'Erro: ' + err.message });
  }
};
