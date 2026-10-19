// Netlify Function: mostra quais produtos de um pedido a cliente pode avaliar
// Rota automática: /.netlify/functions/review-order
// POST { order, token? , phone4? }

const { blobStore } = require('../lib/blobs');
const { verifyOrderAccess, reviewableItems, displayName } = require('../lib/reviews');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }

  try {
    const v = await verifyOrderAccess(event, body);
    if (!v.ok) {
      return { statusCode: v.statusCode, body: JSON.stringify({ error: v.error, needPhone: !!v.needPhone, status: v.status || null }) };
    }
    const store = blobStore('reviews', event);
    const items = await Promise.all(reviewableItems(v.order).map(async it => {
      let r = null;
      try { r = await store.get(`${it.productId}_${v.orderNsu}`, { type: 'json' }); } catch (e) { r = null; }
      return Object.assign(it, r ? { reviewed: true, rating: r.rating, comment: r.comment, reviewStatus: r.status } : { reviewed: false });
    }));
    return {
      statusCode: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ success: true, order: v.orderNsu, name: displayName(v.order), items })
    };
  } catch (err) {
    console.error('Erro em review-order:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao carregar o pedido' }) };
  }
};
