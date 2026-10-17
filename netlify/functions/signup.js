// Netlify Function: cria uma conta nova
// Rota automática: /.netlify/functions/signup

const { blobStore } = require('../lib/blobs');
const { createToken } = require('../lib/session');
const crypto = require('crypto');

const clean = (v, max = 120) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

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

  const name = clean(body.name);
  const email = clean(body.email).toLowerCase();
  const phone = clean(body.phone, 30);
  const password = String(body.password || '');
  if (!name || !email || !password) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Preencha nome, e-mail e senha' }) };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Digite um e-mail válido' }) };
  }
  if (password.length < 6 || password.length > 200) {
    return { statusCode: 400, body: JSON.stringify({ error: 'A senha precisa ter pelo menos 6 caracteres' }) };
  }

  try {
    const store = blobStore('users', event);
    const existing = await store.get(email, { type: 'json' });
    if (existing) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Já existe uma conta com esse e-mail. Clique em "Entrar".' }) };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);

    await store.setJSON(email, { name, email, phone, salt, passwordHash, createdAt: new Date().toISOString() });

    const token = await createToken(email, event);
    return { statusCode: 200, body: JSON.stringify({ success: true, token, user: { name, email, phone } }) };
  } catch (err) {
    console.error('Erro no cadastro:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao criar conta. Tenta de novo em instantes.' }) };
  }
};
