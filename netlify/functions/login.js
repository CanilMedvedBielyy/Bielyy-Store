// Netlify Function: faz login
// Rota automática: /.netlify/functions/login

const { getStore } = require('@netlify/blobs');
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

  const { email, password } = body;
  if (!email || !password) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Preencha e-mail e senha' }) };
  }

  const emailKey = email.trim().toLowerCase();

  try {
    const store = getStore('users');
    const user = await store.get(emailKey, { type: 'json' });

    if (!user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'E-mail ou senha incorretos' }) };
    }

    const hash = hashPassword(password, user.salt);
    if (hash !== user.passwordHash) {
      return { statusCode: 401, body: JSON.stringify({ error: 'E-mail ou senha incorretos' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, user: { name: user.name, email: user.email } }) };
  } catch (err) {
    console.error('Erro no login:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao entrar' }) };
  }
};
