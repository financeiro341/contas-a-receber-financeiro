// Totais do Omie calculados na hora (só consulta), com a MESMA conta do programa financeiro.py v8 da tarefa das 16h11
// (cr_config/financeiro_py do Painel das Automações), para os números baterem com os relatórios do Omie que a Maria Clara
// usa (Finanças > Meus Relatórios), centavo por centavo:
//   A (--vencimento): PesquisarLancamentos {cNatureza R, cCodCateg 1.02.02, vencimento de 01/01 ao último dia do mês, lDadosCad}
//   B (--aberto):     PesquisarLancamentos {cNatureza R, cStatus ATRASADO, cCodCateg 1.02.02, previsão de 01/01 a hoje}
//   C (--pagamento):  PesquisarLancamentos {cNatureza R, cCodCateg 1.02.02, pagamento do dia 01 do mês a hoje}
// Da consulta B saem também os atrasados por cliente do Omie, para o "Quem cobrar hoje".
//   D (só para o Quem cobrar, 06/11/2026): os mesmos atrasados de honorários dos anos anteriores (previsão de 01/01/2015
//     a 31/12 do ano passado), para a lista mostrar também as maiores dívidas antigas. Não entra em nenhum total.
//   E (Em atraso por cliente, 06/11/2026): títulos ATRASADOS de TODAS as categorias e de todos os anos (previsão de
//     01/01/2015 a hoje), por cliente do Omie, para a coluna "Em atraso" da Cobrança do dia sair pela API e não
//     depender do relatório das 17h30 (pedido do Marcus, 06/11, 14h46). Não entra em nenhum total; se falhar, os totais
//     continuam valendo e a coluna fica com o relatório.

export const CATEG = "1.02.02"; // Honorários
export const VERSAO = "painel-cr omie_totais 2026-11-06b (conta do financeiro.py v8; atrasados de todos os anos; em atraso por cliente)";

type Pagina = { nTotRegistros?: number; nTotPaginas?: number; titulosEncontrados?: any[] } | null;
export type Consultar = (param: Record<string, unknown>) => Promise<Pagina>;

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
export function dataDe(s: unknown): string | null {
  const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export function periodos(hoje: string) {
  const [a, m] = hoje.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return {
    hoje,
    ini: `${a}-01-01`,
    ini_m: `${a}-${String(m).padStart(2, "0")}-01`,
    fim_m: `${a}-${String(m).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`,
  };
}

export function filtros(hoje: string) {
  const p = periodos(hoje);
  return {
    vencimento: { cNatureza: "R", cCodCateg: CATEG, dDtVencDe: br(p.ini), dDtVencAte: br(p.fim_m), lDadosCad: true },
    aberto: { cNatureza: "R", cStatus: "ATRASADO", cCodCateg: CATEG, dDtPrevDe: br(p.ini), dDtPrevAte: br(hoje) },
    pagamento: { cNatureza: "R", cCodCateg: CATEG, dDtPagtoDe: br(p.ini_m), dDtPagtoAte: br(hoje) },
    antigos: { cNatureza: "R", cStatus: "ATRASADO", cCodCateg: CATEG, dDtPrevDe: "01/01/2015", dDtPrevAte: `31/12/${Number(hoje.slice(0, 4)) - 1}` },
    todas_categorias: { cNatureza: "R", cStatus: "ATRASADO", dDtPrevDe: "01/01/2015", dDtPrevAte: br(hoje) },
  };
}

// Lê todas as páginas de uma consulta (50 por página, o máximo do Omie), com poucas chamadas ao mesmo tempo.
export async function todasAsPaginas(consultar: Consultar, filtro: Record<string, unknown>, simultaneas = 3) {
  const primeira = await consultar({ ...filtro, nPagina: 1, nRegPorPagina: 50 });
  const titulos = new Map<number, any>();
  const guardar = (p: Pagina) => { for (const t of p?.titulosEncontrados || []) titulos.set(t.cabecTitulo.nCodTitulo, t); };
  guardar(primeira);
  const esperado = primeira?.nTotRegistros ?? 0;
  const paginas = primeira?.nTotPaginas ?? 1;
  if (paginas > 150) throw new Error("omie: páginas demais");
  const fila = Array.from({ length: Math.max(0, paginas - 1) }, (_, i) => i + 2);
  // Se uma página falhar, os outros leitores param na hora (esvazia a fila): nada de seguir consultando o Omie depois do erro.
  await Promise.all(Array.from({ length: Math.min(simultaneas, fila.length) }, async () => {
    for (let n = fila.shift(); n !== undefined; n = fila.shift()) {
      try {
        guardar(await consultar({ ...filtro, nPagina: n, nRegPorPagina: 50 }));
      } catch (e) {
        fila.length = 0;
        throw e;
      }
    }
  }));
  return { titulos, esperado };
}

export function calcular(hoje: string, venc: Map<number, any>, espV: number, abt: Map<number, any>, espA: number, pag: Map<number, any>, espC: number,
  ant: Map<number, any> = new Map(), espD = 0) {
  const p = periodos(hoje);
  const dentro = (d: string | null) => d !== null && p.ini <= d && d <= hoje;
  const noMes = (d: string | null) => d !== null && p.ini_m <= d && d <= p.fim_m;
  const mesAteHoje = (d: string | null) => d !== null && p.ini_m <= d && d <= hoje;

  let rec = 0, n = 0, canc = 0;
  let fatM = 0, recM = 0, avM = 0, nFatM = 0, nRecM = 0, nAvM = 0;
  const vencidosAbertosMes = new Map<number, number>();
  for (const t of venc.values()) {
    const c = t.cabecTitulo, r = t.resumo || {};
    if (c.cCodCateg !== CATEG) continue;
    const dv = dataDe(c.dDtVenc);
    if (dentro(dv)) {
      if (c.cStatus === "CANCELADO") canc++;
      else { n++; rec += r.nValLiquido || 0; }
    }
    if (c.cStatus === "CANCELADO" || !noMes(dv)) continue;
    nFatM++; fatM += c.nValorTitulo || 0;
    const liq = r.nValLiquido || 0;
    recM += liq; if (liq > 0) nRecM++;
    const ab = r.nValAberto || 0;
    if (ab > 0 && (dv as string) >= hoje) { nAvM++; avM += ab; }
    else if (ab > 0) vencidosAbertosMes.set(c.nCodTitulo, ab);
  }

  let inad = 0, inadM = 0, nInad = 0, nInadM = 0;
  const porCliente = new Map<number, { qtd: number; valor: number; mais_antigo: string | null }>();
  for (const t of abt.values()) {
    const c = t.cabecTitulo, r = t.resumo || {};
    // A consulta já vem só com ATRASADO; não filtrar por cStatus (o Omie devolve também títulos com saldo após desconto).
    if (c.cStatus === "CANCELADO" || c.cCodCateg !== CATEG || !dentro(dataDe(c.dDtPrevisao))) continue;
    const ab = r.nValAberto || 0;
    if (ab > 0) {
      nInad++; inad += ab;
      if (mesAteHoje(dataDe(c.dDtPrevisao))) { nInadM++; inadM += ab; }
      vencidosAbertosMes.delete(c.nCodTitulo);
      const cli = Number(c.nCodCliente);
      if (Number.isSafeInteger(cli) && cli > 0) {
        const x = porCliente.get(cli) || { qtd: 0, valor: 0, mais_antigo: null };
        x.qtd++; x.valor += ab;
        const dv = dataDe(c.dDtVenc) || dataDe(c.dDtPrevisao);
        if (dv && (!x.mais_antigo || dv < x.mais_antigo)) x.mais_antigo = dv;
        porCliente.set(cli, x);
      }
    }
  }
  const foraB = r2([...vencidosAbertosMes.values()].reduce((s, v) => s + v, 0));

  const lancs = new Map<string, number>();
  for (const t of pag.values()) {
    const c = t.cabecTitulo;
    if (c.cCodCateg !== CATEG || (c.cNatureza || "R") !== "R") continue;
    for (const l of t.lancamentos || []) {
      if (!mesAteHoje(dataDe(l.dDtLanc))) continue;
      const chave = l.nCodLanc ? String(l.nCodLanc) : `${c.nCodTitulo}|${l.dDtLanc}|${l.nIdLancCC}|${l.nValLanc}`;
      lancs.set(chave, l.nValLanc || 0);
    }
  }
  const recNoMes = [...lancs.values()].reduce((s, v) => s + v, 0);
  const nRecNoMes = [...lancs.values()].filter((v) => v > 0).length;

  const completo = venc.size >= espV && abt.size >= espA && pag.size >= espC && ant.size >= espD;
  const totais = {
    data: hoje, inicio: p.ini, totais_ate: hoje,
    recebido_total: r2(rec), inadimplencia_total: r2(inad),
    inicio_mes: p.ini_m, fim_mes: p.fim_m,
    recebido_mes: r2(recM), titulos_mes: nRecM,
    inadimplencia_mes: r2(inadM), titulos_inadimplentes_mes: nInadM,
    a_vencer_mes: r2(avM), titulos_a_vencer_mes: nAvM,
    faturado_mes: r2(fatM), titulos_faturado_mes: nFatM,
    recebido_no_mes: r2(recNoMes), titulos_recebidos_no_mes: nRecNoMes,
    aberto_vencido_fora_b_mes: foraB,
    titulos: n, cancelados_fora: canc, titulos_inadimplentes: nInad,
    lidos_vencimento: venc.size, esperados_vencimento: espV,
    lidos_aberto: abt.size, esperados_aberto: espA,
    lidos_pagamento: pag.size, esperados_pagamento: espC,
    lidos_anos_anteriores: ant.size, esperados_anos_anteriores: espD,
    status: completo ? "completo" : "incompleto",
    versao_programa: VERSAO,
  };
  // Quem cobrar hoje: dívida do ano (consulta B) e de todos os anos (B + D, os anos anteriores).
  const doAno = new Map([...porCliente.entries()].map(([k, x]) => [k, { ...x }]));
  const fimAnoPassado = `${Number(hoje.slice(0, 4)) - 1}-12-31`;
  for (const t of ant.values()) {
    const c = t.cabecTitulo, r = t.resumo || {};
    const dp = dataDe(c.dDtPrevisao);
    if (c.cStatus === "CANCELADO" || c.cCodCateg !== CATEG || !dp || dp > fimAnoPassado) continue;
    const ab = r.nValAberto || 0;
    const cli = Number(c.nCodCliente);
    if (ab <= 0 || !Number.isSafeInteger(cli) || cli <= 0) continue;
    const x = porCliente.get(cli) || { qtd: 0, valor: 0, mais_antigo: null };
    x.qtd++; x.valor += ab;
    const dv = dataDe(c.dDtVenc) || dp;
    if (dv && (!x.mais_antigo || dv < x.mais_antigo)) x.mais_antigo = dv;
    porCliente.set(cli, x);
  }
  const atrasados = [...porCliente.entries()].map(([cliente, x]) => {
    const a = doAno.get(cliente);
    return { cliente, qtd: x.qtd, valor: r2(x.valor), mais_antigo: x.mais_antigo, qtd_ano: a?.qtd ?? 0, valor_ano: r2(a?.valor ?? 0) };
  });
  return { totais, atrasados, status: totais.status as "completo" | "incompleto" };
}

// Em atraso por cliente (consulta E): soma do que está em aberto nos títulos atrasados, de qualquer categoria e ano.
// Devolve null quando a leitura não veio inteira (assim a tela não mostra um valor menor do que o real).
export function atrasoPorCliente(todos: Map<number, any>, esperado: number) {
  if (todos.size < esperado) return null;
  const m = new Map<number, { qtd: number; valor: number }>();
  for (const t of todos.values()) {
    const c = t.cabecTitulo, r = t.resumo || {};
    if (c.cStatus === "CANCELADO" || (c.cNatureza || "R") !== "R") continue;
    const ab = r.nValAberto || 0;
    const cli = Number(c.nCodCliente);
    if (ab <= 0 || !Number.isSafeInteger(cli) || cli <= 0) continue;
    const x = m.get(cli) || { qtd: 0, valor: 0 };
    x.qtd++; x.valor += ab;
    m.set(cli, x);
  }
  return [...m.entries()].map(([cliente, x]) => ({ cliente, qtd: x.qtd, valor: r2(x.valor) }));
}

export async function retratoDoOmie(consultar: Consultar, hoje: string) {
  const f = filtros(hoje);
  // Uma consulta de cada vez (cada uma já lê 3 páginas ao mesmo tempo): o Omie recusa chamadas demais em paralelo.
  const a = await todasAsPaginas(consultar, f.vencimento);
  const b = await todasAsPaginas(consultar, f.aberto);
  const c = await todasAsPaginas(consultar, f.pagamento);
  const d = await todasAsPaginas(consultar, f.antigos);
  const r = calcular(hoje, a.titulos, a.esperado, b.titulos, b.esperado, c.titulos, c.esperado, d.titulos, d.esperado);
  // E por último e à parte: se o Omie recusar ou o prazo acabar, os totais (A a D) já calculados continuam valendo.
  let atraso_clientes: { cliente: number; qtd: number; valor: number }[] | null = null;
  try {
    const e = await todasAsPaginas(consultar, f.todas_categorias);
    atraso_clientes = atrasoPorCliente(e.titulos, e.esperado);
  } catch (_) { atraso_clientes = null; }
  return { ...r, atraso_clientes };
}
