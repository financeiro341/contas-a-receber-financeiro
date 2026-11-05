// Situações do relatório de cobrança (processo-cobranca-whatsapp.md, item 4.9; "pagou_parcial" desde 05/11/2026).
// A ordem é a da lista de clientes e da legenda (decisão do Marcus, 05/11/2026): primeiro quem pagou,
// depois quem prometeu, quem respondeu sem pagamento e quem não respondeu.
export const SITUACOES = [
  { id: 'pagou', nome: 'Pagou', plural: 'Pagaram' },
  { id: 'pagou_parcial', nome: 'Pagou uma parte', plural: 'Pagaram uma parte' },
  { id: 'disse_que_pagou', nome: 'Diz que já pagou', plural: 'Dizem que já pagaram' },
  { id: 'prometeu', nome: 'Prometeu pagar', plural: 'Prometeram pagar' },
  { id: 'respondeu_sem_pagar', nome: 'Respondeu, sem pagamento', plural: 'Responderam, sem pagamento' },
  { id: 'sem_retorno', nome: 'Não respondeu', plural: 'Não responderam' },
  { id: 'so_boleto', nome: 'Só boleto', plural: 'Só receberam o boleto' },
];
export const ORDEM_SITUACAO = Object.fromEntries(SITUACOES.map((s, i) => [s.id, i]));
export const NOME_SITUACAO = Object.fromEntries(SITUACOES.map((s) => [s.id, s.nome]));
export const PAGARAM_OU_PROMETERAM = ['pagou', 'pagou_parcial', 'disse_que_pagou', 'prometeu'];
