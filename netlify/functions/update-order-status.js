// Netlify Function: atualiza o status de um pedido (protegida por senha)
// Rota automática: /.netlify/functions/update-order-status

const { getStore } = require('@netlify/blobs');

const VALID_STATUSES = ['aguardando_pagamento', 'pago', 'em_preparacao', 'enviado', 'entregue', 'cancelado'];
const crypto = require('crypto');

function isAdmin(event, bodyPassword) {
  const given = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password'])) || bodyPassword || '';
  const real = process.env.ADMIN_PASSWORD || '';
  if (!given || !real) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

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

  const { password, order_nsu, status, trackingCode, note } = body;

  if (!isAdmin(event, password)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Senha incorreta' }) };
  }
  if (!order_nsu || (status && !VALID_STATUSES.includes(status)) || (!status && note === undefined && trackingCode === undefined)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Dados inválidos' }) };
  }

  try {
    const store = getStore('orders', { siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_ACCESS_TOKEN });
    const order = await store.get(order_nsu, { type: 'json' });

    if (!order) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Pedido não encontrado' }) };
    }

    if (status) {
      if (status === 'pago' && order.status !== 'pago' && !order.paidAt) {
        order.paidAt = new Date().toISOString();
        order.paidManually = true; // confirmado à mão (ex.: pedido do WhatsApp)
      }
      order.status = status;
      order.statusUpdatedAt = new Date().toISOString();
    }
    if (trackingCode !== undefined && trackingCode !== null) {
      order.trackingCode = String(trackingCode).slice(0, 60);
    }
    if (note !== undefined) {
      order.note = String(note).slice(0, 1000);
    }

    await store.setJSON(order_nsu, order);

    return { statusCode: 200, body: JSON.stringify({ success: true, order }) };
  } catch (err) {
    console.error('Erro ao atualizar pedido:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao atualizar' }) };
  }
};
