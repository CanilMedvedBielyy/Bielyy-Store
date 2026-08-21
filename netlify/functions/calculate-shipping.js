// Netlify Function: calcula frete real via API da SuperFrete
// Rota automática: /.netlify/functions/calculate-shipping
//
// Variáveis de ambiente necessárias (configurar no painel do Netlify):
//   SUPERFRETE_TOKEN        -> token de autenticação (sandbox ou produção)
//   SUPERFRETE_BASE_URL     -> https://sandbox.superfrete.com  (teste)  OU  https://api.superfrete.com  (produção)
//   SUPERFRETE_CEP_ORIGEM   -> CEP de onde os produtos são enviados
//   SUPERFRETE_CONTACT_EMAIL-> e-mail de contato técnico, usado no header User-Agent

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

  const { cepDestino, package: pkg } = body;
  if (!cepDestino || !pkg || !pkg.weight || !pkg.height || !pkg.width || !pkg.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Envie cepDestino e package {weight,height,width,length}' }) };
  }

  const token = process.env.SUPERFRETE_TOKEN;
  const baseUrl = process.env.SUPERFRETE_BASE_URL || 'https://sandbox.superfrete.com';
  const cepOrigem = process.env.SUPERFRETE_CEP_ORIGEM;
  const contactEmail = process.env.SUPERFRETE_CONTACT_EMAIL || 'contato@bielyystore.com';

  if (!token || !cepOrigem) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Configuração ausente no servidor (token ou CEP de origem)' }) };
  }

  const payload = {
    from: { postal_code: cepOrigem.replace(/\D/g, '') },
    to: { postal_code: String(cepDestino).replace(/\D/g, '') },
    services: '1,2', // 1 = PAC, 2 = SEDEX
    options: {
      own_hand: false,
      receipt: false,
      insurance_value: 0,
      use_insurance_value: false
    },
    package: {
      height: pkg.height,
      width: pkg.width,
      length: pkg.length,
      weight: pkg.weight
    }
  };

  try {
    const response = await fetch(`${baseUrl}/api/v0/calculator`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': `Bielyy Store (${contactEmail})`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify(data) };
    }

    // Filtra só as opções sem erro e simplifica pro front-end usar direto
    const options = (Array.isArray(data) ? data : [])
      .filter(opt => !opt.has_error)
      .map(opt => ({
        id: opt.id,
        label: opt.name,
        price: parseFloat(opt.price),
        days: opt.delivery_time
      }));

    return { statusCode: 200, body: JSON.stringify({ options }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao falar com a SuperFrete', details: err.message }) };
  }
};
