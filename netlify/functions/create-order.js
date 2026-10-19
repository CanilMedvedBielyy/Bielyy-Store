// Netlify Function: registra um pedido feito pelo WhatsApp (público)
// Rota automática: /.netlify/functions/create-order
// O pedido fica no painel admin com status "aguardando_pagamento".

const { blobStore } = require('../lib/blobs');
const { cleanStockItems } = require('../lib/catalog');

const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }
  if ((event.body || '').length > 20000) {
    return { statusCode: 413, body: JSON.stringify({ error: 'Pedido grande demais' }) };
  }

  let b;
  try { b = JSON.parse(event.body); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const items = (Array.isArray(b.itemsDetailed) ? b.itemsDetailed : []).slice(0, 60).map(it => ({
    name: clean(it.name, 320),
    variant: clean(it.variant, 60),
    qty: Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1)),
    unitPrice: num(it.unitPrice),
    preorder: !!it.preorder,
    productId: clean(it.productId, 20)
  })).filter(it => it.name);

  const customer = b.customer || {};
  const address = b.address || {};
  if (!items.length || !clean(customer.name) || !clean(customer.phone) || !clean(address.street)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Pedido incompleto' }) };
  }

  let orderNsu = /^W\d{12,16}$/.test(String(b.order_nsu || '')) ? String(b.order_nsu) : 'W' + Date.now() + Math.floor(Math.random() * 90 + 10);
  const coupon = b.coupon && b.coupon.code ? {
    code: clean(b.coupon.code, 40).toUpperCase(),
    label: clean(b.coupon.label, 120),
    discount: num(b.coupon.discount),
    percent: b.coupon.percent != null ? num(b.coupon.percent) : null,
    commissionPct: b.coupon.commissionPct != null ? Math.max(0, Math.min(50, num(b.coupon.commissionPct))) : null,
    first: b.coupon.first === true ? true : (b.coupon.first === false ? false : undefined)
  } : null;

  const order = {
    order_nsu: orderNsu,
    status: 'aguardando_pagamento',
    createdAt: new Date().toISOString(),
    paymentMethod: 'whatsapp',
    accountEmail: clean(b.accountEmail, 120).toLowerCase(),
    customer: { name: clean(customer.name, 120), phone: clean(customer.phone, 30), email: clean(customer.email, 120) },
    address: {
      cep: clean(address.cep, 12), street: clean(address.street, 160), number: clean(address.number, 20),
      complement: clean(address.complement, 80), neighborhood: clean(address.neighborhood, 80), city: clean(address.city, 80)
    },
    items: items.map(it => ({ description: it.name + (it.variant ? ` (${it.variant})` : ''), quantity: it.qty, price: Math.round(it.unitPrice * 100) })),
    itemsDetailed: items,
    subtotal: num(b.subtotal),
    coupon,
    shipping: b.shipping ? { label: clean(b.shipping.label, 60), price: num(b.shipping.price), free: !!b.shipping.free, local: !!b.shipping.local } : null,
    total: num(b.total),
    stockItems: cleanStockItems(b.stockItems),
    trackStock: true
  };

  try {
    const store = blobStore('orders', event);
    // nunca sobrescreve um pedido que já existe
    if (await store.get(orderNsu, { type: 'json' })) {
      orderNsu = 'W' + Date.now() + Math.floor(Math.random() * 90 + 10);
      order.order_nsu = orderNsu;
    }
    await store.setJSON(orderNsu, order);
    return { statusCode: 200, body: JSON.stringify({ success: true, order_nsu: orderNsu }) };
  } catch (err) {
    console.error('Erro ao salvar pedido:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao salvar pedido' }) };
  }
};
