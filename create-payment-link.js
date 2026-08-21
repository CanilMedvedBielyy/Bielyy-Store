// Netlify Function: gera um link de pagamento InfinitePay
// Rota automática: /.netlify/functions/create-payment-link
//
// Variáveis de ambiente extras usadas aqui (além das do InfinitePay/Blobs):
//   RESEND_API_KEY  -> chave de API do resend.com, pra mandar e-mail de aviso
//   NOTIFY_EMAIL    -> e-mail que recebe o aviso de pedido novo

const { getStore } = require('@netlify/blobs');

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendOrderEmail(order) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  if (!apiKey || !to) {
    console.error('RESEND_API_KEY ou NOTIFY_EMAIL não configurados — e-mail de pedido não enviado');
    return;
  }
  const itemsHtml = (order.items || [])
    .map(it => `<div>${it.quantity}x ${esc(it.description)} — R$ ${(it.price / 100).toFixed(2)}</div>`)
    .join('');
  const addr = order.address || {};
  const html = `
    <h2>🐾 Novo pedido — #${esc(order.order_nsu)}</h2>
    <p><strong>Status:</strong> Aguardando pagamento</p>
    <h3>Comprador</h3>
    <p>
      Nome: ${esc(order.customer && order.customer.name)}<br>
      WhatsApp: ${esc(order.customer && order.customer.phone)}<br>
      E-mail: ${esc((order.customer && order.customer.email) || '-')}
    </p>
    <h3>Endereço</h3>
    <p>
      ${esc(addr.street || '')}, ${esc(addr.number || '')} ${addr.complement ? '- ' + esc(addr.complement) : ''}<br>
      ${esc(addr.neighborhood || '')}<br>
      ${esc(addr.city || '')} — CEP ${esc(addr.cep || '')}
    </p>
    <h3>Itens</h3>
    ${itemsHtml}
    <p><strong>Total: R$ ${order.total ? order.total.toFixed(2) : '?'}</strong></p>
    <p>Assim que o pagamento for confirmado, você recebe outro e-mail avisando.</p>
  `;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: 'Bielyy Store <onboarding@resend.dev>',
      to: [to],
      subject: `🐾 Novo pedido #${order.order_nsu} — aguardando pagamento`,
      html
    })
  });
  if (!res.ok) {
    console.error('Erro ao enviar e-mail via Resend:', await res.text());
  }
}

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

    // Manda o e-mail de aviso — não depende do Blobs funcionar
    try {
      await sendOrderEmail(order);
    } catch (mailErr) {
      console.error('Erro ao mandar e-mail de pedido:', mailErr);
    }

    // Também tenta salvar no Blobs, pro painel admin (se estiver funcionando)
    try {
      const store = getStore('orders', { siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_ACCESS_TOKEN });
      await store.setJSON(payload.order_nsu, order);
    } catch (blobErr) {
      console.error('Erro ao salvar pedido no Blobs:', blobErr);
    }

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao falar com a InfinitePay', details: err.message }) };
  }
};
