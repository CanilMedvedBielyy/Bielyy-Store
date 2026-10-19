// Netlify Function: mostra a foto de uma avaliação
// /.netlify/functions/review-photo?k=CHAVE
// Fotos de avaliações aprovadas são públicas; as pendentes só aparecem com a senha do admin (&p=SENHA).

const crypto = require('crypto');
const { blobStore } = require('../lib/blobs');

function isAdminPwd(given) {
  const real = process.env.ADMIN_PASSWORD || '';
  if (!given || !real) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const key = String(q.k || '');
  if (!/^[A-Za-z0-9_-]{5,120}$/.test(key)) return { statusCode: 400, body: 'Foto inválida' };
  try {
    const reviewId = key.replace(/_[a-z0-9]+$/, '');
    const review = await blobStore('reviews', event).get(reviewId, { type: 'json' }).catch(() => null);
    if (!review || !Array.isArray(review.photos) || !review.photos.includes(key)) return { statusCode: 404, body: 'Foto não encontrada' };
    const admin = isAdminPwd(q.p);
    if (review.status !== 'approved' && !admin) return { statusCode: 404, body: 'Foto não encontrada' };

    const store = blobStore('review-photos', event);
    const res = await store.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!res || !res.data) return { statusCode: 404, body: 'Foto não encontrada' };
    return {
      statusCode: 200,
      headers: {
        'Content-Type': (res.metadata && res.metadata.type) || 'image/jpeg',
        'Cache-Control': admin ? 'no-store' : 'public, max-age=86400'
      },
      body: Buffer.from(res.data).toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    console.error('Erro ao buscar foto:', err);
    return { statusCode: 500, body: 'Erro' };
  }
};
