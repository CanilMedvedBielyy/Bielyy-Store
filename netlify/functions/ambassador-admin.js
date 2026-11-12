// Netlify Function: programa de embaixadores (painel da loja, protegido pela senha do painel)
// Header "x-admin-password". POST { op, ... }:
//   get                      -> regras, embaixadores e relatório de cada um
//   settings { settings }    -> salva as regras (comissão, descontos, kit...)
//   save { ambassador, originalCode? } -> cadastra ou edita um embaixador
//   release { month }        -> libera a comissão do mês (vira crédito) e manda e-mail para cada embaixador
//   adjust { code, amount, note } -> ajuste manual de crédito (+ ou −)
//   kit { code, cycle, value, note } -> marca o kit do bimestre como entregue

const crypto = require('crypto');
const A = require('../lib/ambassadors');

function isAdmin(event) {
  const given = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password'])) || '';
  const real = process.env.ADMIN_PASSWORD || '';
  if (!given || !real) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}
const res = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function full(p, event) {
  const orders = await A.loadOrders(event);
  return { success: true, program: p, currentMonth: A.nowYm(), reports: p.ambassadors.map(a => A.report(p, a, orders)) };
}

exports.handler = async function (event) {
  if (!isAdmin(event)) return res(401, { error: 'Senha incorreta' });
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return res(400, { error: 'JSON inválido' }); }
  const op = b.op || 'get';

  try {
    const p = await A.loadProgram(event);

    if (op === 'get') return res(200, await full(p, event));

    if (op === 'settings') {
      const s = b.settings || {};
      const num = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
      Object.assign(p.settings, {
        commissionPct: num(s.commissionPct, 50), discountPct: num(s.discountPct, 60),
        customerPercent: num(s.customerPercent, 60), customerKitPercent: num(s.customerKitPercent, 60),
        minSubtotal: num(s.minSubtotal, 5000), kitPct: num(s.kitPct, 50), kitMinSales: Math.round(num(s.kitMinSales, 999)),
        kitMinKit: num(s.kitMinKit, 5000), kitMinValue: num(s.kitMinValue, 500000),
        releaseDay: Math.max(1, Math.round(num(s.releaseDay, 28))), creditWithDiscount: s.creditWithDiscount !== false
      });
      await A.saveProgram(p, event);
      return res(200, await full(p, event));
    }

    if (op === 'save') {
      const x = b.ambassador || {};
      const code = A.clean(x.code, 20).toUpperCase().replace(/\s+/g, '');
      const email = A.lower(x.email);
      if (!A.validCode(code)) return res(400, { error: 'Código do cupom inválido: use de 3 a 20 letras e números, sem espaço (e diferente dos cupons da loja).' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res(400, { error: 'Informe o e-mail da conta do embaixador no site.' });
      const orig = b.originalCode ? String(b.originalCode).toUpperCase() : null;
      const existing = orig ? A.findByCode(p, orig) : null;
      if (A.findByCode(p, code) && (!existing || existing.code !== code)) return res(409, { error: 'Já existe um embaixador com esse código.' });
      if (p.ambassadors.some(a => a !== existing && a.active !== false && A.lower(a.email) === email)) return res(409, { error: 'Esse e-mail já é de outro embaixador ativo.' });
      if (existing && existing.code !== code && p.releases.some(r => r.code === existing.code)) {
        return res(409, { error: 'Esse embaixador já tem comissão liberada: o código não pode mudar (crie um novo, se precisar).' });
      }
      const data = {
        code, email, name: A.clean(x.name, 80), pet: A.clean(x.pet, 60), instagram: A.clean(x.instagram, 60).replace(/^@/, ''),
        phone: A.clean(x.phone, 30), startMonth: /^\d{4}-\d{2}$/.test(x.startMonth || '') ? x.startMonth : A.nowYm(),
        active: x.active !== false
      };
      if (existing) Object.assign(existing, data);
      else p.ambassadors.push(Object.assign({ createdAt: new Date().toISOString() }, data));
      await A.saveProgram(p, event);
      return res(200, await full(p, event));
    }

    if (op === 'release') {
      const month = String(b.month || '');
      if (!/^\d{4}-\d{2}$/.test(month)) return res(400, { error: 'Mês inválido' });
      if (month >= A.nowYm()) return res(400, { error: 'Só dá para liberar meses que já terminaram.' });
      const orders = await A.loadOrders(event);
      const done = [];
      for (const a of p.ambassadors) {
        if (p.releases.some(r => r.code === a.code && r.month === month)) continue;
        const rep = A.report(p, a, orders);
        const m = rep.months.find(x => x.ym === month);
        if (!m || !(m.commission > 0)) continue;
        const rel = { id: id(), code: a.code, month, amount: A.r2(m.commission), sales: m.sales, base: A.r2(m.base), pct: p.settings.commissionPct, at: new Date().toISOString() };
        p.releases.push(rel);
        done.push({ a, rel });
      }
      if (!done.length) return res(200, Object.assign(await full(p, event), { released: [], message: 'Nada para liberar nesse mês (sem comissão ou já liberado).' }));
      await A.saveProgram(p, event);
      // e-mails depois de salvar: se algum falhar, o crédito já está garantido
      const orders2 = await A.loadOrders(event);
      for (const d of done) {
        const avail = A.report(p, d.a, orders2).available;
        d.rel.emailed = await A.notifyRelease(d.a, d.rel, avail).catch(() => false);
      }
      await A.saveProgram(p, event);
      return res(200, Object.assign(await full(p, event), { released: done.map(d => ({ code: d.a.code, name: d.a.name, amount: d.rel.amount, emailed: !!d.rel.emailed })) }));
    }

    if (op === 'adjust') {
      const a = A.findByCode(p, b.code);
      const amount = A.r2(b.amount);
      if (!a) return res(404, { error: 'Embaixador não encontrado' });
      if (!amount) return res(400, { error: 'Informe o valor (positivo para dar crédito, negativo para tirar).' });
      p.adjustments.push({ id: id(), code: a.code, amount, note: A.clean(b.note, 120) || (amount > 0 ? 'Crédito extra da loja' : 'Ajuste da loja'), at: new Date().toISOString() });
      await A.saveProgram(p, event);
      return res(200, await full(p, event));
    }

    if (op === 'kit') {
      const a = A.findByCode(p, b.code);
      if (!a) return res(404, { error: 'Embaixador não encontrado' });
      const cycle = String(b.cycle || '');
      if (!/^\d{4}-\d{2}$/.test(cycle)) return res(400, { error: 'Bimestre inválido' });
      p.kits = p.kits.filter(k => !(k.code === a.code && k.cycle === cycle));
      if (b.undo !== true) p.kits.push({ code: a.code, cycle, value: A.r2(b.value), note: A.clean(b.note, 160), deliveredAt: new Date().toISOString() });
      await A.saveProgram(p, event);
      return res(200, await full(p, event));
    }

    return res(400, { error: 'Operação desconhecida' });
  } catch (err) {
    console.error('Erro no painel de embaixadores:', err);
    return res(500, { error: 'Erro ao salvar. Tente de novo.' });
  }
};
