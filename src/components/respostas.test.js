import { describe, expect, it } from 'vitest';
import { preencher } from './RespostasProntas.jsx';

describe('respostas prontas', () => {
  it('troca {nome} e {empresa}', () => {
    expect(preencher('Olá, {nome}! Segue o boleto da {empresa}.', { nome: 'REINAN almeida' }, [{ empresa: 'DOCTOR LENTES LTDA' }]))
      .toBe('Olá, Reinan! Segue o boleto da DOCTOR LENTES LTDA.');
  });
  it('sem nome (só telefone) não deixa vírgula solta', () => {
    expect(preencher('Olá, {nome}! Tudo bem?', { nome: '557592394611' }, [])).toBe('Olá! Tudo bem?');
  });
});
