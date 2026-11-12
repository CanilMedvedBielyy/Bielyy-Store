// Programa de embaixadores da Bielyy Store
// - Cada embaixador tem um cupom (código) para divulgar. A cliente ganha desconto e o embaixador ganha
//   comissão (padrão 8%) sobre o valor pago nos produtos (sem frete), nas vendas pagas do mês.
// - No dia 07 a loja libera, pelo painel, a comissão do mês anterior: ela vira CRÉDITO na conta do
//   embaixador (para comprar produtos no site) e ele recebe um e-mail.
// - O embaixador tem desconto próprio (padrão 15%) no site todo. Compras dele mesmo não geram comissão.
// - A cada 2 meses (contados do mês de entrada), quem fez o mínimo de vendas ganha um kit de
//   X% (padrão 5%) do valor vendido no bimestre.
// Tudo fica num documento só: store "ambassadors", chave "program".

const { blobStore } = require('./blobs');
const { itemsView } = require('./order-view');

const SALE = ['pago', 'em_preparacao', 'enviado', 'entregue'];
const DEFAULTS = {
  commissionPct: 8,       // comissão do embaixador sobre o valor pago nos produtos
  discountPct: 15,        // desconto do embaixador nas compras dele
  customerPercent: 10,    // desconto da cliente com o cupom do embaixador (produtos avulsos)
  customerKitPercent: 5,  // desconto da cliente nos kits
  minSubtotal: 0,         // compra mínima da cliente para usar o cupom (0 = sem mínimo)
  kitPct: 2,              // kit do bimestre = 2% do valor vendido no bimestre...
  kitMinKit: 120,         // ...e nunca menos que R$ 120 em produtos
  kitMinValue: 2400,      // meta: vender pelo menos R$ 2.400 no bimestre para ganhar o kit
  kitMinSales: 0,         // (opcional) mínimo de vendas em número; 0 = não exige
  releaseDay: 7,          // dia do mês em que a comissão é liberada
  creditWithDiscount: true // pode usar o crédito junto com o desconto de embaixador
};
// códigos que não podem virar cupom de embaixador
const RESERVED = ['BIELYY10', 'VOLTEI5', 'BIELYYFRET3', 'ERIVAM10', 'MATEUSADESTRA', 'EMBAIXADOR', '1478180803'];

const lower = (v) => String(v || '').trim().toLowerCase();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clean = (v, max = 120) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

// mês (AAAA-MM) no horário de São Paulo
const ymOf = (iso) => {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t - 3 * 3600e3).toISOString().slice(0, 7);
};
const nowYm = () => ymOf(new Date().toISOString());
const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthName = (ym) => { const [y, m] = String(ym).split('-').map(Number); return m ? `${MESES[m - 1]} de ${y}` : ym; };
const validCode = (c) => /^[A-Z0-9]{3,20}$/.test(c) && !RESERVED.includes(c);

function normalizeProgram(d) {
  d = d && typeof d === 'object' ? d : {};
  const s = Object.assign({}, DEFAULTS, d.settings || {});
  ['commissionPct', 'discountPct', 'customerPercent', 'customerKitPercent', 'minSubtotal', 'kitPct', 'kitMinKit', 'kitMinValue', 'kitMinSales', 'releaseDay']
    .forEach(k => { s[k] = Math.max(0, Number(s[k]) || 0); });
  s.creditWithDiscount = s.creditWithDiscount !== false;
  return {
    settings: s,
    ambassadors: Array.isArray(d.ambassadors) ? d.ambassadors : [],
    releases: Array.isArray(d.releases) ? d.releases : [],
    adjustments: Array.isArray(d.adjustments) ? d.adjustments : [],
    kits: Array.isArray(d.kits) ? d.kits : [],
    updatedAt: d.updatedAt || null
  };
}

async function loadProgram(event) {
  const d = await blobStore('ambassadors', event).get('program', { type: 'json' }).catch(() => null);
  return normalizeProgram(d);
}
async function saveProgram(p, event) {
  p.updatedAt = new Date().toISOString();
  await blobStore('ambassadors', event).setJSON('program', p);
}
async function loadOrders(event) {
  const store = blobStore('orders', event);
  const { blobs } = await store.list();
  return (await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' }).catch(() => null)))).filter(Boolean);
}

const activeList = (p) => p.ambassadors.filter(a => a && a.active !== false);
const findByEmail = (p, email) => { const e = lower(email); return e ? activeList(p).find(a => lower(a.email) === e) || null : null; };
const findByCode = (p, code) => { const c = String(code || '').trim().toUpperCase(); return p.ambassadors.find(a => a.code === c) || null; };

// Cupons dos embaixadores para o site (a cliente digita o código do embaixador)
function publicCoupons(p) {
  const s = p.settings, out = {};
  activeList(p).forEach(a => {
    out[a.code] = {
      percent: s.customerPercent, kitPercent: s.customerKitPercent, boxPercent: s.customerKitPercent, boxTriFixed: 10,
      commissionPct: s.commissionPct,
      minSubtotal: s.minSubtotal > 0 ? s.minSubtotal : undefined,
      ambassador: true,
      label: `${s.customerPercent}% OFF${s.customerKitPercent !== s.customerPercent ? ` (${s.customerKitPercent}% em kits)` : ''} — cupom de embaixador Bielyy${a.pet ? ' · ' + a.pet : ''}`
    };
  });
  return out;
}

// ---------- vendas e comissão ----------
function orderSubtotal(o) {
  if (o.subtotal != null && Number.isFinite(Number(o.subtotal))) return Number(o.subtotal);
  return (o.itemsDetailed || []).reduce((s, i) => s + (Number(i.unitPrice) || 0) * (Number(i.qty) || 1), 0);
}
// valor dos produtos devolvidos (troca não conta; devolução concluída desconta)
function returnedValue(o) {
  const all = [o.returnRequest].concat(Array.isArray(o.returnHistory) ? o.returnHistory : []).filter(Boolean);
  const view = itemsView(o);
  let v = 0;
  all.forEach(rr => {
    if (rr.wants !== 'devolucao' || rr.status !== 'concluida') return;
    (rr.items || []).forEach(it => {
      const line = view[it.idx];
      if (!line || !line.total) return;
      v += (Number(line.total) / Math.max(1, Number(line.qty) || 1)) * (Number(it.qty) || 1);
    });
  });
  return v;
}
// base da comissão: valor pago pelos produtos (com o desconto do cupom, sem frete), menos devoluções
function saleBase(o) {
  const sub = orderSubtotal(o);
  if (!(sub > 0)) return 0;
  const disc = o.coupon ? Number(o.coupon.discount) || 0 : 0;
  const base = Math.max(0, sub - disc);
  const ret = Math.min(sub, returnedValue(o));
  return r2(base * (1 - ret / sub));
}
const itemsShort = (o) => itemsView(o).map(i => ({ title: i.title, sub: i.sub || '', qty: i.qty, img: i.img || '' }));

function couponOrders(a, orders) {
  return orders.filter(o => o && o.coupon && String(o.coupon.code || '').toUpperCase() === a.code
    && lower(o.accountEmail) !== lower(a.email));
}

// Relatório completo de um embaixador
function report(p, a, orders) {
  const s = p.settings, pct = s.commissionPct, cur = nowYm();
  const months = {};
  const month = (ym) => months[ym] || (months[ym] = { ym, label: monthName(ym), sales: 0, base: 0, commission: 0, pending: 0, cancelled: 0, orders: [] });

  couponOrders(a, orders).forEach(o => {
    const ym = ymOf(o.createdAt); if (!ym) return;
    const m = month(ym);
    const sale = SALE.includes(o.status);
    const base = sale ? saleBase(o) : 0;
    const com = r2(base * pct / 100);
    const st = sale ? 'venda' : o.status === 'cancelado' ? 'cancelado' : 'aguardando';
    if (sale) { m.sales++; m.base = r2(m.base + base); m.commission = r2(m.commission + com); }
    else if (st === 'cancelado') m.cancelled++;
    else m.pending++;
    m.orders.push({ nsu: o.order_nsu, date: o.createdAt, status: o.status, kind: st, items: itemsShort(o), base, commission: com,
      returned: sale && returnedValue(o) > 0 });
  });
  Object.values(months).forEach(m => m.orders.sort((x, y) => new Date(y.date) - new Date(x.date)));

  // liberações (entradas), usos de crédito (saídas), estornos e ajustes
  const releases = p.releases.filter(r => r.code === a.code);
  releases.forEach(r => { const m = months[r.month]; if (m) m.released = r; });
  const adjustments = p.adjustments.filter(x => x.code === a.code);
  const uses = orders.filter(o => o && o.credit && o.credit.code === a.code && Number(o.credit.amount) > 0);

  const statement = [];
  releases.forEach(r => statement.push({ date: r.at, type: 'entrada', label: `Comissão de ${monthName(r.month)} (${r.sales} venda${r.sales === 1 ? '' : 's'})`, amount: r2(r.amount) }));
  adjustments.forEach(x => statement.push({ date: x.at, type: x.amount >= 0 ? 'entrada' : 'saida', label: x.note || 'Ajuste da loja', amount: r2(x.amount) }));
  uses.forEach(o => {
    const amt = r2(o.credit.amount);
    statement.push({ date: o.createdAt, type: 'saida', label: `Compra #${o.order_nsu}`, amount: -amt, nsu: o.order_nsu, status: o.status });
    if (o.status === 'cancelado') statement.push({ date: o.statusUpdatedAt || o.createdAt, type: 'estorno', label: `Compra #${o.order_nsu} cancelada: crédito devolvido`, amount: amt, nsu: o.order_nsu });
  });
  statement.sort((x, y) => new Date(y.date) - new Date(x.date));
  const balance = r2(statement.reduce((t, e) => t + e.amount, 0));
  const reserved = r2(uses.filter(o => o.status === 'aguardando_pagamento').reduce((t, o) => t + Number(o.credit.amount), 0));

  // kit do bimestre (ciclos de 2 meses a partir do mês de entrada)
  const start = /^\d{4}-\d{2}$/.test(a.startMonth || '') ? a.startMonth : ymOf(a.createdAt) || cur;
  const cycleOf = (ym) => addMonths(start, Math.floor(Math.max(0, monthsBetween(start, ym)) / 2) * 2);
  const cycleInfo = (c) => {
    const ms = [c, addMonths(c, 1)];
    const sales = ms.reduce((t, ym) => t + (months[ym] ? months[ym].sales : 0), 0);
    const base = r2(ms.reduce((t, ym) => t + (months[ym] ? months[ym].base : 0), 0));
    const delivered = p.kits.find(k => k.code === a.code && k.cycle === c) || null;
    const eligible = sales >= s.kitMinSales && base >= s.kitMinValue && (s.kitMinValue > 0 || s.kitMinSales > 0 || base > 0);
    return { cycle: c, months: ms, label: `${monthName(ms[0])} e ${monthName(ms[1])}`, sales, base,
      value: r2(Math.max(s.kitMinKit, base * s.kitPct / 100)), // valor do kit se bater a meta
      minSales: s.kitMinSales, minValue: s.kitMinValue, minKit: s.kitMinKit, missingValue: r2(Math.max(0, s.kitMinValue - base)),
      missingSales: Math.max(0, s.kitMinSales - sales), eligible, ended: monthsBetween(ms[1], cur) > 0, delivered };
  };
  const cycles = [];
  if (monthsBetween(start, cur) >= 0) for (let c = start; monthsBetween(c, cur) >= 0; c = addMonths(c, 2)) cycles.push(cycleInfo(c));
  const currentCycle = cycles.length ? cycles[cycles.length - 1] : cycleInfo(cycleOf(cur));

  const monthList = Object.values(months).sort((x, y) => y.ym.localeCompare(x.ym));
  if (!months[cur]) monthList.unshift(Object.assign(month(cur), {}));
  monthList.sort((x, y) => y.ym.localeCompare(x.ym));

  return {
    ambassador: { code: a.code, name: a.name, pet: a.pet || '', instagram: a.instagram || '', email: a.email, startMonth: start, active: a.active !== false },
    settings: s, currentMonth: cur, months: monthList, statement, balance, reserved,
    available: Math.max(0, balance), cycles: cycles.slice().reverse(), currentCycle,
    totals: { sales: monthList.reduce((t, m) => t + m.sales, 0), base: r2(monthList.reduce((t, m) => t + m.base, 0)), released: r2(releases.reduce((t, r) => t + r.amount, 0)) }
  };
}

// Saldo de crédito disponível para usar numa compra
function availableCredit(p, a, orders) {
  return report(p, a, orders).available;
}

// ---------- e-mail de comissão liberada ----------
const { sendEmail } = require('./mailer');
const SITE_URL = () => (process.env.SITE_URL || 'https://bielyystore.com.br').replace(/\/+$/, '');
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => { const [i, d] = (Number(n) || 0).toFixed(2).split('.'); return 'R$ ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d; };

function buildNotice({ name, kicker, title, icon, lines, highlight, rows, button }) {
  const C = { roxo: '#6D42B8', rosa: '#C24E7A', tinta: '#3A2E52', suave: '#6B6680', lilas: '#F3ECFF', borda: '#E9E0F7', fundo: '#F6F1FF' };
  const font = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif";
  const first = String(name || '').trim().split(' ')[0];
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.fundo}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.fundo}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;${font};color:${C.tinta}">
  <tr><td align="center" style="padding:0 0 14px"><img src="${SITE_URL()}/site-asset-0.jpg" width="76" height="76" alt="Bielyy Store" style="display:block;width:76px;height:76px;border-radius:38px;border:3px solid #fff"></td></tr>
  <tr><td bgcolor="#ffffff" style="background:#fff;border-radius:22px;padding:30px 26px 28px;border:1px solid ${C.borda};text-align:center">
    <div style="width:64px;height:64px;line-height:64px;border-radius:32px;background:${C.lilas};margin:0 auto;font-size:30px">${icon || '🌟'}</div>
    <div style="margin-top:14px;font-size:12px;letter-spacing:1.5px;color:${C.rosa};font-weight:bold">${esc(kicker || 'EMBAIXADOR BIELYY')}</div>
    <h1 style="margin:6px 0 12px;font-size:24px;line-height:1.25;color:${C.roxo}">${esc(title)}</h1>
    <p style="margin:0 0 6px;font-size:15px;line-height:1.55">Oi${first ? ', <b>' + esc(first) + '</b>' : ''}!</p>
    ${(lines || []).map(l => `<p style="margin:0 0 6px;font-size:15px;line-height:1.55">${esc(l)}</p>`).join('')}
    ${highlight ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0"><tr><td align="center" style="background:${C.lilas};border:2px dashed #C9B4EE;border-radius:14px;padding:16px">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${C.suave}">${esc(highlight.label)}</div>
      <div style="margin-top:6px;font-size:28px;font-weight:bold;color:${C.roxo}">${esc(highlight.value)}</div></td></tr></table>` : ''}
    ${rows && rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;text-align:left">${rows.map(([k, v]) => `<tr><td style="padding:5px 0;font-size:13px;color:${C.suave}">${esc(k)}</td><td align="right" style="padding:5px 0;font-size:13px;font-weight:bold;color:${C.tinta}">${esc(v)}</td></tr>`).join('')}</table>` : ''}
    ${button ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto 0"><tr><td align="center" bgcolor="${C.roxo}" style="border-radius:999px"><a href="${esc(button.url)}" style="display:inline-block;padding:13px 28px;${font};font-size:15px;font-weight:bold;color:#fff;text-decoration:none;border-radius:999px">${esc(button.label)}</a></td></tr></table>` : ''}
  </td></tr>
  <tr><td align="center" style="padding:22px 16px 6px;font-size:13px;line-height:1.6;color:${C.suave}">Dúvidas? É só responder este e-mail ou chamar no <a href="https://wa.me/5511915971151" style="color:${C.roxo};font-weight:bold">WhatsApp</a>.<br><br>Com carinho, equipe <b style="color:${C.roxo}">Bielyy Store</b> 🐾</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`Oi${first ? ', ' + first : ''}!`, title, ...(lines || []), highlight ? `${highlight.label}: ${highlight.value}` : '',
    ...(rows || []).map(([k, v]) => `${k}: ${v}`), button ? `${button.label}: ${button.url}` : '', '', 'Equipe Bielyy Store'].filter(Boolean).join('\n');
  return { html, text };
}

async function notifyRelease(a, release, available) {
  const { html, text } = buildNotice({
    name: a.name, icon: '💜', kicker: 'COMISSÃO LIBERADA',
    title: `Sua comissão de ${MESES[Number(release.month.split('-')[1]) - 1]} chegou!`,
    lines: ['Obrigada por divulgar a Bielyy Store. A comissão das vendas com o seu cupom já virou crédito na sua conta para escolher os produtos que quiser no site.'],
    highlight: { label: 'Crédito liberado', value: money(release.amount) },
    rows: [['Mês', monthName(release.month)], ['Vendas com o seu cupom', String(release.sales)], ['Total vendido', money(release.base)], ['Comissão', `${release.pct}%`], ['Crédito disponível agora', money(available)]],
    button: { label: '🌟 Abrir meu painel de embaixador', url: SITE_URL() + '/embaixador.html' }
  });
  return sendEmail({ to: a.email, subject: `💜 Sua comissão de ${monthName(release.month)} foi liberada: ${money(release.amount)} em crédito`, html, text });
}

// Confere cupom e crédito de embaixador num pedido novo (create-order / create-payment-link).
// Devolve { coupon, credit } ou { error, statusCode }.
async function checkOrder(event, accountEmail, coupon, creditAsked) {
  const asked = r2(creditAsked);
  const code = coupon && coupon.code ? String(coupon.code).toUpperCase() : '';
  const ambCode = code && code !== 'EMBAIXADOR';
  if (!asked && !code) return { coupon, credit: null };
  const p = await loadProgram(event);
  const me = findByEmail(p, accountEmail);
  const out = coupon ? Object.assign({}, coupon) : null;
  if (out && code === 'EMBAIXADOR') {
    if (me) { out.ambassadorSelf = me.code; out.commissionPct = null; }
    else out.invalid = 'esta conta não é de embaixador';
  } else if (out && ambCode) {
    const owner = findByCode(p, code);
    if (owner && owner.active !== false) {
      out.ambassador = owner.code;
      const self = lower(owner.email) === lower(accountEmail);
      out.commissionPct = self ? 0 : p.settings.commissionPct;
      if (self) out.self = true;
    }
  }
  if (!(asked > 0)) return { coupon: out, credit: null };
  if (!me) return { error: 'O crédito de embaixador só pode ser usado na conta do embaixador.', statusCode: 403 };
  if (code === 'EMBAIXADOR' && !p.settings.creditWithDiscount) return { error: 'O crédito não pode ser usado junto com o desconto de embaixador.', statusCode: 409 };
  const orders = await loadOrders(event);
  const available = report(p, me, orders).available;
  if (asked > available + 0.01) return { error: `Seu crédito disponível é ${money(available)}. Atualize a página e tente de novo.`, statusCode: 409, available };
  return { coupon: out, credit: { code: me.code, amount: asked } };
}

module.exports = {
  checkOrder,
  SALE, DEFAULTS, RESERVED, ymOf, nowYm, addMonths, monthName, validCode, lower, r2, clean,
  loadProgram, saveProgram, loadOrders, findByEmail, findByCode, activeList, publicCoupons,
  saleBase, report, availableCredit, notifyRelease, buildNotice, money
};
