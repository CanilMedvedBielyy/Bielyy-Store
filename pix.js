/* Pix "copia e cola" (BR Code) no padrão do Banco Central — usado pelo site e pelo painel */
(function (g) {
  function field(id, v) { v = String(v); return id + String(v.length).padStart(2, '0') + v; }
  function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) { crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1); crc &= 0xFFFF; }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  function clean(s, max) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  // Normaliza a chave conforme o tipo (cpf, cnpj, celular, email, aleatoria)
  function normKey(type, key) {
    key = String(key || '').trim();
    if (type === 'email') return key.toLowerCase();
    if (type === 'cpf' || type === 'cnpj') return key.replace(/\D/g, '');
    if (type === 'celular') { let d = key.replace(/\D/g, ''); if (!d.startsWith('55')) d = '55' + d; return '+' + d; }
    return key.toLowerCase(); // aleatória (EVP)
  }
  function payload(o) {
    const key = normKey(o.type, o.key);
    const mai = field('00', 'br.gov.bcb.pix') + field('01', key);
    const txid = String(o.txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
    let p = field('00', '01') + field('26', mai) + field('52', '0000') + field('53', '986')
      + (o.amount ? field('54', Number(o.amount).toFixed(2)) : '')
      + field('58', 'BR') + field('59', clean(o.name, 25) || 'BIELYY STORE') + field('60', clean(o.city, 15) || 'SAO PAULO')
      + field('62', field('05', txid)) + '6304';
    return p + crc16(p);
  }
  function qrSvg(text, size) {
    if (typeof qrcode !== 'function') return '';
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    const cell = Math.max(2, Math.floor((size || 220) / (q.getModuleCount() + 8)));
    return q.createSvgTag({ cellSize: cell, margin: cell * 4, scalable: true });
  }
  g.BielyyPix = { payload, qrSvg, normKey, crc16 };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module === 'object') module.exports = (typeof window !== 'undefined' ? window : globalThis).BielyyPix;
