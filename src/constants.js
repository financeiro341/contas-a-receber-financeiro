// Situações do relatório de cobrança (processo-cobranca-whatsapp.md, item 4.9; "pagou_parcial" desde 05/11/2026).
export const SITUACOES = [
  { id: 'sem_retorno', nome: 'Não respondeu', plural: 'Não responderam' },
  { id: 'respondeu_sem_pagar', nome: 'Respondeu, sem pagamento', plural: 'Responderam, sem pagamento' },
  { id: 'prometeu', nome: 'Prometeu pagar', plural: 'Prometeram pagar' },
  { id: 'disse_que_pagou', nome: 'Diz que já pagou', plural: 'Dizem que já pagaram' },
  { id: 'pagou_parcial', nome: 'Pagou uma parte', plural: 'Pagaram uma parte' },
  { id: 'pagou', nome: 'Pagou', plural: 'Pagaram' },
  { id: 'so_boleto', nome: 'Só boleto', plural: 'Só receberam o boleto' },
];
export const NOME_SITUACAO = Object.fromEntries(SITUACOES.map((s) => [s.id, s.nome]));
export const PAGARAM_OU_PROMETERAM = ['pagou', 'pagou_parcial', 'disse_que_pagou', 'prometeu'];
