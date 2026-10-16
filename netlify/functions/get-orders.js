// Netlify Function: lista todos os pedidos (protegida por senha)
// Rota automática: /.netlify/functions/get-orders
// Senha: header "x-admin-password" (ou ?password= por compatibilidade).
// Variável de ambiente necessária: ADMIN_PASSWORD

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

function isAdmin(event) {
  const given = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password']))
    || (event.queryStringParameters && event.queryStringParameters.password) || '';
  const real = process.env.ADMIN_PASSWORD || '';
  if (!given || !real) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

exports.handler = async function (event) {
  if (!isAdmin(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Senha incorreta' }) };
  }

  try {
    const store = getStore('orders', { siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_ACCESS_TOKEN });
    const { blobs } = await store.list();

    const orders = (await Promise.all(
      blobs.map(b => store.get(b.key, { type: 'json' }))
    )).filter(Boolean);

    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ orders })
    };
  } catch (err) {
    console.error('Erro ao listar pedidos:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao buscar pedidos' }) };
  }
};
