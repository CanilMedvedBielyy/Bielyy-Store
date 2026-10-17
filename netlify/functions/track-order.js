// Netlify Function: consulta pública do status de um pedido (sem senha)
// Rota automática: /.netlify/functions/track-order?order=NUMERO
// Só devolve informação limitada (sem endereço/telefone) por privacidade.

const { blobStore } = require('../lib/blobs');

function itemsOf(o) {
  if (Array.isArray(o.itemsDetailed) && o.itemsDetailed.length) {
    return o.itemsDetailed.map(i => ({ description: (i.name || '') + (i.variant ? ` (${i.variant})` : ''), quantity: i.qty || 1 }));
  }
  return (o.items || [])
    .filter(i => !/^Frete \(/.test(i.description || ''))
    .map(i => ({ description: i.description || '', quantity: i.quantity || 1 }));
}

exports.handler = async function (event) {
  const raw = (event.queryStringParameters && event.queryStringParameters.order) || '';
  // aceita "#W123", " w123 ", etc.
  const orderNsu = String(raw).replace(/[#\s]/g, '').toUpperCase().slice(0, 40);
  if (!orderNsu) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Informe o número do pedido' }) };
  }

  try {
    const store = blobStore('orders', event);
    const order = await store.get(orderNsu, { type: 'json' });

    if (!order) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Pedido não encontrado' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        order_nsu: order.order_nsu,
        status: order.status,
        createdAt: order.createdAt,
        statusUpdatedAt: order.statusUpdatedAt || null,
        paidAt: order.paidAt || null,
        trackingCode: order.trackingCode || null,
        carrier: order.carrier || null,
        shipping: order.shipping && order.shipping.label ? order.shipping.label : null,
        paymentMethod: order.paymentMethod || null,
        items: itemsOf(order),
        customerFirstName: (order.customer && order.customer.name) ? order.customer.name.split(' ')[0] : null
      })
    };
  } catch (err) {
    console.error('Erro ao consultar pedido:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao consultar pedido' }) };
  }
};
