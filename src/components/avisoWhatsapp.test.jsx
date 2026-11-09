import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FaixaWhatsapp } from './AvisoWhatsapp.jsx';
import { INTERVALO_VIGIA, VIGIA_URL, lerSituacaoVigia, textoAvisoWhatsapp, vigiarWhatsapp } from '../lib/vigia.js';

// 17:05 UTC = 14:05 em Brasília.
const EM = '2026-11-09T17:05:00.000+00:00';

describe('texto do aviso do WhatsApp', () => {
  it('falha: avisa o problema e a hora da última conferência em Brasília', () => {
    expect(textoAvisoWhatsapp({ situacao: 'falha', verificado_em: EM })).toBe(
      'WhatsApp do financeiro com problema na automação. Conversas, respostas e confirmações de envio podem não estar chegando a este sistema, e os números do dia podem ficar incompletos. O Marcus já foi avisado. Última conferência às 14:05.',
    );
  });
  it('vigia parado: avisa que o vigia parou', () => {
    expect(textoAvisoWhatsapp({ situacao: 'vigia_parado', verificado_em: EM }))
      .toBe('O vigia do WhatsApp do financeiro parou de conferir. Última conferência às 14:05. O Marcus já foi avisado.');
  });
  it('sem hora válida, não inventa a hora', () => {
    expect(textoAvisoWhatsapp({ situacao: 'vigia_parado', verificado_em: 'xx' }))
      .toBe('O vigia do WhatsApp do financeiro parou de conferir. O Marcus já foi avisado.');
  });
  it.each(['ok', 'atencao', 'sem_dados', 'erro', 'outra'])('"%s" não mostra nada', (situacao) => {
    expect(textoAvisoWhatsapp({ situacao, verificado_em: EM })).toBeNull();
  });
  it('sem resposta não mostra nada', () => {
    expect(textoAvisoWhatsapp(null)).toBeNull();
  });
});

describe('faixa do WhatsApp', () => {
  it('falha: faixa vermelha com role="alert"', () => {
    const html = renderToStaticMarkup(<FaixaWhatsapp resposta={{ situacao: 'falha', verificado_em: EM }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aviso-whatsapp falha');
    expect(html).toContain('Última conferência às 14:05.');
  });
  it('vigia parado: faixa âmbar', () => {
    const html = renderToStaticMarkup(<FaixaWhatsapp resposta={{ situacao: 'vigia_parado', verificado_em: EM }} />);
    expect(html).toContain('aviso-whatsapp parado');
    expect(html).toContain('parou de conferir');
  });
  it.each(['ok', 'atencao', 'sem_dados'])('"%s": nenhuma faixa', (situacao) => {
    expect(renderToStaticMarkup(<FaixaWhatsapp resposta={{ situacao, verificado_em: EM }} />)).toBe('');
  });
  it('sem resposta (erro de rede): nenhuma faixa', () => {
    expect(renderToStaticMarkup(<FaixaWhatsapp resposta={null} />)).toBe('');
  });
});

const resposta = (corpo, ok = true) => ({ ok, json: async () => corpo });

describe('consulta ao vigia', () => {
  it('faz POST com {"acao":"situacao"} e devolve a situação', async () => {
    const buscar = vi.fn(async () => resposta({ ok: true, situacao: 'falha', verificado_em: EM }));
    expect(await lerSituacaoVigia(buscar)).toEqual({ situacao: 'falha', verificado_em: EM });
    const [url, opcoes] = buscar.mock.calls[0];
    expect(url).toBe(VIGIA_URL);
    expect(opcoes.method).toBe('POST');
    expect(opcoes.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opcoes.body)).toEqual({ acao: 'situacao' });
    expect(opcoes.headers.Authorization).toBeUndefined();
  });
  it('erro de rede devolve null, sem lançar erro', async () => {
    expect(await lerSituacaoVigia(async () => { throw new TypeError('Failed to fetch'); })).toBeNull();
  });
  it('HTTP com erro devolve null', async () => {
    expect(await lerSituacaoVigia(async () => resposta({ ok: true, situacao: 'falha' }, false))).toBeNull();
  });
  it('resposta estranha devolve null', async () => {
    expect(await lerSituacaoVigia(async () => resposta({ ok: false, situacao: 'falha' }))).toBeNull();
    expect(await lerSituacaoVigia(async () => resposta({ situacao: 'falha' }))).toBeNull();
    expect(await lerSituacaoVigia(async () => resposta({ ok: true, situacao: 3 }))).toBeNull();
    expect(await lerSituacaoVigia(async () => resposta(null))).toBeNull();
    expect(await lerSituacaoVigia(async () => ({ ok: true, json: async () => { throw new SyntaxError('html'); } }))).toBeNull();
  });
  it('consulta que não responde é cancelada e devolve null', async () => {
    const buscar = (_url, { signal }) => new Promise((_ok, falhou) => signal.addEventListener('abort', () => falhou(new Error('abortado'))));
    expect(await lerSituacaoVigia(buscar, 10)).toBeNull();
  });
});

function alvoDeEventos(extra = {}) {
  const ouvintes = {};
  return {
    ...extra,
    addEventListener: (nome, fn) => { (ouvintes[nome] ||= new Set()).add(fn); },
    removeEventListener: (nome, fn) => { ouvintes[nome]?.delete(fn); },
    disparar: (nome) => ouvintes[nome]?.forEach((fn) => fn()),
    quantos: (nome) => ouvintes[nome]?.size || 0,
  };
}

describe('quando o sistema consulta o vigia', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('ao abrir, a cada 5 minutos e quando a janela volta ao foco; para ao sair', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(EM));
    const janela = alvoDeEventos();
    const documento = alvoDeEventos({ visibilityState: 'visible' });
    const ler = vi.fn(async () => ({ situacao: 'ok', verificado_em: EM }));
    const aoMudar = vi.fn();
    const parar = vigiarWhatsapp({ ler, aoMudar, janela, documento });
    expect(ler).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(aoMudar).toHaveBeenLastCalledWith({ situacao: 'ok', verificado_em: EM });

    await vi.advanceTimersByTimeAsync(INTERVALO_VIGIA);
    expect(ler).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60000);
    janela.disparar('focus');
    documento.disparar('visibilitychange'); // chega junto com o foco: não repete
    expect(ler).toHaveBeenCalledTimes(3);

    // Aba em segundo plano: não consulta no intervalo.
    documento.visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(INTERVALO_VIGIA);
    expect(ler).toHaveBeenCalledTimes(3);

    parar();
    expect(janela.quantos('focus')).toBe(0);
    expect(documento.quantos('visibilitychange')).toBe(0);
    documento.visibilityState = 'visible';
    await vi.advanceTimersByTimeAsync(INTERVALO_VIGIA * 2);
    expect(ler).toHaveBeenCalledTimes(3);
  });

  it('falha de rede na consulta seguinte tira a faixa (sem alarme falso)', async () => {
    vi.useFakeTimers();
    const ler = vi.fn()
      .mockResolvedValueOnce({ situacao: 'falha', verificado_em: EM })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const aoMudar = vi.fn();
    const parar = vigiarWhatsapp({ ler, aoMudar, janela: alvoDeEventos(), documento: alvoDeEventos({ visibilityState: 'visible' }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(aoMudar).toHaveBeenLastCalledWith({ situacao: 'falha', verificado_em: EM });
    await vi.advanceTimersByTimeAsync(INTERVALO_VIGIA);
    expect(aoMudar).toHaveBeenLastCalledWith(null);
    parar();
  });

  it('resposta que chega depois de sair é ignorada', async () => {
    let soltar;
    const ler = () => new Promise((ok) => { soltar = ok; });
    const aoMudar = vi.fn();
    const parar = vigiarWhatsapp({ ler, aoMudar, janela: alvoDeEventos(), documento: alvoDeEventos({ visibilityState: 'visible' }) });
    parar();
    soltar({ situacao: 'falha', verificado_em: EM });
    await Promise.resolve();
    expect(aoMudar).not.toHaveBeenCalled();
  });
});
