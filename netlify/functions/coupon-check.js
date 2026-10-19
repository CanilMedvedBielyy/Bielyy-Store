// Netlify Function: confere se é a 1ª compra da cliente (para cupons com valor diferente na 1ª compra)
// POST { email?, phone?, token? }  ->  { first: true|false }
// Conta como "já comprou" qualquer pedido pago (pago, em preparação, enviado ou entregue)
// com o mesmo e-mail ou o mesmo telefone.
const { blobStore } = require('../lib/blobs');
const { readToken } = require('../lib/session');

const SALE = ['pago', 'em_preparacao', 'enviado', 'entregue'];
const lower = (v) => String(v || '').trim().toLowerCase();
const phoneKey = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }
  try {
    const emails = new Set();
    const e1 = lower(body.email); if (/@/.test(e1)) emails.add(e1.slice(0, 120));
    if (body.token) { const e2 = await readToken(body.token, event); if (e2) emails.add(e2); }
    const ph = phoneKey(body.phone);
    if (!emails.size && !ph) return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ first: true, checked: false }) };

    const store = blobStore('orders', event);
    const { blobs } = await store.list();
    const all = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' }).catch(() => null)));
    const bought = all.some(o => o && SALE.includes(o.status) && (
      (emails.size && (emails.has(lower(o.accountEmail)) || emails.has(lower(o.customer && o.customer.email)))) ||
      (ph && phoneKey(o.customer && o.customer.phone) === ph)
    ));
    return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ first: !bought, checked: true }) };
  } catch (err) {
    console.error('Erro ao conferir 1ª compra:', err);
    return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ first: true, checked: false }) };
  }
};
