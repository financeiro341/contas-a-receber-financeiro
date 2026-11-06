import { useEffect, useRef, useState } from 'react';
import { lerDia, lerOmie, lerOmieAgora } from '../lib/api.js';
import { dadosDoDia, gerarPdf, nomeDoArquivo } from '../utils/relatorioPdf.js';
import leao from '../assets/leao.png';
import { NOME_SITUACAO } from '../constants.js';
import { FERIADOS, brl, dataCurta, diaSemana, hoje, inteiro, nomeMes, somarDias } from '../utils/formato.js';
import { Estado, Vazio, iniciais, useDados } from './comum.jsx';

// Data e hora no horário de Brasília (o cálculo feito na hora vem em UTC; o do relatório, com o fuso).
const quando = (iso) => {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(t)).replace(',', ' às');
};

async function leaoEmDataUrl() {
  const b = await (await fetch(leao)).blob();
  return await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = falha; r.readAsDataURL(b); });
}

// Baixar o relatório (pedido do Marcus, 05/11/2026): calcula no Omie com a data de hoje (só consulta), junta a Cobrança de
// hoje do sistema até a hora do clique e baixa o PDF no modelo do relatório que ia por e-mail.
function BaixarRelatorio({ eu, aoCalcular }) {
  const [estado, setEstado] = useState(null); // null | 'omie' | 'pdf' | { erro } | { ok }
  async function baixar() {
    setEstado('omie');
    try {
      const dia = hoje();
      const [omie, cobranca] = await Promise.all([lerOmieAgora(true), lerDia(dia)]);
      setEstado('pdf');
      const d = dadosDoDia(cobranca, omie.financeiro);
      const doc = await gerarPdf(d, { leaoPng: await leaoEmDataUrl(), quem: eu?.nome });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(doc.output('blob'));
      a.download = nomeDoArquivo(dia);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setEstado({ ok: omie.status === 'completo' ? 'Relatório baixado com os números de agora.' : 'Relatório baixado, mas o Omie não devolveu todos os títulos: confira os totais.' });
      aoCalcular?.();
    } catch (e) {
      setEstado({ erro: e.message || 'Não foi possível montar o relatório.' });
    }
  }
  const ocupado = estado === 'omie' || estado === 'pdf';
  return (
    <div className="baixar-relatorio">
      <button type="button" className="botao principal" onClick={baixar} disabled={ocupado}>
        <i className={`ti ${ocupado ? 'ti-loader-2 girando' : 'ti-download'}`} aria-hidden="true" />
        {estado === 'omie' ? 'Consultando o Omie…' : estado === 'pdf' ? 'Montando o PDF…' : 'Baixar relatório de hoje'}
      </button>
      <span className="mini" role="status" aria-live="polite">
        {estado === 'omie' ? 'Calculando os números de hoje no Omie. Pode levar até 1 minuto.'
          : estado?.erro ? <span className="texto-erro">{estado.erro}</span>
            : estado?.ok ? estado.ok : ''}
      </span>
    </div>
  );
}

// Valor com os centavos menores (só visual; o leitor de tela lê o valor inteiro).
function Dinheiro({ valor }) {
  const t = brl(valor);
  const k = t.lastIndexOf(',');
  return <>{t.slice(0, k)}<span className="centavos">{t.slice(k)}</span></>;
}
// "503,2 mil" (sem quebra de linha entre o número e o "mil").
const mil = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}\u00a0mil` : brl(v).replace(/,00$/, ''));
const comReal = (t) => (t.startsWith('R$') ? t : `R$\u00a0${t}`);

// Dias úteis de um mês (AAAA-MM-01 até o último dia), sem sábado, domingo e feriados: nesses dias o Omie não muda
// (ninguém dá baixa), então o dia útil seguinte já mostra o efeito deles.
function diasUteis(inicio, fim) {
  const lista = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) if (![0, 6].includes(diaSemana(d)) && !FERIADOS.has(d)) lista.push(d);
  return lista;
}

// Aba Omie no visual novo (aprovado pelo Marcus, 06/11/2026): faixa do ano com o anel recebido x inadimplência e o que entrou
// no caixa hoje; o mês em régua (recebido, inadimplente, a vencer) e faturado x entrou; os maiores atrasos dos cobrados; e a
// inadimplência do mês dia a dia, pelo último cálculo de cada dia. Só consulta ao Omie.
export default function Omie({ abrirConversa, eu }) {
  const { dados, erro, carregando, recarregar, atualizar } = useDados(() => lerOmie(), []);
  const [todos, setTodos] = useState(false);
  // Tudo pela API (decisão do Marcus, 06/11/2026, 14h27): ao abrir a aba, se o último cálculo tem mais de 30 minutos (ou é
  // de outro dia), o sistema consulta o Omie de novo (só consulta) e mostra o anterior enquanto isso.
  const [auto, setAuto] = useState(null); // null | 'calculando' | 'ok' | { erro }
  const pediu = useRef(false);
  useEffect(() => {
    if (!dados || pediu.current) return;
    const ultimo = Date.parse(dados.financeiro?.atualizado || '');
    const velho = Number.isNaN(ultimo) || Date.now() - ultimo > 30 * 60_000 || (dados.financeiro?.totais_ate || '') !== hoje();
    if (!velho) return;
    pediu.current = true;
    setAuto('calculando');
    lerOmieAgora(false).then(() => { setAuto('ok'); atualizar(); }).catch((e) => setAuto({ erro: e.message }));
  }, [dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = dados?.financeiro || null;
  const mes = f?.inicio_mes ? nomeMes(f.inicio_mes) : '';
  const ano = String(f?.inicio || '').slice(0, 4);
  const n = (v) => Number(v || 0);

  // Dia do cálculo mostrado e o relatório anterior a ele (para "hoje" e para a variação).
  const diaCalc = f?.totais_ate || dados?.dia || hoje();
  const evol = (dados?.evolucao || []).filter((e) => e.dia < diaCalc);
  const anterior = evol[evol.length - 1] || null;
  const mesmoMes = anterior && f?.inicio_mes && anterior.inicio_mes === f.inicio_mes;
  const rotuloDia = diaCalc === hoje() ? 'hoje' : dataCurta(diaCalc);

  const vencidoAno = n(f?.recebido_total) + n(f?.inadimplencia_total);
  const pctRecebido = vencidoAno ? Math.round((n(f?.recebido_total) / vencidoAno) * 100) : 0;
  const totalMes = n(f?.recebido_mes) + n(f?.inadimplencia_mes) + n(f?.a_vencer_mes);
  const pctMes = (v) => (totalMes ? Math.round((n(v) / totalMes) * 100) : 0);
  const entrouHoje = mesmoMes ? n(f?.recebido_no_mes) - n(anterior.recebido_no_mes) : null;
  const recebimentosHoje = mesmoMes ? n(f?.titulos_recebidos_no_mes) - n(anterior.titulos_recebidos_no_mes) : null;
  // Inadimplência do ano contra o último cálculo do dia anterior (pedido do Marcus, 06/11/2026, 14h42: ver se reduz a cada dia).
  const deltaAno = anterior && anterior.inadimplencia_total != null ? n(f?.inadimplencia_total) - n(anterior.inadimplencia_total) : null;

  // Inadimplência do ano em cada dia útil do mês (pedido do Marcus, 06/11/2026, 14h42): o último cálculo de cada dia que
  // passou, o cálculo atual no dia dele, e os dias que ainda vão chegar em pontilhado.
  const porDia = Object.fromEntries((dados?.evolucao || []).filter((e) => e.inicio_mes === f?.inicio_mes && e.inadimplencia_total != null).map((e) => [e.dia, n(e.inadimplencia_total)]));
  if (f?.inicio_mes) porDia[diaCalc] = n(f.inadimplencia_total);
  const dias = f?.inicio_mes ? diasUteis(f.inicio_mes, f.fim_mes || diaCalc) : [];
  // As barras partem de 90% do menor valor, para a variação de um dia para o outro aparecer; o valor exato vai em cima.
  const maxDia = Math.max(1, ...Object.values(porDia));
  const baseDia = Math.min(maxDia, ...Object.values(porDia)) * 0.9;
  const atrasos = dados?.atrasos || [];
  const maxAtraso = Math.max(1, ...atrasos.map((c) => n(c.atraso_valor)));

  return (
    <Estado carregando={carregando} erro={erro} recarregar={recarregar}>
      <div className="cabeca-dia">
        <div>
          <p className="ola">Honorários no Omie</p>
          <p className="data-pagina">{ano ? `Carteira de ${ano}` : 'Carteira'}</p>
        </div>
        <div className="estado-leitura omie-acoes">
          {auto === 'calculando'
            ? <span role="status"><i className="ti ti-loader-2 girando" aria-hidden="true" />Atualizando com o Omie{f?.atualizado ? `, mostrando o cálculo de ${quando(f.atualizado)}` : ''}</span>
            : f?.atualizado && <span><span className="luz ok" aria-hidden="true" />Calculado no Omie {quando(f.atualizado)}</span>}
          {auto?.erro && <span className="selo regras">Não deu para atualizar agora: {auto.erro}</span>}
          <BaixarRelatorio eu={eu} aoCalcular={atualizar} />
        </div>
      </div>
      {!f ? <div className="cartao"><Vazio icone="ti-building-bank" titulo="Ainda sem totais do Omie" texto="Eles entram com o primeiro relatório gravado, todo dia útil depois das 17h30." /></div> : (
        <>
          <section className="omie-ano tema-escuro" aria-labelledby="t-ano">
            <img className="omie-selo" src={leao} alt="" />
            <div className="omie-anel" style={{ '--p': pctRecebido }} role="img" aria-label={`${pctRecebido}% do valor vencido no ano já foi recebido`}>
              <div><b>{pctRecebido}%</b><span>recebido</span></div>
            </div>
            <div className="omie-ano-meio">
              <h2 id="t-ano">Honorários vencidos de {dataCurta(f.inicio)} a {dataCurta(f.totais_ate)}</h2>
              <p className="omie-total"><Dinheiro valor={vencidoAno} /></p>
              <p className="omie-frase">De cada R$&nbsp;100 que venceram no ano, <b>R$&nbsp;{pctRecebido} já entraram</b>. Faltam {comReal(mil(n(f.inadimplencia_total)))}.</p>
              <div className="omie-ano-nums">
                <div><span className="rot"><i className="c-rec" aria-hidden="true" />Recebido</span><b><Dinheiro valor={f.recebido_total} /></b>{f.titulos != null && <small>{inteiro(f.titulos)} títulos no período</small>}</div>
                <div><span className="rot"><i className="c-atr" aria-hidden="true" />Inadimplência</span><b><Dinheiro valor={f.inadimplencia_total} /></b>{f.titulos_inadimplentes != null && <small>{inteiro(f.titulos_inadimplentes)} títulos em aberto</small>}</div>
              </div>
            </div>
            {f.recebido_no_mes != null && (
              <div className="omie-hoje">
                <span className="rot"><span className="luz-verde" aria-hidden="true" />{entrouHoje != null && entrouHoje >= 0 ? `Entrou no caixa ${rotuloDia}` : `Entrou no caixa em ${mes}`}</span>
                <b><Dinheiro valor={entrouHoje != null && entrouHoje >= 0 ? entrouHoje : f.recebido_no_mes} /></b>
                {entrouHoje != null && entrouHoje >= 0
                  ? <small>{inteiro(recebimentosHoje)} {recebimentosHoje === 1 ? 'recebimento' : 'recebimentos'} desde o último cálculo de {dataCurta(anterior.dia)}</small>
                  : <small>{f.titulos_recebidos_no_mes != null ? `${inteiro(f.titulos_recebidos_no_mes)} recebimentos` : 'recebimentos de qualquer vencimento'}</small>}
                {entrouHoje != null && entrouHoje >= 0 && <span className="omie-hoje-mes">No mês: {brl(f.recebido_no_mes)}</span>}
              </div>
            )}
          </section>

          {f.inicio_mes && (
            <>
              <div className="omie-secao"><h2>{mes.charAt(0).toUpperCase() + mes.slice(1)}</h2><span>vencimentos de {dataCurta(f.inicio_mes)} a {dataCurta(f.fim_mes || f.totais_ate)}</span></div>
              <div className="omie-mes">
                <section className="cartao" aria-labelledby="t-mes">
                  <h2 id="t-mes">Títulos que vencem no mês</h2>
                  <p className="sub">{brl(totalMes)}</p>
                  <div className="omie-regua" role="img" aria-label={`${pctMes(f.recebido_mes)}% recebido, ${pctMes(f.inadimplencia_mes)}% inadimplente, ${pctMes(f.a_vencer_mes)}% a vencer`}>
                    {n(f.recebido_mes) > 0 && <i className="c-rec" style={{ flexGrow: n(f.recebido_mes) }} />}
                    {n(f.inadimplencia_mes) > 0 && <i className="c-atr" style={{ flexGrow: n(f.inadimplencia_mes) }} />}
                    {n(f.a_vencer_mes) > 0 && <i className="c-ven" style={{ flexGrow: n(f.a_vencer_mes) }} />}
                  </div>
                  <div className="omie-leg">
                    <div className="leg-rec"><span className="rot"><span className="bolinha c-rec" aria-hidden="true" />Recebido, {pctMes(f.recebido_mes)}%</span><b>{brl(f.recebido_mes)}</b>{f.titulos_mes != null && <small>{inteiro(f.titulos_mes)} títulos do mês</small>}</div>
                    <div className="leg-atr"><span className="rot"><span className="bolinha c-atr" aria-hidden="true" />Inadimplente, {pctMes(f.inadimplencia_mes)}%</span><b>{brl(f.inadimplencia_mes)}</b>{f.titulos_inadimplentes_mes != null && <small>{inteiro(f.titulos_inadimplentes_mes)} vencidos em aberto</small>}</div>
                    <div className="leg-ven"><span className="rot"><span className="bolinha c-ven" aria-hidden="true" />A vencer, {pctMes(f.a_vencer_mes)}%</span><b>{brl(f.a_vencer_mes)}</b>{f.titulos_a_vencer_mes != null && <small>{inteiro(f.titulos_a_vencer_mes)} títulos em aberto</small>}</div>
                  </div>
                </section>
                <section className="cartao omie-fxr" aria-labelledby="t-fxr">
                  <h2 id="t-fxr">Faturado e recebido em {mes}</h2>
                  <p className="sub">recebimentos de qualquer vencimento que entraram no mês</p>
                  <div className="omie-fxr-linhas">
                    <div><div className="topo-l"><span>Faturado de honorários</span><b>{brl(f.faturado_mes)}</b></div><div className="trilha"><i className="c-fat" style={{ width: '100%' }} /></div>{f.titulos_faturado_mes != null && <small>{inteiro(f.titulos_faturado_mes)} títulos, pagos e em aberto</small>}</div>
                    <div><div className="topo-l"><span>Entrou no caixa</span><b>{brl(f.recebido_no_mes)}</b></div><div className="trilha"><i className="c-rec" style={{ width: `${Math.min(100, n(f.faturado_mes) ? (n(f.recebido_no_mes) / n(f.faturado_mes)) * 100 : 0)}%` }} /></div>{f.titulos_recebidos_no_mes != null && <small>{inteiro(f.titulos_recebidos_no_mes)} recebimentos</small>}</div>
                  </div>
                  {n(f.faturado_mes) > 0 && <p className="omie-fxr-pct"><b>{Math.round((n(f.recebido_no_mes) / n(f.faturado_mes)) * 100)}%</b>do faturado do mês já entrou no caixa (somando recebimentos de qualquer vencimento)</p>}
                </section>
              </div>
            </>
          )}

          <div className="omie-secao"><h2>Maiores atrasos entre os cobrados</h2><span>{dados.atrasos_fonte === 'api' ? `cobrados de hoje, Omie às ${new Date(dados.atrasos_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' })}` : `do relatório de ${dataCurta(dados.atrasos_dia || dados.dia)}`}, títulos em atraso de todas as categorias</span></div>
          <section className="cartao omie-ranking-cartao" aria-label="Maiores atrasos entre os cobrados">
            {atrasos.length === 0 ? <Vazio icone="ti-circle-check" titulo="Nenhum atraso entre os cobrados" texto="Nenhum dos clientes cobrados tem título em atraso no Omie." /> : (
              <>
                <ol className="omie-ranking">
                  {atrasos.slice(0, todos ? atrasos.length : 8).map((c, i) => (
                    <li key={c.contato_id}>
                      <button type="button" onClick={() => abrirConversa(c.contato_id, dados.atrasos_dia || dados.dia)}>
                        <span className="pos" aria-hidden="true">{i + 1}</span>
                        <span className={`avatar sit-${c.situacao || 'so_boleto'}`} aria-hidden="true">{iniciais(c.nome) || <i className="ti ti-user" />}</span>
                        <span className="quem">
                          <b>{c.nome}<span className="so-leitor">, abrir a conversa</span></b>
                          {(c.empresas || []).length > 0 && <span className="emp">{c.empresas.slice(0, 2).join(', ')}{c.empresas.length > 2 ? ` e mais ${c.empresas.length - 2}` : ''}</span>}
                          {c.situacao && <span className={`etiqueta-sit sit-${c.situacao}`}><span className={`bolinha s-${c.situacao}`} aria-hidden="true" />{NOME_SITUACAO[c.situacao] || c.situacao}</span>}
                        </span>
                        <span className="barra-c" aria-hidden="true"><i style={{ width: `${(n(c.atraso_valor) / maxAtraso) * 100}%` }} /></span>
                        <span className="val"><b>{brl(c.atraso_valor)}</b><small>{inteiro(c.atraso_qtd)} {c.atraso_qtd === 1 ? 'título' : 'títulos'}</small></span>
                        <i className="ti ti-chevron-right ir" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ol>
                {atrasos.length > 8 && (
                  <button type="button" className="omie-ver-todos" onClick={() => setTodos(!todos)} aria-expanded={todos}>{todos ? 'Mostrar só os 8 maiores' : `Ver os ${atrasos.length} maiores`}</button>
                )}
              </>
            )}
          </section>

          {f.inicio_mes && dias.length > 0 && (
            <>
              <div className="omie-secao"><h2>Inadimplência do ano, dia a dia em {mes}</h2><span>honorários vencidos de {dataCurta(f.inicio)} até o dia e ainda em aberto, no último cálculo de cada dia</span></div>
              <section className="cartao" aria-label={`Inadimplência do ano em cada dia de ${mes}`}>
                <div className="omie-inad-topo">
                  <div><span className="rot">{rotuloDia.charAt(0).toUpperCase() + rotuloDia.slice(1)}</span><b><Dinheiro valor={f.inadimplencia_total} /></b>{f.titulos_inadimplentes != null && <small>{inteiro(f.titulos_inadimplentes)} títulos vencidos em aberto</small>}</div>
                  {deltaAno != null && deltaAno !== 0 && (
                    <p className={`omie-delta ${deltaAno > 0 ? 'sobe' : 'cai'}`}><b>{deltaAno > 0 ? '↑' : '↓'} {comReal(mil(Math.abs(deltaAno)))}</b>{deltaAno > 0 ? 'a mais' : 'a menos'} que no último cálculo de {dataCurta(anterior.dia)}</p>
                  )}
                </div>
                <div className="omie-dias" role="img" aria-label={dias.filter((d) => d in porDia).map((d) => `${dataCurta(d)}: ${brl(porDia[d])}`).join('; ')}>
                  {dias.map((d) => {
                    const futuro = d > diaCalc;
                    const temDado = d in porDia;
                    return (
                      <div key={d} className={`omie-dia${futuro ? ' futuro' : ''}${d === diaCalc ? ' atual' : ''}${!futuro && !temDado ? ' sem' : ''}`}>
                        <em>{temDado ? mil(porDia[d]) : ''}</em>
                        <i style={temDado ? { height: `${maxDia > baseDia ? ((porDia[d] - baseDia) / (maxDia - baseDia)) * 80 + 8 : 50}%` } : undefined} />
                        <small>{d === diaCalc ? rotuloDia : d.slice(8, 10)}</small>
                      </div>
                    );
                  })}
                </div>
                {dias.some((d) => d < diaCalc && !(d in porDia)) && <p className="mini omie-sem-nota">Dia sem barra: ninguém consultou o Omie pelo sistema naquele dia.</p>}
              </section>
            </>
          )}

          <p className="mini omie-fonte">Fonte: Omie, relatórios Faturado X Recebido e Contas a Receber, Inadimplência (Honorários). Só consulta: nada é alterado no Omie.</p>
        </>
      )}
    </Estado>
  );
}
