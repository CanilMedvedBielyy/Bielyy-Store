// Catálogo editável pelo painel admin (fica no Netlify Blobs, sem precisar de deploy).
//
// O site já traz o catálogo "base" dentro do index.html. Aqui guardamos só o que muda:
//   products[id] = { stock, sold, soldOut, hidden, preorder, name, desc, brand, category, variants, photo }
//     - stock: estoque definido por você no painel (número absoluto)
//     - sold:  quanto já vendeu DEPOIS que você definiu esse estoque (o site mostra stock - sold)
//   added[id]    = produto novo cadastrado pelo painel (mesmo formato dos produtos do site)
//   kits[id]     = kit montado ou alterado no painel ({ removed: true } = kit do site excluído)
//   products[id].story = textos da página do produto alterados no painel
const { blobStore } = require('./blobs');

const KEY = 'overrides';

function emptyDoc() { return { products: {}, added: {}, kits: {}, updatedAt: null, v: 0 }; }

async function getDoc(event) {
  try {
    const d = await blobStore('catalog', event).get(KEY, { type: 'json' });
    if (d && typeof d === 'object') {
      d.products = d.products || {}; d.added = d.added || {}; d.kits = d.kits || {};
      return d;
    }
  } catch (e) { /* sem catálogo salvo ainda */ }
  return emptyDoc();
}

async function saveDoc(doc, event) {
  doc.updatedAt = new Date().toISOString();
  doc.v = (doc.v || 0) + 1;
  await blobStore('catalog', event).setJSON(KEY, doc);
  return doc;
}

// Itens do pedido que mexem no estoque: [{ productId, qty }]
// (kits já chegam "abertos" em cada produto; encomendas não contam)
function stockLines(order) {
  if (Array.isArray(order.stockItems) && order.stockItems.length) return order.stockItems;
  return (Array.isArray(order.itemsDetailed) ? order.itemsDetailed : [])
    .filter(i => i && i.productId && !i.preorder && Number(i.productId) < 9000)
    .map(i => ({ productId: String(i.productId), qty: Number(i.qty) || 1 }));
}

// sign = +1 vende (baixa estoque) | -1 devolve (pedido cancelado)
async function applyOrderStock(order, sign, event) {
  const lines = stockLines(order);
  if (!lines.length) return false;
  const doc = await getDoc(event);
  lines.forEach(l => {
    const id = String(l.productId);
    const p = doc.products[id] || (doc.products[id] = {});
    p.sold = Math.max(-999, (Number(p.sold) || 0) + sign * (Number(l.qty) || 1));
    if (l.v) { // produto com cores: guarda quanto saiu de cada cor
      p.vsold = p.vsold || {};
      p.vsold[l.v] = Math.max(-999, (Number(p.vsold[l.v]) || 0) + sign * (Number(l.qty) || 1));
    }
  });
  await saveDoc(doc, event);
  return true;
}

const SALE_STATUSES = ['pago', 'em_preparacao', 'enviado', 'entregue'];

// Chamado sempre que o status de um pedido muda. Devolve true se mexeu no estoque.
async function syncOrderStock(order, event) {
  if (!order || !order.trackStock) return false; // pedidos antigos (antes do controle de estoque) não mexem
  try {
    if (SALE_STATUSES.includes(order.status) && !order.stockApplied) {
      await applyOrderStock(order, +1, event);
      order.stockApplied = true;
      return true;
    }
    if (order.status === 'cancelado' && order.stockApplied) {
      await applyOrderStock(order, -1, event);
      order.stockApplied = false;
      return true;
    }
  } catch (e) {
    console.error('Erro ao atualizar estoque do pedido', order.order_nsu, e);
  }
  return false;
}

// Limpa a lista de estoque enviada pelo site no pedido
function cleanStockItems(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 80).map(i => ({
    productId: String((i && i.productId) || '').replace(/\D/g, '').slice(0, 9),
    qty: Math.max(1, Math.min(99, parseInt(i && i.qty, 10) || 1)),
    v: (i && i.v) ? String(i.v).replace(/[\u0000-\u001f]/g, '').slice(0, 30) : undefined
  })).filter(i => i.productId && Number(i.productId) < 9000);
}

module.exports = { cleanStockItems, getDoc, saveDoc, syncOrderStock, applyOrderStock, stockLines, emptyDoc };
