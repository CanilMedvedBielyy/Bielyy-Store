// Netlify Function: mostra uma foto enviada numa solicitação de troca/devolução
// /.netlify/functions/return-photo?k=CHAVE&p=SENHA   (só a loja, com a senha do painel)

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
  if (!isAdminPwd(q.p)) return { statusCode: 401, body: 'Senha incorreta' };
  try {
    const res = await blobStore('return-photos', event).getWithMetadata(key, { type: 'arrayBuffer' });
    if (!res || !res.data) return { statusCode: 404, body: 'Foto não encontrada' };
    return {
      statusCode: 200,
      headers: { 'Content-Type': (res.metadata && res.metadata.type) || 'image/jpeg', 'Cache-Control': 'no-store' },
      body: Buffer.from(res.data).toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    console.error('Erro ao buscar foto da troca:', err);
    return { statusCode: 500, body: 'Erro' };
  }
};
