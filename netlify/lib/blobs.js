// Abre um "caderno" (store) do Netlify Blobs de forma segura.
//
// As funções deste site rodam no modo "Lambda" da Netlify. Nesse modo a
// Netlify manda as credenciais do Blobs dentro do próprio pedido (event.blobs)
// e é preciso chamar connectLambda(event) antes de usar o getStore.
// Sem isso aparece o erro "MissingBlobsEnvironmentError".
//
// Se connectLambda não funcionar por algum motivo, usamos as variáveis
// BLOBS_SITE_ID e BLOBS_ACCESS_TOKEN como plano B.
const { getStore, connectLambda } = require('@netlify/blobs');

function blobStore(name, event) {
  if (event && event.blobs && typeof connectLambda === 'function') {
    try {
      connectLambda(event);
    } catch (e) {
      console.warn('connectLambda falhou, usando variáveis de ambiente:', e.message);
    }
  }
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_ACCESS_TOKEN;
  if (siteID && token) return getStore(name, { siteID, token });
  return getStore(name);
}

module.exports = { blobStore };
