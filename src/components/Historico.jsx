import { useState } from 'react';
import { lerHistorico } from '../lib/api.js';
import { PAGARAM_OU_PROMETERAM } from '../constants.js';
import { dataCurta, inteiro, minutos, pct, somarDias } from '../utils/formato.js';
import { Estado, Kpi, baixarCsv, useDados } from './comum.jsx';

// As mensagens completas dos clientes existem no banco desde 01/11/2026.
export const INICIO_DADOS = '2026-11-01';
const PERIODOS = [['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['mes', 'Mês do dia escolhido']];

export default function Historico({ dia, abrirDia }) {
  const [periodo, setPeriodo] = useState('30');
  let de = periodo === 'mes' ? `${dia.slice(0, 8)}01` : somarDias(dia, -(Number(periodo) - 1));
  if (de < INICIO_DADOS) de = INICIO_DADOS;
  const { dados, erro, carregando } = useDados(() => lerHistorico(de, dia), [de, dia]);
  const dias = dados?.dias || [];
  const soma = (k) => dias.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const pp = (d) => PAGARAM_OU_PROMETERAM.reduce((s, k) => s + (d.por_situacao?.[k] || 0), 0);
  const pag = (d) => (d.por_situacao?.pagou || 0) + (d.por_situacao?.pagou_parcial || 0);
  const max = Math.max(1, ...dias.map((d) => d.cobrados));
  const medianas = dias.map((d) => d.primeira_resposta_mediana_min).filter((v) => v != null).sort((x, y) => x - y);
  const medianaPeriodo = medianas.length ? medianas[Math.floor(medianas.length / 2)] : null;

  function exportar() {
    baixarCsv(`historico-${de}-a-${dia}.csv`, [
      { rotulo: 'Dia', valor: (d) => d.dia },
      { rotulo: 'Fonte', valor: (d) => (d.fonte === 'claude' ? 'Leitura do Claude' : 'Regras') },
      { rotulo: 'Clientes cobrados', valor: (d) => d.cobrados },
      { rotulo: 'Responderam', valor: (d) => d.responderam },
      { rotulo: 'Sem resposta', valor: (d) => d.sem_resposta },
      { rotulo: 'Pagaram ou prometeram', valor: pp },
      { rotulo: 'Com pagamento', valor: pag },
      { rotulo: 'Boletos enviados', valor: (d) => d.boletos },
      { rotulo: 'Ligações', valor: (d) => d.ligacoes },
      { rotulo: 'Conversas de clientes', valor: (d) => d.conversas },
      { rotulo: 'Primeira resposta, mediana (min)', valor: (d) => d.primeira_resposta_mediana_min },
    ], dias);
  }

  return (
    <>
      <div className="ferramentas" role="group" aria-label="Período">
        {PERIODOS.map(([k, r]) => <button key={k} type="button" className={`botao${periodo === k ? ' principal' : ''}`} aria-pressed={periodo === k} onClick={() => setPeriodo(k)}>{r}</button>)}
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)', marginLeft: 'auto' }}>De {dataCurta(de)} a {dataCurta(dia)} · dias úteis · dados desde 01/11/2026</span>
      </div>
      <Estado carregando={carregando} erro={erro}>
        <section className="grade g-4" aria-label="Resumo do período">
          <Kpi icone="ti-users" rotulo="Cobranças no período" valor={inteiro(soma('cobrados'))} apoio={`${dias.length} dias com cobrança`} />
          <Kpi icone="ti-message-check" rotulo="Taxa de resposta" valor={pct(soma('responderam'), soma('cobrados'))} apoio={`${inteiro(soma('responderam'))} responderam`} />
          <Kpi icone="ti-cash" rotulo="Pagaram ou prometeram" valor={inteiro(dias.reduce((s, d) => s + pp(d), 0))} apoio={`${inteiro(dias.reduce((s, d) => s + pag(d), 0))} com pagamento`} />
          <Kpi icone="ti-clock-play" rotulo="Primeira resposta" valor={minutos(medianaPeriodo)} apoio="Mediana dos dias" />
        </section>

        <section className="cartao bloco" aria-labelledby="t-evolucao">
          <h2 id="t-evolucao"><i className="ti ti-chart-bar" aria-hidden="true" />Cobrados e responderam por dia</h2>
          <div className="sub" style={{ display: 'flex', gap: 14 }}>
            <span><span className="bolinha" style={{ background: 'var(--grafico-serie)' }} aria-hidden="true" /> Cobrados</span>
            <span><span className="bolinha" style={{ background: 'var(--grafico-destaque)' }} aria-hidden="true" /> Responderam</span>
          </div>
          {dias.length === 0 ? <div className="vazio">Sem cobranças no período.</div> : (
            <>
              <div className="barras" role="img" aria-label={dias.map((d) => `${dataCurta(d.dia)}: ${d.cobrados} cobrados, ${d.responderam} responderam`).join('; ')}>
                {dias.map((d) => (
                  <div className="col" key={d.dia}>
                    <div className="par">
                      <i className="b1" style={{ height: `${(d.cobrados / max) * 100}%` }} title={`${dataCurta(d.dia)}: ${d.cobrados} cobrados`} />
                      <i className="b2" style={{ height: `${(d.responderam / max) * 100}%` }} title={`${dataCurta(d.dia)}: ${d.responderam} responderam`} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="eixo" aria-hidden="true">{dias.map((d) => <span key={d.dia}>{dataCurta(d.dia)}</span>)}</div>
            </>
          )}
        </section>

        <div className="grade g-lado bloco">
          <section className="cartao" aria-labelledby="t-dias">
            <div className="ferramentas">
              <h2 id="t-dias" style={{ marginRight: 'auto' }}><i className="ti ti-calendar" aria-hidden="true" />Dia a dia</h2>
              <button className="botao" type="button" onClick={exportar} disabled={!dias.length}><i className="ti ti-download" aria-hidden="true" />Exportar</button>
            </div>
            <div className="rolagem">
              <table className="tabela">
                <thead><tr><th>Dia</th><th className="num">Cobrados</th><th className="num">Resposta</th><th className="num">Pagaram ou prometeram</th><th className="num">1ª resposta</th><th>Fonte</th></tr></thead>
                <tbody>
                  {[...dias].reverse().map((d) => (
                    <tr key={d.dia} className="clicavel" onClick={() => abrirDia(d.dia)}>
                      <td><button type="button" className="linha-botao nome" onClick={(e) => { e.stopPropagation(); abrirDia(d.dia); }}>{dataCurta(d.dia)}<span className="so-leitor">, abrir o dia</span></button></td>
                      <td className="num">{d.cobrados}</td>
                      <td className="num">{pct(d.responderam, d.cobrados)}</td>
                      <td className="num">{pp(d)}</td>
                      <td className="num">{minutos(d.primeira_resposta_mediana_min)}</td>
                      <td><span className={`selo ${d.fonte === 'claude' ? 'claude' : 'regras'}`}>{d.fonte === 'claude' ? 'Claude' : 'Regras'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="cartao" aria-labelledby="t-recorrentes">
            <h2 id="t-recorrentes"><i className="ti ti-repeat" aria-hidden="true" />Mais vezes sem retorno</h2>
            <div className="sub">Clientes cobrados que não responderam em 2 dias ou mais do período (leitura do Claude).</div>
            {(dados?.recorrentes || []).length === 0 ? <div className="vazio">Ninguém ainda.</div> : (
              <ul className="fila">
                {dados.recorrentes.map((c) => (
                  <li key={c.contato_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 2px', gap: 10 }}>
                    <span className="quem">{c.nome}</span><span className="espera atraso">{c.dias} dias</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Estado>
    </>
  );
}
