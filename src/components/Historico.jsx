import { useState } from 'react';
import { lerHistorico } from '../lib/api.js';
import { PAGARAM_OU_PROMETERAM } from '../constants.js';
import { dataCurta, dataLonga, inteiro, minutos, pct, somarDias } from '../utils/formato.js';
import { Barras, Estado, Kpi, Vazio, baixarCsv, iniciais, useDados } from './comum.jsx';

// As mensagens completas dos clientes existem no banco desde 01/11/2026.
export const INICIO_DADOS = '2026-11-01';
const PERIODOS = [['7', '7 dias'], ['30', '30 dias'], ['mes', 'Mês do dia escolhido']];

// Visual novo (06/11/2026): mesmo molde da Cobrança do dia e do Atendimento.
// Início de cada período, sem passar de 01/11/2026 (antes disso não há dados).
function inicioDe(periodo, dia) {
  const de = periodo === 'mes' ? `${dia.slice(0, 8)}01` : somarDias(dia, -(Number(periodo) - 1));
  return de < INICIO_DADOS ? INICIO_DADOS : de;
}

export default function Historico({ dia, abrirDia }) {
  const [periodo, setPeriodo] = useState('30');
  // Só aparecem os períodos que mudam alguma coisa (pedido do Marcus, 06/11/2026): no começo dos dados os três davam o
  // mesmo intervalo e os botões pareciam quebrados. Com dois períodos iguais, fica o primeiro deles.
  const vistos = new Set();
  const opcoes = PERIODOS.filter(([k]) => { const de = inicioDe(k, dia); return vistos.has(de) ? false : vistos.add(de); });
  const escolhido = opcoes.some(([k]) => k === periodo) ? periodo : (opcoes.find(([k]) => inicioDe(k, dia) === inicioDe(periodo, dia)) || opcoes[0])[0];
  const de = inicioDe(escolhido, dia);
  const { dados, erro, carregando, recarregar } = useDados(() => lerHistorico(de, dia), [de, dia]);
  const dias = dados?.dias || [];
  const soma = (k) => dias.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const pp = (d) => PAGARAM_OU_PROMETERAM.reduce((s, k) => s + (d.por_situacao?.[k] || 0), 0);
  const pag = (d) => (d.por_situacao?.pagou || 0) + (d.por_situacao?.pagou_parcial || 0);
  const medianas = dias.map((d) => d.primeira_resposta_mediana_min).filter((v) => v != null).sort((x, y) => x - y);
  const medianaPeriodo = medianas.length ? medianas[Math.floor(medianas.length / 2)] : null;
  const cobrados = soma('cobrados');
  const responderam = soma('responderam');
  const totalPp = dias.reduce((s, d) => s + pp(d), 0);
  const proporcao = (n, t) => (t ? Math.round((n / t) * 100) : 0);

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
      <div className="cabeca-dia">
        <div>
          <p className="ola">Histórico da cobrança</p>
          <p className="data-pagina">{de === dia ? dataLonga(dia) : `De ${dataCurta(de)} a ${dataCurta(dia)}`}</p>
        </div>
        <div className="estado-leitura">
          {opcoes.length > 1 ? (
            <div className="periodos" role="group" aria-label="Período">
              {opcoes.map(([k, r]) => <button key={k} type="button" aria-pressed={escolhido === k} onClick={() => setPeriodo(k)}>{r}</button>)}
            </div>
          ) : (
            <span className="selo-periodo">Tudo desde 01/11/2026</span>
          )}
        </div>
      </div>
      <p className="nota-periodo">Só dias úteis. Os dados começam em 01/11/2026{opcoes.length > 1 ? '' : ': até lá, 7 dias, 30 dias e o mês dão o mesmo período, por isso a escolha aparece só quando fizer diferença'}.</p>
      <Estado carregando={carregando} erro={erro} recarregar={recarregar}>
        <section className="grade g-kpi4" aria-label="Resumo do período">
          <Kpi icone="ti-send" rotulo="Cobranças no período" valor={inteiro(cobrados)} apoio={`${dias.length} ${dias.length === 1 ? 'dia' : 'dias'} com cobrança`} />
          <Kpi icone="ti-message-check" rotulo="Taxa de resposta" valor={pct(responderam, cobrados)} apoio={`${inteiro(responderam)} responderam`} barra={proporcao(responderam, cobrados)} corBarra="--sit-prometeu" />
          <Kpi icone="ti-cash" rotulo="Pagou ou prometeu" valor={inteiro(totalPp)} apoio={`${inteiro(dias.reduce((s, d) => s + pag(d), 0))} com pagamento`} barra={proporcao(totalPp, cobrados)} corBarra="--sit-pagou" />
          <Kpi icone="ti-clock-play" rotulo="Primeira resposta" valor={minutos(medianaPeriodo)} apoio="mediana dos dias do período" />
        </section>

        <div className="grade grade-historico bloco">
          <section className="cartao grafico-cheio" aria-labelledby="t-evolucao">
            <div className="cartao-topo">
              <h2 id="t-evolucao">Cobrados e responderam por dia</h2>
              <div className="legenda-grafico">
                <span><span className="bolinha" style={{ background: 'var(--grafico-serie)' }} aria-hidden="true" />cobrados</span>
                <span><span className="bolinha" style={{ background: 'var(--grafico-destaque)' }} aria-hidden="true" />responderam</span>
              </div>
            </div>
            {dias.length === 0 ? <Vazio icone="ti-chart-bar-off" titulo="Sem cobranças no período" texto="Escolha um período maior ou outro dia." /> : (
              <Barras
                altura={null}
                rotulos={dias.map((d) => dataCurta(d.dia))}
                series={[
                  { nome: 'cobrados', classe: 'b1', valores: dias.map((d) => d.cobrados) },
                  { nome: 'responderam', classe: 'b2', valores: dias.map((d) => d.responderam) },
                ]}
              />
            )}
          </section>
          <section className="cartao" aria-labelledby="t-recorrentes">
            <div className="cartao-topo">
              <h2 id="t-recorrentes">Mais vezes sem retorno</h2>
            </div>
            <p className="sub" style={{ margin: '-4px 0 8px' }}>Clientes cobrados que não responderam em 2 dias ou mais do período (leitura do Claude).</p>
            {(dados?.recorrentes || []).length === 0 ? <Vazio icone="ti-mood-smile" titulo="Ninguém até agora" texto="Aparece aqui quem ficar sem retorno em 2 dias ou mais." /> : (
              <ul className="lista-recorrentes" tabIndex={dados.recorrentes.length > 6 ? 0 : undefined} aria-label="Clientes mais vezes sem retorno">
                {dados.recorrentes.map((c) => (
                  <li key={c.contato_id}>
                    <span className="avatar sit-sem_retorno" aria-hidden="true">{iniciais(c.nome) || <i className="ti ti-user" />}</span>
                    <span className="nome">{c.nome}</span>
                    <span className="espera atraso">{c.dias} dias</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

          <section className="cartao tabela-cartao bloco" aria-labelledby="t-dias">
            <div className="cartao-topo cartao-topo-tabela">
              <h2 id="t-dias">Dia a dia <span className="mini">clique num dia para abrir a cobrança dele</span></h2>
              <button className="botao" type="button" onClick={exportar} disabled={!dias.length}><i className="ti ti-download" aria-hidden="true" />Exportar</button>
            </div>
            {dias.length === 0 ? <Vazio icone="ti-calendar-off" titulo="Nenhum dia com cobrança no período" /> : (
              <div className="rolagem">
                <table className="tabela em-cartoes">
                  <thead><tr><th>Dia</th><th className="num">Cobrados</th><th className="num">Resposta</th><th className="num">Pagou ou prometeu</th><th className="num">1ª resposta</th><th>Leitura</th></tr></thead>
                  <tbody>
                    {[...dias].reverse().map((d) => (
                      <tr key={d.dia} className="clicavel" onClick={() => abrirDia(d.dia)}>
                        <td><button type="button" className="linha-botao nome" onClick={(e) => { e.stopPropagation(); abrirDia(d.dia); }}>{dataCurta(d.dia)}<span className="so-leitor">, abrir o dia</span></button></td>
                        <td className="num" data-rotulo="Cobrados">{inteiro(d.cobrados)}</td>
                        <td className="num" data-rotulo="Resposta">
                          <span className="mini-barra">{pct(d.responderam, d.cobrados)}<span className="t t-azul" aria-hidden="true"><i style={{ width: pct(d.responderam, d.cobrados) }} /></span></span>
                        </td>
                        <td className="num" data-rotulo="Pagou ou prometeu">{inteiro(pp(d))}</td>
                        <td className="num" data-rotulo="1ª resposta">{minutos(d.primeira_resposta_mediana_min)}</td>
                        <td><span className={`etiqueta-sit ${d.fonte === 'claude' ? 'sit-pagou' : 'sit-respondeu_sem_pagar'}`}>{d.fonte === 'claude' ? 'Claude' : 'Prévia'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
      </Estado>
    </>
  );
}
