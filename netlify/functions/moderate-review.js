// Netlify Function: aprova ou rejeita uma avaliação (protegida por senha)
// Rota automática: /.netlify/functions/moderate-review

const { blobStore } = require('../lib/blobs');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { password, reviewId, action } = body;
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Senha incorreta' }) };
  }
  if (!reviewId || !['approve', 'reject'].includes(action)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Dados inválidos' }) };
  }

  try {
    const store = blobStore('reviews', event);

    if (action === 'reject') {
      const r = await store.get(reviewId, { type: 'json' }).catch(() => null);
      if (r && Array.isArray(r.photos) && r.photos.length) {
        const photos = blobStore('review-photos', event);
        for (const k of r.photos) { try { await photos.delete(k); } catch (e) { /* ignora */ } }
      }
      await store.delete(reviewId);
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    const review = await store.get(reviewId, { type: 'json' });
    if (!review) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Avaliação não encontrada' }) };
    }
    review.status = 'approved';
    await store.setJSON(reviewId, review);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Erro ao moderar avaliação:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao processar' }) };
  }
};
