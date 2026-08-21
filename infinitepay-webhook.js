// Netlify Function: recebe a confirmação de pagamento da InfinitePay
// Rota automática: /.netlify/functions/infinitepay-webhook
// Configure essa URL como webhook_url no Checkout Integrado da InfinitePay.
//
// Variáveis de ambiente extras usadas aqui:
//   RESEND_API_KEY  -> chave de API do resend.com, pra mandar e-mail de aviso
//   NOTIFY_EMAIL    -> e-mail que recebe o aviso de pagamento confirmado

const { getStore } = require('@netlify/blobs');

async function sendPaidEmail(body) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  if (!apiKey || !to) {
    console.error('RESEND_API_KEY ou NOTIFY_EMAIL não configurados — e-mail de confirmação não enviado');
    return;
  }
  const paidReais = body.paid_amount ? (body.paid_amount / 100).toFixed(2) : '?';
  const metodo = body.capture_method === 'pix' ? 'Pix' : body.capture_method === 'credit_card' ? 'Cartão de crédito' : (body.capture_method || '-');
  const html = `
    <h2>✅ Pagamento confirmado — pedido #${body.order_nsu}</h2>
    <p>
      Valor pago: <strong>R$ ${paidReais}</strong><br>
      Forma de pagamento: <strong>${metodo}</strong><br>
      ${body.receipt_url ? `Comprovante: <a href="${body.receipt_url}">${body.receipt_url}</a><br>` : ''}
    </p>
    <p>Confira os dados completos do comprador no e-mail de "Novo pedido" que chegou antes com o mesmo número de pedido.</p>
  `;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: 'Bielyy Store <onboarding@resend.dev>',
      to: [to],
      subject: `✅ Pagamento confirmado — pedido #${body.order_nsu} — R$ ${paidReais}`,
      html
    })
  });
  if (!res.ok) {
    console.error('Erro ao enviar e-mail via Resend:', await res.text());
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, message: 'Método não permitido' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, message: 'JSON inválido' }) };
  }

  const orderNsu = body.order_nsu;
  if (!orderNsu) {
    return { statusCode: 400, body: JSON.stringify({ success: false, message: 'order_nsu ausente' }) };
  }

  // Manda o e-mail de confirmação — não depende do Blobs funcionar
  try {
    await sendPaidEmail(body);
  } catch (mailErr) {
    console.error('Erro ao mandar e-mail de confirmação:', mailErr);
  }

  try {
    const store = getStore('orders', { siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_ACCESS_TOKEN });
    const existing = await store.get(orderNsu, { type: 'json' });

    if (!existing) {
      // Pedido não encontrado no nosso registro, mas já confirmamos recebimento e mandamos o e-mail
      return { statusCode: 200, body: JSON.stringify({ success: true, message: null }) };
    }

    existing.status = 'pago';
    existing.paidAt = new Date().toISOString();
    existing.paid_amount = body.paid_amount;
    existing.capture_method = body.capture_method;
    existing.transaction_nsu = body.transaction_nsu;
    existing.receipt_url = body.receipt_url;

    await store.setJSON(orderNsu, existing);

    return { statusCode: 200, body: JSON.stringify({ success: true, message: null }) };
  } catch (err) {
    console.error('Erro no webhook (Blobs):', err);
    // Mesmo com erro no Blobs, o e-mail já foi enviado, então confirmamos recebimento
    return { statusCode: 200, body: JSON.stringify({ success: true, message: null }) };
  }
};
