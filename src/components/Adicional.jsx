import { useMemo, useState } from 'react';
import { anotarAdicional, lerAdicional } from '../lib/api.js';
import { SITUACOES, NOME_SITUACAO } from '../constants.js';
import { brl, dataCurta, inteiro, plural } from '../utils/formato.js';
import { NOME_PAGAMENTO, P1, P2, PAGAMENTOS, clientesDoAdicional, deFora, diaADia, historicoPagamentos, metaDeHoje, metasDoMes, resumoParcelas } from '../utils/adicional.js';
import { Estado, Kpi, Vazio, baixarCsv, useDados } from './comum.jsx';

// Aba Adicional Anual (24/11/2026, pedido do Marcus): a cobrança da mensalidade adicional anual de 2026 sem digitação.
// Pagamentos e saldo vêm do Omie (categoria 1.02.97, só consulta, guardado por 10 minutos); a situação de cada cliente vem
// das conversas do WhatsApp (as mesmas regras da Cobrança do dia) e o boleto, das mensagens do PayBot. A equipe só escreve,
// se quiser, uma anotação por cliente. Metas do protótipo aprovadas pelo Marcus (utils/adicional.js).

const POR_PAGINA = 30;
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const horaDe = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(',', ' às');
const pctTexto = (p) => `${Math.floor((p || 0) * 100)}%`;
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const semana = (iso) => DIAS_SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()];

// Status da mensagem do boleto no WhatsApp (o status só avança: enviado, entregue, lido).
const BOLETO = {
  READ: { nome: 'boleto lido', cor: 'cor-verde', icone: 'ti-checks' },
  PLAYED: { nome: 'boleto lido', cor: 'cor-verde', icone: 'ti-checks' },
  DELIVERY_ACK: { nome: 'boleto entregue', cor: 'cor-neutro', icone: 'ti-checks' },
  SERVER_ACK: { nome: 'boleto enviado', cor: 'cor-neutro', icone: 'ti-check' },
  PENDING: { nome: 'boleto saindo', cor: 'cor-neutro', icone: 'ti-clock' },
  ERROR: { nome: 'boleto não entregue', cor: 'cor-vermelho', icone: 'ti-alert-triangle' },
};


export default function Adicional({ abrirNaCaixa }) {
  const { dados, erro, carregando, recarregar } = useDados(() => lerAdicional(false), []);
  const [atualizando, setAtualizando] = useState(null); // null | 'lendo' | { erro }
  const [extra, setExtra] = useState(null); // dados mais novos depois de "Atualizar"
  const [notas, setNotas] = useState({}); // anotações salvas nesta sessão (por cima das que vieram)
  const [vista, setVista] = useState('cobrar');
  const d = extra || dados;

  async function atualizar() {
    setAtualizando('lendo');
    try { setExtra(await lerAdicional(true)); setAtualizando(null); } catch (e) { setAtualizando({ erro: e.message }); }
  }

  const calc = useMemo(() => {
    if (!d) return null;
    const hoje = d.hoje;
    const titulos = d.titulos || [];
    const dias = diaADia(titulos, hoje);
    const comNotas = { ...d, whatsapp: { ...(d.whatsapp || {}), anotacoes: { ...(d.whatsapp?.anotacoes || {}), ...notas } } };
    for (const [k, v] of Object.entries(notas)) if (v === null) delete comNotas.whatsapp.anotacoes[k];
    const out = {
      hoje,
      parcelas: resumoParcelas(titulos),
      meses: metasDoMes(titulos),
      dias,
      metaHoje: metaDeHoje(dias, hoje),
      clientes: clientesDoAdicional(comNotas, hoje),
      pagamentos: historicoPagamentos(d),
      fora: deFora(d),
    };
    out.lista = out.clientes.filter((c) => c.aberto > 0.004);
    return out;
  }, [d, notas]);

  return (
    <>
      <div className="cabeca-dia">
        <div>
          <p className="ola">Mensalidade adicional anual</p>
          <p className="data-pagina">Adicional Anual 2026</p>
        </div>
        <div className="estado-leitura omie-acoes">
          {atualizando === 'lendo'
            ? <span role="status"><i className="ti ti-loader-2 girando" aria-hidden="true" />Consultando o Omie, pode levar até 1 minuto</span>
            : d?.calculado_em && <span><span className={`luz${d.status === 'completo' ? ' ok' : ''}`} aria-hidden="true" />Omie consultado em {horaDe(d.calculado_em)}</span>}
          {atualizando?.erro && <span className="selo regras">Não deu para atualizar agora: {atualizando.erro}</span>}
          {d && <button type="button" className="botao" onClick={atualizar} disabled={atualizando === 'lendo'}><i className="ti ti-refresh" aria-hidden="true" />Atualizar</button>}
        </div>
      </div>
      {carregando && !d && <p className="mini ad-lendo" role="status"><i className="ti ti-loader-2 girando" aria-hidden="true" /> Lendo os títulos do adicional no Omie. Na primeira vez do dia pode levar até 1 minuto.</p>}
      <Estado carregando={carregando && !d} erro={!d ? erro : null} recarregar={recarregar}>
        {calc && (
          <>
            {d.status !== 'completo' && <div className="aviso" role="alert"><i className="ti ti-alert-triangle" aria-hidden="true" /><span>O Omie não devolveu todos os títulos ({inteiro(d.lidos)} de {inteiro(d.esperados)}): os números podem estar menores. Clique em Atualizar daqui a 2 minutos.</span></div>}
            <Resumo calc={calc} />
            <Parcelas parcelas={calc.parcelas} hoje={calc.hoje} />
            <DiaADia dias={calc.dias} hoje={calc.hoje} />

            <div className="omie-secao ad-vistas">
              <div className="periodos" role="tablist" aria-label="Lista">
                <button type="button" role="tab" aria-selected={vista === 'cobrar'} aria-pressed={vista === 'cobrar'} onClick={() => setVista('cobrar')}>Por cliente <span className="n">{inteiro(calc.clientes.length)}</span></button>
                <button type="button" role="tab" aria-selected={vista === 'pagos'} aria-pressed={vista === 'pagos'} onClick={() => setVista('pagos')}>Histórico de pagamentos <span className="n">{inteiro(calc.pagamentos.length)}</span></button>
              </div>
            </div>
            {vista === 'cobrar'
              ? <PorCliente lista={calc.clientes} abrirNaCaixa={abrirNaCaixa} aoAnotar={(cliente, nota) => setNotas((n) => ({ ...n, [cliente]: nota }))} />
              : <Pagamentos linhas={calc.pagamentos} />}

            <Rodape d={d} fora={calc.fora} />
          </>
        )}
      </Estado>
    </>
  );
}

function Resumo({ calc }) {
  const h = calc.metaHoje;
  const mes = calc.meses.find((m) => h && h.dia <= m.prazo) || calc.meses[1];
  const vencido = calc.lista.reduce((s, c) => s + c.vencido, 0);
  const aberto = calc.lista.reduce((s, c) => s + c.aberto, 0);
  const comVencido = calc.lista.filter((c) => c.vencido > 0).length;
  if (!h) {
    return (
      <div className="grade g-4">
        <Kpi icone="ti-flag-check" rotulo="Campanha encerrada" valor={pctTexto(mes.pct)} apoio={`${brl(mes.quitado)} de ${brl(mes.meta)} até ${dataCurta(mes.prazo)}`} />
        <Kpi icone="ti-cash" rotulo="Em aberto do adicional" valor={brl(aberto)} dinheiro apoio={`${inteiro(calc.lista.length)} ${plural(calc.lista.length, 'cliente', 'clientes')}`} />
      </div>
    );
  }
  const bateu = h.eh_hoje && h.quitado >= h.meta && h.meta > 0;
  return (
    <div className="grade g-4">
      <Kpi icone="ti-target-arrow" rotulo={h.eh_hoje ? 'Meta de hoje' : `Meta de ${semana(h.dia)}, ${dataCurta(h.dia)}`} valor={brl(h.meta)} dinheiro
        apoio={`${brl(h.saldo_inicio)} em aberto ÷ ${inteiro(h.dias_restantes)} ${plural(h.dias_restantes, 'dia útil', 'dias úteis')} até ${dataCurta(h.prazo)}`} />
      <Kpi icone="ti-coin" rotulo={h.eh_hoje ? 'Quitado hoje' : `Quitado em ${dataCurta(h.dia)}`} valor={brl(h.quitado)} dinheiro tom={bateu ? 'bom' : undefined}
        barra={h.pct * 100} corBarra={bateu ? '--sit-pagou' : '--grafico-serie'}
        apoio={bateu ? 'Meta do dia batida' : `${pctTexto(h.pct)} da meta, faltam ${brl(h.falta)}`} />
      <Kpi icone="ti-calendar-stats" rotulo={`Meta de ${mes.mes.toLowerCase()}`} valor={pctTexto(mes.pct)} barra={mes.pct * 100} corBarra={mes.pct >= 1 ? '--sit-pagou' : '--grafico-serie'}
        apoio={`${brl(mes.quitado)} de ${brl(mes.meta)} até ${dataCurta(mes.prazo)}`} />
      <Kpi icone="ti-alert-circle" rotulo="Vencido em aberto" valor={brl(vencido)} dinheiro tom={vencido > 0 ? 'atencao' : undefined}
        apoio={`${inteiro(comVencido)} ${plural(comVencido, 'cliente', 'clientes')}; ${brl(aberto)} em aberto ao todo`} />
    </div>
  );
}

function Parcelas({ parcelas, hoje }) {
  const venc = { 1: P1.inicio, 2: P2.inicio };
  return (
    <>
      <div className="omie-secao"><h2>Parcelas</h2><span>títulos do adicional no Omie, sem os cancelados e os clientes que não recebem o adicional</span></div>
      <div className="grade g-2 ad-parcelas">
        {parcelas.map((p) => {
          const vencida = hoje > venc[p.parcela];
          const total = p.quitado + p.aberto;
          return (
            <section key={p.parcela} className="cartao ad-parcela" aria-labelledby={`t-parc-${p.parcela}`}>
              <div className="ad-parcela-topo">
                <h2 id={`t-parc-${p.parcela}`}>{p.parcela}ª parcela</h2>
                <span className="mini">vencimento {dataCurta(venc[p.parcela])}</span>
                <b className="ad-pct">{pctTexto(p.pct)}<small> pago</small></b>
              </div>
              <p className="sub">{brl(p.previsto)} em {inteiro(p.titulos)} títulos</p>
              <div className="omie-regua" role="img" aria-label={`${pctTexto(p.pct)} pago, ${total ? Math.round((p.aberto / total) * 100) : 0}% em aberto`}>
                {p.quitado > 0 && <i className="c-rec" style={{ flexGrow: p.quitado }} />}
                {p.aberto > 0 && <i className={vencida ? 'c-atr' : 'c-ven'} style={{ flexGrow: p.aberto }} />}
              </div>
              <div className="omie-leg ad-leg">
                <div className="leg-rec">
                  <span className="rot"><span className="bolinha c-rec" aria-hidden="true" />Recebido</span>
                  <b>{brl(p.recebido)}</b>
                  <small>{inteiro(p.pagos)} {plural(p.pagos, 'título pago', 'títulos pagos')}{p.juros_multa > 0 ? `, com ${brl(p.juros_multa)} de juros e multa` : ''}</small>
                </div>
                <div className={vencida ? 'leg-atr' : 'leg-ven'}>
                  <span className="rot"><span className={`bolinha ${vencida ? 'c-atr' : 'c-ven'}`} aria-hidden="true" />{vencida ? 'Vencido em aberto' : 'A vencer'}</span>
                  <b>{brl(p.aberto)}</b>
                  <small>{inteiro(p.em_aberto)} {plural(p.em_aberto, 'título', 'títulos')}</small>
                </div>
              </div>
              {(p.cancelados > 0 || p.excluidos > 0) && (
                <p className="mini ad-fora">{[p.cancelados > 0 && `${inteiro(p.cancelados)} ${plural(p.cancelados, 'cancelado', 'cancelados')} (isentos ou baixados)`, p.excluidos > 0 && `${inteiro(p.excluidos)} de clientes que não recebem o adicional`].filter(Boolean).join(' e ')} fora da conta</p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

// Dia a dia do período em curso (novembro até 30/11, depois dezembro): o que foi quitado e a meta de cada dia útil.
function DiaADia({ dias, hoje }) {
  const emDezembro = hoje > P1.prazo;
  const lista = dias.filter((d) => (emDezembro ? d.dia > P1.prazo : d.dia <= P1.prazo));
  if (!lista.length) return null;
  // A escala vem dos dias que já passaram (e de hoje): a meta dos dias que faltam pode subir muito no fim do prazo e
  // achataria as barras; acima da escala, o traço da meta fica no topo.
  const base = lista.filter((d) => d.momento !== 'futuro');
  const max = Math.max(1, ...(base.length ? base : lista).map((d) => Math.max(d.meta, d.quitado)));
  const altura = (v) => `${Math.min(100, (v / max) * 100)}%`;
  const descricao = lista.filter((d) => d.momento !== 'futuro').map((d) => `${dataCurta(d.dia)}: quitado ${brl(d.quitado)}, meta ${brl(d.meta)}`).join('; ');
  return (
    <>
      <div className="omie-secao"><h2>Dia a dia em {emDezembro ? 'dezembro' : 'novembro'}</h2><span>valor da parcela quitado em cada dia útil e a meta do dia (traço); pagamento no fim de semana ou feriado conta no dia útil seguinte</span></div>
      <section className="cartao" aria-label={`Dia a dia em ${emDezembro ? 'dezembro' : 'novembro'}`}>
        <div className="omie-dias ad-dias" role="img" aria-label={descricao}>
          {lista.map((d) => {
            const bateu = d.momento !== 'futuro' && d.meta > 0 && d.quitado >= d.meta;
            return (
              <div key={d.dia} className={`omie-dia ad-dia${d.momento === 'futuro' ? ' futuro' : ''}${d.momento === 'hoje' ? ' atual' : ''}${bateu ? ' bateu' : ''}`}
                title={`${dataCurta(d.dia)}: meta ${brl(d.meta)}${d.momento !== 'futuro' ? `, quitado ${brl(d.quitado)}` : ''}`}>
                <em>{d.momento !== 'futuro' && d.quitado > 0 ? mil(d.quitado) : ''}</em>
                <div className="ad-coluna">
                  {d.momento !== 'futuro' && <i style={{ height: altura(d.quitado) }} />}
                  <span className={`ad-meta${d.meta > max ? ' acima' : ''}`} style={{ bottom: altura(d.meta) }} aria-hidden="true" />
                </div>
                <small>{d.momento === 'hoje' ? 'hoje' : d.dia.slice(8, 10)}</small>
              </div>
            );
          })}
        </div>
        <p className="mini ad-legenda"><span className="ad-amostra" aria-hidden="true" /> quitado no dia · <span className="ad-amostra-meta" aria-hidden="true" /> meta do dia (os dias que ainda vão chegar mostram a meta se nada mais entrar)</p>
      </section>
    </>
  );
}
const mil = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : brl(v).replace(/,00$/, ''));

function PorCliente({ lista, abrirNaCaixa, aoAnotar }) {
  const [filtro, setFiltro] = useState('nenhuma');
  const [situacao, setSituacao] = useState('');
  const [busca, setBusca] = useState('');
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [anotando, setAnotando] = useState(null);

  const contagem = useMemo(() => {
    const c = { todos: lista.length };
    for (const x of lista) c[x.pagamento] = (c[x.pagamento] || 0) + 1;
    return c;
  }, [lista]);
  // Só aparecem as situações que existem (a 2ª paga sem a 1ª e "pagou tudo" são raras).
  const grupos = PAGAMENTOS.filter((g) => contagem[g.id] > 0 || ['nenhuma', 'primeira', 'duas'].includes(g.id));
  const filtrada = useMemo(() => {
    const q = semAcento(busca);
    return lista.filter((c) => (filtro === 'todos' || c.pagamento === filtro)
      && (!situacao || (situacao === 'sem_conversa' ? !c.contato?.situacao : c.contato?.situacao === situacao))
      && (!q || semAcento(c.nome).includes(q) || semAcento(c.contato?.nome).includes(q) || semAcento(c.anotacao?.texto).includes(q)));
  }, [lista, filtro, situacao, busca]);
  const somaAberto = filtrada.reduce((s, c) => s + c.aberto, 0);
  const somaRecebido = filtrada.reduce((s, c) => s + c.recebido, 0);
  const escolher = (id) => { setFiltro(id); setMostrar(POR_PAGINA); };

  return (
    <section className="cartao" aria-label="Situação de pagamento por cliente">
      <div className="ad-pag-regua" role="img" aria-label={PAGAMENTOS.filter((g) => contagem[g.id]).map((g) => `${contagem[g.id]} ${g.plural.toLowerCase()}`).join(', ')}>
        {PAGAMENTOS.filter((g) => contagem[g.id]).map((g) => <i key={g.id} className={`pg-${g.id}`} style={{ flexGrow: contagem[g.id] }} />)}
      </div>
      <div className="ad-pag-grupos" role="group" aria-label="Situação de pagamento">
        {grupos.map((g) => (
          <button key={g.id} type="button" className="ad-pag" aria-pressed={filtro === g.id} onClick={() => escolher(g.id)}>
            <span className="rot"><span className={`bolinha pg-${g.id}`} aria-hidden="true" />{g.plural}</span>
            <b>{inteiro(contagem[g.id] || 0)}</b>
          </button>
        ))}
        <button type="button" className="ad-pag" aria-pressed={filtro === 'todos'} onClick={() => escolher('todos')}>
          <span className="rot">Todos os clientes</span>
          <b>{inteiro(contagem.todos)}</b>
        </button>
      </div>
      <div className="quem-cobrar-topo">
        <select className="faixa-atraso" aria-label="Situação no WhatsApp" value={situacao} onChange={(e) => { setSituacao(e.target.value); setMostrar(POR_PAGINA); }}>
          <option value="">Qualquer situação no WhatsApp</option>
          {SITUACOES.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          <option value="sem_conversa">Sem cobrança no WhatsApp</option>
        </select>
        <div className="busca">
          <i className="ti ti-search" aria-hidden="true" />
          <input type="search" placeholder="Buscar cliente ou anotação" aria-label="Buscar cliente" value={busca} onChange={(e) => { setBusca(e.target.value); setMostrar(POR_PAGINA); }} />
        </div>
      </div>
      <p className="mini quem-cobrar-fonte">
        {inteiro(filtrada.length)} {plural(filtrada.length, 'cliente', 'clientes')} nesta lista: {brl(somaAberto)} em aberto e {brl(somaRecebido)} já recebidos.
        {' '}A situação no WhatsApp é a última cobrança desde 05/11 (as mesmas regras da Cobrança do dia).
      </p>
      {filtrada.length === 0 ? (
        <Vazio icone={filtro === 'nenhuma' && !busca && !situacao ? 'ti-checks' : 'ti-filter-off'}
          titulo={filtro === 'nenhuma' && !busca && !situacao ? 'Todos os clientes já pagaram alguma parcela' : 'Nenhum cliente aqui'}
          texto={busca || situacao ? 'Tente outra busca ou situação.' : 'Escolha outro grupo acima.'} />
      ) : (
        <ul className="lista-cobrar">
          {filtrada.slice(0, mostrar).map((c) => (
            <ItemCobrar key={c.cliente} c={c} abrirNaCaixa={abrirNaCaixa} anotando={anotando === c.cliente}
              aoAbrirNota={() => setAnotando(anotando === c.cliente ? null : c.cliente)}
              aoSalvarNota={(nota) => { aoAnotar(c.cliente, nota); setAnotando(null); }} />
          ))}
        </ul>
      )}
      {filtrada.length > mostrar && (
        <div className="antigas"><button type="button" className="botao" onClick={() => setMostrar((m) => m + POR_PAGINA)}>Mostrar mais {Math.min(POR_PAGINA, filtrada.length - mostrar)}</button></div>
      )}
    </section>
  );
}

function ItemCobrar({ c, abrirNaCaixa, anotando, aoAbrirNota, aoSalvarNota }) {
  const ct = c.contato;
  const boleto = ct?.boleto_status ? BOLETO[ct.boleto_status] || { nome: 'boleto enviado', cor: 'cor-neutro', icone: 'ti-check' } : null;
  return (
    <li className="ad-item">
      <div className="quem">
        <span className="nome">{c.nome}</span>
        {ct?.nome && semAcento(ct.nome) !== semAcento(c.nome) && <span className="empresa"><i className="ti ti-brand-whatsapp" aria-hidden="true" /> {ct.nome}{c.outros_numeros > 0 ? ` e mais ${c.outros_numeros} ${plural(c.outros_numeros, 'número', 'números')}` : ''}</span>}
        <span className="marcas">
          <span className={`etq etq-pag ${NOME_PAGAMENTO[c.pagamento].cor}`}><span className={`bolinha pg-${c.pagamento}`} aria-hidden="true" />{NOME_PAGAMENTO[c.pagamento].nome}{c.ultimo_pagamento && c.pagamento !== 'nenhuma' ? ` em ${dataCurta(c.ultimo_pagamento)}` : ''}</span>
          {c.vencido > 0 && <span className={`etq ${c.dias_atraso > 15 ? 'cor-vermelho' : 'cor-amarelo'}`}>{c.dias_atraso} {plural(c.dias_atraso, 'dia', 'dias')} de atraso</span>}
          {ct?.situacao
            ? <span className={`etiqueta-sit sit-${ct.situacao}`}><span className={`bolinha s-${ct.situacao}`} aria-hidden="true" />{NOME_SITUACAO[ct.situacao] || ct.situacao} em {dataCurta(ct.situacao_dia)}</span>
            : <span className="etq cor-neutro">{ct ? 'sem cobrança no WhatsApp desde 05/11' : 'sem WhatsApp ligado'}</span>}
          {boleto && <span className={`etq ${boleto.cor}`} title={`Último boleto do adicional pelo PayBot em ${horaDe(ct.boleto_em)}`}><i className={`ti ${boleto.icone}`} aria-hidden="true" />{boleto.nome} {dataCurta(String(ct.boleto_em).slice(0, 10))}</span>}
          {ct?.retorno && <span className="etq marca-retorno"><i className="ti ti-alarm" aria-hidden="true" />retorno {dataCurta(ct.retorno.dia)}</span>}
          {c.obs.map((o) => <span key={o} className="etq cor-amarelo" title="Observação do título no Omie"><i className="ti ti-building-bank" aria-hidden="true" />{o}</span>)}
        </span>
        {c.anotacao && !anotando && <span className="ad-nota"><i className="ti ti-note" aria-hidden="true" /> {c.anotacao.texto}{c.anotacao.por ? <small> ({c.anotacao.por})</small> : null}</span>}
        {anotando && <EditorNota cliente={c.cliente} inicial={c.anotacao?.texto || ''} aoSalvar={aoSalvarNota} aoCancelar={aoAbrirNota} />}
      </div>
      <div className="valor">
        {c.aberto > 0.004 ? (
          <>
            <b>{brl(c.aberto)}</b>
            <span className="mini">{c.vencido > 0 ? (c.aberto > c.vencido ? `em aberto; ${brl(c.vencido)} vencido` : 'vencido') : 'a vencer'}</span>
          </>
        ) : (
          <>
            <b className="ad-pago">{brl(c.recebido)}</b>
            <span className="mini">recebido</span>
          </>
        )}
      </div>
      <div className="acoes">
        {ct && (
          <>
            <button type="button" className="botao" onClick={() => abrirNaCaixa(ct.contato_id, { segundaVia: true })} aria-label={`Segunda via para ${c.nome}`} title="Abrir a conversa com a segunda via do boleto">
              <i className="ti ti-file-invoice" aria-hidden="true" /><span className="rotulo-largo">Segunda via</span>
            </button>
            <button type="button" className="botao" onClick={() => abrirNaCaixa(ct.contato_id)} aria-label={`Abrir a conversa com ${c.nome}`} title="Abrir a conversa">
              <i className="ti ti-message" aria-hidden="true" /><span className="rotulo-largo">Conversa</span>
            </button>
          </>
        )}
        <button type="button" className="botao" onClick={aoAbrirNota} aria-expanded={anotando} aria-label={`Anotação sobre ${c.nome}`} title={c.anotacao ? 'Mudar a anotação' : 'Escrever uma anotação'}>
          <i className="ti ti-pencil" aria-hidden="true" /><span className="rotulo-largo">Anotar</span>
        </button>
      </div>
    </li>
  );
}

function EditorNota({ cliente, inicial, aoSalvar, aoCancelar }) {
  const [texto, setTexto] = useState(inicial);
  const [estado, setEstado] = useState(null); // null | 'salvando' | { erro }
  async function salvar(valor) {
    setEstado('salvando');
    try {
      const r = await anotarAdicional(cliente, valor);
      aoSalvar(r.anotacao);
    } catch (e) { setEstado({ erro: e.message }); }
  }
  return (
    <form className="ad-editor" onSubmit={(e) => { e.preventDefault(); salvar(texto); }}>
      <label className="so-leitor" htmlFor={`nota-${cliente}`}>Anotação</label>
      <textarea id={`nota-${cliente}`} value={texto} maxLength={500} rows={2} autoFocus placeholder="Ex.: contestou o valor, empresa baixada, combinou pagar dia 30" onChange={(e) => setTexto(e.target.value)} />
      <div className="ad-editor-acoes">
        <button type="submit" className="botao principal" disabled={estado === 'salvando' || !texto.trim()}>{estado === 'salvando' ? 'Salvando…' : 'Salvar'}</button>
        {inicial && <button type="button" className="botao" disabled={estado === 'salvando'} onClick={() => salvar('')}>Apagar</button>}
        <button type="button" className="botao" onClick={aoCancelar}>Cancelar</button>
        {estado?.erro && <span className="mini texto-erro" role="alert">{estado.erro}</span>}
      </div>
    </form>
  );
}

const PARCELAS = [
  { id: 0, nome: 'As duas' },
  { id: 1, nome: '1ª parcela' },
  { id: 2, nome: '2ª parcela' },
];

// Histórico do que já foi pago do adicional (pedido do Marcus, 24/11/2026): um pagamento por linha, como está no Omie.
function Pagamentos({ linhas }) {
  const [parcela, setParcela] = useState(0);
  const [busca, setBusca] = useState('');
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const filtradas = useMemo(() => {
    const q = semAcento(busca);
    return linhas.filter((l) => (!parcela || l.parcela === parcela) && (!q || semAcento(l.nome).includes(q)));
  }, [linhas, parcela, busca]);
  const total = filtradas.reduce((s, l) => s + l.valor, 0);
  const clientes = new Set(filtradas.map((l) => l.cliente)).size;
  function exportar() {
    baixarCsv('adicional-anual-pagamentos.csv', [
      { rotulo: 'Data', valor: (l) => l.dia.split('-').reverse().join('/') },
      { rotulo: 'Cliente', valor: (l) => l.nome },
      { rotulo: 'Parcela', valor: (l) => `${l.parcela}ª` },
      { rotulo: 'Recebido', valor: (l) => l.valor.toFixed(2).replace('.', ',') },
      { rotulo: 'Da parcela', valor: (l) => l.quitou.toFixed(2).replace('.', ',') },
      { rotulo: 'Forma', valor: (l) => l.forma },
      { rotulo: 'Conta', valor: (l) => l.banco },
    ], filtradas);
  }
  return (
    <section className="cartao" aria-label="Quem já pagou o adicional">
      <div className="quem-cobrar-topo">
        <div className="periodos" role="group" aria-label="Parcela">
          {PARCELAS.map((p) => <button key={p.id} type="button" aria-pressed={parcela === p.id} onClick={() => { setParcela(p.id); setMostrar(POR_PAGINA); }}>{p.nome}</button>)}
        </div>
        <div className="busca">
          <i className="ti ti-search" aria-hidden="true" />
          <input type="search" placeholder="Buscar cliente" aria-label="Buscar em Quem já pagou" value={busca} onChange={(e) => { setBusca(e.target.value); setMostrar(POR_PAGINA); }} />
        </div>
        <button type="button" className="botao" onClick={exportar} disabled={!filtradas.length}><i className="ti ti-download" aria-hidden="true" />Planilha</button>
      </div>
      <p className="mini quem-cobrar-fonte">
        {inteiro(filtradas.length)} {plural(filtradas.length, 'pagamento', 'pagamentos')} de {inteiro(clientes)} {plural(clientes, 'cliente', 'clientes')}, {brl(total)} recebidos no Omie (com juros e multa quando houve).
      </p>
      {filtradas.length === 0 ? <Vazio icone="ti-receipt-off" titulo="Nenhum pagamento aqui" texto={busca ? 'Tente outra busca.' : 'Ainda não há pagamento do adicional nesta parcela.'} /> : (
        <table className="tabela em-cartoes">
          <thead><tr><th>Data</th><th>Cliente</th><th>Parcela</th><th className="num">Recebido</th><th>Forma</th></tr></thead>
          <tbody>
            {filtradas.slice(0, mostrar).map((l, i) => (
              <tr key={`${l.titulo}-${l.dia}-${i}`}>
                <td data-rotulo="Data">{dataCurta(l.dia)}</td>
                <td><span className="nome">{l.nome}</span>{l.excluido && <span className="empresa"> (não recebe cobrança do adicional)</span>}</td>
                <td data-rotulo="Parcela">{l.parcela}ª</td>
                <td className="num" data-rotulo="Recebido">{brl(l.valor)}{Math.abs(l.valor - l.quitou) > 0.004 && <div className="mini">{brl(l.quitou)} da parcela</div>}</td>
                <td data-rotulo="Forma">{[l.forma, l.banco].filter(Boolean).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {filtradas.length > mostrar && (
        <div className="antigas"><button type="button" className="botao" onClick={() => setMostrar((m) => m + POR_PAGINA)}>Mostrar mais {Math.min(POR_PAGINA, filtradas.length - mostrar)}</button></div>
      )}
    </section>
  );
}

function Rodape({ d, fora }) {
  const partes = [
    fora.cancelados > 0 && `${inteiro(fora.cancelados)} ${plural(fora.cancelados, 'título cancelado', 'títulos cancelados')} (isentos ou baixados)`,
    fora.excluidos_clientes > 0 && `${inteiro(fora.excluidos_clientes)} ${plural(fora.excluidos_clientes, 'cliente que não recebe', 'clientes que não recebem')} o adicional (${brl(fora.excluidos_aberto)} em aberto)`,
    fora.outros_acordos > 0 && `${inteiro(fora.outros_acordos)} ${plural(fora.outros_acordos, 'título', 'títulos')} da mesma categoria com vencimento em novembro ou dezembro que ${plural(fora.outros_acordos, 'é de outro acordo', 'são de outros acordos')}`,
  ].filter(Boolean);
  return (
    <>
      {partes.length > 0 && <p className="mini omie-fonte">Fora das metas e da lista: {partes.join('; ')}.</p>}
      <details className="mini ad-como">
        <summary>Como os números são calculados</summary>
        <ul>
          <li>Fonte: Omie, contas a receber da categoria Adicional Anual (1.02.97), parcelas 1/2 (vencimento 10/11) e 2/2 (vencimento 10/12) registradas desde outubro de 2026. Só consulta: nada é alterado no Omie.</li>
          <li>Recebido é a coluna "Pago ou Recebido" do Omie, com juros e multa. As metas usam só o valor da parcela quitado, para fechar exato.</li>
          <li>Novembro: receber 100% da 1ª parcela até 30/11. Dezembro: a 2ª parcela e o que sobrou da 1ª até 31/12.</li>
          <li>Meta do dia: o saldo em aberto no começo do dia dividido pelos dias úteis que faltam até o prazo, contando o próprio dia. Se um dia fica abaixo, a meta dos dias seguintes sobe. Fim de semana e feriado (20/11 e 25/12) não contam.</li>
          <li>Situação no WhatsApp: a última cobrança desde 05/11, pela leitura do relatório nos dias que tiveram e pelas regras do sistema nos outros. Boleto: a última mensagem do PayBot com "Referente a: Adicional Anual".</li>
          {!d.cadastro_completo && <li>O cadastro de clientes do Omie não respondeu nesta consulta: alguns nomes podem aparecer pelo código.</li>}
        </ul>
      </details>
    </>
  );
}
