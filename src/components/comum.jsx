import { useCallback, useEffect, useRef, useState } from 'react';
import { SITUACOES } from '../constants.js';
import { pct } from '../utils/formato.js';

// Número de resumo. Com aoClicar, vira botão (pedido do Marcus, 06/11/2026: clicar no número filtra a lista).
export function Kpi({ icone, rotulo, valor, apoio, dinheiro, tom, aoClicar, ativo }) {
  const conteudo = (
    <>
      <div className="rotulo">{icone && <i className={`ti ${icone}`} aria-hidden="true" />}{rotulo}</div>
      <div className={`valor${dinheiro ? ' dinheiro' : ''}`}>{valor}</div>
      {apoio && <div className="apoio">{apoio}</div>}
    </>
  );
  const classe = `cartao kpi${tom ? ` tom-${tom}` : ''}`;
  if (!aoClicar) return <div className={classe}>{conteudo}</div>;
  return (
    <button type="button" className={`${classe} kpi-botao${ativo ? ' ativo' : ''}`} onClick={aoClicar} aria-pressed={!!ativo}
      title={ativo ? 'Clique para tirar o filtro' : 'Clique para ver esses clientes na lista'}>
      {conteudo}
    </button>
  );
}

// Barra empilhada das situações, com legenda que também filtra a lista.
export function PilhaSituacoes({ porSituacao, total, filtro, aoFiltrar }) {
  const partes = SITUACOES.filter((s) => (porSituacao?.[s.id] || 0) > 0);
  return (
    <>
      <div className="pilha" role="img" aria-label={partes.map((s) => `${s.plural}: ${porSituacao[s.id]}`).join(', ') || 'Sem clientes'}>
        {partes.map((s) => <i key={s.id} className={`s-${s.id}`} style={{ flex: `${porSituacao[s.id]} 1 0` }} />)}
      </div>
      <div className="legenda" role="group" aria-label="Filtrar por situação">
        {aoFiltrar && <button type="button" aria-pressed={!filtro} onClick={() => aoFiltrar(null)}>Todas <b>{total}</b></button>}
        {partes.map((s) => (
          <button key={s.id} type="button" aria-pressed={filtro === s.id} onClick={() => aoFiltrar?.(filtro === s.id ? null : s.id)}>
            <span className={`bolinha s-${s.id}`} aria-hidden="true" />{s.plural} <b>{porSituacao[s.id]}</b>
            <span style={{ color: 'var(--text-muted)' }}>{pct(porSituacao[s.id], total)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// Lê os dados e, se pedido, relê sozinho a cada `intervalo` ms (só com a aba visível).
export function useDados(leitor, deps, intervalo) {
  const [estado, setEstado] = useState({ dados: null, erro: null, carregando: true });
  const ref = useRef(leitor);
  ref.current = leitor;
  const carregar = useCallback(async (silencioso) => {
    if (!silencioso) setEstado((e) => ({ ...e, carregando: true, erro: null }));
    try {
      const dados = await ref.current();
      setEstado({ dados, erro: null, carregando: false, em: new Date() });
    } catch (erro) {
      setEstado((e) => ({ ...e, erro, carregando: false }));
    }
  }, []);
  useEffect(() => { carregar(false); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!intervalo) return undefined;
    const id = setInterval(() => { if (document.visibilityState === 'visible') carregar(true); }, intervalo);
    return () => clearInterval(id);
  }, [intervalo, carregar]);
  return { ...estado, recarregar: () => carregar(false), atualizar: () => carregar(true) };
}

// Carregando: esqueleto com a forma da página; erro: mensagem e "Tentar de novo".
export function Estado({ carregando, erro, recarregar, forma = 'kpis', children }) {
  if (erro) {
    return (
      <div className="aviso erro" role="alert">
        <i className="ti ti-alert-triangle" aria-hidden="true" />
        <span style={{ flex: 1 }}>{erro.message}</span>
        {recarregar && <button type="button" className="botao" onClick={recarregar}>Tentar de novo</button>}
      </div>
    );
  }
  if (carregando) return <Esqueleto forma={forma} />;
  return children;
}

export function Esqueleto({ forma }) {
  if (forma === 'lista') {
    return (
      <div role="status" aria-label="Carregando" style={{ padding: 12 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="cartao esqueleto" style={{ height: 64, marginBottom: 8 }} />)}
      </div>
    );
  }
  if (forma === 'conversa') {
    return (
      <div role="status" aria-label="Carregando">
        {[60, 40, 70, 45].map((w, i) => <div key={i} className="cartao esqueleto" style={{ height: 52, width: `${w}%`, margin: `8px 0 8px ${i % 2 ? 'auto' : '0'}` }} />)}
      </div>
    );
  }
  const n = forma === 'kpis6' ? 6 : 4;
  return (
    <div role="status" aria-label="Carregando">
      <div className={`grade ${n === 6 ? 'g-kpi' : 'g-4'}`}>
        {Array.from({ length: n }).map((_, i) => <div key={i} className="cartao esqueleto" style={{ height: 112 }} />)}
      </div>
      <div className="cartao esqueleto bloco" style={{ height: 120 }} />
      <div className="cartao esqueleto bloco" style={{ height: 260 }} />
    </div>
  );
}

export function Vazio({ icone = 'ti-mood-empty', titulo, texto }) {
  return (
    <div className="vazio">
      <i className={`ti ${icone}`} aria-hidden="true" style={{ fontSize: 28, color: 'var(--text-muted)' }} />
      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: 6 }}>{titulo}</div>
      {texto && <div style={{ fontSize: 13, marginTop: 2 }}>{texto}</div>}
    </div>
  );
}

// Gráfico de barras em CSS (sem biblioteca), com o valor em cima de cada barra.
export function Barras({ rotulos, series, altura = 170 }) {
  const max = Math.max(1, ...series.flatMap((s) => s.valores));
  const densas = rotulos.length > 12 ? ' densas' : '';
  const descricao = rotulos.map((r, i) => `${r}: ${series.map((s) => `${s.valores[i]} ${s.nome}`).join(', ')}`).join('; ');
  return (
    <div className="grafico">
      <div className={`barras${densas}`} style={{ height: altura }} role="img" aria-label={descricao}>
        {rotulos.map((r, i) => (
          <div className="col" key={r}>
            <div className="par">
              {series.map((s) => (
                <span className="bv" key={s.classe}>
                  {s.valores[i] > 0 && <em>{s.valores[i]}</em>}
                  <i className={s.classe} style={{ height: `${(s.valores[i] / max) * 82}%` }} title={`${r}: ${s.valores[i]} ${s.nome}`} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={`eixo${densas}`} aria-hidden="true">{rotulos.map((r) => <span key={r}>{r}</span>)}</div>
    </div>
  );
}

// CSV com ponto e vírgula (abre direto no Excel em português).
export function baixarCsv(nome, colunas, linhas) {
  const esc = (v) => {
    const t = v == null ? '' : String(v);
    const seguro = /^[=+\-@]/.test(t) ? `'${t}` : t; // evita fórmula no Excel
    return /[;"\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
  };
  const texto = [colunas.map((c) => esc(c.rotulo)).join(';'), ...linhas.map((l) => colunas.map((c) => esc(c.valor(l))).join(';'))].join('\r\n');
  const blob = new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
