// Netlify Function: avaliações APROVADAS (público)
// /.netlify/functions/get-reviews?productId=123  -> lista do produto
// /.netlify/functions/get-reviews?summary=1      -> média e quantidade de todos os produtos

const { blobStore } = require('../lib/blobs');

const publicView = (r) => ({
  name: r.name, rating: r.rating, comment: r.comment,
  createdAt: r.createdAt, verified: !!r.verified,
  photos: (Array.isArray(r.photos) ? r.photos : []).map(k => '/.netlify/functions/review-photo?k=' + encodeURIComponent(k))
});

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  try {
    const store = blobStore('reviews', event);

    if (q.summary) {
      const { blobs } = await store.list();
      const all = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' }).catch(() => null)));
      const summary = {};
      all.filter(r => r && r.status === 'approved').forEach(r => {
        const s = summary[r.productId] || (summary[r.productId] = { sum: 0, n: 0 });
        s.sum += Number(r.rating) || 0; s.n += 1;
      });
      Object.keys(summary).forEach(k => { const s = summary[k]; summary[k] = { avg: Math.round(s.sum / s.n * 10) / 10, n: s.n }; });
      return { statusCode: 200, headers: { 'Cache-Control': 'public, max-age=120' }, body: JSON.stringify({ summary }) };
    }

    const productId = String(q.productId || '').slice(0, 20);
    if (!productId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Informe o productId' }) };
    }
    const { blobs } = await store.list({ prefix: `${productId}_` });
    const all = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' }).catch(() => null)));
    const approved = all
      .filter(r => r && r.status === 'approved' && String(r.productId) === productId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(publicView);
    return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ reviews: approved }) };
  } catch (err) {
    console.error('Erro ao buscar avaliações:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao buscar avaliações' }) };
  }
};
