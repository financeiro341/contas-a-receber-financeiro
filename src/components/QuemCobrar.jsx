import { useMemo, useState } from 'react';
import { lerQuemCobrar } from '../lib/api.js';
import { brl, dataCurta, inteiro, plural } from '../utils/formato.js';
import { Vazio } from './comum.jsx';
import leao from '../assets/leao.png';

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hora = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const diaDe = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

const FILTROS = [
  { id: 'falta', nome: 'Falta cobrar', dica: 'Em atraso e ainda sem mensagem nossa hoje' },
  { id: 'feito', nome: 'Já falamos hoje', dica: 'Em atraso e já com mensagem nossa hoje' },
  { id: 'todos', nome: 'Todos', dica: 'Todos os clientes em atraso' },
];
const GRUPOS = [
  { id: 'todos', nome: 'Os dois grupos' },
  { id: 'maior', nome: 'Maiores dívidas', dica: 'Os 40 que mais devem, somando todos os anos' },
  { id: 'ano', nome: 'Dívidas do ano', dica: 'Honorário vencido de 01/01 até hoje' },
];
const FAIXAS = [
  { id: 'todas', nome: 'Qualquer atraso', de: -Infinity, ate: Infinity },
  { id: '30', nome: 'Até 30 dias', de: -Infinity, ate: 30 },
  { id: '90', nome: '31 a 90 dias', de: 31, ate: 90 },
  { id: '365', nome: '91 dias a 1 ano', de: 91, ate: 365 },
  { id: 'mais', nome: 'Mais de 1 ano', de: 366, ate: Infinity },
];
const POR_PAGINA = 30;

// Quem cobrar hoje (pedido do Marcus, 05/11/2026): clientes com honorários em atraso no Omie, do maior valor para o menor,
// separando quem ainda não recebeu mensagem nossa hoje. O Omie é consultado na hora (só consulta) e o cálculo vale 10 minutos.
// Desde 06/11/2026 a lista mistura dois grupos, com filtro: as 40 maiores dívidas de todos os anos e as dívidas do ano
// (vencidas de 01/01 até o dia da cobrança); e filtra pela faixa de atraso (do título mais antigo).
export default function QuemCobrar({ abrirNaCaixa }) {
  const [estado, setEstado] = useState(null); // null | 'lendo' | { dados } | { erro }
  const [filtro, setFiltro] = useState('falta');
  const [grupo, setGrupo] = useState('todos');
  const [faixa, setFaixa] = useState('todas');
  const [busca, setBusca] = useState('');
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  // Recolher a lista (pedido do Marcus): a escolha fica guardada neste navegador.
  const [recolhida, setRecolhida] = useState(() => { try { return localStorage.getItem('cr:quem-cobrar') === 'recolhida'; } catch { return false; } });
  function alternar() {
    setRecolhida((r) => { try { localStorage.setItem('cr:quem-cobrar', r ? 'aberta' : 'recolhida'); } catch { /* sem armazenamento */ } return !r; });
  }

  async function carregar(atualizar) {
    setEstado((e) => (e?.dados ? { ...e, atualizando: true } : 'lendo'));
    try { setEstado({ dados: await lerQuemCobrar(atualizar) }); } catch (e) { setEstado({ erro: e.message }); }
  }

  const d = estado?.dados;
  // Grupo e faixa de atraso valem para os três botões (falta cobrar, já falamos, todos) e para a soma.
  const base = useMemo(() => {
    const fx = FAIXAS.find((f) => f.id === faixa) || FAIXAS[0];
    return (d?.contatos || []).filter((c) => (grupo === 'todos' || (grupo === 'maior' ? c.maior : c.do_ano))
      && c.dias_atraso >= fx.de && c.dias_atraso <= fx.ate);
  }, [d, grupo, faixa]);
  const contagem = useMemo(() => {
    const c = base;
    return { falta: c.filter((x) => !x.falou_hoje).length, feito: c.filter((x) => x.falou_hoje).length, todos: c.length };
  }, [base]);
  const lista = useMemo(() => {
    const q = semAcento(busca);
    return base.filter((c) => (filtro === 'todos' || (filtro === 'falta' ? !c.falou_hoje : c.falou_hoje))
      && (!q || semAcento(c.nome).includes(q) || (c.empresas || []).some((e) => semAcento(e).includes(q))));
  }, [base, filtro, busca]);
  const somaFalta = useMemo(() => base.filter((x) => !x.falou_hoje).reduce((s, x) => s + Number(x.valor || 0), 0), [base]);

  return (
    <section className={`bloco quem-cobrar${recolhida ? ' recolhida' : ''}`} aria-labelledby="t-quem-cobrar">
      <div className="qc-faixa tema-escuro">
        <img className="qc-selo" src={leao} alt="" />
        <div className="qc-texto">
          <h2 id="t-quem-cobrar">Quem cobrar hoje</h2>
          <p>As 40 maiores dívidas e quem venceu de 01/01 até hoje, do maior valor para o menor.</p>
        </div>
        {d && (
          <>
            <div className="qc-num"><b>{inteiro(contagem.falta)}</b><span>{plural(contagem.falta, 'cliente a cobrar', 'clientes a cobrar')}</span></div>
            <div className="qc-num"><b>{brl(somaFalta)}</b><span>em atraso de quem falta</span></div>
            <div className="qc-prog">
              <span>{inteiro(contagem.feito)} de {inteiro(contagem.todos)} já com mensagem hoje</span>
              <div className="qc-trilha" aria-hidden="true"><i style={{ width: `${contagem.todos ? Math.round((contagem.feito / contagem.todos) * 100) : 0}%` }} /></div>
            </div>
          </>
        )}
        <span className="so-leitor" role="status">{estado === 'lendo' ? 'Consultando o Omie, pode levar até 1 minuto' : ''}</span>
        {estado === 'lendo' && <span className="qc-lendo" aria-hidden="true"><i className="ti ti-loader-2 girando" /> Consultando o Omie, pode levar até 1 minuto</span>}
        <div className="qc-acoes">
          {!estado && <button type="button" className="botao principal" onClick={() => carregar(false)}><i className="ti ti-list-search" aria-hidden="true" />Montar a lista</button>}
          {d && (
            <button type="button" className="botao icone" onClick={alternar} aria-expanded={!recolhida} aria-controls="quem-cobrar-corpo"
              aria-label="Lista Quem cobrar hoje" title={recolhida ? 'Mostrar a lista' : 'Recolher a lista'}>
              <i className="ti ti-chevron-down" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {estado?.erro && (
        <div className="aviso erro qc-erro" role="alert"><i className="ti ti-alert-triangle" aria-hidden="true" /><span style={{ flex: 1 }}>{estado.erro}</span>
          <button type="button" className="botao" onClick={() => carregar(false)}>Tentar de novo</button></div>
      )}

      <div id="quem-cobrar-corpo" className="cartao qc-corpo" hidden={recolhida || !d}>
      {d && (
        <>
          <div className="quem-cobrar-topo">
            <div className="periodos" role="group" aria-label="Mostrar">
              {FILTROS.map((x) => (
                <button key={x.id} type="button" aria-pressed={filtro === x.id} title={x.dica} onClick={() => { setFiltro(x.id); setMostrar(POR_PAGINA); }}>
                  {x.nome} <span className="n">{contagem[x.id]}</span>
                </button>
              ))}
            </div>
            <div className="periodos" role="group" aria-label="Grupo">
              {GRUPOS.map((x) => (
                <button key={x.id} type="button" aria-pressed={grupo === x.id} title={x.dica} onClick={() => { setGrupo(x.id); setMostrar(POR_PAGINA); }}>{x.nome}</button>
              ))}
            </div>
            <select className="faixa-atraso" aria-label="Faixa de atraso" value={faixa} onChange={(e) => { setFaixa(e.target.value); setMostrar(POR_PAGINA); }}>
              {FAIXAS.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
            <div className="busca">
              <i className="ti ti-search" aria-hidden="true" />
              <input type="search" placeholder="Buscar cliente ou empresa" aria-label="Buscar em Quem cobrar hoje" value={busca} onChange={(e) => { setBusca(e.target.value); setMostrar(POR_PAGINA); }} />
            </div>
          </div>
          <p className="mini quem-cobrar-fonte">
            <i className="ti ti-building-bank" aria-hidden="true" /> Consultado no Omie às {hora(d.calculado_em)}
            {d.status !== 'completo' && ' (o Omie não devolveu todos os títulos: a lista pode estar incompleta)'}.
            {' '}"Falta cobrar" são os que ainda não receberam mensagem nossa hoje.
            <button type="button" className="link-botao" onClick={() => carregar(true)} disabled={estado.atualizando}>{estado.atualizando ? 'Atualizando…' : 'Atualizar'}</button>
          </p>

          {lista.length === 0 ? (
            <Vazio icone={filtro === 'falta' ? 'ti-checks' : 'ti-filter-off'} titulo={filtro === 'falta' && !busca ? 'Todos os clientes em atraso já receberam mensagem hoje' : 'Nenhum cliente aqui'} texto={busca ? 'Tente outra busca.' : 'Troque o filtro para ver os outros.'} />
          ) : (
            <ul className="lista-cobrar">
              {lista.slice(0, mostrar).map((c) => (
                <li key={c.contato_id}>
                  <div className="quem">
                    <span className="nome">{c.nome}</span>
                    {(c.empresas || []).length > 0 && <span className="empresa">{c.empresas[0]}{c.empresas.length > 1 ? ` +${c.empresas.length - 1}` : ''}</span>}
                    <span className="marcas">
                      <span className={`etq ${c.dias_atraso > 30 ? 'cor-vermelho' : 'cor-amarelo'}`}>{c.dias_atraso > 0 ? `atraso desde ${dataCurta(c.mais_antigo)}${c.dias_atraso > 365 ? `/${String(c.mais_antigo).slice(2, 4)}` : ''}` : 'vence hoje'}</span>
                      {c.maior && <span className="etq cor-neutro"><i className="ti ti-trending-up" aria-hidden="true" />maior dívida</span>}
                      {c.do_ano && c.valor_ano < c.valor && <span className="etq cor-neutro">do ano: {brl(c.valor_ano)}</span>}
                      {c.falou_hoje && <span className="etq cor-verde"><i className="ti ti-check" aria-hidden="true" />falamos às {hora(c.ultima_nossa)}</span>}
                      {!c.falou_hoje && c.ultima_nossa && <span className="etq cor-neutro">última mensagem nossa {dataCurta(diaDe(c.ultima_nossa))}</span>}
                      {!c.ultima_nossa && <span className="etq cor-neutro">nunca falamos pelo WhatsApp</span>}
                      {c.retorno && <span className="etq marca-retorno"><i className="ti ti-alarm" aria-hidden="true" />retorno {dataCurta(c.retorno.dia)}</span>}
                    </span>
                  </div>
                  <div className="valor">
                    <b>{brl(c.valor)}</b>
                    <span className="mini">{inteiro(c.qtd)} {plural(c.qtd, 'título', 'títulos')}</span>
                  </div>
                  <div className="acoes">
                    <button type="button" className="botao" onClick={() => abrirNaCaixa(c.contato_id, { segundaVia: true })} aria-label={`Segunda via para ${c.nome}`} title="Abrir a conversa com a segunda via do boleto">
                      <i className="ti ti-file-invoice" aria-hidden="true" /><span className="rotulo-largo">Segunda via</span>
                    </button>
                    <button type="button" className="botao" onClick={() => abrirNaCaixa(c.contato_id)} aria-label={`Abrir a conversa com ${c.nome}`} title="Abrir a conversa">
                      <i className="ti ti-message" aria-hidden="true" /><span className="rotulo-largo">Conversa</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {lista.length > mostrar && (
            <div className="antigas"><button type="button" className="botao" onClick={() => setMostrar((m) => m + POR_PAGINA)}>Mostrar mais {Math.min(POR_PAGINA, lista.length - mostrar)}</button></div>
          )}
          {d.sem_numero?.clientes > 0 && (
            <p className="mini quem-cobrar-fonte"><i className="ti ti-phone-off" aria-hidden="true" /> Mais {inteiro(d.sem_numero.clientes)} {plural(d.sem_numero.clientes, 'cliente do Omie', 'clientes do Omie')} em atraso ({brl(d.sem_numero.valor)}) sem número de WhatsApp ligado no cadastro.</p>
          )}
        </>
      )}
      </div>
    </section>
  );
}
