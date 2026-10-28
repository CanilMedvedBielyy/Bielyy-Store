// Netlify Function: alterações do catálogo feitas no painel (público, só leitura)
// /.netlify/functions/catalog  -> { products, added, v, updatedAt }
const { getDoc } = require('../lib/catalog');

exports.handler = async function (event) {
  try {
    const doc = await getDoc(event);
    return {
      statusCode: 200,
      headers: { 'Cache-Control': 'public, max-age=20', 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: doc.products, added: doc.added, settings: doc.settings || {}, v: doc.v || 0, updatedAt: doc.updatedAt })
    };
  } catch (err) {
    console.error('Erro ao ler catálogo:', err);
    return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ products: {}, added: {}, v: 0 }) };
  }
};
