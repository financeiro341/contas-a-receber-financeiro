import { useCallback, useEffect, useRef, useState } from 'react';
import { SITUACOES } from '../constants.js';
import { pct } from '../utils/formato.js';

export function Kpi({ icone, rotulo, valor, apoio, dinheiro }) {
  return (
    <div className="cartao kpi">
      <div className="rotulo">{icone && <i className={`ti ${icone}`} aria-hidden="true" />}{rotulo}</div>
      <div className={`valor${dinheiro ? ' dinheiro' : ''}`}>{valor}</div>
      {apoio && <div className="apoio">{apoio}</div>}
    </div>
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
  return { ...estado, recarregar: () => carregar(false) };
}

export function Estado({ carregando, erro, children }) {
  if (erro) return <div className="aviso erro" role="alert"><i className="ti ti-alert-triangle" aria-hidden="true" />{erro.message}</div>;
  if (carregando) return <div className="carregando" role="status">Carregando…</div>;
  return children;
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
