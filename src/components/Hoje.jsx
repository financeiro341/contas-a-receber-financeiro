import { useEffect, useMemo, useRef, useState } from 'react';
import { lerDia, lerOmieAgora } from '../lib/api.js';
import { NOME_SITUACAO, ORDEM_SITUACAO, PAGARAM_OU_PROMETERAM } from '../constants.js';
import { brl, dataCurta, dataLonga, inteiro, pct, plural } from '../utils/formato.js';
import { AbasSituacao, Estado, Kpi, Vazio, baixarCsv, iniciais, useDados } from './comum.jsx';
import QuemCobrar from './QuemCobrar.jsx';

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Filtros dos números do topo (06/11/2026): o filtro pode ser uma situação (legenda) ou um destes grupos.
const respondeu = (c) => (c.do_cliente || 0) > 0 || (c.lig_atendidas || 0) > 0;
const GRUPOS = {
  'g:responderam': { nome: 'Responderam', teste: respondeu },
  'g:sem_resposta': { nome: 'Sem resposta', teste: (c) => !respondeu(c) },
  'g:pagou_prometeu': { nome: 'Pagaram ou prometeram', teste: (c) => PAGARAM_OU_PROMETERAM.includes(c.situacao) },
  'g:ligacoes': { nome: 'Com ligação', teste: (c) => (c.ligacoes || 0) > 0 },
  'g:atraso': { nome: 'Com atraso no Omie', teste: (c) => Number(c.atraso_valor || 0) > 0 },
};
const passa = (filtro, c) => !filtro || (GRUPOS[filtro] ? GRUPOS[filtro].teste(c) : c.situacao === filtro);
const nomeFiltro = (filtro) => GRUPOS[filtro]?.nome || NOME_SITUACAO[filtro];

// Saudação pela hora de Feira de Santana.
function saudacao(nome) {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const primeiro = String(nome || '').trim().split(/\s+/)[0];
  return `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}${primeiro ? `, ${primeiro}` : ''}`;
}

export default function Hoje({ dia, ehHoje, nome, abrirConversa, abrirNaCaixa }) {
  const { dados, erro, carregando, em, recarregar } = useDados(() => lerDia(dia), [dia], ehHoje ? 120000 : 0);
  const [filtro, setFiltro] = useState(null);
  const [busca, setBusca] = useState('');

  const r = dados?.resumo || {};

  // "Em atraso" pela API do Omie (pedido do Marcus, 06/11/2026, 14h46): no dia de hoje, se não há cálculo com o atraso por
  // cliente ou o último tem mais de 30 minutos, o sistema consulta o Omie (só consulta) e relê a lista. No máximo uma vez a
  // cada 30 minutos por tela aberta; o cálculo é o mesmo da aba Omie e do Quem cobrar (um por vez para todo o sistema).
  const [omieAuto, setOmieAuto] = useState(null); // null | 'calculando' | { erro }
  const pedidoEm = useRef(0);
  useEffect(() => {
    if (!ehHoje || !dados || omieAuto === 'calculando') return;
    const ultimo = Date.parse(r.atraso_em || '');
    const velho = r.atraso_fonte !== 'api' || Number.isNaN(ultimo) || Date.now() - ultimo > 30 * 60_000;
    if (!velho || Date.now() - pedidoEm.current < 30 * 60_000) return;
    pedidoEm.current = Date.now();
    setOmieAuto('calculando');
    lerOmieAgora(false).then(() => { setOmieAuto(null); recarregar(); }).catch((e) => setOmieAuto({ erro: e.message }));
  }, [dados, ehHoje]); // eslint-disable-line react-hooks/exhaustive-deps
  const horaAtraso = r.atraso_em ? new Date(r.atraso_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }) : '';
  const ps = r.por_situacao || {};
  const pp = PAGARAM_OU_PROMETERAM.reduce((a, k) => a + (ps[k] || 0), 0);
  const lig = r.ligacoes || {};
  const proporcao = (n) => (r.cobrados ? Math.round(((n || 0) / r.cobrados) * 100) : 0);
  const lista = useMemo(() => {
    const q = semAcento(busca);
    // Ordem: pagou, prometeu, respondeu sem pagamento, não respondeu (ORDEM_SITUACAO); no mesmo grupo, a ordem do dia.
    return (dados?.clientes || []).filter((c) => passa(filtro, c)
      && (!q || semAcento(c.nome).includes(q) || (c.empresas || []).some((e) => semAcento(e).includes(q))))
      .map((c, i) => [c, i])
      .sort(([a, i], [b, j]) => ((ORDEM_SITUACAO[a.situacao] ?? 99) - (ORDEM_SITUACAO[b.situacao] ?? 99)) || i - j)
      .map(([c]) => c);
  }, [dados, filtro, busca]);

  // Clicar num número do topo filtra a lista e leva até ela; clicar de novo tira o filtro.
  function filtrarPor(f) {
    const novo = f === null || filtro === f ? null : f;
    setFiltro(novo);
    document.getElementById('t-lista')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exportar() {
    baixarCsv(`cobranca-${dia}.csv`, [
      { rotulo: 'Cliente', valor: (c) => c.nome },
      { rotulo: 'Empresas', valor: (c) => (c.empresas || []).join(' / ') },
      { rotulo: 'Situação', valor: (c) => NOME_SITUACAO[c.situacao] || c.situacao },
      { rotulo: 'Motivo', valor: (c) => c.motivo },
      { rotulo: 'Primeira mensagem', valor: (c) => c.primeira },
      { rotulo: 'Última mensagem', valor: (c) => c.ultima },
      { rotulo: 'Mensagens do cliente', valor: (c) => c.do_cliente },
      { rotulo: 'Boletos enviados', valor: (c) => c.boletos },
      { rotulo: 'Ligações', valor: (c) => c.ligacoes },
      { rotulo: 'Títulos em atraso', valor: (c) => c.atraso_qtd },
      { rotulo: 'Valor em atraso', valor: (c) => (c.atraso_valor == null ? '' : String(c.atraso_valor).replace('.', ',')) },
    ], lista);
  }

  return (
    <Estado carregando={carregando && !dados} erro={!dados && erro} recarregar={recarregar} forma="kpis6">
      {dados && (
        <>
          <div className="cabeca-dia">
            <div>
              {ehHoje && <p className="ola">{saudacao(nome)}</p>}
              <p className="data-pagina">{dataLonga(dia)}</p>
            </div>
            <div className="estado-leitura">
              {dados.fonte === 'claude'
                ? <span><span className="luz ok" aria-hidden="true" />Leitura do Claude, feita depois das 17h30</span>
                : <span title="A leitura do Claude, conversa por conversa, entra depois das 17h30"><span className="luz" aria-hidden="true" />Prévia pelas regras{em ? <>, atualizada às <b>{em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b></> : ''}</span>}
              {erro && <span className="selo regras">Falha ao reler: {erro.message}</span>}
            </div>
          </div>
          <section className="grade g-kpi" aria-label="Resumo do dia">
            <Kpi icone="ti-send" rotulo={plural(r.cobrados, 'Cliente cobrado', 'Clientes cobrados')} valor={inteiro(r.cobrados)} apoio={`${inteiro(r.boletos_enviados)} ${plural(r.boletos_enviados, 'boleto enviado', 'boletos enviados')}`} aoClicar={() => filtrarPor(null)} ativo={false} />
            <Kpi icone="ti-message-check" rotulo="Responderam" valor={inteiro(r.responderam)} apoio={`${pct(r.responderam, r.cobrados)} dos cobrados`} barra={proporcao(r.responderam)} corBarra="--sit-prometeu" aoClicar={() => filtrarPor('g:responderam')} ativo={filtro === 'g:responderam'} />
            <Kpi icone="ti-message-off" tom={r.sem_resposta ? 'perigo' : undefined} rotulo="Sem resposta" valor={inteiro(r.sem_resposta)} apoio={`${pct(r.sem_resposta, r.cobrados)} dos cobrados, só boleto ou sem retorno`} barra={proporcao(r.sem_resposta)} corBarra="--sit-sem" aoClicar={() => filtrarPor('g:sem_resposta')} ativo={filtro === 'g:sem_resposta'} />
            <Kpi icone="ti-cash" rotulo="Pagou ou prometeu" valor={inteiro(pp)} apoio={`${inteiro((ps.pagou || 0) + (ps.pagou_parcial || 0))} com pagamento`} barra={proporcao(pp)} corBarra="--sit-pagou" aoClicar={() => filtrarPor('g:pagou_prometeu')} ativo={filtro === 'g:pagou_prometeu'} />
            <Kpi icone="ti-phone" rotulo="Ligações" valor={inteiro(lig.total)} apoio={`${inteiro(lig.atendidas)} ${plural(lig.atendidas, 'atendida', 'atendidas')}, ${inteiro(lig.feitas)} ${plural(lig.feitas, 'feita', 'feitas')} por nós e ${inteiro((lig.total || 0) - (lig.feitas || 0))} ${plural((lig.total || 0) - (lig.feitas || 0), 'recebida', 'recebidas')}`} aoClicar={() => filtrarPor('g:ligacoes')} ativo={filtro === 'g:ligacoes'} />
            {r.atraso_total == null
              ? <Kpi icone="ti-building-bank" tom="vazio" rotulo="Em atraso no Omie"
                  valor={ehHoje && !omieAuto?.erro ? 'Consultando…' : 'Sem dado'}
                  apoio={omieAuto?.erro ? `Não deu para consultar o Omie: ${omieAuto.erro}` : ehHoje ? 'no Omie, pela API, leva cerca de 1 minuto' : 'dia sem cálculo do Omie guardado'} />
              : <Kpi icone="ti-building-bank" rotulo="Em atraso no Omie" dinheiro valor={brl(r.atraso_total)}
                  apoio={r.atraso_fonte === 'api' ? `Soma dos cobrados, Omie às ${horaAtraso}${omieAuto === 'calculando' ? ' (atualizando)' : ''}` : 'Soma dos cobrados, do relatório das 17h30'}
                  aoClicar={() => filtrarPor('g:atraso')} ativo={filtro === 'g:atraso'} />}
          </section>

          {(dados.retornos || []).length > 0 && (
            <section className="cartao bloco" aria-labelledby="t-retornos">
              <h2 id="t-retornos"><i className="ti ti-alarm" aria-hidden="true" />Retornos {ehHoje ? 'de hoje' : 'do dia'} ({dados.retornos.filter((x) => !x.feito).length} {plural(dados.retornos.filter((x) => !x.feito).length, 'pendente', 'pendentes')})</h2>
              <div className="sub">Clientes com retorno marcado na conversa{ehHoje ? ', mais os atrasados' : ''}. Abra a conversa e marque como feito.</div>
              <ul className="fila lista-retornos" aria-label="Retornos">
                {dados.retornos.map((x) => (
                  <li key={x.id} className={x.feito ? 'lida' : undefined}>
                    <button type="button" onClick={() => abrirNaCaixa(x.contato_id)}>
                      <span className={`espera ${x.feito ? 'ok' : x.atrasado ? 'atraso' : 'atencao'}`}>{x.feito ? 'Feito' : x.atrasado ? `Desde ${dataCurta(x.dia)}` : (x.hora || 'Hoje')}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="quem">{x.nome}</span>
                        <span className="texto" style={{ display: 'block' }}>{(x.empresas || [])[0] ? `${x.empresas[0]} · ` : ''}{x.texto || 'Sem observação'}</span>
                      </span>
                      <span className="desde">{x.feito ? `por ${String(x.feito_por || '').split(' ')[0]}` : `marcado por ${String(x.por).split(' ')[0]}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {ehHoje && <QuemCobrar abrirNaCaixa={abrirNaCaixa} />}

          <section className="bloco lista-cobranca" aria-labelledby="t-lista">
            <div className="ferramentas">
              <h2 id="t-lista">Clientes cobrados</h2>
              <span className="contagem">{lista.length === (dados.clientes || []).length ? inteiro(lista.length) : `${inteiro(lista.length)} de ${inteiro((dados.clientes || []).length)}`}</span>
              {filtro && (
                <span className="chip filtro-ativo">
                  {!GRUPOS[filtro] && <span className={`bolinha s-${filtro}`} aria-hidden="true" />}{nomeFiltro(filtro)}
                  <button type="button" className="limpar" onClick={() => setFiltro(null)} aria-label={`Tirar o filtro ${nomeFiltro(filtro)}`}><i className="ti ti-x" aria-hidden="true" /></button>
                </span>
              )}
              <div className="espaco" />
              <div className="busca">
                <i className="ti ti-search" aria-hidden="true" />
                <input type="search" placeholder="Buscar cliente ou empresa" aria-label="Buscar cliente ou empresa" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              <button className="botao" type="button" onClick={exportar} disabled={!lista.length}><i className="ti ti-download" aria-hidden="true" />Exportar</button>
            </div>
            {(dados.clientes || []).length > 0 && <AbasSituacao porSituacao={ps} total={r.cobrados || 0} filtro={filtro} aoFiltrar={setFiltro} />}
            <div className="cartao tabela-cartao">
            {lista.length === 0 ? (dados.clientes.length ? <Vazio icone="ti-filter-off" titulo="Nenhum cliente com esse filtro" texto="Limpe a busca ou escolha outra situação." /> : <Vazio icone="ti-calendar-off" titulo="Nenhuma cobrança neste dia" texto={ehHoje ? 'Assim que a primeira cobrança sair pelo WhatsApp ela aparece aqui.' : 'Escolha outro dia útil.'} />) : (
              <div className="rolagem">
                <table className="tabela em-cartoes">
                  <thead><tr><th>Cliente</th><th>Situação</th><th className="motivo">Motivo</th><th className="num">Última</th><th className="num">Respostas</th><th className="num">Em atraso</th></tr></thead>
                  <tbody>
                    {lista.map((c) => (
                      <tr key={c.contato_id} className="clicavel" onClick={() => abrirConversa(c.contato_id)}>
                        <td>
                          <div className="cliente-celula">
                            <span className={`avatar sit-${c.situacao}`} aria-hidden="true">{iniciais(c.nome) || <i className="ti ti-user" />}</span>
                            <div className="cliente-texto">
                              <button type="button" className="linha-botao" onClick={(e) => { e.stopPropagation(); abrirConversa(c.contato_id); }}>
                                <span className="nome">{c.nome}</span>
                                <span className="so-leitor">, abrir a conversa</span>
                              </button>
                              {(c.empresas || []).length > 0 && <div className="empresa">{c.empresas.slice(0, 2).join(', ')}{c.empresas.length > 2 ? ` e mais ${c.empresas.length - 2}` : ''}</div>}
                            </div>
                          </div>
                        </td>
                        <td><span className={`etiqueta-sit sit-${c.situacao}`}><span className={`bolinha s-${c.situacao}`} aria-hidden="true" />{NOME_SITUACAO[c.situacao] || c.situacao}</span></td>
                        <td className="motivo">{c.motivo}</td>
                        <td className="num" data-rotulo="Última">{c.ultima || '—'}</td>
                        <td className="num" data-rotulo="Respostas"><span className={`n-resp${c.do_cliente ? '' : ' zero'}`}>{c.do_cliente ? `${c.do_cliente} ${plural(c.do_cliente, 'mensagem', 'mensagens')}` : 'Nenhuma'}</span>{c.ligacoes ? <div className="empresa"><i className="ti ti-phone" aria-hidden="true" /> {c.ligacoes} {plural(c.ligacoes, 'ligação', 'ligações')}{c.lig_atendidas ? `, ${c.lig_atendidas} atendida${c.lig_atendidas > 1 ? 's' : ''}` : ''}</div> : null}</td>
                        <td className="num quebra valor-atraso" data-rotulo="Em atraso">{c.atraso_valor == null ? <span className="mini">sem dado</span> : Number(c.atraso_valor) > 0 ? <b>{brl(c.atraso_valor)}</b> : <span className="mini">{brl(0)}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          </section>
        </>
      )}
    </Estado>
  );
}
