// Netlify Function: configura a "Entrega hoje" (motoboy) pelo painel admin
// GET  -> devolve a configuração atual (precisa da senha do admin)
// POST { config }        -> salva a configuração
// POST { testCep }       -> simula a cotação para um CEP (faixas + preço real do Lalamove)
// POST { lalamoveCities } -> lista as cidades e veículos do Lalamove (para escolher a moto)

const crypto = require('crypto');
const { getConfig, saveConfig, quoteLocal, DEFAULT_CONFIG } = require('../lib/local-delivery');
const lalamove = require('../lib/lalamove');

function isAdmin(event) {
  const given = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password'])) || '';
  const real = process.env.ADMIN_PASSWORD || '';
  if (!given || !real) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

exports.handler = async function (event) {
  if (!isAdmin(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Senha incorreta' }) };
  }
  try {
    if (event.httpMethod === 'GET') {
      return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ config: await getConfig(event), defaults: DEFAULT_CONFIG, lalamove: lalamove.status() }) };
    }
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
    }
    const body = JSON.parse(event.body || '{}');
    if (body.testCep) {
      const r = await quoteLocal({ cepDestino: body.testCep, weightKg: Number(body.weightKg) || 1, subtotal: Number(body.subtotal) || 0 }, event, undefined, { withLalamove: true });
      return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ success: true, option: r.option, info: r.info, lalamove: r.lalamove || null, priceSource: r.priceSource || null }) };
    }
    if (body.lalamoveCities) {
      const st = lalamove.status();
      if (!st.configured) return { statusCode: 200, body: JSON.stringify({ success: false, status: st, error: lalamove.explain({ code: 'NO_KEYS' }) }) };
      try {
        const cities = await lalamove.getCities(event, true);
        const sp = lalamove.findSaoPaulo(cities);
        return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ success: true, status: st, cities: cities.map(c => ({ locode: c.locode, name: c.name })), saoPaulo: sp, suggested: lalamove.pickMoto(sp ? sp.services : []) }) };
      } catch (err) {
        return { statusCode: 200, body: JSON.stringify({ success: false, status: st, error: lalamove.explain(err, st.sandbox) }) };
      }
    }
    if (body.config) {
      const saved = await saveConfig(body.config, event);
      return { statusCode: 200, body: JSON.stringify({ success: true, config: saved }) };
    }
    return { statusCode: 400, body: JSON.stringify({ error: 'Nada para fazer' }) };
  } catch (err) {
    console.error('Erro na config de entrega local:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro: ' + err.message }) };
  }
};
