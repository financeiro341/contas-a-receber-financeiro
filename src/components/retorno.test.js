import { describe, expect, it } from 'vitest';
import { atalhosRetorno, rotuloRetorno } from './AcoesConversa.jsx';

describe('lembrete de retorno', () => {
  it('na quinta: amanhã é sexta, próxima segunda e uma semana', () => {
    const a = atalhosRetorno('2026-11-05');
    expect(a.map((x) => x.dia)).toEqual(['2026-11-06', '2026-11-08', '2026-11-09', '2026-11-12']);
    expect(a[0].rotulo).toBe('Amanhã');
  });
  it('na sexta o primeiro atalho é segunda, sem repetir a próxima segunda', () => {
    const a = atalhosRetorno('2026-11-06');
    expect(a[0]).toEqual({ rotulo: 'Segunda', dia: '2026-11-09' });
    expect(a.filter((x) => x.dia === '2026-11-09')).toHaveLength(1);
  });
  it('rótulo de hoje, amanhã, atrasado e outra data', () => {
    expect(rotuloRetorno({ dia: '2026-11-05', hora: '09:30' }, '2026-11-05')).toBe('hoje às 09:30');
    expect(rotuloRetorno({ dia: '2026-11-06' }, '2026-11-05')).toBe('amanhã');
    expect(rotuloRetorno({ dia: '2026-11-03' }, '2026-11-05')).toBe('atrasado (03/11)');
    expect(rotuloRetorno({ dia: '2026-11-20' }, '2026-11-05')).toBe('20/11');
  });
});
