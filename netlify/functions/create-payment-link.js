// Netlify Function: gera um link de pagamento InfinitePay
// Rota automática: /.netlify/functions/create-payment-link

const { getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  if (!payload.handle || !Array.isArray(payload.items) || payload.items.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Payload incompleto: precisa de handle e items' }) };
  }

  // orderDetails vem do front-end só pra guardarmos (não é enviado pra InfinitePay)
  const orderDetails = payload.orderDetails || {};
  delete payload.orderDetails;

  try {
    const response = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify(data) };
    }

    // Salva o pedido completo (itens, endereço, cliente) com status "aguardando pagamento"
    try {
      const store = getStore('orders', { siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_ACCESS_TOKEN });
      const order = {
        order_nsu: payload.order_nsu,
        status: 'aguardando_pagamento',
        createdAt: new Date().toISOString(),
        customer: payload.customer || {},
        address: orderDetails.address || null,
        items: payload.items,
        total: orderDetails.total || null,
        shipping: orderDetails.shipping || null,
        paymentUrl: data.url || null
      };
      await store.setJSON(payload.order_nsu, order);
    } catch (blobErr) {
      // Não deixa o pedido falhar por causa disso, só loga
      console.error('Erro ao salvar pedido:', blobErr);
    }

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao falar com a InfinitePay', details: err.message }) };
  }
};
