import { useEffect, useId, useRef, useState } from 'react';
import { FERIADOS, dataLonga, diaSemana, somarDias } from '../utils/formato.js';

// Calendário do topo (06/11/2026): substitui o seletor nativo do navegador, que não aceita o visual do sistema.
// Mostra o mês em grade (domingo a sábado), o dia escolhido em ouro, o dia de hoje com anel, fim de semana e feriado
// apagados (dá para escolher, só ficam em segundo plano) e os dias fora do período com dado desligados.
// Teclado: setas mudam o dia, Page Up/Page Down o mês, Home/End a semana, Enter escolhe e Esc fecha.

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SEMANA = [['D', 'Domingo'], ['S', 'Segunda'], ['T', 'Terça'], ['Q', 'Quarta'], ['Q', 'Quinta'], ['S', 'Sexta'], ['S', 'Sábado']];

const ABREV = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const mesDe = (iso) => iso.slice(0, 7);
const curta = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
function somarMes(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
function diasDoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}
const limitar = (d, min, max) => (d < min ? min : d > max ? max : d);

export default function Calendario({ dia, min, max, hoje, aoEscolher }) {
  const [aberto, setAberto] = useState(false);
  const [mes, setMes] = useState(mesDe(dia));
  const [foco, setFoco] = useState(dia);
  const raiz = useRef(null);
  const botao = useRef(null);
  const grade = useRef(null);
  const id = useId();
  const focarNaGrade = useRef(false);

  const abrir = () => { focarNaGrade.current = true; setMes(mesDe(dia)); setFoco(dia); setAberto(true); };
  const fechar = (devolverFoco = true) => { setAberto(false); if (devolverFoco) botao.current?.focus(); };
  const escolher = (d) => { if (d < min || d > max) return; aoEscolher(d); fechar(); };

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (!raiz.current?.contains(e.target)) fechar(false); };
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ao abrir e ao andar pelo teclado, o foco vai para o dia em foco. Pelas setas do cabeçalho, fica na seta.
  useEffect(() => {
    if (!aberto || !focarNaGrade.current) return;
    focarNaGrade.current = false;
    grade.current?.querySelector(`[data-dia="${foco}"]`)?.focus();
  }, [aberto, foco, mes]);

  const trocarMes = (n) => { const novo = somarMes(mes, n); setMes(novo); setFoco(limitar(ajustarMes(`${mes}-${foco.slice(8)}`, n), min, max)); };
  const moverFoco = (d) => {
    focarNaGrade.current = true;
    const novo = limitar(d, min, max);
    setFoco(novo);
    setMes(mesDe(novo));
  };
  const teclas = (e) => {
    const mapa = {
      ArrowLeft: () => moverFoco(somarDias(foco, -1)),
      ArrowRight: () => moverFoco(somarDias(foco, 1)),
      ArrowUp: () => moverFoco(somarDias(foco, -7)),
      ArrowDown: () => moverFoco(somarDias(foco, 7)),
      Home: () => moverFoco(somarDias(foco, -diaSemana(foco))),
      End: () => moverFoco(somarDias(foco, 6 - diaSemana(foco))),
      PageUp: () => moverFoco(ajustarMes(foco, -1)),
      PageDown: () => moverFoco(ajustarMes(foco, 1)),
      Escape: () => fechar(),
    };
    if (mapa[e.key]) { e.preventDefault(); e.stopPropagation(); mapa[e.key](); }
  };

  const primeiro = `${mes}-01`;
  const vazios = diaSemana(primeiro);
  const total = diasDoMes(mes);
  const dias = Array.from({ length: total }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`);
  const semanas = [];
  const celulas = [...Array(vazios).fill(null), ...dias];
  while (celulas.length % 7) celulas.push(null);
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
  const [ano, m] = mes.split('-').map(Number);
  const podeVoltar = mes > mesDe(min);
  const podeAvancar = mes < mesDe(max);

  return (
    <div className="calendario" ref={raiz}>
      <button
        ref={botao} type="button" className="calendario-gatilho" aria-haspopup="dialog" aria-expanded={aberto}
        aria-label={`Escolher o dia. Dia escolhido: ${dataLonga(dia)}`} onClick={() => (aberto ? fechar() : abrir())}
      >
        <i className="ti ti-calendar-event" aria-hidden="true" />
        <span className="calendario-semana">{ABREV[diaSemana(dia)]}</span>
        <span>{curta(dia)}</span>
      </button>
      {aberto && (
        <div className="calendario-painel" role="dialog" aria-modal="false" aria-labelledby={`${id}-mes`}>
          <div className="calendario-cabeca">
            <button type="button" className="calendario-seta" onClick={() => trocarMes(-1)} disabled={!podeVoltar} aria-label="Mês anterior"><i className="ti ti-chevron-left" aria-hidden="true" /></button>
            <b id={`${id}-mes`} aria-live="polite">{MESES[m - 1]} <span>{ano}</span></b>
            <button type="button" className="calendario-seta" onClick={() => trocarMes(1)} disabled={!podeAvancar} aria-label="Próximo mês"><i className="ti ti-chevron-right" aria-hidden="true" /></button>
          </div>
          <table className="calendario-grade" role="grid" aria-labelledby={`${id}-mes`} ref={grade} onKeyDown={teclas}>
            <thead>
              <tr>{SEMANA.map(([l, nome], i) => <th key={nome} scope="col" abbr={nome} className={i === 0 || i === 6 ? 'fds' : undefined}>{l}</th>)}</tr>
            </thead>
            <tbody>
              {semanas.map((s, i) => (
                <tr key={i}>
                  {s.map((d, j) => {
                    if (!d) return <td key={j} />;
                    const fora = d < min || d > max;
                    const feriado = FERIADOS.has(d);
                    const fds = [0, 6].includes(diaSemana(d));
                    const classes = ['calendario-dia', d === dia && 'escolhido', d === hoje && 'hoje', (fds || feriado) && 'apagado'].filter(Boolean).join(' ');
                    const extra = [d === hoje && 'hoje', feriado && 'feriado', fds && !feriado && 'fim de semana', fora && 'sem dados'].filter(Boolean).join(', ');
                    return (
                      <td key={j} role="gridcell" aria-selected={d === dia}>
                        <button
                          type="button" className={classes} data-dia={d} tabIndex={d === foco ? 0 : -1} disabled={fora}
                          aria-label={`${dataLonga(d)}${extra ? `, ${extra}` : ''}`} title={feriado ? 'Feriado' : undefined}
                          onClick={() => escolher(d)}
                        >
                          {Number(d.slice(8))}
                          {feriado && <span className="ponto-feriado" aria-hidden="true" />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="calendario-pe">
            <span className="calendario-legenda"><span className="amostra-hoje" aria-hidden="true" />Hoje<span className="amostra-feriado" aria-hidden="true" />Feriado</span>
            <button type="button" className="calendario-hoje" onClick={() => escolher(hoje)} disabled={dia === hoje}>Ir para hoje</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Mesmo dia no mês vizinho; se o mês não tiver esse dia (31 em mês de 30), cai no último.
function ajustarMes(iso, n) {
  const alvo = somarMes(mesDe(iso), n);
  const d = Math.min(Number(iso.slice(8)), diasDoMes(alvo));
  return `${alvo}-${String(d).padStart(2, '0')}`;
}
