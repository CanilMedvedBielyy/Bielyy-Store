// Netlify Function: lista avaliações pendentes de moderação (protegida por senha)
// Rota automática: /.netlify/functions/get-pending-reviews?password=XXX

const { getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  const password = event.queryStringParameters && event.queryStringParameters.password;
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Senha incorreta' }) };
  }

  try {
    const store = getStore('reviews');
    const { blobs } = await store.list();
    const all = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
    const pending = all
      .filter(r => r && r.status === 'pending')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    return { statusCode: 200, body: JSON.stringify({ reviews: pending }) };
  } catch (err) {
    console.error('Erro ao listar pendentes:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao buscar' }) };
  }
};
