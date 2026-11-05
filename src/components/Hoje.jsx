import { useMemo, useState } from 'react';
import { lerDia } from '../lib/api.js';
import { NOME_SITUACAO, ORDEM_SITUACAO, PAGARAM_OU_PROMETERAM } from '../constants.js';
import { brl, inteiro, pct, plural } from '../utils/formato.js';
import { Estado, Kpi, PilhaSituacoes, Vazio, baixarCsv, useDados } from './comum.jsx';

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function Hoje({ dia, ehHoje, abrirConversa }) {
  const { dados, erro, carregando, em, recarregar } = useDados(() => lerDia(dia), [dia], ehHoje ? 120000 : 0);
  const [filtro, setFiltro] = useState(null);
  const [busca, setBusca] = useState('');

  const r = dados?.resumo || {};
  const ps = r.por_situacao || {};
  const pp = PAGARAM_OU_PROMETERAM.reduce((a, k) => a + (ps[k] || 0), 0);
  const lig = r.ligacoes || {};
  const lista = useMemo(() => {
    const q = semAcento(busca);
    // Ordem: pagou, prometeu, respondeu sem pagamento, não respondeu (ORDEM_SITUACAO); no mesmo grupo, a ordem do dia.
    return (dados?.clientes || []).filter((c) => (!filtro || c.situacao === filtro)
      && (!q || semAcento(c.nome).includes(q) || (c.empresas || []).some((e) => semAcento(e).includes(q))))
      .map((c, i) => [c, i])
      .sort(([a, i], [b, j]) => ((ORDEM_SITUACAO[a.situacao] ?? 99) - (ORDEM_SITUACAO[b.situacao] ?? 99)) || i - j)
      .map(([c]) => c);
  }, [dados, filtro, busca]);

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
          <div className="linha-status">
            {dados.fonte === 'claude'
              ? <span><i className="ti ti-circle-check" aria-hidden="true" style={{ color: 'var(--success-text)' }} /> Leitura do Claude (depois das 17h30)</span>
              : <span title="A leitura do Claude, conversa por conversa, entra depois das 17h30"><i className="ti ti-bolt" aria-hidden="true" /> Prévia ao vivo pelas regras</span>}
            {em && <span>· atualizado às {em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{ehHoje ? ', relê a cada 2 min' : ''}</span>}
            {erro && <span className="selo regras">Falha ao reler: {erro.message}</span>}
          </div>
          <section className="grade g-kpi" aria-label="Resumo do dia">
            <Kpi icone="ti-users" rotulo={plural(r.cobrados, 'Cliente cobrado', 'Clientes cobrados')} valor={inteiro(r.cobrados)} apoio={`${inteiro(r.boletos_enviados)} boletos enviados`} />
            <Kpi icone="ti-message-check" rotulo="Responderam" valor={inteiro(r.responderam)} apoio={`${pct(r.responderam, r.cobrados)} dos cobrados`} />
            <Kpi icone="ti-message-off" tom={r.sem_resposta ? "atencao" : undefined} rotulo="Sem resposta" valor={inteiro(r.sem_resposta)} apoio="Contando só boleto e sem retorno" />
            <Kpi icone="ti-cash" tom={pp ? "bom" : undefined} rotulo="Pagaram ou prometeram" valor={inteiro(pp)} apoio={`${inteiro((ps.pagou || 0) + (ps.pagou_parcial || 0))} com pagamento`} />
            <Kpi icone="ti-phone" rotulo="Ligações" valor={inteiro(lig.total)} apoio={`${inteiro(lig.atendidas)} atendidas · ${lig.fonte === 'chrome' ? 'lidas no Chrome' : 'só as recebidas'}`} />
            <Kpi icone="ti-alert-circle" rotulo="Em atraso no Omie" dinheiro valor={r.atraso_total == null ? '—' : brl(r.atraso_total)} apoio={r.atraso_total == null ? 'Entra com o relatório das 17h30' : 'Soma dos clientes cobrados'} />
          </section>

          <section className="cartao bloco" aria-labelledby="t-situacao">
            <h2 id="t-situacao"><i className="ti ti-chart-bar" aria-hidden="true" />Situação dos clientes cobrados</h2>
            <PilhaSituacoes porSituacao={ps} total={r.cobrados || 0} filtro={filtro} aoFiltrar={setFiltro} />
          </section>

          <section className="cartao bloco" aria-labelledby="t-lista">
            <div className="ferramentas">
              <h2 id="t-lista" style={{ marginRight: 'auto' }}><i className="ti ti-list" aria-hidden="true" />Clientes ({lista.length})</h2>
              {filtro && (
                <span className="chip filtro-ativo">
                  <span className={`bolinha s-${filtro}`} aria-hidden="true" />Filtro: {NOME_SITUACAO[filtro]}
                  <button type="button" className="limpar" onClick={() => setFiltro(null)} aria-label="Limpar o filtro"><i className="ti ti-x" aria-hidden="true" /></button>
                </span>
              )}
              <div className="busca">
                <i className="ti ti-search" aria-hidden="true" />
                <input type="search" placeholder="Buscar cliente ou empresa" aria-label="Buscar cliente ou empresa" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              <button className="botao" type="button" onClick={exportar} disabled={!lista.length}><i className="ti ti-download" aria-hidden="true" />Exportar</button>
            </div>
            {lista.length === 0 ? (dados.clientes.length ? <Vazio icone="ti-filter-off" titulo="Nenhum cliente com esse filtro" texto="Limpe a busca ou escolha outra situação." /> : <Vazio icone="ti-calendar-off" titulo="Nenhuma cobrança neste dia" texto={ehHoje ? 'Assim que a primeira cobrança sair pelo WhatsApp ela aparece aqui.' : 'Escolha outro dia útil.'} />) : (
              <div className="rolagem">
                <table className="tabela em-cartoes">
                  <thead><tr><th>Cliente</th><th>Situação</th><th className="motivo">Motivo</th><th className="num">Última</th><th className="num">Respostas</th><th className="num">Em atraso</th></tr></thead>
                  <tbody>
                    {lista.map((c) => (
                      <tr key={c.contato_id} className="clicavel" onClick={() => abrirConversa(c.contato_id)}>
                        <td>
                          <button type="button" className="linha-botao" onClick={(e) => { e.stopPropagation(); abrirConversa(c.contato_id); }}>
                            <span className="nome">{c.nome}</span>
                            <span className="so-leitor">, abrir a conversa</span>
                          </button>
                          {(c.empresas || []).length > 0 && <div className="empresa">{c.empresas.slice(0, 2).join(' · ')}{c.empresas.length > 2 ? ` +${c.empresas.length - 2}` : ''}</div>}
                        </td>
                        <td><span className="chip"><span className={`bolinha s-${c.situacao}`} aria-hidden="true" />{NOME_SITUACAO[c.situacao] || c.situacao}</span></td>
                        <td className="motivo">{c.motivo}</td>
                        <td className="num" data-rotulo="Última">{c.ultima || '—'}</td>
                        <td className="num" data-rotulo="Respostas">{c.do_cliente ? `${c.do_cliente} ${plural(c.do_cliente, 'mensagem', 'mensagens')}` : 'Nenhuma'}{c.ligacoes ? <div className="empresa"><i className="ti ti-phone" aria-hidden="true" /> {c.ligacoes} {plural(c.ligacoes, 'ligação', 'ligações')}{c.lig_atendidas ? `, ${c.lig_atendidas} atendida${c.lig_atendidas > 1 ? 's' : ''}` : ''}</div> : null}</td>
                        <td className="num quebra" data-rotulo="Em atraso">{c.atraso_valor == null ? '—' : <b style={{ color: 'var(--text-primary)' }}>{brl(c.atraso_valor)}</b>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </Estado>
  );
}
