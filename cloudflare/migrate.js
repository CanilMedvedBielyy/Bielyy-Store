// Mudança do Netlify para a Cloudflare: copia os dados que estão no Netlify
// (catálogo do painel, configurações, clientes, pedidos, avaliações e fotos)
// para o banco D1 da Cloudflare, usando as próprias funções que já estão no ar
// no Netlify (com a senha do painel). Não precisa publicar nada no Netlify.
// Pode rodar quantas vezes quiser: só atualiza o que já foi copiado.
//
// Senhas das clientes não são copiadas (o Netlify não entrega): a conta vem marcada
// como "migrated" e a cliente cria uma senha nova com o mesmo e-mail e telefone.
import { ready } from './netlify-blobs-shim.js';

const STORES = ['config', 'catalog', 'users', 'orders', 'reviews', 'product-photos', 'review-photos'];
const STEPS = ['catalog', 'config', 'users', 'orders', 'reviews', 'product-photos', 'review-photos'];
const PHOTOS_PER_CALL = 8;
const DEFAULT_SOURCE = 'https://bielyy-store.netlify.app';

const json = (data, status) => new Response(JSON.stringify(data), {
  status: status || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

async function sha(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
}
async function isAdmin(given, env) {
  const real = (env && env.ADMIN_PASSWORD) || '';
  if (!given || !real) return false;
  const a = await sha(given), b = await sha(real);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function cleanSource(s) {
  try {
    const u = new URL(String(s || DEFAULT_SOURCE));
    if (u.protocol !== 'https:') return null;
    if (!/(^|\.)netlify\.app$/.test(u.hostname) && !/(^|\.)bielyystore\.com\.br$/.test(u.hostname)) return null;
    return u.origin;
  } catch (e) { return null; }
}

class SourceError extends Error {}

async function getJSON(url, headers) {
  let r;
  try { r = await fetch(url, { headers: Object.assign({ 'cache-control': 'no-cache' }, headers || {}) }); }
  catch (e) { throw new SourceError('Não consegui falar com o Netlify: ' + e.message); }
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* não é JSON */ }
  if (r.status === 401) throw new SourceError('A senha do painel no Netlify é diferente da senha cadastrada na Cloudflare (ADMIN_PASSWORD).');
  if (!r.ok || !data) throw new SourceError('O Netlify respondeu com erro ' + r.status + ((data && data.error) ? ': ' + data.error : ''));
  return data;
}

async function getBytes(url) {
  let r;
  try { r = await fetch(url); } catch (e) { return null; }
  if (!r.ok) return null;
  return { bytes: new Uint8Array(await r.arrayBuffer()), type: (r.headers.get('content-type') || 'image/jpeg').split(';')[0] };
}

const putText = (db, store, key, value, now, ignore) =>
  db.prepare(`INSERT OR ${ignore ? 'IGNORE' : 'REPLACE'} INTO blobs (store, key, kind, txt, bin, meta, updated) VALUES (?, ?, 't', ?, NULL, NULL, ?)`)
    .bind(store, String(key), typeof value === 'string' ? value : JSON.stringify(value), now);

const putBin = (db, store, key, bytes, type, now) =>
  db.prepare("INSERT OR REPLACE INTO blobs (store, key, kind, txt, bin, meta, updated) VALUES (?, ?, 'b', NULL, ?, ?, ?)")
    .bind(store, String(key), bytes, JSON.stringify({ type }), now);

async function readJSON(db, store, key) {
  const row = await db.prepare("SELECT txt FROM blobs WHERE store = ? AND key = ? AND kind = 't'").bind(store, key).first();
  try { return row ? JSON.parse(row.txt) : null; } catch (e) { return null; }
}

// Fotos que você subiu pelo painel (as que começam com p123_...)
async function productPhotoKeys(db) {
  const doc = await readJSON(db, 'catalog', 'overrides');
  const keys = new Set();
  const take = (o) => {
    if (!o || typeof o !== 'object') return;
    [o.photo].concat(Array.isArray(o.photos) ? o.photos : []).forEach(k => { if (typeof k === 'string' && /^p\d{1,9}_[a-z0-9]{4,16}$/.test(k)) keys.add(k); });
  };
  if (doc) { Object.values(doc.products || {}).forEach(take); Object.values(doc.added || {}).forEach(take); }
  return [...keys].sort();
}

async function reviewPhotoKeys(db) {
  const { results } = await db.prepare("SELECT txt FROM blobs WHERE store = 'reviews' AND kind = 't'").all();
  const keys = new Set();
  (results || []).forEach(r => { try { (JSON.parse(r.txt).photos || []).forEach(k => { if (typeof k === 'string') keys.add(k); }); } catch (e) { /* ignora */ } });
  return [...keys].sort();
}

async function runStep(step, src, pw, offset, db) {
  const now = Date.now();
  const adm = { 'x-admin-password': pw };
  const F = src + '/.netlify/functions/';
  const stmts = [];
  let total = 0, next = null;

  if (step === 'catalog') {
    const doc = await getJSON(F + 'catalog?nc=' + now);
    const clean = { products: doc.products || {}, added: doc.added || {}, kits: doc.kits || {}, settings: doc.settings || {}, v: doc.v || 0, updatedAt: doc.updatedAt || null };
    stmts.push(putText(db, 'catalog', 'overrides', clean, now));
    total = 1;
  } else if (step === 'config') {
    const pix = await getJSON(F + 'pix-config?nc=' + now);
    if (pix && pix.key) stmts.push(putText(db, 'config', 'pix', pix, now));
    const ld = await getJSON(F + 'local-delivery-config', adm);
    if (ld && ld.config) stmts.push(putText(db, 'config', 'local-delivery', ld.config, now));
    total = stmts.length;
  } else if (step === 'users') {
    const { users } = await getJSON(F + 'get-customers', adm);
    (users || []).forEach(u => {
      const email = String(u.email || '').trim().toLowerCase();
      if (!email) return;
      // IGNORE: se a cliente já criou a senha nova aqui, não apaga
      stmts.push(putText(db, 'users', email, { name: u.name || '', email, phone: u.phone || '', createdAt: u.createdAt || null, migrated: true }, now, true));
    });
    total = (users || []).length;
  } else if (step === 'orders') {
    const { orders } = await getJSON(F + 'get-orders', adm);
    (orders || []).forEach(o => { if (o && o.order_nsu) stmts.push(putText(db, 'orders', o.order_nsu, o, now)); });
    total = (orders || []).length;
  } else if (step === 'reviews') {
    const lists = [];
    for (const st of ['pending', 'approved']) {
      const d = await getJSON(F + 'get-pending-reviews?password=' + encodeURIComponent(pw) + (st === 'approved' ? '&status=approved' : ''));
      lists.push(...(d.reviews || []));
    }
    lists.forEach(r => {
      const id = r && (r.id || (r.productId && r.orderNsu && `${r.productId}_${r.orderNsu}`));
      if (id) stmts.push(putText(db, 'reviews', id, r, now));
    });
    total = lists.length;
  } else if (step === 'product-photos' || step === 'review-photos') {
    const keys = step === 'product-photos' ? await productPhotoKeys(db) : await reviewPhotoKeys(db);
    total = keys.length;
    const page = keys.slice(offset, offset + PHOTOS_PER_CALL);
    for (const k of page) {
      const url = step === 'product-photos'
        ? F + 'product-photo?k=' + encodeURIComponent(k)
        : F + 'review-photo?k=' + encodeURIComponent(k) + '&p=' + encodeURIComponent(pw);
      const got = await getBytes(url);
      if (got && got.bytes.length) stmts.push(putBin(db, step, k, got.bytes, got.type, now));
    }
    next = offset + page.length < keys.length ? offset + page.length : null;
    if (stmts.length) await db.batch(stmts);
    return { imported: stmts.length, done: page.length, total, next };
  }

  if (stmts.length) await db.batch(stmts);
  return { imported: stmts.length, done: total, total, next };
}

export async function migrateImport(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'JSON inválido' }, 400); }
  if (!(await isAdmin(body.password, env))) return json({ error: 'Senha incorreta' }, 401);
  const step = String(body.store || '');
  if (!STEPS.includes(step)) return json({ error: 'Etapa desconhecida' }, 400);
  const source = cleanSource(body.source);
  if (!source) return json({ error: 'Endereço de origem inválido' }, 400);
  const offset = Math.max(0, parseInt(body.offset, 10) || 0);
  try {
    const db = await ready();
    const r = await runStep(step, source, String(body.password), offset, db);
    return json(Object.assign({ store: step }, r));
  } catch (e) {
    if (e instanceof SourceError) return json({ error: e.message }, 502);
    console.error('Erro na cópia', step, e && e.stack || e);
    return json({ error: 'Erro ao copiar: ' + e.message }, 500);
  }
}

export async function migrateStatus(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'JSON inválido' }, 400); }
  if (!(await isAdmin(body.password, env))) return json({ error: 'Senha incorreta' }, 401);
  const db = await ready();
  const { results } = await db.prepare('SELECT store, COUNT(*) AS n FROM blobs GROUP BY store').all();
  const counts = {};
  STORES.forEach(s => { counts[s] = 0; });
  (results || []).forEach(r => { counts[r.store] = r.n; });
  return json({ counts });
}

export const MIGRATE_PAGE = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Mudança para a Cloudflare · Bielyy Store</title>
<style>
:root{--roxo:#7B4FD6;--lilas:#F3EDFF;--txt:#2D2340;--ok:#1E9E62;--erro:#C8324B}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--lilas);color:var(--txt)}
main{max-width:560px;margin:0 auto;padding:28px 16px 60px}
h1{font-size:1.45rem;margin:0 0 6px;color:var(--roxo)}p{line-height:1.5}
.card{background:#fff;border-radius:18px;padding:20px;box-shadow:0 6px 24px rgba(123,79,214,.12);margin-top:18px}
label{display:block;font-weight:600;margin:12px 0 6px}input{width:100%;padding:12px 14px;border:1.5px solid #D8CCF5;border-radius:12px;font-size:1rem}
button{margin-top:16px;width:100%;padding:14px;border:0;border-radius:999px;background:var(--roxo);color:#fff;font-size:1.05rem;font-weight:700;cursor:pointer}
button.sec{background:#fff;color:var(--roxo);border:1.5px solid var(--roxo)}button:disabled{opacity:.55;cursor:wait}
ul{list-style:none;padding:0;margin:14px 0 0}li{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px dashed #E6DDFA}
.ok{color:var(--ok);font-weight:700}.err{color:var(--erro);font-weight:600}small{color:#6B5E85}
</style></head><body><main>
<h1>💜 Mudança para a Cloudflare</h1>
<p>Esta página copia os dados do Netlify para cá: estoque e kits do painel, fotos que você subiu, configurações do Pix e da entrega, clientes, pedidos e avaliações. Pode clicar quantas vezes precisar: ela só atualiza o que já foi copiado.</p>
<div class="card">
<label for="pw">Senha do painel</label><input id="pw" type="password" autocomplete="current-password">
<label for="src">Copiar de</label><input id="src" value="${DEFAULT_SOURCE}">
<small>Deixe como está, a não ser que eu te peça para mudar.</small>
<button id="go">Copiar os dados</button>
<button id="chk" class="sec">Só conferir o que já está aqui</button>
<ul id="list"></ul><p id="msg"></p>
</div></main>
<script>
const STORES=${JSON.stringify(STEPS)};
const NAMES={config:'Configurações (Pix e entrega)',catalog:'Catálogo do painel (estoque, kits, textos)',users:'Contas de clientes',orders:'Pedidos',reviews:'Avaliações','product-photos':'Fotos de produtos do painel','review-photos':'Fotos das avaliações'};
const $=id=>document.getElementById(id);
function row(s,t,c){let li=document.getElementById('r-'+s);if(!li){li=document.createElement('li');li.id='r-'+s;li.innerHTML='<span></span><span></span>';$('list').appendChild(li);}li.children[0].textContent=NAMES[s]||s;li.children[1].textContent=t;li.children[1].className=c||'';}
async function post(path,data){const r=await fetch('/.netlify/functions/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const j=await r.json().catch(()=>({error:'Resposta inválida ('+r.status+')'}));if(!r.ok)throw new Error(j.error||('Erro '+r.status));return j;}
async function check(){const pw=$('pw').value;if(!pw){$('msg').textContent='Digite a senha do painel.';return;}
 try{const {counts}=await post('migrate-status',{password:pw});$('list').innerHTML='';STORES.forEach(s=>row(s,counts[s]+' itens','ok'));$('msg').textContent='';}catch(e){$('msg').innerHTML='<span class="err">'+e.message+'</span>';}}
$('chk').onclick=check;
$('go').onclick=async()=>{const pw=$('pw').value,src=$('src').value.trim();if(!pw){$('msg').textContent='Digite a senha do painel.';return;}
 $('go').disabled=$('chk').disabled=true;$('list').innerHTML='';$('msg').textContent='Copiando… não feche esta página.';
 try{for(const s of STORES){let off=0,done=0,got=0,total=0;row(s,'copiando…');
   while(off!==null){const j=await post('migrate-import',{password:pw,source:src,store:s,offset:off});total=j.total;done+=j.done;got+=j.imported;off=j.next;row(s,done+' de '+total+'…');}
   row(s,got+' de '+total+(got<total?' (alguns não vieram)':' ✓'),got<total?'err':'ok');}
  $('msg').innerHTML='<span class="ok">Pronto! Tudo copiado 💜</span>';}
 catch(e){$('msg').innerHTML='<span class="err">'+e.message+'</span>';}
 finally{$('go').disabled=$('chk').disabled=false;}};
</script></body></html>`;
