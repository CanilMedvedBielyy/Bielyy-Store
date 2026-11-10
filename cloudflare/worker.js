// Bielyy Store na Cloudflare.
//
// - As páginas, fotos e scripts (index.html, *.jpg...) são servidos direto pela
//   Cloudflare, de graça e sem limite, sem nem passar por aqui.
// - Este worker só roda para /.netlify/functions/*, /sitemap.xml, /google-feed.xml e /migrar.
//   Os endereços das funções continuam iguais aos do Netlify, então o site,
//   o painel e o aviso de pagamento da InfinitePay não precisam mudar nada.
import { FUNCTIONS } from './functions-map.js';
import { migrateImport, migrateStatus, MIGRATE_PAGE } from './migrate.js';

const SITE_HOST = 'bielyystore.com.br';

// Converte o pedido do navegador no formato que as funções do Netlify esperam
async function toEvent(request, url) {
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const query = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });
  let body = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') body = await request.text();
  return {
    httpMethod: request.method,
    path: url.pathname,
    rawUrl: url.toString(),
    rawQuery: url.search.replace(/^\?/, ''),
    headers,
    multiValueHeaders: {},
    queryStringParameters: query,
    multiValueQueryStringParameters: {},
    body,
    isBase64Encoded: false
  };
}

// Converte a resposta da função em resposta para o navegador
function toResponse(res, method) {
  res = res || {};
  const status = res.statusCode || 200;
  const headers = new Headers();
  Object.entries(res.headers || {}).forEach(([k, v]) => { if (v != null) headers.set(k, String(v)); });
  Object.entries(res.multiValueHeaders || {}).forEach(([k, list]) => {
    (Array.isArray(list) ? list : [list]).forEach(v => headers.append(k, String(v)));
  });
  let body = res.body == null ? '' : res.body;
  if (res.isBase64Encoded) {
    const bin = atob(String(body));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    body = bytes;
  } else if (!headers.has('content-type')) {
    const s = String(body).trimStart();
    headers.set('content-type', (s.startsWith('{') || s.startsWith('[')) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
  }
  if ([204, 304].includes(status) || method === 'HEAD') body = null;
  return new Response(body, { status, headers });
}

// A função do mapa do site lê o index.html pelo endereço do site:
// aqui esse pedido vai direto para os arquivos publicados (sem dar volta pela internet).
let currentEnv = null;
let currentOrigin = '';
const realFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  try {
    const u = new URL(typeof input === 'string' ? input : (input && input.url) || String(input));
    const ownHost = u.hostname === SITE_HOST || u.hostname === 'www.' + SITE_HOST || (currentOrigin && u.origin === currentOrigin);
    if (ownHost && currentEnv && currentEnv.ASSETS && !u.pathname.startsWith('/.netlify/')) {
      return currentEnv.ASSETS.fetch(new Request(currentOrigin + u.pathname + u.search, init));
    }
  } catch (e) { /* segue normal */ }
  return realFetch(input, init);
};

async function runFunction(name, request, url) {
  const fn = FUNCTIONS[name];
  if (!fn || typeof fn.handler !== 'function') {
    return new Response(JSON.stringify({ error: 'Função não encontrada' }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  try {
    const event = await toEvent(request, url);
    const res = await fn.handler(event, {});
    return toResponse(res, request.method);
  } catch (err) {
    console.error('Erro na função', name, err && err.stack || err);
    return new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
}

export default {
  async fetch(request, env, ctx) {
    globalThis.__BIELYY_DB = env.DB;
    currentEnv = env;
    const url = new URL(request.url);
    currentOrigin = url.origin;

    // www.bielyystore.com.br -> bielyystore.com.br (endereço principal, igual ao Netlify)
    if (url.hostname === 'www.' + SITE_HOST) {
      return Response.redirect('https://' + SITE_HOST + url.pathname + url.search, 301);
    }

    if (url.pathname === '/sitemap.xml') return runFunction('sitemap', request, url);
    if (url.pathname === '/google-feed.xml') return runFunction('google-feed', request, url);

    if (url.pathname === '/migrar' || url.pathname === '/migrar/') {
      return new Response(MIGRATE_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
    }

    const m = url.pathname.match(/^\/\.netlify\/functions\/([a-z0-9-]+)\/?$/);
    if (m) {
      if (m[1] === 'migrate-import') return migrateImport(request, env);
      if (m[1] === 'migrate-status') return migrateStatus(request, env);
      return runFunction(m[1], request, url);
    }

    return env.ASSETS.fetch(request);
  }
};
