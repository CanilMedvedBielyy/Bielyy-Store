// Netlify Function: consulta pública do status de um pedido (sem senha)
// Rota automática: /.netlify/functions/track-order?order=NUMERO
// Só devolve informação limitada (sem endereço/telefone completos) por privacidade.

const { getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  const orderNsu = event.queryStringParameters && event.queryStringParameters.order;
  if (!orderNsu) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Informe o número do pedido' }) };
  }

  try {
    const store = getStore('orders', { siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_ACCESS_TOKEN });
    const order = await store.get(orderNsu, { type: 'json' });

    if (!order) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Pedido não encontrado' }) };
    }

    // Retorna só o essencial, sem dados sensíveis completos
    return {
      statusCode: 200,
      body: JSON.stringify({
        order_nsu: order.order_nsu,
        status: order.status,
        createdAt: order.createdAt,
        statusUpdatedAt: order.statusUpdatedAt || null,
        trackingCode: order.trackingCode || null,
        items: (order.items || []).map(it => ({ description: it.description, quantity: it.quantity })),
        customerFirstName: (order.customer && order.customer.name) ? order.customer.name.split(' ')[0] : null
      })
    };
  } catch (err) {
    console.error('Erro ao consultar pedido:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao consultar pedido' }) };
  }
};
