import { describe, expect, it } from 'vitest';
import { textoSegundaVia } from './SegundaVia.jsx';

describe('segunda via', () => {
  it('monta a mensagem com nome, categoria, vencimento, valor e código de barras', () => {
    const t = { categoria: 'Adicional anual', vencimento: '2026-11-10', valor: 810.5, codigo_barras: '03399.06208' };
    const txt = textoSegundaVia(t, { nome: 'Financeiro BIMais' }, []);
    expect(txt.split('\n')[0]).toBe('Olá, Financeiro! Segue a segunda via do boleto (adicional anual).');
    expect(txt).toContain('Vencimento: 10/11/2026');
    expect(txt).toMatch(/Valor: R\$\s810,50/);
    expect(txt).toContain('Código de barras: 03399.06208');
  });
  it('categoria só com código não aparece no texto', () => {
    expect(textoSegundaVia({ categoria: '1.01.01', vencimento: '2026-11-10', valor: 1 }, { nome: '5575999' }, []).split('\n')[0])
      .toBe('Olá! Segue a segunda via do boleto.');
  });
});
