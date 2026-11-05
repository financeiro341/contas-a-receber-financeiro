import { useMemo, useState } from 'react';
import { lerDia } from '../lib/api.js';
import { NOME_SITUACAO, PAGARAM_OU_PROMETERAM } from '../constants.js';
import { brl, inteiro, pct, plural } from '../utils/formato.js';
import { Estado, Kpi, PilhaSituacoes, baixarCsv, useDados } from './comum.jsx';

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function Hoje({ dia, ehHoje, abrirConversa }) {
  const { dados, erro, carregando, em } = useDados(() => lerDia(dia), [dia], ehHoje ? 120000 : 0);
  const [filtro, setFiltro] = useState(null);
  const [busca, setBusca] = useState('');

  const r = dados?.resumo || {};
  const ps = r.por_situacao || {};
  const pp = PAGARAM_OU_PROMETERAM.reduce((a, k) => a + (ps[k] || 0), 0);
  const lig = r.ligacoes || {};
  const lista = useMemo(() => {
    const q = semAcento(busca);
    return (dados?.clientes || []).filter((c) => (!filtro || c.situacao === filtro)
      && (!q || semAcento(c.nome).includes(q) || (c.empresas || []).some((e) => semAcento(e).includes(q))));
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
    <Estado carregando={carregando && !dados} erro={!dados && erro}>
      {dados && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            {dados.fonte === 'claude'
              ? <span className="selo claude"><i className="ti ti-circle-check" aria-hidden="true" />Leitura do Claude, depois das 17h30</span>
              : <span className="selo regras"><i className="ti ti-bolt" aria-hidden="true" />Prévia ao vivo pelas regras; a leitura do Claude entra depois das 17h30</span>}
            {em && <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Atualizado às {em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{ehHoje ? ', relê a cada 2 minutos' : ''}</span>}
            {erro && <span className="selo regras">Falha ao reler: {erro.message}</span>}
          </div>
          <section className="grade g-kpi" aria-label="Resumo do dia">
            <Kpi icone="ti-users" rotulo={plural(r.cobrados, 'Cliente cobrado', 'Clientes cobrados')} valor={inteiro(r.cobrados)} apoio={`${inteiro(r.boletos_enviados)} boletos enviados`} />
            <Kpi icone="ti-message-check" rotulo="Responderam" valor={inteiro(r.responderam)} apoio={`${pct(r.responderam, r.cobrados)} dos cobrados`} />
            <Kpi icone="ti-message-off" rotulo="Sem resposta" valor={inteiro(r.sem_resposta)} apoio="Contando só boleto e sem retorno" />
            <Kpi icone="ti-cash" rotulo="Pagaram ou prometeram" valor={inteiro(pp)} apoio={`${inteiro((ps.pagou || 0) + (ps.pagou_parcial || 0))} com pagamento`} />
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
              <div className="busca">
                <i className="ti ti-search" aria-hidden="true" />
                <input type="search" placeholder="Buscar cliente ou empresa" aria-label="Buscar cliente ou empresa" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              <button className="botao" type="button" onClick={exportar} disabled={!lista.length}><i className="ti ti-download" aria-hidden="true" />Exportar</button>
            </div>
            {lista.length === 0 ? <div className="vazio">{dados.clientes.length ? 'Nenhum cliente com esse filtro.' : 'Nenhuma cobrança registrada neste dia.'}</div> : (
              <div className="rolagem">
                <table className="tabela em-cartoes">
                  <thead><tr><th>Cliente</th><th>Situação</th><th className="motivo">Motivo</th><th className="num">Última</th><th className="num">Msgs do cliente</th><th className="num">Em atraso</th></tr></thead>
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
                        <td className="num" data-rotulo="Msgs do cliente">{c.do_cliente} de {c.mensagens}{c.ligacoes ? <span title="Ligações"> · <i className="ti ti-phone" aria-label="ligações" />{c.ligacoes}</span> : null}</td>
                        <td className="num" data-rotulo="Em atraso">{c.atraso_valor == null ? '—' : brl(c.atraso_valor)}</td>
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
