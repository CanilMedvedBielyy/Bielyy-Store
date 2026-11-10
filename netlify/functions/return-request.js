// Netlify Function: a cliente pede troca ou devolução de um pedido pelo site
// Rota automática: /.netlify/functions/return-request
// POST { order, token (ou phone4), items:[{ idx, qty }], reason, wants, details, photos:[dataURL] }
// A solicitação fica em order.returnRequest; a loja recebe um e-mail e a cliente também.

const { blobStore } = require('../lib/blobs');
const { verifyOrderAccess } = require('../lib/reviews');
const { itemsView } = require('../lib/order-view');
const { REASONS, WANTS, MAX_DAYS, deliveredAt, isOpen, publicReturn } = require('../lib/returns');
const { notifyReturn, notifyStoreReturn } = require('../lib/mailer');

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 700 * 1024;

function parsePhotos(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_PHOTOS).map(d => {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(d || ''));
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > MAX_PHOTO_BYTES) return null;
    return { type: 'image/' + m[1], buf };
  }).filter(Boolean);
}

const res = (statusCode, obj) => ({ statusCode, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return res(405, { error: 'Método não permitido' });
  if ((event.body || '').length > 2600000) return res(413, { error: 'As fotos ficaram grandes demais. Tente com menos fotos.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return res(400, { error: 'JSON inválido' }); }

  const reason = String(body.reason || '');
  const wants = String(body.wants || '');
  const details = String(body.details || '').trim().replace(/\s+\n/g, '\n').slice(0, 1000);
  if (!REASONS[reason]) return res(400, { error: 'Escolha o motivo' });
  if (!WANTS[wants]) return res(400, { error: 'Escolha se prefere trocar ou devolver' });
  if (wants === 'troca' && details.length < 3) return res(400, { error: 'Conte para qual produto, tamanho ou cor você quer trocar' });
  if (reason === 'outro' && details.length < 3) return res(400, { error: 'Conte um pouquinho o motivo' });

  try {
    const v = await verifyOrderAccess(event, body);
    if (!v.ok) {
      if (v.statusCode === 409) {
        return res(409, { error: v.status === 'cancelado'
          ? 'Este pedido foi cancelado.'
          : 'Este pedido ainda não foi enviado. Para cancelar ou mudar algo, fale com a gente no WhatsApp.' });
      }
      return res(v.statusCode, { error: v.error, needPhone: !!v.needPhone });
    }
    const order = v.order;

    if (isOpen(order.returnRequest)) {
      return res(409, { error: 'Já existe uma solicitação aberta para este pedido. Acompanhe por aqui ou fale com a gente no WhatsApp.' });
    }
    const dAt = deliveredAt(order);
    if (dAt && Date.now() - new Date(dAt).getTime() > MAX_DAYS * 864e5) {
      return res(409, { error: `O prazo de ${MAX_DAYS} dias depois da entrega já passou. Fale com a gente no WhatsApp que a gente te ajuda.` });
    }

    // itens escolhidos (conferidos com o pedido)
    const view = itemsView(order);
    const picked = [];
    for (const it of (Array.isArray(body.items) ? body.items : []).slice(0, 50)) {
      const idx = parseInt(it && it.idx, 10);
      const line = view[idx];
      if (!line) continue;
      const max = Math.max(1, parseInt(line.qty, 10) || 1);
      const qty = Math.min(max, Math.max(1, parseInt(it.qty, 10) || 1));
      if (picked.some(p => p.idx === idx)) continue;
      picked.push({ idx, title: line.title, sub: line.sub || '', qty, img: line.img || '' });
    }
    if (!picked.length) return res(400, { error: 'Marque qual produto você quer trocar ou devolver' });

    const incoming = parsePhotos(body.photos);
    if (Array.isArray(body.photos) && body.photos.length && !incoming.length) {
      return res(400, { error: 'Não conseguimos ler as fotos. Tente outras imagens.' });
    }

    const now = new Date().toISOString();
    const id = 'R' + Date.now().toString(36);
    const photos = [];
    if (incoming.length) {
      const photoStore = blobStore('return-photos', event);
      for (let i = 0; i < incoming.length; i++) {
        const key = `${v.orderNsu}_${id}${i}`.replace(/[^A-Za-z0-9_-]/g, '');
        await photoStore.set(key, incoming[i].buf, { metadata: { type: incoming[i].type } });
        photos.push(key);
      }
    }

    if (order.returnRequest) {
      order.returnHistory = Array.isArray(order.returnHistory) ? order.returnHistory : [];
      order.returnHistory.push(order.returnRequest);
    }
    order.returnRequest = {
      id, status: 'em_analise', createdAt: now, updatedAt: now,
      reason, wants, details, items: picked, photos, reply: '',
      deliveredAt: dAt || null,
      history: [{ at: now, status: 'em_analise' }]
    };

    await notifyStoreReturn(order);
    await notifyReturn(order, 'em_analise');
    await blobStore('orders', event).setJSON(order.order_nsu || v.orderNsu, order);

    return res(200, { success: true, returnRequest: publicReturn(order.returnRequest) });
  } catch (err) {
    console.error('Erro ao registrar troca/devolução:', err);
    return res(500, { error: 'Não conseguimos registrar agora. Tente de novo ou fale com a gente no WhatsApp.' });
  }
};
