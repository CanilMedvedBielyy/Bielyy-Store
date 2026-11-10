// Netlify Function: faz login
// Rota automática: /.netlify/functions/login

const { blobStore } = require('../lib/blobs');
const { createToken } = require('../lib/session');
const crypto = require('crypto');

function hashPassword(password, salt){
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// ---------- "Esqueci minha senha" ----------
// op 'forgot': manda um link por e-mail (serviço Resend; chave RESEND_API_KEY no painel da Cloudflare).
// op 'reset' : com o link, a cliente cria a senha nova e já entra na conta.
// O link vale 1 hora e só funciona uma vez. Sem a chave do Resend, o site manda a cliente para o WhatsApp.
const RESET_MINUTES = 60;
const SITE_URL = () => process.env.SITE_URL || 'https://bielyystore.com.br';
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const reply = (code, obj) => ({ statusCode: code, body: JSON.stringify(obj) });
const escHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendResetEmail(to, name, link) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = process.env.RESET_EMAIL_FROM || 'Bielyy Store <nao-responda@bielyystore.com.br>';
  const first = escHtml(String(name || '').trim().split(' ')[0] || '');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#3A2E52">
    <h2 style="color:#6D42B8;margin:0 0 12px">Crie sua senha nova 🐾</h2>
    <p>Oi${first ? ', ' + first : ''}! Recebemos um pedido para criar uma senha nova na sua conta da <b>Bielyy Store</b>.</p>
    <p style="margin:24px 0"><a href="${link}" style="background:#6D42B8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold;display:inline-block">Criar senha nova</a></p>
    <p style="font-size:13px;color:#6B6680">O link vale por 1 hora e só funciona uma vez. Se não foi você, é só ignorar este e-mail: sua senha continua a mesma.</p>
    <p style="font-size:13px;color:#6B6680">Com carinho, Bielyy Store 💜</p></div>`;
  const text = `Oi${first ? ', ' + first : ''}! Para criar sua senha nova na Bielyy Store, abra este link (vale por 1 hora): ${link}\nSe não foi você, ignore este e-mail.`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: 'Crie sua senha nova da Bielyy Store 🐾', html, text })
  });
  if (!r.ok) console.error('Resend recusou o e-mail:', r.status, await r.text().catch(() => ''));
  return r.ok;
}

async function forgot(body, event) {
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Digite um e-mail válido.' });
  if (!process.env.RESEND_API_KEY) return reply(200, { success: false, semEmail: true });
  const ok = { success: true }; // mesma resposta exista a conta ou não (não revela quem tem conta)
  const users = blobStore('users', event);
  const user = await users.get(email, { type: 'json' });
  if (!user) return reply(200, ok);
  const resets = blobStore('password-resets', event);
  const last = await resets.get('last:' + sha256(email), { type: 'json' }).catch(() => null);
  if (last && Date.now() - last.at < 60 * 1000) return reply(200, ok); // no máximo 1 e-mail por minuto
  const token = crypto.randomBytes(24).toString('base64url');
  await resets.setJSON(sha256(token), { email, exp: Date.now() + RESET_MINUTES * 60 * 1000 });
  await resets.setJSON('last:' + sha256(email), { at: Date.now() });
  const sent = await sendResetEmail(email, user.name, SITE_URL() + '/?redefinir=' + token);
  if (!sent) return reply(502, { error: 'Não consegui enviar o e-mail agora. Fale com a gente no WhatsApp que resolvemos na hora.' });
  return reply(200, ok);
}

async function resetPassword(body, event) {
  const token = String(body.token || '');
  const password = String(body.password || '');
  if (!token || token.length > 100) return reply(400, { error: 'Link inválido. Peça um link novo em "Esqueceu a senha?".' });
  if (password.length < 6 || password.length > 200) return reply(400, { error: 'A senha precisa ter pelo menos 6 caracteres.' });
  const resets = blobStore('password-resets', event);
  const key = sha256(token);
  const rec = await resets.get(key, { type: 'json' });
  if (!rec || !rec.email || Date.now() > rec.exp) {
    if (rec) await resets.delete(key);
    return reply(400, { error: 'Esse link venceu ou já foi usado. Peça um link novo em "Esqueceu a senha?".' });
  }
  const users = blobStore('users', event);
  const user = await users.get(rec.email, { type: 'json' });
  if (!user) return reply(400, { error: 'Conta não encontrada.' });
  const salt = crypto.randomBytes(16).toString('hex');
  await users.setJSON(rec.email, Object.assign({}, user, { salt, passwordHash: hashPassword(password, salt), migrated: false, passwordSetAt: new Date().toISOString() }));
  await resets.delete(key);
  const t = await createToken(rec.email, event);
  return reply(200, { success: true, token: t, user: { name: user.name, email: user.email || rec.email, phone: user.phone || '' } });
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

  if (body && (body.op === 'forgot' || body.op === 'reset')) {
    try {
      return body.op === 'forgot' ? await forgot(body, event) : await resetPassword(body, event);
    } catch (err) {
      console.error('Erro ao redefinir senha:', err);
      return reply(500, { error: 'Algo deu errado. Tente de novo em instantes.' });
    }
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
    if (user && user.migrated && !user.passwordHash) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Atualizamos o site da Bielyy Store 💜 Para entrar, clique em "Criar conta" e use o mesmo e-mail e telefone: você cria uma senha nova e seus pedidos continuam aqui.' }) };
    }
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
