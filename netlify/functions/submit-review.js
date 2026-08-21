// Netlify Function: recebe uma avaliação de produto (fica pendente até aprovação)
// Rota automática: /.netlify/functions/submit-review

const { getStore } = require('@netlify/blobs');

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

  const { productId, name, rating, comment } = body;
  if (!productId || !name || !comment || !rating) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Preencha todos os campos' }) };
  }
  const ratingNum = parseInt(rating);
  if (ratingNum < 1 || ratingNum > 5) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Nota inválida' }) };
  }

  try {
    const store = getStore('reviews');
    const id = `${productId}_${Date.now()}`;
    await store.setJSON(id, {
      id,
      productId: String(productId),
      name,
      rating: ratingNum,
      comment,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Erro ao salvar avaliação:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao enviar avaliação' }) };
  }
};
