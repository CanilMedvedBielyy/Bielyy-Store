// Lalamove: cotação de frete de moto em tempo real (API v3)
//
// Chaves no painel da Cloudflare (Variables and Secrets, tipo Secret):
//   LALAMOVE_API_KEY     (começa com pk_test_ no Sandbox, pk_prod_ na Produção)
//   LALAMOVE_API_SECRET  (começa com sk_test_ / sk_prod_)
//   LALAMOVE_ENV         (opcional: "sandbox" ou "production"; sem ele, o site
//                         descobre pelo começo da chave)
//
// O site só COTA (pede o preço). Ele nunca cria corrida nem gasta saldo.

const crypto = require('crypto');
const { blobStore } = require('./blobs');

const MARKET = 'BR';
const SP_LOCODE = 'BR_SAO';
const CITIES_TTL_MS = 12 * 60 * 60 * 1000;

function creds() {
  const key = String(process.env.LALAMOVE_API_KEY || '').trim();
  const secret = String(process.env.LALAMOVE_API_SECRET || '').trim();
  if (!key || !secret) return null;
  const forced = String(process.env.LALAMOVE_ENV || '').trim().toLowerCase();
  const sandbox = forced ? !/^prod/.test(forced) : !/prod/i.test(key);
  return { key, secret, sandbox, base: sandbox ? 'https://rest.sandbox.lalamove.com' : 'https://rest.lalamove.com' };
}

function status() {
  const c = creds();
  return c ? { configured: true, sandbox: c.sandbox } : { configured: false };
}

// Assinatura HMAC-SHA256 exigida pela Lalamove
function sign(secret, time, method, path, bodyStr) {
  const raw = `${time}\r\n${method}\r\n${path}\r\n\r\n${bodyStr}`;
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

class LalamoveError extends Error {
  constructor(code, message, httpStatus) { super(message); this.code = code; this.httpStatus = httpStatus; }
}

async function call(method, path, body, timeoutMs) {
  const c = creds();
  if (!c) throw new LalamoveError('NO_KEYS', 'Chaves do Lalamove não configuradas no Cloudflare');
  const time = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const headers = {
    Authorization: `hmac ${c.key}:${time}:${sign(c.secret, time, method, path, bodyStr)}`,
    Market: MARKET,
    'Request-ID': crypto.randomUUID(),
    Accept: 'application/json'
  };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(c.base + path, { method, headers, body: body ? bodyStr : undefined, signal: AbortSignal.timeout(timeoutMs || 6000) });
  let j = null;
  try { j = await r.json(); } catch (e) { /* sem corpo */ }
  if (!r.ok) {
    const e = (j && Array.isArray(j.errors) && j.errors[0]) || {};
    const code = e.id || e.code || (r.status === 401 ? 'ERR_UNAUTHORIZED' : 'HTTP_' + r.status);
    throw new LalamoveError(code, e.message || e.detail || ('HTTP ' + r.status), r.status);
  }
  return (j && j.data) || j;
}

// Mensagem em português para mostrar no painel
function explain(err, sandbox) {
  const code = (err && err.code) || '';
  const map = {
    NO_KEYS: 'As chaves do Lalamove não estão no Cloudflare (LALAMOVE_API_KEY e LALAMOVE_API_SECRET).',
    ERR_UNAUTHORIZED: 'O Lalamove recusou as chaves. Confira se copiou a API Key e o API Secret certos, sem espaço no começo ou no fim.',
    HTTP_401: 'O Lalamove recusou as chaves. Confira se copiou a API Key e o API Secret certos, sem espaço no começo ou no fim.',
    ERR_OUT_OF_SERVICE_AREA: 'Endereço fora da área do Lalamove.' + (sandbox ? ' No modo Sandbox (teste) o Lalamove só atende algumas cidades, então São Paulo pode dar esse erro até você usar as chaves de Produção.' : ''),
    ERR_INVALID_SERVICE_TYPE: 'Esse veículo não existe nessa cidade. Clique em "Ver veículos" e escolha outro.',
    ERR_INVALID_MARKET: 'O Lalamove não reconheceu o mercado Brasil para essas chaves.',
    ERR_REVERSE_GEOCODE_FAILURE: 'O Lalamove não conseguiu localizar o endereço.',
    ERR_INVALID_FIELD: 'O Lalamove recusou algum dado do pedido de cotação.'
  };
  if (err && err.name === 'TimeoutError') return 'O Lalamove demorou demais para responder.';
  return (map[code] || 'Erro do Lalamove') + (code && !map[code] ? ` (${code}: ${err.message})` : '');
}

// ---------- Cidades e veículos ----------
async function getCities(event, force) {
  const c = creds();
  const cacheKey = 'lalamove-cities-' + (c && c.sandbox ? 'sandbox' : 'prod');
  let store = null;
  try { store = blobStore('config', event); } catch (e) { /* sem cache */ }
  if (store && !force) {
    try {
      const hit = await store.get(cacheKey, { type: 'json' });
      if (hit && hit.at && Date.now() - hit.at < CITIES_TTL_MS && Array.isArray(hit.cities)) return hit.cities;
    } catch (e) { /* ignora */ }
  }
  const data = await call('GET', '/v3/cities', null, 8000);
  const cities = (Array.isArray(data) ? data : []).map(ct => ({
    locode: ct.locode,
    name: ct.name,
    services: (ct.services || []).map(s => ({
      key: s.key,
      description: s.description || '',
      loadKg: s.load && Number(s.load.value) || null,
      dims: s.dimensions ? ['length', 'width', 'height'].map(k => s.dimensions[k] && s.dimensions[k].value).filter(Boolean).join(' x ') + (s.dimensions.length && s.dimensions.length.unit ? ' ' + s.dimensions.length.unit : '') : ''
    }))
  }));
  if (store) { try { await store.setJSON(cacheKey, { at: Date.now(), cities }); } catch (e) { /* ignora */ } }
  return cities;
}

function findSaoPaulo(cities) {
  return cities.find(c => c.locode === SP_LOCODE) || cities.find(c => /s[aã]o paulo/i.test(c.name || '')) || null;
}

// Escolhe a moto: o veículo cujo nome/descrição fala em moto; senão, o de menor carga
function pickMoto(services) {
  if (!services || !services.length) return '';
  const moto = services.find(s => /moto/i.test(s.key + ' ' + s.description));
  if (moto) return moto.key;
  return services.slice().sort((a, b) => (a.loadKg || 9e9) - (b.loadKg || 9e9))[0].key;
}

async function resolveServiceType(preferred, event) {
  if (preferred) return preferred;
  const cities = await getCities(event);
  const sp = findSaoPaulo(cities);
  return pickMoto(sp ? sp.services : (cities[0] && cities[0].services) || []);
}

// ---------- Cotação ----------
function stop(p) {
  const address = [p.street, p.district, p.city ? p.city + ' - SP' : '', 'Brasil'].filter(Boolean).join(', ');
  return { coordinates: { lat: String(p.lat), lng: String(p.lng) }, address };
}

// from/to: { lat, lng, street, district, city } (o que o geocodeCep devolve)
// Devolve { ok:true, total, currency, km, serviceType, sandbox } ou { ok:false, code, error, sandbox }
async function quoteCoords(from, to, opts, event) {
  opts = opts || {};
  const c = creds();
  if (!c) return { ok: false, code: 'NO_KEYS', error: explain({ code: 'NO_KEYS' }), configured: false };
  try {
    const serviceType = await resolveServiceType(opts.serviceType, event);
    if (!serviceType) return { ok: false, code: 'NO_SERVICE', error: 'Não encontrei nenhum veículo do Lalamove para escolher.', sandbox: c.sandbox };
    const data = await call('POST', '/v3/quotations', {
      data: { serviceType, language: 'pt_BR', stops: [stop(from), stop(to)], isRouteOptimized: false }
    }, opts.timeoutMs || 6000);
    const pb = data.priceBreakdown || {};
    const total = Number(pb.total);
    if (!Number.isFinite(total) || total <= 0) return { ok: false, code: 'NO_PRICE', error: 'O Lalamove respondeu sem preço.', sandbox: c.sandbox };
    const dist = data.distance || {};
    const km = dist.value != null ? Math.round((dist.unit === 'mi' ? Number(dist.value) * 1.609 : Number(dist.value) / 1000) * 10) / 10 : null;
    return { ok: true, total: Math.round(total * 100) / 100, currency: pb.currency || 'BRL', km, serviceType, sandbox: c.sandbox, expiresAt: data.expiresAt || null };
  } catch (err) {
    console.warn('Lalamove:', err && (err.code || err.name), err && err.message);
    return { ok: false, code: err.code || err.name || 'ERRO', error: explain(err, c.sandbox), sandbox: c.sandbox };
  }
}

// Preço para a cliente: custo do Lalamove + margem, arredondado para cima em ,90
function priceFrom(total, markupPct) {
  const x = Number(total) * (1 + Math.max(0, Number(markupPct) || 0) / 100);
  const n = Math.ceil(Math.round((x - 0.9) * 100) / 100);
  return Math.round((n + 0.9) * 100) / 100;
}

module.exports = { creds, status, sign, call, getCities, findSaoPaulo, pickMoto, quoteCoords, priceFrom, explain };
