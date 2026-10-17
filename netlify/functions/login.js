// Netlify Function: faz login
// Rota automática: /.netlify/functions/login

const { blobStore } = require('../lib/blobs');
const { createToken } = require('../lib/session');
const crypto = require('crypto');

function hashPassword(password, salt){
  return crypto.scryptSync(password, salt, 64).toString('hex');
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

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Preencha e-mail e senha' }) };
  }

  try {
    const store = blobStore('users', event);
    const user = await store.get(email, { type: 'json' });

    const wrong = { statusCode: 401, body: JSON.stringify({ error: 'E-mail ou senha incorretos' }) };
    if (!user || !user.salt || !user.passwordHash) return wrong;

    const a = Buffer.from(hashPassword(password, user.salt), 'hex');
    const b = Buffer.from(user.passwordHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return wrong;

    const token = await createToken(email, event);
    return { statusCode: 200, body: JSON.stringify({ success: true, token, user: { name: user.name, email: user.email, phone: user.phone || '' } }) };
  } catch (err) {
    console.error('Erro no login:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao entrar. Tenta de novo em instantes.' }) };
  }
};
