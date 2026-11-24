// Aba Adicional Anual (24/11/2026, pedido do Marcus): os títulos da mensalidade adicional anual de 2026 lidos no Omie
// (só consulta), com o histórico do que já foi pago, para a aba montar metas, parcelas e a lista de quem cobrar.
//
// O que é o adicional de 2026 (conferido no Omie em 24/11/2026): categoria 1.02.97, duas parcelas (001/002 com vencimento
// 10/11/2026 e 002/002 com vencimento 10/12/2026), registradas a partir de 20/10/2026. A categoria 1.02.97 tem também
// títulos de outros acordos (parcelamentos antigos, adicional de anos anteriores); esses ficam fora e só são contados.
// Uma consulta só: PesquisarLancamentos {cNatureza R, cCodCateg 1.02.97, vencimento de 01/10/2026 a 31/12/2027}, para
// pegar também a parcela que teve o vencimento mudado. Os nomes e telefones vêm do cadastro (ListarClientes por código).
//
// Valores (decisão do Marcus, 24/11/2026: "igual à tela do Omie"):
//   recebido = resumo.nValLiquido (coluna "Pago ou Recebido" do Omie, com juros e multa);
//   quitado  = resumo.nValPago (o valor da parcela que já foi pago, sem juros e multa);
//   aberto   = resumo.nValAberto.
// As metas usam o valor da parcela (quitado e aberto), para fechar exato; o recebido aparece como no Omie.
// Desconto (24/11/2026, achado no primeiro cálculo real): o Omie lança o desconto concedido (ex.: "desconto de 50% concedido
// pela diretora") como um recebimento de valor 0 com nDesconto, e o nValPago soma o desconto. Desconto não é dinheiro que
// entrou: o devido da parcela é o valor menos o desconto, o quitado é o nValPago menos o desconto, e o lançamento só de
// desconto não aparece como pagamento.
//
// Fora da meta e da lista (decisão do Marcus, 24/11/2026): títulos cancelados e os 4 clientes que não recebem o
// adicional (decisões de 12/11/2026, processo-paybot.md). A aba só diz quantos ficaram de fora.

export const CATEG_ADICIONAL = "1.02.97";
export const VERSAO_ADICIONAL = "painel-adicional 2026-11-24b";
export const REGISTRO_DESDE = "2026-10-01";

// Códigos do cliente no Omie (conferidos em 24/11/2026). RDA CONFECCOES é outra empresa e continua na lista.
export const EXCLUIDOS: Record<number, string> = {
  4358621437: "R10 LOG TRANSPORTES",
  4358619684: "RAPHAEL CAMPOS GONZALEZ (RLOG)",
  4139450683: "RDA MEDICINA AVANCADA",
  4175977744: "AGENCIA MIDAS",
};

// Contas correntes do Omie que recebem o adicional (as mesmas do protótipo).
const BANCOS: Record<string, string> = { "4153071576": "Santander", "4099436378": "Inter" };

type Pagina = { nTotRegistros?: number; nTotPaginas?: number; titulosEncontrados?: any[] } | null;
export type Consultar = (param: Record<string, unknown>) => Promise<Pagina>;
export type ConsultarClientes = (codigos: number[]) => Promise<any[]>;

export function dataDe(s: unknown): string | null {
  const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export const FILTRO_ADICIONAL = { cNatureza: "R", cCodCateg: CATEG_ADICIONAL, dDtVencDe: "01/10/2026", dDtVencAte: "31/12/2027" };

// A parcela da campanha (1 ou 2) ou null quando o título é de outro acordo da mesma categoria.
export function parcelaDaCampanha(c: any): 1 | 2 | null {
  if (c?.cCodCateg !== CATEG_ADICIONAL) return null;
  const m = String(c.cNumParcela || "").match(/^0*([12])\/0*2$/);
  if (!m) return null;
  const reg = dataDe(c.dDtRegistro) || dataDe(c.dDtEmissao);
  if (!reg || reg < REGISTRO_DESDE) return null;
  return Number(m[1]) as 1 | 2;
}

function forma(obs: string): string {
  const t = obs.toLowerCase();
  if (t.includes("banco inter")) return "Boleto (Inter)";
  if (t.includes("arquivo de retorno")) return "Boleto";
  if (t.includes("pix")) return "PIX";
  return "";
}

// Títulos da campanha, compactos, com os recebimentos (histórico do que já foi pago).
export function montar(titulos: Map<number, any>) {
  const lista: any[] = [];
  let foraQtd = 0, foraValor = 0;
  for (const t of titulos.values()) {
    const c = t.cabecTitulo || {}, r = t.resumo || {};
    const p = parcelaDaCampanha(c);
    if (!p) {
      const v = dataDe(c.dDtVenc);
      if (v && v >= "2026-11-01" && v <= "2026-12-31" && c.cStatus !== "CANCELADO") { foraQtd++; foraValor += Number(c.nValorTitulo) || 0; }
      continue;
    }
    const cliente = Number(c.nCodCliente);
    // Desconto do resumo; se o resumo não trouxer, a soma dos descontos dos lançamentos.
    const somaDesc = (t.lancamentos || []).reduce((s: number, l: any) => s + ((l.cNatureza || "R") === "R" ? Number(l.nDesconto) || 0 : 0), 0);
    const desconto = Math.max(Number(r.nDesconto) || 0, somaDesc);
    lista.push({
      titulo: Number(c.nCodTitulo),
      cliente,
      parcela: p,
      vencimento: dataDe(c.dDtVenc),
      status: String(c.cStatus || ""),
      cancelado: c.cStatus === "CANCELADO",
      excluido: cliente in EXCLUIDOS,
      valor: r2(c.nValorTitulo),
      desconto: r2(desconto),
      devido: r2((Number(c.nValorTitulo) || 0) - desconto),
      aberto: c.cStatus === "CANCELADO" ? 0 : r2(r.nValAberto),
      quitado: r2(Math.max(0, (Number(r.nValPago) || 0) - desconto)),
      recebido: r2(r.nValLiquido),
      juros_multa: r2((Number(r.nJuros) || 0) + (Number(r.nMulta) || 0)),
      boleto: !!c.cCodigoBarras,
      banco: BANCOS[String(c.nCodCC)] || null,
      obs: c.observacao ? String(c.observacao).slice(0, 200) : null,
      // Só dinheiro que entrou (lançamento com valor); o que quitou da parcela é o lançamento sem juros e multa.
      pagamentos: (t.lancamentos || [])
        .filter((l: any) => (l.cNatureza || "R") === "R" && dataDe(l.dDtLanc) && (Number(l.nValLanc) || 0) > 0.004)
        .map((l: any) => ({
          dia: dataDe(l.dDtLanc),
          valor: r2(l.nValLanc),
          parcela: r2((Number(l.nValLanc) || 0) - (Number(l.nJuros) || 0) - (Number(l.nMulta) || 0)),
          banco: BANCOS[String(l.nCodCC)] || null,
          forma: forma(String(l.cObsLanc || "")),
        }))
        .sort((a: any, b: any) => a.dia.localeCompare(b.dia)),
      descontos: (t.lancamentos || [])
        .filter((l: any) => (l.cNatureza || "R") === "R" && dataDe(l.dDtLanc) && (Number(l.nDesconto) || 0) > 0.004)
        .map((l: any) => ({ dia: dataDe(l.dDtLanc), valor: r2(l.nDesconto) })),
    });
  }
  lista.sort((a, b) => a.parcela - b.parcela || a.titulo - b.titulo);
  return { titulos: lista, fora_da_campanha: { qtd: foraQtd, valor: r2(foraValor) } };
}

// Lê todas as páginas (50 por página), três de cada vez; se uma falhar, as outras param.
export async function todasAsPaginas(consultar: Consultar, filtro: Record<string, unknown>, simultaneas = 3) {
  const primeira = await consultar({ ...filtro, nPagina: 1, nRegPorPagina: 50 });
  const titulos = new Map<number, any>();
  const guardar = (p: Pagina) => { for (const t of p?.titulosEncontrados || []) titulos.set(t.cabecTitulo.nCodTitulo, t); };
  guardar(primeira);
  const esperado = primeira?.nTotRegistros ?? 0;
  const paginas = primeira?.nTotPaginas ?? 1;
  if (paginas > 60) throw new Error("omie: páginas demais no adicional");
  const fila = Array.from({ length: Math.max(0, paginas - 1) }, (_, i) => i + 2);
  await Promise.all(Array.from({ length: Math.min(simultaneas, fila.length) }, async () => {
    for (let n = fila.shift(); n !== undefined; n = fila.shift()) {
      try { guardar(await consultar({ ...filtro, nPagina: n, nRegPorPagina: 50 })); } catch (e) { fila.length = 0; throw e; }
    }
  }));
  return { titulos, esperado };
}

// Só o que a aba usa do cadastro: nome e telefone (sem e-mail, endereço nem dado bancário).
export function resumirClientes(cadastros: any[]) {
  const saida: Record<string, { nome: string; cnpj: string | null; telefone: string | null }> = {};
  for (const c of cadastros) {
    const tel = c.telefone1_numero ? `${c.telefone1_ddd ? `(${c.telefone1_ddd}) ` : ""}${c.telefone1_numero}` : null;
    saida[String(c.codigo_cliente_omie)] = {
      nome: String(c.nome_fantasia || c.razao_social || "").trim() || String(c.cnpj_cpf || ""),
      cnpj: c.cnpj_cpf || null,
      telefone: tel,
    };
  }
  return saida;
}

export async function adicionalDoOmie(consultar: Consultar, consultarClientes: ConsultarClientes) {
  const a = await todasAsPaginas(consultar, FILTRO_ADICIONAL);
  const m = montar(a.titulos);
  const codigos = [...new Set(m.titulos.map((t) => t.cliente).filter((c) => Number.isSafeInteger(c) && c > 0))];
  let clientes: Record<string, any> = {};
  let cadastroCompleto = true;
  try {
    const cads: any[] = [];
    for (let i = 0; i < codigos.length; i += 50) cads.push(...await consultarClientes(codigos.slice(i, i + 50)));
    clientes = resumirClientes(cads);
  } catch (_) { cadastroCompleto = false; }
  return {
    versao: VERSAO_ADICIONAL,
    status: a.titulos.size >= a.esperado ? "completo" : "incompleto",
    lidos: a.titulos.size,
    esperados: a.esperado,
    cadastro_completo: cadastroCompleto,
    excluidos: Object.entries(EXCLUIDOS).map(([k, v]) => ({ cliente: Number(k), nome: v })),
    ...m,
    clientes,
  };
}
