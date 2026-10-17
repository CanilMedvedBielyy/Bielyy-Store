// Netlify Function: lista as avaliações APROVADAS de um produto (público)
// Rota automática: /.netlify/functions/get-reviews?productId=123

const { blobStore } = require('../lib/blobs');

exports.handler = async function (event) {
  const productId = event.queryStringParameters && event.queryStringParameters.productId;
  if (!productId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Informe o productId' }) };
  }

  try {
    const store = blobStore('reviews', event);
    const { blobs } = await store.list({ prefix: `${productId}_` });

    const all = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
    const approved = all
      .filter(r => r && r.status === 'approved')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return { statusCode: 200, body: JSON.stringify({ reviews: approved }) };
  } catch (err) {
    console.error('Erro ao buscar avaliações:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao buscar avaliações' }) };
  }
};
