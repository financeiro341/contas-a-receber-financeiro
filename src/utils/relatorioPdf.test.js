import { describe, expect, it } from 'vitest';
import { brl, contar, dadosDoDia, duracao, gerarPdf, nomeDoArquivo } from './relatorioPdf.js';
import { trecho } from '../components/BuscaConversa.jsx';

const dia = {
  dia: '2026-11-05',
  resumo: { cobrados: 6, responderam: 3, sem_resposta: 3, ligacoes: { fonte: 'sistema', atendidas: 2, nao_atendidas: 1 } },
  clientes: [
    { situacao: 'pagou', primeira: '09:00', ultima: '09:30' },
    { situacao: 'prometeu', primeira: '10:00', ultima: '10:10' },
    { situacao: 'respondeu_sem_pagar', primeira: '11:00', ultima: '11:20' },
    { situacao: 'sem_retorno', primeira: '12:00', ultima: '12:00' },
    { situacao: 'sem_retorno', primeira: '13:00', ultima: '13:00' },
    { situacao: 'so_boleto', primeira: '14:00', ultima: '14:00' },
  ],
};

describe('relatório em PDF', () => {
  it('conta os grupos como o gerador do e-mail', () => {
    const d = dadosDoDia(dia, {}, new Date('2026-11-05T19:40:00Z'));
    expect(d.periodo).toBe('00:00 a 16:40');
    expect(d.resumo.conversas).toBe(6);
    expect(d.resumo.finalizacao_min).toBe(10);
    expect(contar(d.resumo, d.clientes)).toEqual({ sp: 1, nr: 2, pp: 2, outros: 1 });
    expect(d.resumo.lig_completo).toBe(true);
    expect(dadosDoDia({ ...dia, resumo: { ...dia.resumo, ligacoes: { fonte: 'evolution' } } }, {}).resumo.lig_completo).toBe(false);
  });

  it('formata valores, tempo e nome do arquivo', () => {
    expect(brl(1234567.8)).toBe('R$ 1.234.567,80');
    expect(duracao(75)).toBe('1 h 15 min');
    expect(duracao(null)).toBe(null);
    expect(nomeDoArquivo('2026-11-05')).toBe('RelatorioCobranca-05-11-2026.pdf');
  });

  it('gera uma página A4 com os totais do Omie', async () => {
    const f = {
      data: '2026-11-05', inicio: '2026-01-01', totais_ate: '2026-11-05', atualizado: '2026-11-05T19:40:00Z',
      recebido_total: 3236886.15, inadimplencia_total: 470202.68, titulos: 3695, titulos_inadimplentes: 529,
      inicio_mes: '2026-11-01', fim_mes: '2026-11-30', recebido_mes: 7837.89, titulos_mes: 40, inadimplencia_mes: 0,
      titulos_inadimplentes_mes: 0, a_vencer_mes: 403120.38, titulos_a_vencer_mes: 357, faturado_mes: 412515.65,
      titulos_faturado_mes: 397, recebido_no_mes: 11425.49, titulos_recebidos_no_mes: 46,
    };
    const doc = await gerarPdf(dadosDoDia(dia, f, new Date('2026-11-05T19:40:00Z')), { quem: 'Marcus Campos' });
    expect(doc.getNumberOfPages()).toBe(1);
    const pdf = doc.output();
    expect(pdf.startsWith('%PDF')).toBe(true);
  });
});

describe('busca dentro da conversa', () => {
  it('recorta em volta do termo, sem diferença de acento', () => {
    const p = trecho('Bom dia! Segue a segunda via do boleto de outubro, com a ação combinada.', 'acao', 10);
    expect(p.achado).toBe('ação');
    expect(p.antes.startsWith('…')).toBe(true);
    expect(trecho('nada aqui', 'boleto').achado).toBe('');
  });
});
