// Netlify Function: programa de embaixadores (lado do site)
// POST { op: 'init', token? }  -> { coupons: {...cupons dos embaixadores}, me: {...} | null }
//   coupons: códigos ativos para a cliente usar no carrinho
//   me: se quem está logado é embaixador -> código, desconto próprio e crédito disponível
// POST { op: 'panel', token }  -> relatório completo do embaixador logado (painel /embaixador.html)

const { readToken } = require('../lib/session');
const A = require('../lib/ambassadors');

const res = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

exports.handler = async function (event) {
  let body = {};
  if (event.httpMethod === 'POST') { try { body = JSON.parse(event.body || '{}'); } catch (e) { return res(400, { error: 'JSON inválido' }); } }
  else if (event.httpMethod !== 'GET') return res(405, { error: 'Método não permitido' });
  const op = body.op || (event.queryStringParameters || {}).op || 'init';

  try {
    const p = await A.loadProgram(event);
    const email = body.token ? A.lower(await readToken(body.token, event).catch(() => null)) : '';
    const amb = email ? A.findByEmail(p, email) : null;

    if (op === 'init') {
      let me = null;
      if (amb) {
        const orders = await A.loadOrders(event);
        const rep = A.report(p, amb, orders);
        me = { code: amb.code, name: amb.name, discountPct: p.settings.discountPct, available: rep.available, creditWithDiscount: p.settings.creditWithDiscount };
      }
      return res(200, { coupons: A.publicCoupons(p), me });
    }

    if (op === 'panel') {
      if (!email) return res(401, { error: 'Entre na sua conta para ver o painel', needLogin: true });
      if (!amb) return res(403, { error: 'Esta conta não está cadastrada como embaixadora. Se você é embaixador da Bielyy, fale com a gente no WhatsApp.' });
      const orders = await A.loadOrders(event);
      return res(200, { success: true, report: A.report(p, amb, orders) });
    }

    return res(400, { error: 'Operação desconhecida' });
  } catch (err) {
    console.error('Erro no programa de embaixadores:', err);
    return res(500, { error: 'Não conseguimos carregar agora. Tente de novo em instantes.' });
  }
};
