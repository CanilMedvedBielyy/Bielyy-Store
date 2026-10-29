// Netlify Function: salva mudanças de produtos feitas no painel admin (protegida por senha)
// POST { password, op, ... }
//   op 'update' : { id, patch }       -> estoque, preço, nome, descrição, categoria, esgotado, oculto, encomenda...
//   op 'add'    : { product }         -> cadastra produto novo
//   op 'remove' : { id }              -> apaga um produto cadastrado pelo painel
//   op 'reset'  : { id }              -> desfaz as alterações de um produto do site (volta ao original)
//   op 'photo'  : { id, dataUrl }     -> troca/coloca a foto (vale para qualquer produto)
//   op 'kit'    : { id?, kit }        -> monta um kit novo ou altera um kit (itens, opções, textos)
//   op 'kit-del': { id }              -> exclui um kit (os kits do site ficam guardados e podem ser restaurados)
//   op 'kit-reset': { id }            -> desfaz as alterações de um kit do site (ou restaura um kit excluído)
const crypto = require('crypto');
const { blobStore } = require('../lib/blobs');
const { getDoc, saveDoc } = require('../lib/catalog');

function isAdmin(event, bodyPassword) {
  const given = (event.headers && (event.headers['x-admin-password'] || event.headers['X-Admin-Password'])) || bodyPassword || '';
  const real = process.env.ADMIN_PASSWORD || '';
  if (!given || !real) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

const txt = (v, n) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, n);
const money = (v) => { const n = Math.round(Number(String(v).replace(',', '.')) * 100) / 100; return n > 0 && n < 100000 ? n : null; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(0, Math.min(99999, n)) : null; };

function cleanVariants(list) {
  if (!Array.isArray(list)) return null;
  const out = list.slice(0, 20).map(v => ({
    label: txt(v.label, 60) || 'Único',
    cartao: money(v.cartao),
    pix: money(v.pix),
    available: v.available !== false
  })).filter(v => v.cartao);
  out.forEach(v => { if (!v.pix) v.pix = v.cartao; });
  return out.length ? out : null;
}

// só deixa passar campos conhecidos
function cleanPatch(p) {
  const o = {};
  if (!p || typeof p !== 'object') return o;
  if ('stock' in p) { const s = int(p.stock); if (s !== null) { o.stock = s; o.sold = 0; } }
  if ('soldOut' in p) o.soldOut = !!p.soldOut;
  if ('hidden' in p) o.hidden = !!p.hidden;
  if ('preorder' in p) o.preorder = !!p.preorder;
  if ('name' in p && txt(p.name, 140)) o.name = txt(p.name, 140);
  if ('desc' in p) o.desc = txt(p.desc, 1200);
  if ('brand' in p && txt(p.brand, 60)) o.brand = txt(p.brand, 60);
  if ('category' in p && txt(p.category, 60)) o.category = txt(p.category, 60);
  if ('variants' in p) { const v = cleanVariants(p.variants); if (v) o.variants = v; }
  if ('cost' in p) { const c = money(p.cost); o.cost = c; }
  if ('story' in p) { const st = cleanStory(p.story); if (st) o.story = st; }
  return o;
}

// lista de textos (aceita lista ou texto com uma linha por item)
const lines = (v, n, m) => (Array.isArray(v) ? v : String(v == null ? '' : v).split('\n')).map(x => txt(x, m)).filter(Boolean).slice(0, n);

// textos da página do produto: etiquetas, frase, "por que precisa", benefícios, como usar, cuidados
function cleanStory(s) {
  if (!s || typeof s !== 'object') return null;
  return { t: lines(s.t, 5, 40), h: txt(s.h, 240), w: txt(s.w, 2000), b: lines(s.b, 8, 240), u: lines(s.u, 10, 400), c: lines(s.c, 10, 400) };
}

const KIT_SIZES = ['PP', 'P', 'M', 'G', 'GG'];
// kit montado no painel: só produtos da loja (id < 9000) e 'PICK' (item que a cliente escolhe)
function cleanKit(k) {
  if (!k || typeof k !== 'object') return { error: 'Kit inválido' };
  const name = txt(k.name, 70);
  if (!name) return { error: 'Coloque o nome do kit' };
  const variants = (Array.isArray(k.variants) ? k.variants : []).slice(0, 12).map(v => ({
    label: txt(v && v.label, 70) || 'Kit completo',
    items: (Array.isArray(v && v.items) ? v.items : []).slice(0, 12).map(it => {
      const raw = Array.isArray(it) ? it[0] : null;
      const id = raw === 'PICK' ? 'PICK' : parseInt(raw, 10);
      const q = Math.max(1, Math.min(9, parseInt(Array.isArray(it) ? it[1] : 1, 10) || 1));
      return (id === 'PICK' || (id > 0 && id < 9000)) ? [id, q] : null;
    }).filter(Boolean)
  })).filter(v => v.items.length);
  if (!variants.length) return { error: 'Coloque pelo menos um produto no kit' };
  const hasPick = variants.some(v => v.items.some(i => i[0] === 'PICK'));
  const pickIds = (k.pick && Array.isArray(k.pick.ids) ? k.pick.ids : []).map(x => parseInt(x, 10)).filter(x => x > 0 && x < 9000).slice(0, 15);
  if (hasPick && !pickIds.length) return { error: 'Escolha os produtos do "item à escolha da cliente"' };
  const kit = {
    name, emoji: txt(k.emoji, 8) || '🎁',
    sizes: (Array.isArray(k.sizes) ? k.sizes : []).filter(s => KIT_SIZES.includes(s)),
    tags: lines(k.tags, 5, 40), hook: txt(k.hook, 240), why: txt(k.why, 2000), how: lines(k.how, 10, 400),
    variants, pick: hasPick ? { label: txt(k.pick && k.pick.label, 60) || 'Escolha o item', ids: pickIds } : null
  };
  if (/^#[0-9a-fA-F]{6}$/.test(String(k.color || ''))) kit.color = k.color;
  if (txt(k.by, 40)) kit.by = txt(k.by, 40);
  return { kit };
}

async function savePhoto(event, id, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Foto inválida');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 1.5 * 1024 * 1024) throw new Error('Foto grande demais');
  const key = `p${id}_${Date.now().toString(36)}`;
  await blobStore('product-photos', event).set(key, buf, { metadata: { type: 'image/' + m[1] } });
  return key;
}

// O Netlify Blobs pode devolver uma cópia de até ~1 minuto atrás logo depois de um salvamento.
// O painel manda junto a versão mais nova que ele tem (base); se ela for mais nova que a lida, usamos ela.
function pickNewest(doc, base) {
  if (!base || typeof base !== 'object') return doc;
  if (!(Number(base.v) > Number(doc.v || 0))) return doc;
  if (typeof base.products !== 'object' || typeof base.added !== 'object' || !base.products || !base.added) return doc;
  return { products: base.products, added: base.added, kits: (base.kits && typeof base.kits === 'object') ? base.kits : (doc.kits || {}), settings: (base.settings && typeof base.settings === 'object') ? base.settings : (doc.settings || {}),
           v: Number(base.v), updatedAt: base.updatedAt || doc.updatedAt };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
  if ((event.body || '').length > 2600000) return { statusCode: 413, body: JSON.stringify({ error: 'Arquivo grande demais' }) };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) }; }
  if (!isAdmin(event, body.password)) return { statusCode: 401, body: JSON.stringify({ error: 'Senha incorreta' }) };

  try {
    const doc = pickNewest(await getDoc(event), body.base);
    const id = String(body.id || (body.product && body.product.id) || '').replace(/\D/g, '').slice(0, 9);

    if (body.op === 'update') {
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Produto inválido' }) };
      const patch = cleanPatch(body.patch);
      if (doc.added[id]) {
        // produto cadastrado pelo painel: altera direto nele
        const a = doc.added[id];
        Object.assign(a, patch);
        if ('stock' in patch) { delete a.sold; doc.products[id] = Object.assign(doc.products[id] || {}, { stock: patch.stock, sold: 0 }); }
      } else {
        doc.products[id] = Object.assign(doc.products[id] || {}, patch);
      }
    } else if (body.op === 'add') {
      const p = body.product || {};
      const patch = cleanPatch(p);
      if (!patch.name || !patch.variants) return { statusCode: 400, body: JSON.stringify({ error: 'Preencha o nome e o preço' }) };
      const used = new Set(Object.keys(doc.added).map(Number));
      let newId = Number(id) >= 5000 ? Number(id) : 5000;
      while (used.has(newId)) newId++;
      const prod = Object.assign({ id: newId, brand: patch.brand || 'Bielyy', category: patch.category || 'Brinquedos', desc: patch.desc || '', preorder: !!patch.preorder, createdAt: new Date().toISOString() }, patch);
      delete prod.sold;
      if (body.dataUrl) prod.photo = await savePhoto(event, newId, body.dataUrl);
      doc.added[String(newId)] = prod;
      if ('stock' in patch) doc.products[String(newId)] = { stock: patch.stock, sold: 0 };
      await saveDoc(doc, event);
      return { statusCode: 200, body: JSON.stringify({ success: true, id: newId, doc }) };
    } else if (body.op === 'remove') {
      if (!doc.added[id]) return { statusCode: 400, body: JSON.stringify({ error: 'Só dá para apagar produtos cadastrados pelo painel. Para os outros, use "Ocultar do site".' }) };
      const ph = doc.added[id].photo;
      delete doc.added[id]; delete doc.products[id];
      if (ph) { try { await blobStore('product-photos', event).delete(ph); } catch (e) { /* ignora */ } }
    } else if (body.op === 'batch') {
      // várias alterações de uma vez (ex.: contagem de estoque) num salvamento só
      const items = Array.isArray(body.items) ? body.items.slice(0, 300) : [];
      if (!items.length) return { statusCode: 400, body: JSON.stringify({ error: 'Nada para salvar' }) };
      items.forEach(it => {
        const pid = String((it && it.id) || '').replace(/\D/g, '').slice(0, 9); if (!pid) return;
        const patch = cleanPatch(it.patch);
        if (doc.added[pid]) {
          const a = doc.added[pid]; Object.assign(a, patch);
          if ('stock' in patch) { delete a.sold; doc.products[pid] = Object.assign(doc.products[pid] || {}, { stock: patch.stock, sold: 0 }); }
        } else {
          doc.products[pid] = Object.assign(doc.products[pid] || {}, patch);
        }
      });
      if (body.settings && typeof body.settings === 'object') {
        doc.settings = Object.assign({}, doc.settings || {});
        if (body.settings.countApplied) doc.settings.countApplied = String(body.settings.countApplied).slice(0, 20);
      }
    } else if (body.op === 'settings') {
      // "modo inauguração": loja fechada (produtos aparecem como "Chegando em breve" e ninguém finaliza pedido)
      const st = body.settings || {};
      doc.settings = Object.assign({}, doc.settings || {}, { closed: !!st.closed });
    } else if (body.op === 'kit') {
      const r = cleanKit(body.kit);
      if (r.error) return { statusCode: 400, body: JSON.stringify({ error: r.error }) };
      doc.kits = doc.kits || {};
      let kid = Number(id) >= 9000 ? Number(id) : 0;
      if (!kid) { kid = 9100; while (doc.kits[String(kid)]) kid++; } // kits novos começam no 9100
      doc.kits[String(kid)] = r.kit;
      await saveDoc(doc, event);
      return { statusCode: 200, body: JSON.stringify({ success: true, id: kid, doc }) };
    } else if (body.op === 'kit-del') {
      if (!(Number(id) >= 9000)) return { statusCode: 400, body: JSON.stringify({ error: 'Kit inválido' }) };
      doc.kits = doc.kits || {};
      if (Number(id) >= 9100) delete doc.kits[id];  // kit montado no painel: apaga de vez
      else doc.kits[id] = { removed: true };        // kit do site: fica escondido (dá para restaurar)
      delete doc.products[id];
    } else if (body.op === 'kit-reset') {
      if (!(Number(id) >= 9000)) return { statusCode: 400, body: JSON.stringify({ error: 'Kit inválido' }) };
      doc.kits = doc.kits || {};
      delete doc.kits[id];
    } else if (body.op === 'reset') {
      delete doc.products[id];
    } else if (body.op === 'photo') {
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Produto inválido' }) };
      const slot = Math.max(0, Math.min(2, parseInt(body.slot, 10) || 0)); // 0 = principal, 1 e 2 = fotos extras
      const key = await savePhoto(event, id, body.dataUrl);
      const target = doc.added[id] || (doc.products[id] = doc.products[id] || {});
      let old;
      if (slot === 0) { old = target.photo; target.photo = key; }
      else {
        const arr = Array.isArray(target.photos) ? target.photos.slice(0, 2) : [];
        while (arr.length < slot - 1) arr.push(null);
        old = arr[slot - 1]; arr[slot - 1] = key;
        target.photos = arr.filter(Boolean);
      }
      if (old && /^p\d+_/.test(old)) { try { await blobStore('product-photos', event).delete(old); } catch (e) { /* ignora */ } }
    } else if (body.op === 'photo-del') {
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Produto inválido' }) };
      const slot = Math.max(1, Math.min(2, parseInt(body.slot, 10) || 1));
      const target = doc.added[id] || (doc.products[id] = doc.products[id] || {});
      const arr = Array.isArray(target.photos) ? target.photos.slice() : [];
      const old = arr[slot - 1]; arr.splice(slot - 1, 1); target.photos = arr.filter(Boolean);
      if (old && /^p\d+_/.test(old)) { try { await blobStore('product-photos', event).delete(old); } catch (e) { /* ignora */ } }
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'Operação inválida' }) };
    }

    await saveDoc(doc, event);
    return { statusCode: 200, body: JSON.stringify({ success: true, doc }) };
  } catch (err) {
    console.error('Erro ao salvar catálogo:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erro ao salvar: ' + err.message }) };
  }
};
