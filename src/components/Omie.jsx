import { lerOmie } from '../lib/api.js';
import { NOME_SITUACAO } from '../constants.js';
import { brl, dataCurta, inteiro, nomeMes } from '../utils/formato.js';
import { Estado, Kpi, Vazio, useDados } from './comum.jsx';

const quando = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]} às ${m[4]}:${m[5]}` : '';
};

// Totais do Omie (os mesmos do relatório de cobrança, tarefa das 16h11) e os maiores atrasos dos cobrados.
export default function Omie({ abrirConversa }) {
  const { dados, erro, carregando, recarregar } = useDados(() => lerOmie(), []);
  const tom = (v) => (v == null ? undefined : Number(v) > 0 ? 'perigo' : 'bom');
  const f = dados?.financeiro || null;
  const mes = f?.inicio_mes ? nomeMes(f.inicio_mes) : '';
  return (
    <Estado carregando={carregando} erro={erro} recarregar={recarregar}>
      {!f ? <div className="cartao"><Vazio icone="ti-building-bank" titulo="Ainda sem totais do Omie" texto="Eles entram com o primeiro relatório gravado, todo dia útil depois das 17h30." /></div> : (
        <>
          <div className="linha-status">
            <span><i className="ti ti-building-bank" aria-hidden="true" /> Omie, relatórios Faturado X Recebido e Contas a Receber, Inadimplência (Honorários){f.atualizado ? `, calculados em ${quando(f.atualizado)}` : ''}</span>
          </div>
          <div className="secao-titulo">Carteira de {String(f.inicio || '').slice(0, 4)}<span>vencimentos de {dataCurta(f.inicio)} a {dataCurta(f.totais_ate)}</span></div>
          <section className="grade g-2">
            <Kpi icone="ti-circle-check" rotulo="Valor recebido" dinheiro valor={brl(f.recebido_total)} apoio={f.titulos != null ? `${inteiro(f.titulos)} títulos no período` : null} />
            <Kpi icone="ti-alert-triangle" rotulo="Inadimplência" tom={tom(f.inadimplencia_total)} dinheiro valor={brl(f.inadimplencia_total)} apoio={f.titulos_inadimplentes != null ? `${inteiro(f.titulos_inadimplentes)} títulos em aberto` : null} />
          </section>
          {f.inicio_mes && (
            <>
              <div className="secao-titulo">Mês vigente<span>vencimentos de {dataCurta(f.inicio_mes)} a {dataCurta(f.fim_mes || f.totais_ate)}</span></div>
              <section className="grade g-3">
                <Kpi icone="ti-circle-check" rotulo="Valor recebido" dinheiro valor={brl(f.recebido_mes)} apoio={f.titulos_mes != null ? `${inteiro(f.titulos_mes)} títulos do mês` : null} />
                <Kpi icone="ti-alert-triangle" rotulo="Inadimplência" tom={tom(f.inadimplencia_mes)} dinheiro valor={brl(f.inadimplencia_mes)} apoio={f.titulos_inadimplentes_mes != null ? `${inteiro(f.titulos_inadimplentes_mes)} vencidos em aberto` : null} />
                <Kpi icone="ti-calendar-due" rotulo="A vencer" dinheiro valor={brl(f.a_vencer_mes)} apoio={f.titulos_a_vencer_mes != null ? `${inteiro(f.titulos_a_vencer_mes)} títulos em aberto` : null} />
              </section>
              <section className="grade g-2 bloco">
                <Kpi icone="ti-file-invoice" rotulo={`Faturado de honorários em ${mes}`} dinheiro valor={brl(f.faturado_mes)} apoio={f.titulos_faturado_mes != null ? `${inteiro(f.titulos_faturado_mes)} títulos, pagos e em aberto` : null} />
                <Kpi icone="ti-cash-banknote" rotulo={`Entrou em ${mes}`} dinheiro valor={brl(f.recebido_no_mes)} apoio={f.titulos_recebidos_no_mes != null ? `${inteiro(f.titulos_recebidos_no_mes)} recebimentos, de qualquer vencimento` : 'Recebimentos de honorários do mês'} />
              </section>
            </>
          )}
          <section className="cartao bloco" aria-labelledby="t-atrasos">
            <h2 id="t-atrasos"><i className="ti ti-alert-circle" aria-hidden="true" />Maiores atrasos entre os clientes cobrados</h2>
            <div className="sub">Do relatório de {dataCurta(dados.dia)}: títulos em atraso no Omie (todas as categorias) de quem foi cobrado no dia.</div>
            {(dados.atrasos || []).length === 0 ? <Vazio icone="ti-circle-check" titulo="Nenhum atraso entre os cobrados" texto="O último relatório não registrou título em atraso para quem foi cobrado." /> : (
              <div className="rolagem">
                <table className="tabela em-cartoes">
                  <thead><tr><th>Cliente</th><th>Situação no dia</th><th className="num">Títulos</th><th className="num">Em atraso</th></tr></thead>
                  <tbody>
                    {dados.atrasos.map((c) => (
                      <tr key={c.contato_id} className="clicavel" onClick={() => abrirConversa(c.contato_id, dados.dia)}>
                        <td><button type="button" className="linha-botao nome" onClick={(e) => { e.stopPropagation(); abrirConversa(c.contato_id, dados.dia); }}>{c.nome}<span className="so-leitor">, abrir a conversa</span></button>
                          {(c.empresas || []).length > 0 && <div className="empresa">{c.empresas.slice(0, 2).join(' · ')}</div>}</td>
                        <td><span className="chip"><span className={`bolinha s-${c.situacao}`} aria-hidden="true" />{NOME_SITUACAO[c.situacao] || c.situacao || '—'}</span></td>
                        <td className="num" data-rotulo="Títulos">{inteiro(c.atraso_qtd)}</td>
                        <td className="num" data-rotulo="Em atraso"><b style={{ color: 'var(--text-primary)' }}>{brl(c.atraso_valor)}</b></td>
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
