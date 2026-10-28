// Netlify Function: gera um link de pagamento InfinitePay
// Rota automática: /.netlify/functions/create-payment-link

const { blobStore } = require('../lib/blobs');
const { cleanStockItems, getDoc } = require('../lib/catalog');
const { readToken } = require('../lib/session');

const cpfOk = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return '';
  for (let t = 9; t < 11; t++) {
    let s = 0; for (let i = 0; i < t; i++) s += Number(d[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(d[t])) return '';
  }
  return d;
};

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

  // Modo inauguração: com a loja fechada no painel, nenhum pedido é aceito
  try {
    const cat = await getDoc(event);
    if (cat.settings && cat.settings.closed) {
      return { statusCode: 409, body: JSON.stringify({ error: 'A Bielyy Store abre em breve! Ainda não estamos aceitando pedidos.', closed: true }) };
    }
  } catch (e) { /* sem catálogo: segue */ }

  const cpf = cpfOk(orderDetails.cpf);
  if (!cpf) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Informe um CPF válido', needCpf: true }) };
  }

  // Comprar exige conta: o pedido fica ligado ao e-mail de quem está logada
  const accountEmail = await readToken(orderDetails.token, event).catch(() => null);
  if (!accountEmail) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Entre na sua conta para finalizar o pedido', needLogin: true }) };
  }

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
      const store = blobStore('orders', event);
      const order = {
        order_nsu: payload.order_nsu,
        status: 'aguardando_pagamento',
        createdAt: new Date().toISOString(),
        customer: Object.assign({}, payload.customer || {}, { cpf }),
        address: orderDetails.address || null,
        items: payload.items,
        total: orderDetails.total || null,
        shipping: orderDetails.shipping || null,
        paymentMethod: 'infinitepay',
        accountEmail: String(accountEmail).trim().toLowerCase().slice(0, 120),
        paymentDetail: orderDetails.paymentDetail || null,
        itemsDetailed: Array.isArray(orderDetails.itemsDetailed) ? orderDetails.itemsDetailed.slice(0, 60) : null,
        subtotal: orderDetails.subtotal != null ? orderDetails.subtotal : null,
        coupon: orderDetails.coupon || null,
        paymentUrl: data.url || null,
        stockItems: cleanStockItems(orderDetails.stockItems),
        trackStock: true
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
