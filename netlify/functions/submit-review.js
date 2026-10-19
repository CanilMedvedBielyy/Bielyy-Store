// Netlify Function: recebe a avaliação de um produto COMPRADO (compra verificada)
// Rota automática: /.netlify/functions/submit-review
// POST { order, token? , phone4?, productId, rating, comment, name? }
// A avaliação fica pendente até a loja aprovar no painel admin.

const { blobStore } = require('../lib/blobs');
const { verifyOrderAccess, reviewableItems, displayName } = require('../lib/reviews');

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 700 * 1024;
// Fotos chegam como "data:image/jpeg;base64,..." (o site já reduz o tamanho antes de enviar)
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

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }
  if ((event.body || '').length > 2600000) {
    return { statusCode: 413, body: JSON.stringify({ error: 'Texto grande demais' }) };
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const rating = parseInt(body.rating, 10);
  const comment = String(body.comment || '').trim().replace(/\s+\n/g, '\n').slice(0, 800);
  const productId = String(body.productId || '').slice(0, 20);
  if (!(rating >= 1 && rating <= 5)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Escolha de 1 a 5 estrelas' }) };
  }
  if (comment.length < 3) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Conte um pouquinho o que achou 💜' }) };
  }

  try {
    const v = await verifyOrderAccess(event, body);
    if (!v.ok) {
      return { statusCode: v.statusCode, body: JSON.stringify({ error: v.error, needPhone: !!v.needPhone }) };
    }
    const item = reviewableItems(v.order).find(i => i.productId === productId);
    if (!item) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Esse produto não está neste pedido' }) };
    }

    const store = blobStore('reviews', event);
    const id = `${productId}_${v.orderNsu}`;
    const prev = await store.get(id, { type: 'json' }).catch(() => null);
    if (prev && prev.status === 'approved') {
      return { statusCode: 409, body: JSON.stringify({ error: 'Você já avaliou este produto. Obrigada! 💜' }) };
    }

    // fotos (opcional)
    const photoStore = blobStore('review-photos', event);
    let photos = (prev && Array.isArray(prev.photos)) ? prev.photos : [];
    if (Array.isArray(body.photos)) {
      const incoming = parsePhotos(body.photos);
      if (body.photos.length && !incoming.length) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Não conseguimos ler as fotos. Tente outras imagens.' }) };
      }
      for (const k of photos) { try { await photoStore.delete(k); } catch (e) { /* ignora */ } }
      photos = [];
      const stamp = Date.now().toString(36);
      for (let i = 0; i < incoming.length; i++) {
        const key = `${id}_${stamp}${i}`;
        await photoStore.set(key, incoming[i].buf, { metadata: { type: incoming[i].type } });
        photos.push(key);
      }
    }
    await store.setJSON(id, {
      id,
      productId,
      productName: item.name,
      orderNsu: v.orderNsu,
      name: displayName(v.order, body.name),
      rating,
      comment,
      verified: true,
      photos,
      status: 'pending',
      createdAt: (prev && prev.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Erro ao salvar avaliação:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao enviar avaliação' }) };
  }
};
