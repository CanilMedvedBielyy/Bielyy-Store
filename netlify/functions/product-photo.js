// Netlify Function: foto de produto enviada pelo painel admin
// /.netlify/functions/product-photo?k=CHAVE
const { blobStore } = require('../lib/blobs');

exports.handler = async function (event) {
  const key = String((event.queryStringParameters || {}).k || '');
  if (!/^p\d{1,9}_[a-z0-9]{4,16}$/.test(key)) return { statusCode: 400, body: 'Foto inválida' };
  try {
    const res = await blobStore('product-photos', event).getWithMetadata(key, { type: 'arrayBuffer' });
    if (!res || !res.data) return { statusCode: 404, body: 'Foto não encontrada' };
    return {
      statusCode: 200,
      headers: { 'Content-Type': (res.metadata && res.metadata.type) || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' },
      body: Buffer.from(res.data).toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    console.error('Erro ao buscar foto do produto:', err);
    return { statusCode: 500, body: 'Erro' };
  }
};
