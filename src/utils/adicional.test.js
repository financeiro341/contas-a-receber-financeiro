import { describe, expect, it } from 'vitest';
import { clientesEmAberto, deFora, diaADia, diasUteis, historicoPagamentos, metaDeHoje, metasDoMes, resumoParcelas } from './adicional.js';

const t = (o) => ({ cancelado: false, excluido: false, juros_multa: 0, recebido: 0, quitado: 0, pagamentos: [], obs: null, ...o });
const titulos = [
  t({ titulo: 1, cliente: 10, parcela: 1, vencimento: '2026-11-10', valor: 100, aberto: 0, quitado: 100, recebido: 102, juros_multa: 2,
    pagamentos: [{ dia: '2026-11-12', valor: 102, parcela: 100, forma: 'PIX', banco: 'Santander' }] }),
  t({ titulo: 2, cliente: 10, parcela: 2, vencimento: '2026-12-10', valor: 100, aberto: 100 }),
  t({ titulo: 3, cliente: 20, parcela: 1, vencimento: '2026-11-10', valor: 200, aberto: 200 }),
  t({ titulo: 4, cliente: 20, parcela: 2, vencimento: '2026-12-10', valor: 200, aberto: 200 }),
  t({ titulo: 5, cliente: 30, parcela: 1, vencimento: '2026-11-10', valor: 50, aberto: 0, cancelado: true }),
  t({ titulo: 6, cliente: 40, parcela: 1, vencimento: '2026-11-10', valor: 999, aberto: 999, excluido: true }),
  // Pago no sábado 21/11: conta na segunda 23/11.
  t({ titulo: 7, cliente: 50, parcela: 1, vencimento: '2026-11-10', valor: 300, aberto: 150, quitado: 150, recebido: 150,
    pagamentos: [{ dia: '2026-11-21', valor: 150, parcela: 150, forma: '', banco: 'Inter' }] }),
];
const dados = {
  titulos,
  clientes: { 10: { nome: 'ALFA', telefone: '(75) 1' }, 20: { nome: 'BETA' }, 40: { nome: 'EXCLUIDA' }, 50: { nome: 'GAMA' } },
  whatsapp: {
    clientes: { 20: [{ contato_id: 7, nome: 'Beta WhatsApp', situacao: 'prometeu', situacao_dia: '2026-11-20', boleto_status: 'READ' }, { contato_id: 8, situacao: 'sem_retorno', situacao_dia: '2026-11-12' }] },
    anotacoes: { 20: { texto: 'contestou', por: 'Maria Clara' } },
  },
  fora_da_campanha: { qtd: 4, valor: 1000 },
};

describe('dias úteis', () => {
  it('tira fim de semana e feriado (20/11)', () => {
    expect(diasUteis('2026-11-16', '2026-11-23')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-23']);
  });
});

describe('parcelas', () => {
  it('sem cancelados e excluídos; recebido igual ao Omie e quitado da parcela', () => {
    const [p1, p2] = resumoParcelas(titulos);
    expect(p1).toMatchObject({ previsto: 600, recebido: 252, quitado: 250, aberto: 350, juros_multa: 2, titulos: 3, pagos: 1, em_aberto: 2, cancelados: 1, excluidos: 1 });
    expect(p2).toMatchObject({ previsto: 300, aberto: 300, titulos: 2, pagos: 0 });
  });
});

describe('metas', () => {
  it('novembro é a 1ª parcela; dezembro, a 2ª mais a sobra da 1ª', () => {
    const [nov, dez] = metasDoMes(titulos);
    expect(nov).toMatchObject({ meta: 600, quitado: 250, falta: 350 });
    expect(dez).toMatchObject({ meta: 650, quitado: 0, falta: 650 });
  });
  it('meta do dia: saldo ÷ dias úteis até o prazo; pagamento no sábado conta na segunda', () => {
    const dias = diaADia(titulos, '2026-11-24');
    const d10 = dias.find((d) => d.dia === '2026-11-10');
    // 10/11 a 30/11: 14 dias úteis (sem 15/11 domingo, 20/11 feriado).
    expect(diasUteis('2026-11-10', '2026-11-30').length).toBe(14);
    expect(d10.meta).toBe(Math.round((600 / 14) * 100) / 100);
    expect(dias.find((d) => d.dia === '2026-11-12').quitado).toBe(100);
    expect(dias.find((d) => d.dia === '2026-11-23')).toMatchObject({ quitado: 150, recebido: 150 });
    const h = metaDeHoje(dias, '2026-11-24');
    // Saldo no começo de 24/11: 600 - 100 - 150 = 350; faltam 24, 25, 26, 27 e 30/11 = 5 dias úteis.
    expect(h).toMatchObject({ dia: '2026-11-24', eh_hoje: true, prazo: '2026-11-30', meta: 70, quitado: 0, falta: 70, saldo: 350, dias_restantes: 5 });
  });
  it('no fim de semana a meta é a do próximo dia útil', () => {
    const h = metaDeHoje(diaADia(titulos, '2026-11-28'), '2026-11-28');
    expect(h).toMatchObject({ dia: '2026-11-30', eh_hoje: false, dias_restantes: 1 });
  });
  it('em dezembro, a meta junta a sobra da 1ª e a 2ª parcela', () => {
    const h = metaDeHoje(diaADia(titulos, '2026-12-10'), '2026-12-10');
    // Sobra da 1ª: 350 até 31/12; 2ª: 300 a partir de 10/12. De 10/12 a 31/12: 15 dias úteis (25/12 feriado).
    expect(diasUteis('2026-12-10', '2026-12-31').length).toBe(15);
    expect(h).toMatchObject({ prazo: '2026-12-31', saldo: 650 });
    expect(h.meta).toBeCloseTo(650 / 15, 1);
  });
});

describe('lista de quem cobrar', () => {
  it('um cliente por linha, sem excluídos, com o WhatsApp mais recente e a anotação', () => {
    const l = clientesEmAberto(dados, '2026-11-24');
    expect(l.map((c) => c.cliente)).toEqual([20, 50, 10]);
    expect(l[0]).toMatchObject({ nome: 'BETA', aberto: 400, vencido: 200, dias_atraso: 14, parcelas: [1, 2], outros_numeros: 1, anotacao: { texto: 'contestou', por: 'Maria Clara' } });
    expect(l[0].contato.contato_id).toBe(7);
    expect(l[2]).toMatchObject({ nome: 'ALFA', vencido: 0, aberto: 100, contato: null });
  });
});

describe('histórico de pagamentos', () => {
  it('do mais novo para o mais antigo, sem cancelados', () => {
    const h = historicoPagamentos(dados);
    expect(h.map((x) => [x.dia, x.nome, x.parcela, x.valor, x.quitou])).toEqual([['2026-11-21', 'GAMA', 1, 150, 150], ['2026-11-12', 'ALFA', 1, 102, 100]]);
  });
});

describe('de fora', () => {
  it('conta cancelados, excluídos e outros acordos', () => {
    expect(deFora(dados)).toEqual({ cancelados: 1, excluidos_clientes: 1, excluidos_aberto: 999, outros_acordos: 4 });
  });
});
