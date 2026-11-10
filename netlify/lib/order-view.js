// Itens do pedido arrumados para mostrar à cliente (página do pedido, Minha conta e e-mails):
// nome curto do produto/kit, detalhe em cinza (opção do kit ou tamanho), quantidade, preço e foto.

// foto do item: só caminho do próprio site (ex.: fam25.jpg ou /.netlify/functions/product-photo?k=...)
const imgPath = (v) => {
  const t = String(v || '').trim().slice(0, 200);
  return /^\/?[A-Za-z0-9_\-.]+(\/[A-Za-z0-9_\-.]+)*(\?[A-Za-z0-9_\-.=&%]*)?$/.test(t) && !t.includes('..') ? t : '';
};

// "Kit X (opção): item1 + item2" → título "Kit X" + detalhe "opção"
function splitName(name, variant) {
  const n = String(name || '').trim();
  const m = n.match(/^(.*?) \(([^)]*)\)(?::\s*[\s\S]*)?$/);
  if (m) return { title: m[1], sub: [m[2], variant].filter(Boolean).join(' · ') };
  return { title: n, sub: variant || '' };
}

function itemsView(o) {
  if (Array.isArray(o.itemsDetailed) && o.itemsDetailed.length) {
    return o.itemsDetailed.map(i => {
      const n = splitName(i.name, i.variant);
      const qty = Number(i.qty) || 1;
      return { title: n.title, sub: n.sub, qty, total: Number(i.unitPrice) ? Math.round(Number(i.unitPrice) * qty * 100) / 100 : null, img: imgPath(i.img) };
    });
  }
  return (o.items || [])
    .filter(i => !/^Frete \(/.test(i.description || ''))
    .map(i => {
      const n = splitName(i.description, '');
      const qty = Number(i.quantity) || 1;
      return { title: n.title, sub: n.sub, qty, total: Number(i.price) ? Math.round(Number(i.price) * qty) / 100 : null, img: '' };
    });
}

module.exports = { imgPath, splitName, itemsView };
