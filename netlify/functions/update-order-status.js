// Netlify Function: atualiza o status de um pedido (protegida por senha)
// Rota automática: /.netlify/functions/update-order-status

const { getStore } = require('@netlify/blobs');

const VALID_STATUSES = ['aguardando_pagamento', 'pago', 'em_preparacao', 'enviado', 'entregue'];

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

  const { password, order_nsu, status, trackingCode } = body;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Senha incorreta' }) };
  }
  if (!order_nsu || !status || !VALID_STATUSES.includes(status)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Dados inválidos' }) };
  }

  try {
    const store = getStore('orders');
    const order = await store.get(order_nsu, { type: 'json' });

    if (!order) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Pedido não encontrado' }) };
    }

    order.status = status;
    order.statusUpdatedAt = new Date().toISOString();
    if (trackingCode) {
      order.trackingCode = trackingCode;
    }

    await store.setJSON(order_nsu, order);

    return { statusCode: 200, body: JSON.stringify({ success: true, order }) };
  } catch (err) {
    console.error('Erro ao atualizar pedido:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao atualizar' }) };
  }
};
