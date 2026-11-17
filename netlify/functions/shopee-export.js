// Exportar para a Shopee (só com a senha do admin)
// A Shopee pede fotos de pelo menos 500 x 500 com fundo branco, enviadas por link.
// O painel ajusta cada foto (1024 x 1024, fundo branco) e guarda aqui; a planilha usa o link dela.
//   { op:'map' }                              -> { map: { <foto original>: <foto Shopee> } }
//   { op:'photo', src, id, dataUrl }          -> guarda a foto ajustada e devolve { key }
const crypto = require('crypto');
const { blobStore } = require('../lib/blobs');

const MAP_KEY = 'shopee-photos';

function isAdmin(event) {
  const given = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password'])) || '';
  const real = process.env.ADMIN_PASSWORD || '';
  if (!given || !real) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}
const res = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return res(405, { error: 'Método não permitido' });
    if (!isAdmin(event)) return res(401, { error: 'Senha incorreta' });
    let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }
    const cfg = blobStore('config', event);
    const doc = (await cfg.get(MAP_KEY, { type: 'json' }).catch(() => null)) || { map: {} };
    doc.map = doc.map || {};

    if (body.op === 'map') return res(200, { map: doc.map });

    if (body.op === 'photo') {
      const src = String(body.src || '').slice(0, 200);
      const id = String(body.id || '').replace(/\D/g, '').slice(0, 9) || '0';
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl || ''));
      if (!src || !m) return res(400, { error: 'Foto inválida' });
      const buf = Buffer.from(m[1], 'base64');
      if (!buf.length || buf.length > 1.5 * 1024 * 1024) return res(400, { error: 'Foto grande demais' });
      // mesmo formato das fotos de produto (p<número>_<código>), servida por /product-photo
      const key = `p${id}_shp${Date.now().toString(36)}${crypto.randomInt(10, 99)}`;
      await blobStore('product-photos', event).set(key, buf, { metadata: { type: 'image/jpeg' } });
      const old = doc.map[src];
      doc.map[src] = key;
      doc.updatedAt = new Date().toISOString();
      await cfg.setJSON(MAP_KEY, doc);
      if (old && /^p\d+_shp[a-z0-9]+$/.test(old)) { try { await blobStore('product-photos', event).delete(old); } catch (e) { /* ignora */ } }
      return res(200, { success: true, key });
    }

    return res(400, { error: 'Operação inválida' });
  } catch (err) {
    console.error('Erro no exportar para a Shopee:', err);
    return res(500, { error: 'Erro: ' + err.message });
  }
};
