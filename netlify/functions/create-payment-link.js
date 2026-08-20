// Netlify Function: gera um link de pagamento InfinitePay
// Rota automática: /.netlify/functions/create-payment-link

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  if (!payload.handle || !Array.isArray(payload.items) || payload.items.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Payload incompleto: precisa de handle e items' }) };
  }

  try {
    const response = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify(data) };
    }

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falha ao falar com a InfinitePay', details: err.message }) };
  }
};
