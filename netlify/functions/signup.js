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
    // Conta trazida na mudança de hospedagem (sem senha): a cliente cria uma senha nova
    // confirmando o mesmo telefone da conta.
    const digits = (v) => String(v || '').replace(/\D/g, '').slice(-8);
    const claim = existing && existing.migrated && !existing.passwordHash;
    if (claim && (!digits(existing.phone) || digits(existing.phone) !== digits(phone))) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Já existe uma conta com esse e-mail. Para criar sua senha nova, use o mesmo telefone da conta ou fale com a gente no WhatsApp.' }) };
    }
    if (existing && !claim) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Já existe uma conta com esse e-mail. Clique em "Entrar".' }) };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);

    await store.setJSON(email, claim
      ? Object.assign({}, existing, { name: name || existing.name, salt, passwordHash, migrated: false, passwordSetAt: new Date().toISOString() })
      : { name, email, phone, salt, passwordHash, createdAt: new Date().toISOString() });

    const token = await createToken(email, event);
    return { statusCode: 200, body: JSON.stringify({ success: true, token, user: { name, email, phone } }) };
  } catch (err) {
    console.error('Erro no cadastro:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao criar conta. Tenta de novo em instantes.' }) };
  }
};
