// Netlify Function: corrige o e-mail da conta de uma cliente (só pelo painel, protegida por senha)
// Rota automática: /.netlify/functions/update-user  (POST { oldEmail, newEmail })
// A cliente passa a entrar com o e-mail novo (mesma senha). Os pedidos feitos logada vão junto.

const { blobStore } = require('../lib/blobs');
const crypto = require('crypto');

function isAdmin(event) {
  const given = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password'])) || '';
  const real = process.env.ADMIN_PASSWORD || '';
  if (!given || !real) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}
const norm = (v) => String(v || '').trim().toLowerCase().slice(0, 120);

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  if (!isAdmin(event)) return { statusCode: 401, body: JSON.stringify({ error: 'Senha incorreta' }) };
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }
  const oldEmail = norm(body.oldEmail), newEmail = norm(body.newEmail);
  if (!oldEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Digite um e-mail válido' }) };
  }
  if (oldEmail === newEmail) return { statusCode: 400, body: JSON.stringify({ error: 'O e-mail novo é igual ao atual' }) };
  try {
    const users = blobStore('users', event);
    const user = await users.get(oldEmail, { type: 'json' });
    if (!user) return { statusCode: 404, body: JSON.stringify({ error: 'Conta não encontrada' }) };
    if (await users.get(newEmail, { type: 'json' })) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Já existe uma conta com esse e-mail' }) };
    }
    await users.setJSON(newEmail, Object.assign({}, user, { email: newEmail, emailChangedFrom: oldEmail, emailChangedAt: new Date().toISOString() }));
    await users.delete(oldEmail);

    // pedidos feitos logada com o e-mail antigo passam para o novo
    let moved = 0;
    const orders = blobStore('orders', event);
    const { blobs } = await orders.list();
    for (const b of blobs) {
      const o = await orders.get(b.key, { type: 'json' }).catch(() => null);
      if (o && norm(o.accountEmail) === oldEmail) { o.accountEmail = newEmail; await orders.setJSON(b.key, o); moved++; }
    }
    return { statusCode: 200, body: JSON.stringify({ success: true, email: newEmail, ordersMoved: moved }) };
  } catch (err) {
    console.error('Erro ao corrigir e-mail:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao corrigir o e-mail. Tente de novo.' }) };
  }
};
