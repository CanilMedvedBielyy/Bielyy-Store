// Netlify Function: lista todos os pedidos (protegida por senha)
// Rota automática: /.netlify/functions/get-orders
// Variável de ambiente necessária: ADMIN_PASSWORD

const { getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  const password = event.queryStringParameters && event.queryStringParameters.password;
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Senha incorreta' }) };
  }

  try {
    const store = getStore('orders');
    const { blobs } = await store.list();

    const orders = await Promise.all(
      blobs.map(b => store.get(b.key, { type: 'json' }))
    );

    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders })
    };
  } catch (err) {
    console.error('Erro ao listar pedidos:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao buscar pedidos' }) };
  }
};
