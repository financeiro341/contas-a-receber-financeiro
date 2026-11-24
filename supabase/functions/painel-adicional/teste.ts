// Teste local: deno run -A supabase/functions/painel-adicional/teste.ts (não é publicado com a função).
// Login, Omie e banco simulados.
const db: any = { retratos: [], anotacoes: [], eventos: [], omie: [], pesquisas: [] };
let perfil = { first_name: "Maria", last_name: "Clara", role: "financeiro", sector: "financeiro" };
let servidor: any;
globalThis.fetch = async (input: any, init: any = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const metodo = init.method || "GET";
  const resp = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url.startsWith("http://fn/")) return servidor(new Request(url, init));
  if (url.includes("/auth/v1/user")) return resp({ id: "u-maria" });
  if (url.includes("rest/v1/profiles")) return resp([perfil]);
  if (url.includes("rpc/senha_em_dia")) return resp(true);
  if (url.includes("/rest/v1/atendentes")) return resp([{ nome: "Maria Clara" }]);
  if (url.includes("/rest/v1/eventos_caixa")) { db.eventos.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
  if (url.includes("/rest/v1/adicional_retratos") && metodo === "POST") {
    const r = { id: db.retratos.length + 1, calculado_em: new Date(Date.now() - (db.idade || 0)).toISOString(), dados: {}, ...JSON.parse(init.body) };
    db.retratos.push(r); return resp([r], 201);
  }
  if (url.includes("/rest/v1/adicional_retratos?id=lt.") && metodo === "PATCH") {
    const lim = Number(url.split("id=lt.")[1].split("&")[0]);
    for (const r of db.retratos) if (r.id < lim) r.dados = {};
    return new Response(null, { status: 204 });
  }
  if (url.includes("/rest/v1/adicional_retratos?select")) {
    const lista = url.includes("status=in.(completo,incompleto)") ? db.retratos.filter((r: any) => r.status === "completo" || r.status === "incompleto") : db.retratos;
    return resp(lista.slice(-1));
  }
  if (url.includes("rpc/painel_adicional_whatsapp")) { db.whats = JSON.parse(init.body); return resp({ desde: db.whats.p_desde, clientes: {}, anotacoes: {} }); }
  if (url.includes("/rest/v1/adicional_anotacoes")) {
    db.anotacoes.push({ metodo, url, corpo: init.body });
    return metodo === "DELETE" ? new Response(null, { status: 204 }) : resp([{ texto: JSON.parse(init.body).texto, usuario_nome: "Maria Clara", em: "2026-11-24T12:00:00Z" }], 201);
  }
  if (url.startsWith("https://app.omie.com.br/")) {
    const b = JSON.parse(init.body);
    db.omie.push(b.call);
    if (b.app_key !== "omie-chave" || b.app_secret !== "omie-segredo") return resp({ faultstring: "chave errada" }, 500);
    if (db.bloqueado) return resp({ faultstring: "ERROR: Consumo redundante detectado. Aguarde 60 segundos." }, 500);
    if (b.call === "ListarClientes") {
      return resp({ clientes_cadastro: b.param[0].clientesPorCodigo.map((c: any) => ({ codigo_cliente_omie: c.codigo_cliente_omie, razao_social: `CLIENTE ${c.codigo_cliente_omie}`, telefone1_ddd: "75", telefone1_numero: "99999", email: "nao@vai.br" })) });
    }
    if (b.call === "PesquisarLancamentos") {
      db.pesquisas.push(b.param[0]);
      const ad = (id: number, parc: string, venc: string, st: string, cli: number, valor: number, pago: number) => ({
        cabecTitulo: { nCodTitulo: id, cCodCateg: "1.02.97", cNumParcela: parc, dDtRegistro: "20/10/2026", dDtVenc: venc, cStatus: st, nCodCliente: cli, nValorTitulo: valor, nCodCC: 4153071576 },
        resumo: { nValAberto: st === "CANCELADO" ? 0 : valor - pago, nValPago: pago, nValLiquido: pago },
        lancamentos: pago ? [{ cNatureza: "R", dDtLanc: "12/11/2026", nValLanc: pago, nCodCC: 4153071576, cObsLanc: "PIX" }] : [],
      });
      const pg = b.param[0].nPagina === 1
        ? [ad(1, "001/002", "10/11/2026", "RECEBIDO", 4112028795, 100, 100), ad(2, "002/002", "10/12/2026", "A VENCER", 4112028795, 100, 0)]
        : [ad(3, "001/002", "10/11/2026", "CANCELADO", 555, 80, 0)];
      return resp({ nTotRegistros: 3, nTotPaginas: 2, titulosEncontrados: pg });
    }
    return resp({ faultstring: "não esperado" }, 500);
  }
  return resp({ desconhecido: url }, 599);
};
Deno.env.set("SUPABASE_URL", "https://mhihrbchidudhgvpouia.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "servico-teste");
Deno.env.set("OMIE_APP_KEY", "omie-chave");
Deno.env.set("OMIE_APP_SECRET", "omie-segredo");
const servir = Deno.serve;
(Deno as any).serve = (f: any) => { servidor = f; return { shutdown() {} }; };
await import("./index.ts");
(Deno as any).serve = servir;
const ok = (c: boolean, m: string) => { console.log((c ? "ok   " : "FALHA") + " " + m); if (!c) Deno.exitCode = 1; };
const g = async (q: string, tok = "tok") => { const r = await fetch("http://fn/?" + q, { headers: { Authorization: `Bearer ${tok}`, Origin: "https://contas-a-receber-financeiro.vercel.app" } }); return [r.status, await r.json(), r.headers] as const; };
const post = async (corpo: any) => { const r = await fetch("http://fn/", { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" }, body: JSON.stringify(corpo) }); return [r.status, await r.json()] as const; };

{
  const r = await fetch("http://fn/?acao=adicional");
  ok(r.status === 401, "sem login: 401");
}
{
  perfil = { first_name: "Fulano", last_name: "", role: "comum", sector: "fiscal" };
  const [s] = await g("acao=adicional", "tok-fiscal");
  ok(s === 401, "setor fiscal não entra");
  perfil = { first_name: "Maria", last_name: "Clara", role: "financeiro", sector: "financeiro" };
}
{
  let [s, x, h] = await g("acao=adicional");
  ok(s === 200 && x.status === "completo" && x.titulos.length === 3 && x.lidos === 3 && db.pesquisas.length === 2, "lê as 2 páginas da categoria 1.02.97 " + JSON.stringify({ s, e: x.erro }));
  ok(h.get("access-control-allow-origin") === "https://contas-a-receber-financeiro.vercel.app", "CORS do sistema");
  ok(db.pesquisas[0].cCodCateg === "1.02.97" && db.pesquisas[0].dDtVencDe === "01/10/2026" && db.pesquisas[0].cNatureza === "R", "filtro da campanha");
  ok(x.clientes["4112028795"].nome === "CLIENTE 4112028795" && !JSON.stringify(x).includes("nao@vai.br"), "nome do cadastro, sem e-mail");
  ok(db.whats.p_desde === "2026-11-05" && db.whats.p_clientes.includes(4112028795) && db.whats.p_clientes.includes(555), "situação do WhatsApp pedida para os clientes");
  ok(x.titulos.find((t: any) => t.titulo === 3).cancelado === true && x.hoje, "cancelado marcado e dia de hoje");
  ok(db.omie.every((c: string) => c === "PesquisarLancamentos" || c === "ListarClientes"), "no Omie, só consulta");
  const n = db.pesquisas.length;
  [s, x] = await g("acao=adicional");
  ok(s === 200 && db.pesquisas.length === n && x.titulos.length === 3, "retrato reaproveitado por 10 minutos");
  [s, x] = await g("acao=adicional&atualizar=1");
  ok(s === 200 && db.pesquisas.length === n, "atualizar antes de 2 minutos não consulta de novo");
  db.retratos.at(-1).calculado_em = new Date(Date.now() - 3 * 60_000).toISOString();
  [s, x] = await g("acao=adicional&atualizar=1");
  ok(s === 200 && db.pesquisas.length === n + 2, "atualizar depois de 2 minutos consulta de novo");
  const comTitulos = db.retratos.filter((r: any) => r.dados?.titulos);
  ok(comTitulos.length === 1 && comTitulos[0].id === db.retratos.filter((r: any) => r.status === "completo").at(-1).id, "só o retrato mais novo guarda os títulos");
}
{
  db.retratos.forEach((r: any) => { r.calculado_em = new Date(Date.now() - 20 * 60_000).toISOString(); });
  db.bloqueado = true;
  const antes = db.omie.length;
  let [s, x] = await g("acao=adicional&atualizar=1");
  ok(s === 429 && db.omie.length === antes + 1 && db.retratos.at(-1).status === "erro", "bloqueio do Omie: uma chamada só, erro gravado");
  [s, x] = await g("acao=adicional");
  ok(s === 200 && db.omie.length === antes + 1 && x.titulos.length === 3, "depois do erro, mostra o último retrato sem consultar");
  db.bloqueado = false;
}
{
  let [s, b] = await post({ acao: "adicional_anotar", cliente: 4112028795, texto: "  contestou   o valor " });
  ok(s === 200 && b.anotacao.texto === "contestou o valor" && JSON.parse(db.anotacoes.at(-1).corpo).usuario_nome === "Maria Clara", "anotação gravada");
  ok(db.eventos.at(-1).tipo === "adicional_anotacao" && db.eventos.at(-1).contato_id === null, "anotação registrada no histórico");
  [s, b] = await post({ acao: "adicional_anotar", cliente: 4112028795, texto: "" });
  ok(s === 200 && b.anotacao === null && db.anotacoes.at(-1).metodo === "DELETE", "anotação vazia apaga");
  [s, b] = await post({ acao: "adicional_anotar", cliente: 4112028795, texto: "x".repeat(501) });
  ok(s === 400, "anotação longa recusada");
  [s, b] = await post({ acao: "enviar_texto", contato: 1, texto: "oi" });
  ok(s === 400, "outra ação recusada");
}
