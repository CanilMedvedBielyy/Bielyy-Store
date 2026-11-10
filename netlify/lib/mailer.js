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
const imgPath = (v) => { const t = String(v || '').trim().slice(0, 200); return /^\/?[A-Za-z0-9_\-.]+(\/[A-Za-z0-9_\-.]+)*(\?[A-Za-z0-9_\-.=&%]*)?$/.test(t) && !t.includes('..') ? t : ''; };
const absUrl = (p) => p ? SITE_URL() + '/' + p.replace(/^\/+/, '') : '';
const cut = (t, n) => { t = String(t || '').trim(); return t.length > n ? t.slice(0, n - 1).trim() + '…' : t; };

// Separa "Kit X (opção): itens" em título curto + linha de detalhe
function splitName(name, variant) {
  const m = String(name || '').match(/^(.*?) \(([^)]*)\)(?::\s*[\s\S]*)?$/);
  if (m) return { title: m[1], sub: m[2] };
  return { title: String(name || ''), sub: variant || '' };
}

function itemsOf(o) {
  if (Array.isArray(o.itemsDetailed) && o.itemsDetailed.length) {
    return o.itemsDetailed.map(i => {
      const n = splitName(i.name, i.variant);
      return {
        title: n.title, sub: n.sub,
        qty: Number(i.qty) || 1,
        total: Number(i.unitPrice) ? Number(i.unitPrice) * (Number(i.qty) || 1) : null,
        img: absUrl(imgPath(i.img))
      };
    });
  }
  return (o.items || [])
    .filter(i => !/^Frete \(/.test(i.description || ''))
    .map(i => {
      const n = splitName(i.description, '');
      return { title: n.title, sub: n.sub, qty: Number(i.quantity) || 1, total: Number(i.price) ? Number(i.price) * (Number(i.quantity) || 1) / 100 : null, img: '' };
    });
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

const STEPS = [['recebido', 'Pedido'], ['pago', 'Pagamento'], ['em_preparacao', 'Preparo'], ['enviado', 'Envio'], ['entregue', 'Entregue']];
const ICON = { recebido: '🛍️', pago: '✅', em_preparacao: '📦', enviado: '🚚', entregue: '🎉', cancelado: '💜' };
const C = { roxo: '#6D42B8', rosa: '#C24E7A', tinta: '#3A2E52', suave: '#6B6680', lilas: '#F3ECFF', borda: '#E9E0F7', fundo: '#F6F1FF' };

function stepsHtml(kind) {
  const at = STEPS.findIndex(s => s[0] === kind);
  if (at < 0) return '';
  const cells = STEPS.map(([k, label], i) => {
    const done = i <= at;
    return `<td align="center" style="width:20%;padding:0 2px;vertical-align:top">
      <div style="width:26px;height:26px;line-height:26px;border-radius:13px;margin:0 auto;font-size:13px;font-weight:bold;color:${done ? '#ffffff' : C.suave};background:${done ? C.roxo : C.borda}">${done ? '✓' : i + 1}</div>
      <div style="font-size:11px;margin-top:5px;color:${i === at ? C.roxo : C.suave};font-weight:${i === at ? 'bold' : 'normal'}">${label}</div></td>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr>${cells}</tr></table>`;
}

function buildOrderEmail(o, kind, extra) {
  const c = content(o, kind, extra);
  if (!c) return null;
  const first = String((o.customer && o.customer.name) || '').trim().split(' ')[0];
  const track = SITE_URL() + '/pedido.html?pedido=' + encodeURIComponent(o.order_nsu);
  const logo = SITE_URL() + '/site-asset-0.jpg';
  const items = itemsOf(o);
  const shown = items.slice(0, 10);
  const totalNum = Number(o.total);
  const shipping = o.shipping && (o.shipping.label || o.shipping.price != null) ? o.shipping : null;
  const font = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif";

  const btn = (b, secondary) => `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto 0"><tr><td align="center" bgcolor="${secondary ? '#ffffff' : C.roxo}" style="border-radius:999px;${secondary ? `border:2px solid ${C.roxo};` : ''}">
    <a href="${esc(b.url)}" style="display:inline-block;padding:13px 28px;${font};font-size:15px;font-weight:bold;color:${secondary ? C.roxo : '#ffffff'};text-decoration:none;border-radius:999px">${esc(b.label)}</a></td></tr></table>`
    + (b.note ? `<p style="margin:8px 0 0;text-align:center;font-size:12px;color:${C.suave}">${esc(b.note)}</p>` : '');

  const trackingHtml = c.tracking ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0"><tr><td align="center" style="background:${C.lilas};border:2px dashed #C9B4EE;border-radius:14px;padding:16px">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${C.suave}">${esc(c.tracking.label)}</div>
      ${c.tracking.link
        ? `<a href="${esc(c.tracking.code)}" style="display:inline-block;margin-top:6px;font-size:15px;font-weight:bold;color:${C.roxo};word-break:break-all">Abrir acompanhamento da entrega →</a>`
        : `<div style="margin-top:6px;font-size:22px;font-weight:bold;letter-spacing:2px;color:${C.roxo}">${esc(c.tracking.code)}</div>`}
    </td></tr></table>` : '';

  const itemRows = shown.map(i => `<tr>
      <td width="64" style="padding:10px 12px 10px 0;vertical-align:middle">${i.img
        ? `<img src="${esc(i.img)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:12px;object-fit:cover;background:${C.lilas};border:1px solid ${C.borda}">`
        : `<div style="width:56px;height:56px;line-height:56px;border-radius:12px;background:${C.lilas};text-align:center;font-size:24px">🐾</div>`}</td>
      <td style="padding:10px 0;vertical-align:middle;font-size:14px;color:${C.tinta}">
        <div style="font-weight:bold;line-height:1.3">${esc(cut(i.title, 70))}</div>
        ${i.sub ? `<div style="font-size:12px;color:${C.suave};line-height:1.35;margin-top:3px">${esc(cut(i.sub, 90))}</div>` : ''}
        <div style="font-size:12px;color:${C.suave};margin-top:3px">Qtd: ${i.qty}</div></td>
      <td align="right" style="padding:10px 0 10px 10px;vertical-align:middle;font-size:14px;font-weight:bold;color:${C.tinta};white-space:nowrap">${i.total != null ? esc(money(i.total)) : ''}</td>
    </tr>`).join(`<tr><td colspan="3" style="border-top:1px solid ${C.borda};font-size:0;line-height:0">&nbsp;</td></tr>`)
    + (items.length > shown.length ? `<tr><td colspan="3" style="padding:8px 0;font-size:13px;color:${C.suave}">+ ${items.length - shown.length} item(ns)</td></tr>` : '');

  const line = (label, value, strong) => `<tr><td style="padding:4px 0;font-size:${strong ? 16 : 13}px;color:${strong ? C.tinta : C.suave};${strong ? 'font-weight:bold;' : ''}">${label}</td><td align="right" style="padding:4px 0;font-size:${strong ? 18 : 13}px;color:${strong ? C.roxo : C.suave};white-space:nowrap;${strong ? 'font-weight:bold;' : ''}">${value}</td></tr>`;
  const totals = (shipping ? line('Frete' + (shipping.label ? ' · ' + esc(shipping.label) : ''), shipping.free ? 'grátis 💜' : (Number(shipping.price) ? esc(money(shipping.price)) : '—')) : '')
    + (o.coupon && o.coupon.code && Number(o.coupon.discount) ? line('Cupom ' + esc(o.coupon.code), '− ' + esc(money(o.coupon.discount))) : '')
    + (Number.isFinite(totalNum) && totalNum > 0 ? line('Total', esc(money(totalNum)), true) : '');

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.fundo}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.lines[0] || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.fundo}" style="background:${C.fundo}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;${font};color:${C.tinta}">

  <tr><td align="center" style="padding:0 0 14px">
    <img src="${esc(logo)}" width="76" height="76" alt="Bielyy Store" style="display:block;width:76px;height:76px;border-radius:38px;border:3px solid #ffffff">
  </td></tr>

  <tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:22px;padding:30px 26px 28px;border:1px solid ${C.borda}">
    <div style="text-align:center">
      <div style="width:64px;height:64px;line-height:64px;border-radius:32px;background:${C.lilas};margin:0 auto;font-size:30px">${ICON[kind] || '🐾'}</div>
      <div style="margin-top:14px;font-size:12px;letter-spacing:1.5px;color:${C.rosa};font-weight:bold">PEDIDO #${esc(o.order_nsu)}</div>
      <h1 style="margin:6px 0 12px;font-size:24px;line-height:1.25;color:${C.roxo}">${esc(String(c.title).replace(/\s*[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F]+$/u, ''))}</h1>
      <p style="margin:0 0 6px;font-size:15px;line-height:1.55">Oi${first ? ', <b>' + esc(first) + '</b>' : ''}!${c.noThanks ? '' : ' Obrigada por comprar na Bielyy Store.'}</p>
      ${c.lines.map(l => `<p style="margin:0 0 6px;font-size:15px;line-height:1.55;color:${C.tinta}">${esc(l)}</p>`).join('')}
    </div>
    ${kind === 'cancelado' ? '' : stepsHtml(kind)}
    ${trackingHtml}
    ${c.button ? btn(c.button) : btn({ label: '📦 Acompanhar meu pedido', url: track })}
  </td></tr>

  <tr><td style="height:16px;font-size:0;line-height:0">&nbsp;</td></tr>

  <tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:22px;padding:22px 24px;border:1px solid ${C.borda}">
    <div style="font-size:16px;font-weight:bold;color:${C.tinta};margin-bottom:6px">Seu pedido</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-top:2px solid ${C.borda};padding-top:8px">${totals}</table>
    ${c.button ? btn({ label: '📦 Acompanhar meu pedido', url: track }, true) : ''}
  </td></tr>

  <tr><td align="center" style="padding:22px 16px 6px;font-size:13px;line-height:1.6;color:${C.suave}">
    Dúvidas? É só responder este e-mail ou chamar no <a href="${WHATSAPP}" style="color:${C.roxo};font-weight:bold">WhatsApp</a>.<br>
    Você também acompanha tudo em <b>Minha conta</b> no site.<br><br>
    Com carinho, equipe <b style="color:${C.roxo}">Bielyy Store</b> 🐾<br>
    <a href="${SITE_URL()}" style="color:${C.suave}">bielyystore.com.br</a>
  </td></tr>

</table></td></tr></table></body></html>`;

  const text = [
    `Oi${first ? ', ' + first : ''}!`,
    c.title,
    ...c.lines,
    c.tracking ? `${c.tracking.label}: ${c.tracking.code}` : '',
    c.button ? `${c.button.label}: ${c.button.url}` : '',
    '',
    `Pedido #${o.order_nsu}`,
    ...shown.map(i => `${i.qty}x ${i.title}${i.sub ? ' (' + cut(i.sub, 90) + ')' : ''}${i.total != null ? ' — ' + money(i.total) : ''}`),
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
