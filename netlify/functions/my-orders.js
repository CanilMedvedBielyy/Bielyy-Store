// Netlify Function: lista os pedidos da cliente que está logada
// Rota automática: /.netlify/functions/my-orders  (POST { token })
// Mostra os pedidos feitos com o mesmo e-mail da conta.

const { blobStore } = require('../lib/blobs');
const { readToken } = require('../lib/session');

const lower = (v) => String(v || '').trim().toLowerCase();

function itemsOf(o) {
  if (Array.isArray(o.itemsDetailed) && o.itemsDetailed.length) {
    return o.itemsDetailed.map(i => ({ name: (i.name || '') + (i.variant ? ` (${i.variant})` : ''), qty: i.qty || 1 }));
  }
  return (o.items || [])
    .filter(i => !/^Frete \(/.test(i.description || ''))
    .map(i => ({ name: i.description || '', qty: i.quantity || 1 }));
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }

  try {
    const email = await readToken(body.token, event);
    if (!email) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Sua sessão expirou. Entre de novo.' }) };
    }

    const store = blobStore('orders', event);
    const { blobs } = await store.list();
    const all = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' }).catch(() => null)));
    const mine = all
      .filter(o => o && (lower(o.accountEmail) === email || lower(o.customer && o.customer.email) === email))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 50)
      .map(o => ({
        order_nsu: o.order_nsu,
        status: o.status,
        createdAt: o.createdAt || null,
        statusUpdatedAt: o.statusUpdatedAt || null,
        total: o.total != null ? Number(o.total) : null,
        trackingCode: o.trackingCode || null,
        carrier: o.carrier || null,
        shipping: o.shipping && o.shipping.label ? o.shipping.label : null,
        items: itemsOf(o)
      }));

    return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ success: true, orders: mine }) };
  } catch (err) {
    console.error('Erro ao listar pedidos da cliente:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao buscar seus pedidos' }) };
  }
};
