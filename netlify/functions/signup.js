// Netlify Function: cria uma conta nova
// Rota automática: /.netlify/functions/signup

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

  const { name, email, password } = body;
  if (!name || !email || !password) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Preencha nome, e-mail e senha' }) };
  }
  if (password.length < 6) {
    return { statusCode: 400, body: JSON.stringify({ error: 'A senha precisa ter pelo menos 6 caracteres' }) };
  }

  const emailKey = email.trim().toLowerCase();

  try {
    const store = getStore('users');
    const existing = await store.get(emailKey, { type: 'json' });
    if (existing) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Já existe uma conta com esse e-mail' }) };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);

    await store.setJSON(emailKey, {
      name,
      email: emailKey,
      salt,
      passwordHash,
      createdAt: new Date().toISOString()
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, user: { name, email: emailKey } }) };
  } catch (err) {
    console.error('Erro no cadastro:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao criar conta', details: err.message }) };
  }
};
