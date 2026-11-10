// Trocas e devoluções pedidas pela cliente no site (Meus pedidos → Trocar ou devolver).
// A solicitação fica guardada no próprio pedido, em order.returnRequest.
// Quando a loja fecha uma solicitação (concluída ou recusada), ela vai para order.returnHistory
// e a cliente pode abrir outra, se precisar.

const REASONS = {
  arrependimento: 'Desisti da compra / não gostei',
  tamanho: 'Tamanho, cor ou modelo não serviu',
  defeito: 'Produto com defeito',
  errado: 'Veio produto errado ou diferente do anúncio',
  avaria: 'Chegou danificado no transporte',
  outro: 'Outro motivo'
};

const WANTS = {
  troca: 'Trocar por outro produto, tamanho ou cor',
  devolucao: 'Devolver e receber o dinheiro de volta'
};

// Etapas da solicitação (o que a loja marca no painel)
const RETURN_STATUS = {
  em_analise: 'Em análise',
  aprovada: 'Aprovada: aguardando o envio do produto',
  recebida: 'Produto recebido: em conferência',
  concluida: 'Concluída',
  recusada: 'Não aprovada'
};
const OPEN = ['em_analise', 'aprovada', 'recebida'];

const MAX_DAYS = 90; // prazo maior da garantia legal (produtos duráveis), contado da entrega

function deliveredAt(o) {
  return o.deliveredAt || (o.status === 'entregue' ? o.statusUpdatedAt : null) || null;
}

function isOpen(rr) {
  return !!(rr && OPEN.includes(rr.status));
}

// Resumo que a cliente vê na conta
function publicReturn(rr) {
  if (!rr) return null;
  return {
    id: rr.id,
    status: rr.status,
    statusLabel: RETURN_STATUS[rr.status] || rr.status,
    wants: rr.wants,
    reason: rr.reason,
    reasonLabel: REASONS[rr.reason] || '',
    createdAt: rr.createdAt || null,
    updatedAt: rr.updatedAt || null,
    reply: rr.reply || '',
    items: (rr.items || []).map(i => ({ title: i.title, sub: i.sub || '', qty: i.qty }))
  };
}

module.exports = { REASONS, WANTS, RETURN_STATUS, OPEN, MAX_DAYS, deliveredAt, isOpen, publicReturn };
