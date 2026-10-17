// Entrega local no mesmo dia (motoboy / Uber Envios Moto / 99 / Lalamove)
//
// Como funciona:
// 1) Descobre as coordenadas do CEP da cliente e do CEP da loja (com cache).
// 2) Calcula a distância em linha reta e multiplica por 1,35 (estimativa do
//    caminho real pelas ruas de São Paulo).
// 3) Procura a faixa (zona) de preço fixo que cobre essa distância.
// As faixas, o horário de corte e o resto ficam guardados no Blobs e a dona
// da loja edita tudo pelo painel admin (aba "Entrega hoje").

const { blobStore } = require('./blobs');

const ROUTE_FACTOR = 1.35;

const DEFAULT_CONFIG = {
  enabled: true,
  originCep: '04210061',
  cutoffHour: 15,          // pedidos pagos até 15h saem no mesmo dia
  workDays: [1, 2, 3, 4, 5, 6], // 0=domingo ... 6=sábado
  maxWeightKg: 10,         // limite da moto
  zones: [
    { maxKm: 4, price: 12.9, freeAbove: 199 },
    { maxKm: 8, price: 21.9, freeAbove: null },
    { maxKm: 12, price: 29.9, freeAbove: null },
    { maxKm: 15, price: 35.9, freeAbove: null }
  ]
};

function sanitizeConfig(c) {
  const d = DEFAULT_CONFIG;
  c = c || {};
  const zones = (Array.isArray(c.zones) ? c.zones : d.zones)
    .map(z => ({
      maxKm: Math.max(0.5, Math.min(60, Number(z.maxKm) || 0)),
      price: Math.max(0, Math.min(500, Math.round((Number(z.price) || 0) * 100) / 100)),
      freeAbove: z.freeAbove === null || z.freeAbove === '' || z.freeAbove === undefined || !(Number(z.freeAbove) > 0) ? null : Math.round(Number(z.freeAbove) * 100) / 100
    }))
    .filter(z => z.maxKm > 0)
    .sort((a, b) => a.maxKm - b.maxKm)
    .slice(0, 8);
  const cep = String(c.originCep || d.originCep).replace(/\D/g, '');
  return {
    enabled: c.enabled === undefined ? d.enabled : !!c.enabled,
    originCep: cep.length === 8 ? cep : d.originCep,
    cutoffHour: Math.max(6, Math.min(22, parseInt(c.cutoffHour, 10) || d.cutoffHour)),
    workDays: Array.isArray(c.workDays) ? c.workDays.map(Number).filter(n => n >= 0 && n <= 6) : d.workDays,
    maxWeightKg: Math.max(1, Math.min(30, Number(c.maxWeightKg) || d.maxWeightKg)),
    zones: zones.length ? zones : d.zones
  };
}

async function getConfig(event) {
  try {
    const saved = await blobStore('config', event).get('local-delivery', { type: 'json' });
    return sanitizeConfig(saved || DEFAULT_CONFIG);
  } catch (e) {
    console.warn('Config de entrega local indisponível, usando padrão:', e.message);
    return sanitizeConfig(DEFAULT_CONFIG);
  }
}

async function saveConfig(cfg, event) {
  const clean = sanitizeConfig(cfg);
  await blobStore('config', event).setJSON('local-delivery', clean);
  return clean;
}

// ---------- Coordenadas do CEP ----------
const okCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat < 6 && lat > -34 && lng < -28 && lng > -74 && !(lat === 0 && lng === 0);

async function getJSON(url, headers) {
  const r = await fetch(url, { headers: Object.assign({ Accept: 'application/json' }, headers || {}), signal: AbortSignal.timeout(4500) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const PROVIDERS = [
  async function awesomeapi(cep) {
    const j = await getJSON(`https://cep.awesomeapi.com.br/json/${cep}`);
    return { lat: parseFloat(j.lat), lng: parseFloat(j.lng), city: j.city || '', district: j.district || '', street: j.address || '', source: 'awesomeapi' };
  },
  async function brasilapi(cep) {
    const j = await getJSON(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    const c = (j.location && j.location.coordinates) || {};
    return { lat: parseFloat(c.latitude), lng: parseFloat(c.longitude), city: j.city || '', district: j.neighborhood || '', street: j.street || '', source: 'brasilapi' };
  },
  async function viacepNominatim(cep) {
    const v = await getJSON(`https://viacep.com.br/ws/${cep}/json/`);
    if (v.erro) throw new Error('CEP inexistente');
    const q = new URLSearchParams({ format: 'json', limit: '1', country: 'Brazil', state: v.uf || '', city: v.localidade || '', street: v.logradouro || '' });
    let res = await getJSON(`https://nominatim.openstreetmap.org/search?${q}`, { 'User-Agent': 'BielyyStore/1.0 (frete local)' });
    if (!res.length && v.bairro) {
      const q2 = new URLSearchParams({ format: 'json', limit: '1', q: `${v.bairro}, ${v.localidade}, ${v.uf}, Brasil` });
      res = await getJSON(`https://nominatim.openstreetmap.org/search?${q2}`, { 'User-Agent': 'BielyyStore/1.0 (frete local)' });
    }
    if (!res.length) throw new Error('sem resultado');
    return { lat: parseFloat(res[0].lat), lng: parseFloat(res[0].lon), city: v.localidade || '', district: v.bairro || '', street: v.logradouro || '', source: 'nominatim' };
  }
];

async function geocodeCep(cep, event) {
  cep = String(cep || '').replace(/\D/g, '');
  if (cep.length !== 8) return null;
  let cache = null;
  try { cache = blobStore('geo', event); } catch (e) { /* sem cache */ }
  if (cache) {
    try {
      const hit = await cache.get(cep, { type: 'json' });
      if (hit && okCoord(hit.lat, hit.lng)) return hit;
    } catch (e) { /* ignora */ }
  }
  for (const p of PROVIDERS) {
    try {
      const g = await p(cep);
      if (g && okCoord(g.lat, g.lng)) {
        if (cache) { try { await cache.setJSON(cep, g); } catch (e) { /* ignora */ } }
        return g;
      }
    } catch (e) {
      console.warn(`Geocode ${p.name} falhou para ${cep}:`, e.message);
    }
  }
  return null;
}

function haversineKm(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- Dia da entrega ----------
function spNow(now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now || new Date());
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.find(p => p.type === 'weekday').value];
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10) % 24;
  return { wd, hour };
}
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function deliveryDay(cfg, now) {
  const { wd, hour } = spNow(now);
  if (cfg.workDays.includes(wd) && hour < cfg.cutoffHour) return { when: 'hoje', days: 0 };
  for (let i = 1; i <= 7; i++) {
    const d = (wd + i) % 7;
    if (cfg.workDays.includes(d)) return { when: i === 1 ? 'amanhã' : DAY_NAMES[d], days: i };
  }
  return { when: 'em breve', days: 1 };
}

// ---------- Cotação ----------
// Devolve { option, info } — option é null quando o CEP está fora da área.
async function quoteLocal({ cepDestino, weightKg, subtotal }, event, now) {
  const cfg = await getConfig(event);
  const info = { enabled: cfg.enabled };
  if (!cfg.enabled) return { option: null, info };
  if (weightKg && weightKg > cfg.maxWeightKg) return { option: null, info: Object.assign(info, { reason: 'peso' }) };

  const [from, to] = await Promise.all([geocodeCep(cfg.originCep, event), geocodeCep(cepDestino, event)]);
  if (!from || !to) return { option: null, info: Object.assign(info, { reason: 'cep-sem-coordenadas' }) };

  const straight = haversineKm(from, to);
  const routeKm = Math.round(straight * ROUTE_FACTOR * 10) / 10;
  Object.assign(info, { routeKm, straightKm: Math.round(straight * 10) / 10, district: to.district, city: to.city, source: to.source });

  const zone = cfg.zones.find(z => routeKm <= z.maxKm);
  if (!zone) return { option: null, info: Object.assign(info, { reason: 'fora-da-area' }) };

  const free = zone.freeAbove != null && Number(subtotal) >= zone.freeAbove;
  const day = deliveryDay(cfg, now);
  return {
    info: Object.assign(info, { zoneMaxKm: zone.maxKm }),
    option: {
      id: 'local',
      local: true,
      label: `Entrega ${day.when} (motoboy)`,
      price: free ? 0 : zone.price,
      fullPrice: zone.price,
      free,
      freeAbove: zone.freeAbove,
      days: day.days,
      when: day.when,
      km: routeKm,
      note: `Até ${zone.maxKm} km da loja · pedidos pagos até ${cfg.cutoffHour}h saem no mesmo dia`
    }
  };
}

module.exports = { quoteLocal, getConfig, saveConfig, geocodeCep, haversineKm, deliveryDay, sanitizeConfig, DEFAULT_CONFIG, ROUTE_FACTOR };
