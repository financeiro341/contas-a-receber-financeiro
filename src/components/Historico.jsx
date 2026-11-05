import { useState } from 'react';
import { lerHistorico } from '../lib/api.js';
import { PAGARAM_OU_PROMETERAM } from '../constants.js';
import { dataCurta, inteiro, minutos, pct, somarDias } from '../utils/formato.js';
import { Barras, Estado, Kpi, Vazio, baixarCsv, useDados } from './comum.jsx';

// As mensagens completas dos clientes existem no banco desde 01/11/2026.
export const INICIO_DADOS = '2026-11-01';
const PERIODOS = [['7', '7 dias'], ['30', '30 dias'], ['mes', 'Mês do dia escolhido']];

export default function Historico({ dia, abrirDia }) {
  const [periodo, setPeriodo] = useState('30');
  let de = periodo === 'mes' ? `${dia.slice(0, 8)}01` : somarDias(dia, -(Number(periodo) - 1));
  if (de < INICIO_DADOS) de = INICIO_DADOS;
  const { dados, erro, carregando, recarregar } = useDados(() => lerHistorico(de, dia), [de, dia]);
  const dias = dados?.dias || [];
  const soma = (k) => dias.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const pp = (d) => PAGARAM_OU_PROMETERAM.reduce((s, k) => s + (d.por_situacao?.[k] || 0), 0);
  const pag = (d) => (d.por_situacao?.pagou || 0) + (d.por_situacao?.pagou_parcial || 0);
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
      <div className="ferramentas">
        <div className="periodos" role="group" aria-label="Período">
          {PERIODOS.map(([k, r]) => <button key={k} type="button" aria-pressed={periodo === k} onClick={() => setPeriodo(k)}>{r}</button>)}
        </div>
        <span className="linha-status" style={{ margin: 0 }}>De {dataCurta(de)} a {dataCurta(dia)}, só dias úteis. Dados desde 01/11/2026.</span>
      </div>
      <Estado carregando={carregando} erro={erro} recarregar={recarregar}>
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
          {dias.length === 0 ? <Vazio icone="ti-chart-bar-off" titulo="Sem cobranças no período" texto="Escolha um período maior ou outro dia." /> : (
            <Barras
              rotulos={dias.map((d) => dataCurta(d.dia))}
              series={[
                { nome: 'cobrados', classe: 'b1', valores: dias.map((d) => d.cobrados) },
                { nome: 'responderam', classe: 'b2', valores: dias.map((d) => d.responderam) },
              ]}
            />
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
                      <td><span className={`selo ${d.fonte === 'claude' ? 'claude' : 'regras'}`}>{d.fonte === 'claude' ? 'Claude' : 'Prévia'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="cartao" aria-labelledby="t-recorrentes">
            <h2 id="t-recorrentes"><i className="ti ti-repeat" aria-hidden="true" />Mais vezes sem retorno</h2>
            <div className="sub">Clientes cobrados que não responderam em 2 dias ou mais do período (leitura do Claude).</div>
            {(dados?.recorrentes || []).length === 0 ? <Vazio icone="ti-mood-smile" titulo="Ninguém até agora" texto="Aparece aqui quem ficar sem retorno em 2 dias ou mais." /> : (
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
