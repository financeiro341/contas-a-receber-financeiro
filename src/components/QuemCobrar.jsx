import { useMemo, useState } from 'react';
import { lerQuemCobrar } from '../lib/api.js';
import { brl, dataCurta, inteiro, plural } from '../utils/formato.js';
import { Vazio } from './comum.jsx';

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hora = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const diaDe = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

const FILTROS = [
  { id: 'falta', nome: 'Falta cobrar', dica: 'Em atraso e ainda sem mensagem nossa hoje' },
  { id: 'feito', nome: 'Já falamos hoje', dica: 'Em atraso e já com mensagem nossa hoje' },
  { id: 'todos', nome: 'Todos', dica: 'Todos os clientes em atraso' },
];
const POR_PAGINA = 30;

// Quem cobrar hoje (pedido do Marcus, 05/11/2026): clientes com honorários em atraso no Omie, do maior valor para o menor,
// separando quem ainda não recebeu mensagem nossa hoje. O Omie é consultado na hora (só consulta) e o cálculo vale 10 minutos.
export default function QuemCobrar({ abrirNaCaixa }) {
  const [estado, setEstado] = useState(null); // null | 'lendo' | { dados } | { erro }
  const [filtro, setFiltro] = useState('falta');
  const [busca, setBusca] = useState('');
  const [mostrar, setMostrar] = useState(POR_PAGINA);

  async function carregar(atualizar) {
    setEstado((e) => (e?.dados ? { ...e, atualizando: true } : 'lendo'));
    try { setEstado({ dados: await lerQuemCobrar(atualizar) }); } catch (e) { setEstado({ erro: e.message }); }
  }

  const d = estado?.dados;
  const contagem = useMemo(() => {
    const c = d?.contatos || [];
    return { falta: c.filter((x) => !x.falou_hoje).length, feito: c.filter((x) => x.falou_hoje).length, todos: c.length };
  }, [d]);
  const lista = useMemo(() => {
    const q = semAcento(busca);
    return (d?.contatos || []).filter((c) => (filtro === 'todos' || (filtro === 'falta' ? !c.falou_hoje : c.falou_hoje))
      && (!q || semAcento(c.nome).includes(q) || (c.empresas || []).some((e) => semAcento(e).includes(q))));
  }, [d, filtro, busca]);
  const somaFalta = useMemo(() => (d?.contatos || []).filter((x) => !x.falou_hoje).reduce((s, x) => s + Number(x.valor || 0), 0), [d]);

  return (
    <section className="cartao bloco quem-cobrar" aria-labelledby="t-quem-cobrar">
      <h2 id="t-quem-cobrar"><i className="ti ti-target-arrow" aria-hidden="true" />Quem cobrar hoje</h2>
      <div className="sub">Clientes com honorários em atraso no Omie, do maior valor para o menor. "Falta cobrar" são os que ainda não receberam mensagem nossa hoje.</div>

      {!estado && (
        <div className="quem-cobrar-inicio">
          <button type="button" className="botao principal" onClick={() => carregar(false)}><i className="ti ti-list-search" aria-hidden="true" />Montar a lista</button>
          <span className="mini">Consulta o Omie na hora (só consulta). A primeira vez do dia leva até 1 minuto.</span>
        </div>
      )}
      {estado === 'lendo' && <div className="quem-cobrar-inicio" role="status"><i className="ti ti-loader-2 girando" aria-hidden="true" /> Consultando os atrasados no Omie. Pode levar até 1 minuto.</div>}
      {estado?.erro && (
        <div className="aviso erro" role="alert"><i className="ti ti-alert-triangle" aria-hidden="true" /><span style={{ flex: 1 }}>{estado.erro}</span>
          <button type="button" className="botao" onClick={() => carregar(false)}>Tentar de novo</button></div>
      )}

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
            <div className="busca">
              <i className="ti ti-search" aria-hidden="true" />
              <input type="search" placeholder="Buscar cliente ou empresa" aria-label="Buscar em Quem cobrar hoje" value={busca} onChange={(e) => { setBusca(e.target.value); setMostrar(POR_PAGINA); }} />
            </div>
          </div>
          <p className="mini quem-cobrar-fonte">
            <i className="ti ti-building-bank" aria-hidden="true" /> Omie às {hora(d.calculado_em)}
            {d.status !== 'completo' && ' (o Omie não devolveu todos os títulos: a lista pode estar incompleta)'}
            {' · '}falta cobrar {inteiro(contagem.falta)} {plural(contagem.falta, 'cliente', 'clientes')}, {brl(somaFalta)}
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
                      <span className={`etq ${c.dias_atraso > 30 ? 'cor-vermelho' : 'cor-amarelo'}`}>{c.dias_atraso > 0 ? `atraso desde ${dataCurta(c.mais_antigo)}` : 'vence hoje'}</span>
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
    </section>
  );
}
