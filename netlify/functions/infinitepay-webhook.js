// Netlify Function: recebe a confirmação de pagamento da InfinitePay
// Rota automática: /.netlify/functions/infinitepay-webhook
// Configure essa URL como webhook_url no Checkout Integrado da InfinitePay.

const { blobStore } = require('../lib/blobs');
const { syncOrderStock } = require('../lib/catalog');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, message: 'Método não permitido' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, message: 'JSON inválido' }) };
  }

  const orderNsu = body.order_nsu;
  if (!orderNsu) {
    return { statusCode: 400, body: JSON.stringify({ success: false, message: 'order_nsu ausente' }) };
  }

  try {
    const store = blobStore('orders', event);
    const existing = await store.get(orderNsu, { type: 'json' });

    if (!existing) {
      // Pedido não encontrado no nosso registro, mas confirmamos recebimento mesmo assim
      return { statusCode: 200, body: JSON.stringify({ success: true, message: null }) };
    }

    // Só avança para "pago" se ainda estava aguardando (a InfinitePay pode reenviar o aviso
    // e não queremos voltar um pedido "enviado" para "pago")
    if (!existing.status || existing.status === 'aguardando_pagamento') {
      existing.status = 'pago';
      existing.statusUpdatedAt = new Date().toISOString();
    }
    if (!existing.paidAt) existing.paidAt = new Date().toISOString();
    existing.paid_amount = body.paid_amount;
    existing.capture_method = body.capture_method;
    existing.transaction_nsu = body.transaction_nsu;
    existing.receipt_url = body.receipt_url;

    await syncOrderStock(existing, event); // baixa o estoque dos produtos vendidos
    await store.setJSON(orderNsu, existing);

    return { statusCode: 200, body: JSON.stringify({ success: true, message: null }) };
  } catch (err) {
    console.error('Erro no webhook:', err);
    return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Erro ao processar' }) };
  }
};
