// E-mails automáticos da Bielyy Store (serviço Resend; chave RESEND_API_KEY no painel da Cloudflare).
// Avisa a cliente, no e-mail da conta dela, cada vez que o pedido muda de etapa:
// recebido → pagamento confirmado → em preparação → enviado (com rastreio) → entregue, ou cancelado.
// Cada aviso sai uma vez só por pedido (fica anotado em order.emailLog).
// Se o e-mail falhar, o pedido segue normalmente: o aviso nunca trava a loja.

const SITE_URL = () => (process.env.SITE_URL || 'https://bielyystore.com.br').replace(/\/+$/, '');
const FROM = () => process.env.ORDER_EMAIL_FROM || 'Bielyy Store <contato@bielyystore.com.br>';
const REPLY_TO = () => process.env.REPLY_TO_EMAIL || 'contato@bielyystore.com.br';
const WHATSAPP = 'https://wa.me/5511915971151';

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const [i, d] = v.toFixed(2).split('.');
  return 'R$ ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
};
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !validEmail(to)) return false;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM(), to: [String(to).trim()], reply_to: REPLY_TO(), subject, html, text }),
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!r.ok) console.error('Resend recusou o e-mail:', r.status, await r.text().catch(() => ''));
    return r.ok;
  } catch (e) {
    console.error('Falha ao mandar e-mail:', e && e.message);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------- montagem do e-mail do pedido ----------
function itemsOf(o) {
  if (Array.isArray(o.itemsDetailed) && o.itemsDetailed.length) {
    return o.itemsDetailed.map(i => ({
      name: (i.name || '') + (i.variant ? ` (${i.variant})` : ''),
      qty: Number(i.qty) || 1,
      total: Number(i.unitPrice) ? Number(i.unitPrice) * (Number(i.qty) || 1) : null
    }));
  }
  return (o.items || [])
    .filter(i => !/^Frete \(/.test(i.description || ''))
    .map(i => ({ name: i.description || '', qty: Number(i.quantity) || 1, total: Number(i.price) ? Number(i.price) * (Number(i.quantity) || 1) / 100 : null }));
}

function carrierOf(o) {
  if (o.carrier) return o.carrier;
  const sh = o.shipping || {};
  if (sh.local || /motoboy/i.test(sh.label || '')) return 'motoboy';
  if (/loggi/i.test(sh.label || '')) return 'loggi';
  if (/jadlog/i.test(sh.label || '')) return 'jadlog';
  return 'correios';
}

const CARRIER_TXT = { correios: 'pelos Correios', loggi: 'pela Loggi', jadlog: 'pela Jadlog', outra: 'pela transportadora' };

function content(o, kind, extra) {
  const pm = o.paymentMethod;
  const car = carrierOf(o);
  const code = String(o.trackingCode || '').trim();
  const codeIsLink = /^https?:\/\//i.test(code);
  switch (kind) {
    case 'recebido':
      return {
        subject: `Recebemos seu pedido #${o.order_nsu} 🐾`,
        title: 'Recebemos seu pedido! 💜',
        lines: [
          pm === 'whatsapp'
            ? 'Para darmos andamento, vamos combinar o pagamento pelo WhatsApp. Aceitamos Pix e cartão de crédito.'
            : pm === 'pix'
              ? 'Assim que confirmarmos o seu Pix, o pedido segue para separação e avisamos você por aqui.'
              : 'Assim que o pagamento for confirmado, o pedido segue para separação e avisamos você por aqui.'
        ],
        button: pm === 'infinitepay' && o.paymentUrl ? { label: 'Concluir pagamento', url: o.paymentUrl, note: 'Se você já pagou, pode ignorar este botão.' } : null
      };
    case 'pago':
      return {
        subject: `Pagamento confirmado · pedido #${o.order_nsu} ✅`,
        title: 'Pagamento confirmado ✅',
        lines: ['Seu pedido já está na fila de separação. Avisamos assim que ele for enviado.']
      };
    case 'em_preparacao':
      return {
        subject: `Seu pedido #${o.order_nsu} está sendo preparado 📦`,
        title: 'Estamos preparando seu pedido 📦',
        lines: ['Seu pedido está sendo separado e embalado com todo o cuidado. Avisamos assim que ele for enviado.']
      };
    case 'enviado': {
      const soCodigo = extra && extra.onlyTracking;
      if (car === 'motoboy') {
        return {
          subject: `Seu pedido #${o.order_nsu} saiu para entrega 🛵`,
          title: 'Saiu para entrega 🛵',
          lines: ['Seu pedido está a caminho com o nosso entregador.'],
          tracking: code ? { code, link: codeIsLink, label: 'Acompanhe a entrega' } : null
        };
      }
      return {
        subject: soCodigo ? `Código de rastreio do pedido #${o.order_nsu} 🚚` : `Seu pedido #${o.order_nsu} foi enviado 🚚`,
        title: soCodigo ? 'Chegou o código de rastreio 🚚' : 'Seu pedido foi enviado 🚚',
        lines: [`Seu pedido foi enviado ${CARRIER_TXT[car] || 'pela transportadora'}.` + (code ? '' : ' O código de rastreio chega em seguida, por aqui mesmo.')],
        tracking: code ? { code, link: codeIsLink, label: 'Código de rastreio' } : null
      };
    }
    case 'entregue':
      return {
        subject: `Pedido #${o.order_nsu} entregue 🎉`,
        title: 'Pedido entregue 🎉',
        lines: ['Esperamos que seu pet aproveite muito! Sua opinião é muito importante para nós e ajuda outros tutores na escolha. Avaliar leva só 1 minuto.'],
        button: { label: '⭐ Avaliar os produtos', url: SITE_URL() + '/?avaliar=' + encodeURIComponent(o.order_nsu) }
      };
    case 'cancelado':
      return {
        subject: `Pedido #${o.order_nsu} cancelado`,
        title: 'Pedido cancelado',
        lines: ['Seu pedido foi cancelado. Se tiver qualquer dúvida sobre o cancelamento, é só responder este e-mail ou chamar a gente no WhatsApp.'],
        noThanks: true
      };
    default:
      return null;
  }
}

function buildOrderEmail(o, kind, extra) {
  const c = content(o, kind, extra);
  if (!c) return null;
  const first = String((o.customer && o.customer.name) || '').trim().split(' ')[0];
  const track = SITE_URL() + '/pedido.html?pedido=' + encodeURIComponent(o.order_nsu);
  const items = itemsOf(o);
  const shown = items.slice(0, 12);
  const totalNum = Number(o.total);
  const shipping = o.shipping && (o.shipping.label || o.shipping.price != null) ? o.shipping : null;

  const rowsHtml = shown.map(i => `<tr><td style="padding:6px 0;border-bottom:1px solid #EEE7FA">${i.qty}× ${esc(i.name)}</td><td style="padding:6px 0;border-bottom:1px solid #EEE7FA;text-align:right;white-space:nowrap">${i.total != null ? esc(money(i.total)) : ''}</td></tr>`).join('')
    + (items.length > shown.length ? `<tr><td colspan="2" style="padding:6px 0;color:#6B6680">+ ${items.length - shown.length} item(ns)</td></tr>` : '')
    + (shipping ? `<tr><td style="padding:6px 0;color:#6B6680">Frete${shipping.label ? ' · ' + esc(shipping.label) : ''}</td><td style="padding:6px 0;text-align:right;color:#6B6680;white-space:nowrap">${shipping.free ? 'grátis' : (Number(shipping.price) ? esc(money(shipping.price)) : '')}</td></tr>` : '')
    + (o.coupon && o.coupon.code ? `<tr><td style="padding:6px 0;color:#6B6680">Cupom ${esc(o.coupon.code)}</td><td style="padding:6px 0;text-align:right;color:#6B6680;white-space:nowrap">${Number(o.coupon.discount) ? '− ' + esc(money(o.coupon.discount)) : ''}</td></tr>` : '')
    + (Number.isFinite(totalNum) && totalNum > 0 ? `<tr><td style="padding:10px 0 0;font-weight:bold">Total</td><td style="padding:10px 0 0;text-align:right;font-weight:bold;white-space:nowrap">${esc(money(totalNum))}</td></tr>` : '');

  const btn = (b) => `<p style="margin:22px 0 6px"><a href="${esc(b.url)}" style="background:#6D42B8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold;display:inline-block">${esc(b.label)}</a></p>${b.note ? `<p style="font-size:12.5px;color:#6B6680;margin:4px 0 0">${esc(b.note)}</p>` : ''}`;
  const trackingHtml = c.tracking
    ? `<div style="background:#F3ECFF;border-radius:12px;padding:12px 14px;margin:16px 0">${esc(c.tracking.label)}:<br>${c.tracking.link
        ? `<a href="${esc(c.tracking.code)}" style="color:#6D42B8;font-weight:bold;word-break:break-all">${esc(c.tracking.code)}</a>`
        : `<b style="font-size:17px;letter-spacing:1px">${esc(c.tracking.code)}</b>`}</div>`
    : '';

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#3A2E52;line-height:1.5">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:1px;color:#C24E7A;font-weight:bold">BIELYY STORE · PEDIDO #${esc(o.order_nsu)}</p>
  <h2 style="color:#6D42B8;margin:0 0 14px">${esc(c.title)}</h2>
  <p style="margin:0 0 10px">Oi${first ? ', ' + esc(first) : ''}!${c.noThanks ? '' : ' Obrigada por comprar na Bielyy Store.'}</p>
  ${c.lines.map(l => `<p style="margin:0 0 10px">${esc(l)}</p>`).join('')}
  ${trackingHtml}
  ${c.button ? btn(c.button) : ''}
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:20px 0 8px">${rowsHtml}</table>
  <p style="margin:22px 0 6px"><a href="${esc(track)}" style="color:#6D42B8;font-weight:bold">📦 Acompanhar meu pedido →</a></p>
  <p style="font-size:13px;color:#6B6680;margin:18px 0 0">Você também vê todos os seus pedidos em <b>Minha conta</b>, no site bielyystore.com.br. Dúvidas? É só responder este e-mail ou chamar no <a href="${WHATSAPP}" style="color:#6D42B8">WhatsApp</a>.</p>
  <p style="font-size:13px;color:#6B6680;margin:10px 0 0">Com carinho, equipe Bielyy Store 🐾</p></div>`;

  const text = [
    `Oi${first ? ', ' + first : ''}!`,
    c.title,
    ...c.lines,
    c.tracking ? `${c.tracking.label}: ${c.tracking.code}` : '',
    c.button ? `${c.button.label}: ${c.button.url}` : '',
    '',
    `Pedido #${o.order_nsu}`,
    ...shown.map(i => `${i.qty}x ${i.name}${i.total != null ? ' — ' + money(i.total) : ''}`),
    Number.isFinite(totalNum) && totalNum > 0 ? `Total: ${money(totalNum)}` : '',
    '',
    `Acompanhe seu pedido: ${track}`,
    'Dúvidas? Responda este e-mail ou chame no WhatsApp: ' + WHATSAPP,
    'Equipe Bielyy Store'
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

  return { subject: c.subject, html, text };
}

// Manda o aviso de uma etapa do pedido, uma vez só. Anota em order.emailLog
// (quem chama precisa salvar o pedido depois). Devolve true se o e-mail saiu.
async function notifyOrder(order, kind) {
  try {
    if (!order || !kind) return false;
    const to = order.accountEmail || (order.customer && order.customer.email);
    if (!validEmail(to)) return false;
    order.emailLog = order.emailLog && typeof order.emailLog === 'object' ? order.emailLog : {};
    let key = kind;
    let extra = null;
    if (kind === 'enviado') {
      const code = String(order.trackingCode || '').trim();
      key = 'enviado:' + code;
      if (order.emailLog[key]) return false;
      // já avisou o envio sem código e agora chegou o código: e-mail só do rastreio
      if (code && Object.keys(order.emailLog).some(k => k.startsWith('enviado:'))) extra = { onlyTracking: true };
    }
    if (order.emailLog[key]) return false;
    const mail = buildOrderEmail(order, kind, extra);
    if (!mail) return false;
    const ok = await sendEmail({ to, ...mail });
    if (ok) order.emailLog[key] = new Date().toISOString();
    return ok;
  } catch (e) {
    console.error('Aviso por e-mail falhou:', e && e.message);
    return false;
  }
}

module.exports = { sendEmail, notifyOrder, buildOrderEmail };
