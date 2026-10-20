// Netlify Function: configuração do Pix direto do site (chave, nome, cidade)
// GET  -> público: { enabled, type, key, name, city }  (a chave aparece no QR Code de qualquer jeito)
// POST -> só com a senha do admin: { password, config: { enabled, type, key, name, city } }
const crypto = require('crypto');
const { blobStore } = require('../lib/blobs');

const TYPES = ['cpf', 'cnpj', 'celular', 'email', 'aleatoria'];
function isAdmin(event, bodyPassword) {
  const given = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password'])) || bodyPassword || '';
  const real = process.env.ADMIN_PASSWORD || '';
  if (!given || !real) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}
const txt = (v, n) => String(v == null ? '' : v).replace(/[<>"]/g, '').trim().slice(0, n);

exports.handler = async function (event) {
  const store = blobStore('config', event);
  try {
    if (event.httpMethod === 'GET') {
      const c = await store.get('pix', { type: 'json' }).catch(() => null);
      return { statusCode: 200, headers: { 'Cache-Control': 'public, max-age=60' }, body: JSON.stringify(c && c.key ? c : { enabled: false }) };
    }
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
    let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }
    if (!isAdmin(event, body.password)) return { statusCode: 401, body: JSON.stringify({ error: 'Senha incorreta' }) };
    const c = body.config || {};
    const type = TYPES.includes(c.type) ? c.type : 'email';
    const key = txt(c.key, 77);
    if (c.enabled && !key) return { statusCode: 400, body: JSON.stringify({ error: 'Coloque a chave Pix' }) };
    if (type === 'email' && key && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key)) return { statusCode: 400, body: JSON.stringify({ error: 'E-mail da chave parece incompleto' }) };
    const cfg = { enabled: !!c.enabled && !!key, type, key, name: txt(c.name, 25) || 'Bielyy Store', city: txt(c.city, 15) || 'Sao Paulo', updatedAt: new Date().toISOString() };
    await store.setJSON('pix', cfg);
    return { statusCode: 200, body: JSON.stringify({ success: true, config: cfg }) };
  } catch (err) {
    console.error('Erro na config do Pix:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro: ' + err.message }) };
  }
};
