// Netlify Function: lista avaliações para o painel admin (protegida por senha)
// /.netlify/functions/get-pending-reviews?password=XXX              -> pendentes
// /.netlify/functions/get-pending-reviews?password=XXX&status=approved -> publicadas

const crypto = require('crypto');
const { blobStore } = require('../lib/blobs');

function isAdminPwd(given) {
  const real = process.env.ADMIN_PASSWORD || '';
  if (!given || !real) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (!isAdminPwd(q.password)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Senha incorreta' }) };
  }
  const want = q.status === 'approved' ? 'approved' : 'pending';
  try {
    const store = blobStore('reviews', event);
    const { blobs } = await store.list();
    const all = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' }).catch(() => null)));
    const list = all
      .filter(r => r && r.status === want)
      .sort((a, b) => want === 'pending'
        ? new Date(a.createdAt) - new Date(b.createdAt)
        : new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 300);
    return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ reviews: list }) };
  } catch (err) {
    console.error('Erro ao listar avaliações:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao buscar' }) };
  }
};
