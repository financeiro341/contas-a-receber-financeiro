import { describe, expect, it } from 'vitest';
import { diaDe, horaDe, tamanhoArquivo } from './formato.js';

describe('horário de Brasília', () => {
  it('21h30 de Brasília ainda é o mesmo dia', () => {
    expect(diaDe('2026-11-06T00:30:00Z')).toBe('2026-11-05');
    expect(horaDe('2026-11-06T00:30:00Z')).toBe('21:30');
  });
  it('tamanho do arquivo', () => {
    expect(tamanhoArquivo(500)).toBe('500 B');
    expect(tamanhoArquivo(2048)).toBe('2 KB');
    expect(tamanhoArquivo(3.5 * 1024 * 1024)).toBe('3,5 MB');
  });
});
