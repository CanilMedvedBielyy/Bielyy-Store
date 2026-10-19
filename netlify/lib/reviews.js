// Avaliações só de quem comprou ("compra verificada").
// A cliente prova que o pedido é dela de um destes jeitos:
//   1) está logada (token) com o mesmo e-mail do pedido, ou
//   2) informa os 4 últimos dígitos do telefone usado no pedido.
// Só pedidos já enviados ou entregues podem ser avaliados.
const { blobStore } = require('./blobs');
const { readToken } = require('./session');

const REVIEWABLE = ['enviado', 'entregue'];
const MAX_FAILS = 8;               // tentativas erradas de telefone por pedido
const LOCK_MS = 60 * 60 * 1000;    // bloqueio de 1 hora depois disso

const lower = (v) => String(v || '').trim().toLowerCase();
const digits = (v) => String(v || '').replace(/\D/g, '');
const normOrder = (v) => String(v || '').replace(/[#\s]/g, '').toUpperCase().slice(0, 40);

function err(statusCode, error, extra) {
  return Object.assign({ ok: false, statusCode, error }, extra || {});
}

async function verifyOrderAccess(event, { order, token, phone4 }) {
  const orderNsu = normOrder(order);
  if (!orderNsu) return err(400, 'Informe o número do pedido');

  const o = await blobStore('orders', event).get(orderNsu, { type: 'json' });
  if (!o) return err(404, 'Pedido não encontrado. Confira o número.');

  let verified = false;
  if (token) {
    const email = await readToken(token, event);
    if (email && (lower(o.accountEmail) === email || lower(o.customer && o.customer.email) === email)) verified = true;
  }

  if (!verified) {
    const p4 = digits(phone4).slice(-4);
    if (p4.length !== 4) return err(401, 'Confirme os 4 últimos dígitos do seu telefone', { needPhone: true });
    const guard = blobStore('config', event);
    const gkey = 'review-guard-' + orderNsu;
    let g = null;
    try { g = await guard.get(gkey, { type: 'json' }); } catch (e) { g = null; }
    if (g && g.lockedUntil && Date.now() < g.lockedUntil) {
      return err(429, 'Muitas tentativas. Tente de novo daqui a 1 hora ou fale com a gente no WhatsApp.');
    }
    const real = digits(o.customer && o.customer.phone).slice(-4);
    if (!real || real !== p4) {
      const fails = ((g && g.fails) || 0) + 1;
      try { await guard.setJSON(gkey, fails >= MAX_FAILS ? { fails: 0, lockedUntil: Date.now() + LOCK_MS } : { fails }); } catch (e) { /* ignora */ }
      return err(401, 'Os dígitos não conferem com o telefone do pedido', { needPhone: true });
    }
    if (g) { try { await guard.delete(gkey); } catch (e) { /* ignora */ } }
  }

  if (!REVIEWABLE.includes(o.status)) {
    return err(409, o.status === 'cancelado'
      ? 'Este pedido foi cancelado.'
      : 'Você poderá avaliar assim que o pedido for enviado 💜', { status: o.status });
  }
  return { ok: true, order: o, orderNsu };
}

// Produtos do pedido que podem ser avaliados (um por produto)
function reviewableItems(o) {
  const seen = new Set();
  return (Array.isArray(o.itemsDetailed) ? o.itemsDetailed : [])
    .filter(i => i && i.productId && !seen.has(String(i.productId)) && seen.add(String(i.productId)))
    .map(i => ({ productId: String(i.productId), name: String(i.name || '').split(' (')[0].slice(0, 120) }));
}

function displayName(o, given) {
  const g = String(given || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (g) return g;
  const parts = String((o.customer && o.customer.name) || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Cliente Bielyy';
  return parts[0] + (parts.length > 1 ? ' ' + parts[parts.length - 1][0].toUpperCase() + '.' : '');
}

module.exports = { verifyOrderAccess, reviewableItems, displayName, normOrder, REVIEWABLE };
