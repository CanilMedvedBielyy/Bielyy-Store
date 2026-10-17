// Netlify Function: calcula o frete
// Rota automática: /.netlify/functions/calculate-shipping
//
// Junta duas cotações:
//  1) Entrega hoje por motoboy (preço fixo por faixa de distância — ver netlify/lib/local-delivery.js)
//  2) Correios (PAC/SEDEX) via API da SuperFrete
//
// Variáveis de ambiente da SuperFrete (painel da Netlify):
//   SUPERFRETE_TOKEN, SUPERFRETE_BASE_URL, SUPERFRETE_CEP_ORIGEM, SUPERFRETE_CONTACT_EMAIL

const { quoteLocal } = require('../lib/local-delivery');

async function superfreteQuote(cepDestino, pkg) {
  const token = process.env.SUPERFRETE_TOKEN;
  const baseUrl = process.env.SUPERFRETE_BASE_URL || 'https://sandbox.superfrete.com';
  const cepOrigem = process.env.SUPERFRETE_CEP_ORIGEM;
  const contactEmail = process.env.SUPERFRETE_CONTACT_EMAIL || 'contato@bielyystore.com';
  if (!token || !cepOrigem) throw new Error('Configuração ausente no servidor (token ou CEP de origem)');

  const payload = {
    from: { postal_code: cepOrigem.replace(/\D/g, '') },
    to: { postal_code: String(cepDestino).replace(/\D/g, '') },
    services: '1,2', // 1 = PAC, 2 = SEDEX
    options: { own_hand: false, receipt: false, insurance_value: 0, use_insurance_value: false },
    package: { height: pkg.height, width: pkg.width, length: pkg.length, weight: pkg.weight }
  };

  const response = await fetch(`${baseUrl}/api/v0/calculator`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': `Bielyy Store (${contactEmail})`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error('SuperFrete ' + response.status + ' ' + JSON.stringify(data).slice(0, 200));

  return (Array.isArray(data) ? data : [])
    .filter(opt => !opt.has_error)
    .map(opt => ({ id: opt.id, label: opt.name, price: parseFloat(opt.price), days: opt.delivery_time }));
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { cepDestino, package: pkg, subtotal } = body;
  if (!cepDestino || !pkg || !pkg.weight || !pkg.height || !pkg.width || !pkg.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Envie cepDestino e package {weight,height,width,length}' }) };
  }

  const [localRes, sfRes] = await Promise.allSettled([
    quoteLocal({ cepDestino, weightKg: Number(pkg.weight), subtotal: Number(subtotal) || 0 }, event),
    superfreteQuote(cepDestino, pkg)
  ]);

  const options = [];
  let local = null;
  if (localRes.status === 'fulfilled') {
    local = localRes.value.info;
    if (localRes.value.option) options.push(localRes.value.option);
  } else {
    console.error('Erro na entrega local:', localRes.reason);
  }
  if (sfRes.status === 'fulfilled') {
    options.push(...sfRes.value);
  } else {
    console.error('Erro SuperFrete:', sfRes.reason && sfRes.reason.message);
  }

  if (!options.length) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Não foi possível calcular o frete agora', local }) };
  }
  return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ options, local }) };
};
