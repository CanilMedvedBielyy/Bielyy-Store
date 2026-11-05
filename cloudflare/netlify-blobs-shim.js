// Substituto do "@netlify/blobs" para a Cloudflare.
//
// As funções do site (pasta netlify/functions) continuam iguais: elas pedem um
// "caderno" (store) e usam get / set / setJSON / delete / list. Aqui na Cloudflare
// esses cadernos ficam guardados no banco D1 (tabela "blobs"), que é gratuito,
// sempre atualizado na hora (sem o atraso de ~1 minuto do Netlify) e fica na
// própria conta da Cloudflare.
//
// O worker (cloudflare/worker.js) coloca o banco em globalThis.__BIELYY_DB a cada pedido.

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS blobs (store TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, txt TEXT, bin BLOB, meta TEXT, updated INTEGER, PRIMARY KEY (store, key))'
];

const schemaReady = new WeakMap(); // banco -> tabela já conferida
function getDB() {
  const db = globalThis.__BIELYY_DB;
  if (!db) throw new Error('Banco de dados D1 (DB) não está ligado ao worker');
  return db;
}
async function ready() {
  const db = getDB();
  let p = schemaReady.get(db);
  if (!p) {
    p = (async () => { for (const s of SCHEMA) await db.prepare(s).run(); })()
      .catch((e) => { schemaReady.delete(db); throw e; });
    schemaReady.set(db, p);
  }
  await p;
  return db;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBytes(v) {
  if (v == null) return new Uint8Array(0);
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return Uint8Array.from(v);
  if (typeof v === 'string') return enc.encode(v);
  return new Uint8Array(0);
}
function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
function parseMeta(m) {
  if (!m) return {};
  try { return JSON.parse(m) || {}; } catch (e) { return {}; }
}

function convert(row, type) {
  if (!row) return null;
  const isText = row.kind === 't';
  switch (type) {
    case 'json': return JSON.parse(isText ? row.txt : dec.decode(toBytes(row.bin)));
    case 'arrayBuffer': return toArrayBuffer(isText ? enc.encode(row.txt || '') : toBytes(row.bin));
    case 'blob': return new Blob([isText ? (row.txt || '') : toBytes(row.bin)]);
    case 'stream': return new Blob([isText ? (row.txt || '') : toBytes(row.bin)]).stream();
    default: return isText ? (row.txt || '') : dec.decode(toBytes(row.bin)); // 'text' (padrão do Netlify)
  }
}

class Store {
  constructor(name) {
    this.name = String(name);
    this.cache = new Map(); // valores de texto já lidos pelo list() (evita centenas de consultas)
  }

  async _row(key, withBin) {
    key = String(key);
    if (this.cache.has(key)) return this.cache.get(key);
    const db = await ready();
    const cols = withBin ? 'kind, txt, bin, meta' : 'kind, NULL AS txt, NULL AS bin, meta';
    return (await db.prepare(`SELECT ${cols} FROM blobs WHERE store = ? AND key = ?`).bind(this.name, key).first()) || null;
  }

  async get(key, opts) {
    const type = opts && opts.type;
    return convert(await this._row(key, true), type);
  }

  async getWithMetadata(key, opts) {
    const row = await this._row(key, true);
    if (!row) return null;
    return { data: convert(row, opts && opts.type), metadata: parseMeta(row.meta), etag: '' };
  }

  async getMetadata(key) {
    const row = await this._row(key, false);
    if (!row) return null;
    return { metadata: parseMeta(row.meta), etag: '' };
  }

  async set(key, value, opts) {
    key = String(key);
    const db = await ready();
    const meta = opts && opts.metadata ? JSON.stringify(opts.metadata) : null;
    if (value instanceof Blob) value = await value.arrayBuffer();
    if (typeof value === 'string') {
      await db.prepare('INSERT OR REPLACE INTO blobs (store, key, kind, txt, bin, meta, updated) VALUES (?, ?, ?, ?, NULL, ?, ?)')
        .bind(this.name, key, 't', value, meta, Date.now()).run();
    } else {
      const bytes = toBytes(value);
      await db.prepare('INSERT OR REPLACE INTO blobs (store, key, kind, txt, bin, meta, updated) VALUES (?, ?, ?, NULL, ?, ?, ?)')
        .bind(this.name, key, 'b', bytes, meta, Date.now()).run();
    }
    this.cache.delete(key);
    return { modified: true, etag: '' };
  }

  async setJSON(key, value, opts) {
    return this.set(key, JSON.stringify(value), opts);
  }

  async delete(key) {
    key = String(key);
    const db = await ready();
    await db.prepare('DELETE FROM blobs WHERE store = ? AND key = ?').bind(this.name, key).run();
    this.cache.delete(key);
  }

  async list(opts) {
    const prefix = opts && opts.prefix ? String(opts.prefix) : '';
    const db = await ready();
    // Traz junto o conteúdo de texto, para os get() seguintes não precisarem ir ao banco de novo
    let stmt;
    if (prefix) {
      stmt = db.prepare("SELECT key, kind, CASE WHEN kind = 't' THEN txt END AS txt, meta FROM blobs WHERE store = ? AND substr(key, 1, ?) = ? ORDER BY key")
        .bind(this.name, prefix.length, prefix);
    } else {
      stmt = db.prepare("SELECT key, kind, CASE WHEN kind = 't' THEN txt END AS txt, meta FROM blobs WHERE store = ? ORDER BY key")
        .bind(this.name);
    }
    const { results } = await stmt.all();
    const rows = results || [];
    for (const r of rows) {
      if (r.kind === 't') this.cache.set(r.key, { kind: 't', txt: r.txt, bin: null, meta: r.meta });
    }
    return { blobs: rows.map(r => ({ key: r.key, etag: '' })), directories: [] };
  }
}

function getStore(nameOrOpts) {
  const name = typeof nameOrOpts === 'string' ? nameOrOpts : (nameOrOpts && nameOrOpts.name);
  if (!name) throw new Error('getStore: informe o nome do caderno');
  return new Store(name);
}

function connectLambda() { /* nada a fazer na Cloudflare */ }

module.exports = { getStore, connectLambda, ready, getDB };
