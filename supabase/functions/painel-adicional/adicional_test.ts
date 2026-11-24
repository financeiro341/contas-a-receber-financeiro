// Teste local: deno test supabase/functions/painel-cr/adicional_test.ts (não é publicado com a função).
import { adicionalDoOmie, montar, parcelaDaCampanha, resumirClientes } from "./adicional.ts";

function igual(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

// Títulos no formato do PesquisarLancamentos (copiados do Omie em 24/11/2026, com os números trocados).
const pago = {
  cabecTitulo: { cCodCateg: "1.02.97", cNumParcela: "001/002", dDtRegistro: "20/10/2026", dDtVenc: "10/11/2026", cStatus: "RECEBIDO",
    nCodTitulo: 1, nCodCliente: 100, nValorTitulo: 135.08, nCodCC: 4099436378, cCodigoBarras: "0779" },
  lancamentos: [{ cNatureza: "R", dDtLanc: "12/11/2026", nValLanc: 137.86, nJuros: 0.08, nMulta: 2.7, nDesconto: 0, nCodCC: 4099436378,
    cObsLanc: "Recebimento realizado automaticamente a partir da integração com o Banco Inter" }],
  resumo: { nValAberto: 0, nValLiquido: 137.86, nValPago: 135.08, nJuros: 0.08, nMulta: 2.7 },
};
const aberto2 = {
  cabecTitulo: { cCodCateg: "1.02.97", cNumParcela: "002/002", dDtRegistro: "20/10/2026", dDtVenc: "10/12/2026", cStatus: "A VENCER",
    nCodTitulo: 2, nCodCliente: 100, nValorTitulo: 135.09, nCodCC: 4099436378, observacao: "EMPRESA BAIXADA - 18/11/2026" },
  lancamentos: [], resumo: { nValAberto: 135.09, nValLiquido: 0, nValPago: 0 },
};
const cancelado = {
  cabecTitulo: { cCodCateg: "1.02.97", cNumParcela: "001/002", dDtRegistro: "20/10/2026", dDtVenc: "10/11/2026", cStatus: "CANCELADO",
    nCodTitulo: 3, nCodCliente: 200, nValorTitulo: 283.67, observacao: "ISENTO DO ADICIONAL ANUAL" },
  lancamentos: [], resumo: { nValAberto: 0, nValLiquido: 0, nValPago: 0 },
};
const excluido = {
  cabecTitulo: { cCodCateg: "1.02.97", cNumParcela: "001/002", dDtRegistro: "20/10/2026", dDtVenc: "10/11/2026", cStatus: "ATRASADO",
    nCodTitulo: 4, nCodCliente: 4358621437, nValorTitulo: 500 },
  lancamentos: [], resumo: { nValAberto: 500, nValLiquido: 0, nValPago: 0 },
};
// Parcelamento antigo na mesma categoria, com vencimento em dezembro: fica fora e só é contado.
const outroAcordo = {
  cabecTitulo: { cCodCateg: "1.02.97", cNumParcela: "001/001", dDtRegistro: "02/02/2026", dDtVenc: "12/12/2026", cStatus: "PAGTO PARCIAL",
    nCodTitulo: 5, nCodCliente: 300, nValorTitulo: 681.53 },
  lancamentos: [{ cNatureza: "R", dDtLanc: "30/01/2026", nValLanc: 56.79 }], resumo: { nValAberto: 113.63, nValLiquido: 567.9, nValPago: 567.9 },
};
// Parcela parcial paga por PIX com desconto.
const parcial = {
  cabecTitulo: { cCodCateg: "1.02.97", cNumParcela: "001/002", dDtRegistro: "21/10/2026", dDtVenc: "17/11/2026", cStatus: "PAGTO PARCIAL",
    nCodTitulo: 6, nCodCliente: 400, nValorTitulo: 1000, nCodCC: 4153071576 },
  lancamentos: [
    { cNatureza: "R", dDtLanc: "20/11/2026", nValLanc: 300, nJuros: 0, nMulta: 0, nDesconto: 0, nCodCC: 4153071576, cObsLanc: "PIX" },
    { cNatureza: "R", dDtLanc: "18/11/2026", nValLanc: 190, nJuros: 0, nMulta: 0, nDesconto: 10, nCodCC: 4153071576, cObsLanc: "" },
  ],
  resumo: { nValAberto: 500, nValLiquido: 490, nValPago: 500, nDesconto: 10 },
};
// 2ª parcela "paga" no Omie só com desconto de 50% (lançamento de valor 0): não é pagamento.
const soDesconto = {
  cabecTitulo: { cCodCateg: "1.02.97", cNumParcela: "002/002", dDtRegistro: "21/10/2026", dDtVenc: "10/12/2026", cStatus: "PAGTO PARCIAL",
    nCodTitulo: 7, nCodCliente: 400, nValorTitulo: 638.23 },
  lancamentos: [{ cNatureza: "R", dDtLanc: "16/11/2026", nValLanc: 0, nJuros: 0, nMulta: 0, nDesconto: 319.12, cObsLanc: "DESCONTO DE 50%" }],
  resumo: { nValAberto: 319.11, nValLiquido: 0, nValPago: 319.12, nDesconto: 319.12 },
};

Deno.test("parcela da campanha: x/002 registrada desde 01/10/2026", () => {
  igual(parcelaDaCampanha(pago.cabecTitulo), 1, "1ª");
  igual(parcelaDaCampanha(aberto2.cabecTitulo), 2, "2ª");
  igual(parcelaDaCampanha(outroAcordo.cabecTitulo), null, "outro acordo");
  igual(parcelaDaCampanha({ ...pago.cabecTitulo, dDtRegistro: "30/09/2026", dDtEmissao: "30/09/2026" }), null, "registrada antes");
  igual(parcelaDaCampanha({ ...pago.cabecTitulo, cCodCateg: "1.02.02" }), null, "honorários");
  igual(parcelaDaCampanha({ ...pago.cabecTitulo, cNumParcela: "003/003" }), null, "três parcelas");
});

Deno.test("montar: valores iguais ao Omie e pagamentos com o que quitou da parcela", () => {
  const m = montar(new Map([[1, pago], [2, aberto2], [3, cancelado], [4, excluido], [5, outroAcordo], [6, parcial], [7, soDesconto]].map(([k, v]) => [k as number, v])));
  igual(m.titulos.length, 6, "6 títulos da campanha");
  igual(m.fora_da_campanha, { qtd: 1, valor: 681.53 }, "fora da campanha");
  const t1 = m.titulos.find((t) => t.titulo === 1)!;
  igual([t1.recebido, t1.quitado, t1.aberto, t1.juros_multa, t1.banco, t1.boleto], [137.86, 135.08, 0, 2.78, "Inter", true], "título pago");
  igual(t1.pagamentos, [{ dia: "2026-11-12", valor: 137.86, parcela: 135.08, banco: "Inter", forma: "Boleto (Inter)" }], "pagamento do pago");
  const t2 = m.titulos.find((t) => t.titulo === 2)!;
  igual([t2.parcela, t2.aberto, t2.obs, t2.pagamentos.length], [2, 135.09, "EMPRESA BAIXADA - 18/11/2026", 0], "2ª parcela");
  const t3 = m.titulos.find((t) => t.titulo === 3)!;
  igual([t3.cancelado, t3.aberto], [true, 0], "cancelado");
  igual(m.titulos.find((t) => t.titulo === 4)!.excluido, true, "excluído");
  const t6 = m.titulos.find((t) => t.titulo === 6)!;
  igual(t6.pagamentos.map((p: any) => [p.dia, p.valor, p.parcela, p.forma]), [["2026-11-18", 190, 190, ""], ["2026-11-20", 300, 300, "PIX"]], "parcial em ordem de data");
  igual([t6.devido, t6.quitado, t6.aberto, t6.desconto], [990, 490, 500, 10], "parcial com desconto");
  const t7 = m.titulos.find((t) => t.titulo === 7)!;
  igual([t7.devido, t7.quitado, t7.aberto, t7.recebido, t7.pagamentos.length], [319.11, 0, 319.11, 0, 0], "só desconto não é pagamento");
  igual(t7.descontos, [{ dia: "2026-11-16", valor: 319.12 }], "desconto registrado");
});

Deno.test("cadastro: só nome, CNPJ e telefone", () => {
  const r = resumirClientes([{ codigo_cliente_omie: 100, razao_social: "EMPRESA LTDA", nome_fantasia: "", cnpj_cpf: "1", telefone1_ddd: "75", telefone1_numero: "999", email: "x@y" }]);
  igual(r, { "100": { nome: "EMPRESA LTDA", cnpj: "1", telefone: "(75) 999" } }, "resumo do cadastro");
});

Deno.test("adicionalDoOmie: lê todas as páginas e os cadastros em blocos de 50", async () => {
  const paginas: number[] = [];
  const consultar = async (p: any) => {
    paginas.push(p.nPagina);
    const todos = [pago, aberto2, cancelado];
    return { nTotRegistros: 3, nTotPaginas: 3, titulosEncontrados: [todos[p.nPagina - 1]] };
  };
  const blocos: number[][] = [];
  const r = await adicionalDoOmie(consultar, async (cods) => { blocos.push(cods); return cods.map((c) => ({ codigo_cliente_omie: c, razao_social: `C${c}` })); });
  igual(paginas.sort(), [1, 2, 3], "páginas");
  igual([r.status, r.lidos, r.esperados, r.titulos.length, r.cadastro_completo], ["completo", 3, 3, 3, true], "resumo");
  igual(blocos, [[100, 200]], "um bloco de cadastro");
  igual(r.clientes["200"].nome, "C200", "nome");
});

Deno.test("adicionalDoOmie: cadastro com falha não derruba os títulos", async () => {
  const r = await adicionalDoOmie(async () => ({ nTotRegistros: 1, nTotPaginas: 1, titulosEncontrados: [pago] }), async () => { throw new Error("x"); });
  igual([r.cadastro_completo, r.titulos.length], [false, 1], "sem cadastro");
});
