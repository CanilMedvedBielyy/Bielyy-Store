// "Crachá" de login das clientes.
// Depois de entrar, a cliente recebe um token assinado (e-mail + validade).
// As funções conferem a assinatura para saber quem é, sem guardar sessão.
// A chave secreta é criada sozinha na primeira vez e fica guardada no Blobs.
const crypto = require('crypto');
const { blobStore } = require('./blobs');

const DAYS = 60;
let cachedSecret = null;

async function getSecret(event) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cachedSecret) return cachedSecret;
  const store = blobStore('config', event);
  let secret = await store.get('session-secret', { type: 'text' });
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    await store.set('session-secret', secret);
  }
  cachedSecret = secret;
  return secret;
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

async function createToken(email, event) {
  const secret = await getSecret(event);
  const payload = b64(JSON.stringify({ e: String(email).toLowerCase(), x: Date.now() + DAYS * 864e5 }));
  return payload + '.' + sign(payload, secret);
}

// Devolve o e-mail da cliente, ou null se o token for inválido/vencido
async function readToken(token, event) {
  if (!token || typeof token !== 'string' || token.length > 600 || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const secret = await getSecret(event);
  const good = sign(payload, secret);
  if (!sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.e || !data.x || Date.now() > data.x) return null;
    return data.e;
  } catch (e) {
    return null;
  }
}

module.exports = { createToken, readToken };
