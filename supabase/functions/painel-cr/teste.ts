// Teste local: deno run -A supabase/functions/painel-cr/teste.ts (não é publicado com a função).
// Teste da função painel-cr com fetch simulado (Painel, banco e Evolution).
const chamadas: { url: string; metodo: string; corpo?: string; headers?: any }[] = [];
let evoStatus = 201;
let senhaEmDia = true;
let limiteContato = 99;
let evoDemora = false;
const marcadas: any[] = [];
let perfil = { first_name: "Maria", last_name: "Clara", role: "financeiro", sector: "financeiro" };
const db: any = { envios: [], notas: [], eventos_caixa: [], atendentes: [{ usuario_id: "u-maria", nome: "Maria Clara", assinatura: "Maria Clara - Dep. Financeiro", pode_enviar: true }] };
let servidor: any;
const fetchReal = globalThis.fetch;
globalThis.fetch = async (input: any, init: any = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const metodo = init.method || "GET";
  chamadas.push({ url, metodo, corpo: init.body, headers: init.headers });
  const resp = (b: any, s = 200, h: any = {}) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...h } });
  if (url.startsWith("http://fn/")) return servidor(new Request(url, init));
  if (url.includes("rpc/senha_em_dia")) return resp(senhaEmDia);
  if (url.includes("rpc/registrar_envio")) {
    const a = JSON.parse(init.body);
    if (db.envios.filter((e: any) => e.contato_id === a.p_contato).length >= limiteContato) return resp({ code: "P0001", message: "limite_contato_minuto" }, 400);
    const e = { id: db.envios.length + 1, contato_id: a.p_contato, usuario_nome: a.p_usuario_nome, tipo: a.p_tipo, texto: a.p_texto, nome_arquivo: a.p_nome_arquivo };
    db.envios.push(e); return resp(e.id);
  }
  if (url.includes("/auth/v1/user")) return resp({ id: perfil.first_name === "Maria" ? "u-maria" : "u-olavio" });
  if (url.includes("nbksfvivdodjdddreppv.supabase.co/rest/v1/profiles?select=first_name")) return resp([perfil]);
  if (url.includes("nbksfvivdodjdddreppv.supabase.co/rest/v1/profiles")) return resp([{ id: "u-maria", first_name: "Maria", last_name: "Clara", role: "financeiro", sector: "financeiro" }, { id: "u-x", first_name: "Fulano", last_name: "", role: "financeiro", sector: "fiscal" }]);
  if (url.includes("/rest/v1/atendentes")) return resp(url.includes("usuario_id=eq.u-maria") || !url.includes("usuario_id=eq") ? db.atendentes : []);
  if (url.includes("/rest/v1/contatos")) return resp([{ id: 94, jid: "556281437001@s.whatsapp.net", lid: null, telefone: "556281437001" }]);
  if (url.includes("/rest/v1/envios?select=id&usuario_id")) return new Response("[]", { status: 200, headers: { "content-range": `0-0/${db.envios.length}` } });
  if (url.includes("/rest/v1/envios") && metodo === "POST") { const e = { id: db.envios.length + 1, ...JSON.parse(init.body) }; db.envios.push(e); return resp([e], 201); }
  if (url.includes("/rest/v1/envios?id=eq") && metodo === "PATCH") { Object.assign(db.envios[db.envios.length - 1], JSON.parse(init.body)); return resp([]); }
  if (url.includes("/rest/v1/eventos_caixa")) { db.eventos_caixa.push(JSON.parse(init.body)); return resp([{ id: 1 }], 201); }
  if (url.includes("/rest/v1/mensagens") && !url.includes("select=id") && metodo === "POST") { db.mensagens = [...(db.mensagens || []), JSON.parse(init.body)]; return new Response(null, { status: 201 }); }
  if (url.includes("/rest/v1/notas") && metodo === "POST") { const n = { id: 7, ...JSON.parse(init.body) }; db.notas.push(n); return resp([n], 201); }
  if (url.includes("/chat/findMessages/")) {
    const b = JSON.parse(init.body);
    if (b.page > 1) return resp({ messages: { total: 2, pages: 1, currentPage: b.page, records: [] } });
    return resp({ messages: { total: 2, pages: 1, currentPage: 1, records: [
      { key: { id: "H1", fromMe: false, remoteJid: b.where.key.remoteJid }, messageType: "conversation", message: { conversation: "Bom dia, paguei ontem" }, messageTimestamp: 1790000000, source: "android", MessageUpdate: [{ status: "READ" }] },
      { key: { id: "H2", fromMe: true, remoteJid: b.where.key.remoteJid }, messageType: "documentMessage", message: { documentMessage: { fileName: "BOLETO.pdf" } }, messageTimestamp: 1790000100, source: "web" },
      { key: { id: "H3", fromMe: true, remoteJid: b.where.key.remoteJid }, messageType: "protocolMessage", message: {}, messageTimestamp: 1790000200 },
    ] } });
  }
  if (url.includes("/chat/markMessageAsRead/")) { marcadas.push(JSON.parse(init.body)); return resp({ message: "Read messages", read: "success" }, 201); }
  if (url.includes("/rest/v1/mensagens?select=id,remote_jid")) return resp([{ id: "U1", remote_jid: "556281437001@s.whatsapp.net" }]);
  if (url.includes("/rest/v1/mensagens?id=in.") && metodo === "PATCH") { db.lidas = url; return new Response(null, { status: 204 }); }
  if (url.includes("/rest/v1/mensagens?on_conflict=id&select=id")) { const l = JSON.parse(init.body); db.historico = l; return resp(l.map((x: any) => ({ id: x.id })), 201); }
  if (url.includes("/rest/v1/mensagens?select=id,contato_id,remote_jid")) {
    const id = decodeURIComponent(url.split("id=eq.")[1] || "");
    const base = { id, contato_id: 94, remote_jid: "556281437001@s.whatsapp.net", de_nos: false, grupo: false, nome_arquivo: null };
    if (id === "3EB0IMG1" || id === "3EB0SVG1") return resp([{ ...base, tipo: "imageMessage" }]);
    if (id === "3EB0GRP1") return resp([{ ...base, grupo: true, tipo: "imageMessage" }]);
    if (id === "3EB0TXT1") return resp([{ ...base, tipo: "conversation" }]);
    if (id === "3EB0BIG1") return resp([{ ...base, tipo: "documentMessage", tamanho_arquivo: 20 * 1024 * 1024 }]);
    if (id === "3EB0DOC1") return resp([{ ...base, tipo: "documentMessage", tamanho_arquivo: null }]);
    return resp([]);
  }
  if (url.includes("/chat/getBase64FromMediaMessage/")) {
    const b = JSON.parse(init.body);
    db.midiaPedida = b;
    if (b.message.key.id === "3EB0SVG1") return resp({ mimetype: "image/svg+xml", fileName: "x.svg", base64: btoa("<svg onload=alert(1)>") });
    return resp({ mediaType: "imageMessage", mimetype: "image/jpeg; charset=binary", fileName: null, base64: btoa("JPEG") });
  }
  if (url.includes("/rest/v1/contato_clientes")) return resp([{ codigo_cliente_omie: 4112028795, empresa: "BIMAIS CONSTRUTORA E INCORPORADORA LTDA" }]);
  if (url.startsWith("https://app.omie.com.br/")) {
    const b = JSON.parse(init.body);
    db.omieCalls = [...(db.omieCalls || []), b.call];
    if (b.app_key !== "omie-chave" || b.app_secret !== "omie-segredo") return resp({ faultstring: "chave errada" }, 500);
    if (b.call === "ListarContasReceber") {
      const t = (cod: number, venc: string, st: string, gerado: string, cat = "1.02.02") => ({ codigo_lancamento_omie: cod, codigo_cliente_fornecedor: 4112028795, numero_documento: "9007", numero_parcela: "001/001", data_vencimento: venc, valor_documento: 1621, status_titulo: st, codigo_categoria: cat, boleto: { cGerado: gerado }, codigo_barras_ficha_compensacao: "03399.0" });
      return resp({ pagina: 1, total_de_paginas: 1, conta_receber_cadastro: [{ ...t(5, "01/11/2026", "A VENCER", "S"), codigo_cliente_fornecedor: 999 }, t(3, "10/12/2026", "A VENCER", "S", "1.02.97"), t(1, "10/11/2026", "A VENCER", "S"), t(2, "10/10/2026", "ATRASADO", "N"), t(4, "10/09/2026", "PAGO", "S")] });
    }
    if (b.call === "PesquisarLancamentos") {
      const pr = b.param[0];
      if (db.omieBloqueado) { db.pesquisasBloqueadas = (db.pesquisasBloqueadas || 0) + 1; return resp({ faultstring: "ERROR: Consumo redundante detectado. Aguarde 60 segundos." }, 500); }
      db.pesquisas = [...(db.pesquisas || []), pr];
      const tt = (id: number, venc: string, st: string, valor: number, liq: number, aberto: number, cli = 77) => ({ cabecTitulo: { nCodTitulo: id, cCodCateg: "1.02.02", dDtVenc: venc, dDtPrevisao: venc, cStatus: st, nValorTitulo: valor, nCodCliente: cli, cNatureza: "R" }, resumo: { nValLiquido: liq, nValAberto: aberto }, lancamentos: liq ? [{ nCodLanc: id * 10, dDtLanc: "03/11/2026", nValLanc: liq }] : [] });
      if (pr.cStatus === "ATRASADO" && String(pr.dDtPrevAte).startsWith("31/12/")) return resp({ nTotRegistros: 2, nTotPaginas: 1, titulosEncontrados: [tt(6, "10/05/2024", "ATRASADO", 200, 0, 200), tt(7, "10/03/2025", "ATRASADO", 1000, 0, 1000, 99)] });
      if (pr.cStatus === "ATRASADO") return resp({ nTotRegistros: 2, nTotPaginas: 1, titulosEncontrados: [tt(2, "10/10/2026", "ATRASADO", 500, 0, 500), tt(3, "10/09/2026", "ATRASADO", 300, 0, 300, 88)] });
      if (pr.dDtPagtoDe) return resp({ nTotRegistros: 1, nTotPaginas: 1, titulosEncontrados: [tt(1, "02/11/2026", "RECEBIDO", 1000, 1000, 0)] });
      const pag1 = [tt(1, "02/11/2026", "RECEBIDO", 1000, 1000, 0), tt(2, "10/10/2026", "ATRASADO", 500, 0, 500)];
      const pag2 = [tt(3, "10/09/2026", "ATRASADO", 300, 0, 300, 88), tt(4, "20/11/2026", "AVENCER", 700, 0, 700), tt(5, "15/11/2026", "CANCELADO", 900, 0, 0)];
      return resp({ nTotRegistros: 5, nTotPaginas: 2, titulosEncontrados: pr.nPagina === 1 ? pag1 : pag2 });
    }
    if (b.call === "ObterBoleto") return resp({ cLinkBoleto: db.linkRuim ? "https://evil.example/x.pdf" : "https://cdn.omie.com.br/repo/boleto.pdf?Signature=x", cCodBarras: "03399.0" });
    return resp({ faultstring: "não esperado" }, 500);
  }
  if (url.startsWith("https://cdn.omie.com.br/")) return new Response(new TextEncoder().encode("%PDF-1.4 boleto"), { status: 200, headers: { "content-type": "application/pdf" } });
  if (url.includes("/rest/v1/respostas_prontas") && metodo === "POST") return resp([{ id: 5 }], 201);
  if (url.includes("/rest/v1/omie_retratos") && metodo === "POST") { const r = { id: (db.retratos || []).length + 1, calculado_em: new Date(Date.now() - (db.idadeRetrato || 0)).toISOString(), ...JSON.parse(init.body) }; db.retratos = [...(db.retratos || []), r]; return resp([r], 201); }
  if (url.includes("/rest/v1/omie_retratos?select")) {
    const todos = db.retratos || [];
    const lista = url.includes("status=in.(completo,incompleto)") ? todos.filter((r: any) => r.status === "completo" || r.status === "incompleto") : todos;
    return resp(lista.slice(-1));
  }
  if (url.includes("rpc/painel_quem_cobrar")) { db.quemCobrar = JSON.parse(init.body); return resp({ dia: db.quemCobrar.p_dia, contatos: [{ contato_id: 94, valor: 500 }], sem_numero: { clientes: 1, valor: 300 } }); }
  if (url.includes("rpc/painel_buscar_conversa")) { db.busca = JSON.parse(init.body); return resp({ resultados: [], mais: false }); }
  if (url.includes("rpc/painel_omie")) return resp({ dia: "2026-11-04", financeiro: { recebido_total: 1, atualizado: "2026-11-04T18:14:00-03:00" }, atrasos: [] });
  if (url.includes("/rest/v1/resolucoes")) { db.resolucoes = [...(db.resolucoes || []), { metodo, url, corpo: init.body }]; return new Response(null, { status: metodo === "DELETE" ? 204 : 201 }); }
  if (url.includes("/rest/v1/lembretes") && metodo === "POST") { const l = { id: 11, ...JSON.parse(init.body) }; db.lembretes = [l]; return resp([l], 201); }
  if (url.includes("/rest/v1/lembretes?select")) return resp(db.lembretes ? [{ feito_em: null, cancelado_em: null, ...db.lembretes[0] }] : []);
  if (url.includes("/rest/v1/lembretes?id=eq") && metodo === "PATCH") { db.lembrete_patch = JSON.parse(init.body); return new Response(null, { status: 204 }); }
  if (url.includes("/rest/v1/ligacoes") && metodo === "POST") { const l = { id: 21, ...JSON.parse(init.body) }; db.ligacoes = [l]; return resp([l], 201); }
  if (url.includes("/rest/v1/ligacoes?select=id&fonte=eq.manual")) return resp(db.ligacaoRecente ? [{ id: 21 }] : []);
  if (url.includes("/rest/v1/ligacoes?select")) return resp(db.ligacoes ? [{ ...db.ligacoes[0], anulada_em: null }] : []);
  if (url.includes("/rest/v1/ligacoes?id=eq") && metodo === "PATCH") { db.ligacao_patch = JSON.parse(init.body); return new Response(null, { status: 204 }); }
  if (url.includes("api-evolution.iapessoas.com.br") && evoDemora) { const e = new Error("abortado"); e.name = "AbortError"; throw e; }
  if (url.includes("api-evolution.iapessoas.com.br")) return evoStatus < 300 ? resp({ key: { id: "MSG123", fromMe: true }, status: "PENDING" }, evoStatus) : resp({ status: 400, response: { message: [{ exists: false, number: "x" }] } }, evoStatus);
  return resp({ desconhecido: url }, 599);
};
Deno.env.set("SUPABASE_URL", "https://mhihrbchidudhgvpouia.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "servico-teste");
Deno.env.set("EVOLUTION_APIKEY", "chave-teste");
Deno.env.set("OMIE_APP_KEY", "omie-chave");
Deno.env.set("OMIE_APP_SECRET", "omie-segredo");
const servir = Deno.serve;
(Deno as any).serve = (f: any) => { servidor = f; return { shutdown() {} }; };
await import("./index.ts");
(Deno as any).serve = servir;
const post = async (corpo: any) => { const r = await fetch("http://fn/", { method: "POST", headers: { Authorization: "Bearer tok", Origin: "http://localhost:4173", "Content-Type": "application/json" }, body: JSON.stringify(corpo) }); return [r.status, await r.json()]; };
const ok = (c: boolean, m: string) => { console.log((c ? "ok   " : "FALHA") + " " + m); if (!c) Deno.exitCode = 1; };

let [s, b] = await post({ acao: "enviar_texto", contato: 94, texto: "  Bom dia, segue o boleto.  " });
ok(s === 200 && b.mensagem_id === "MSG123", "texto enviado " + s + JSON.stringify(b));
const evo = chamadas.find((c) => c.url.includes("sendText"))!;
ok(evo.url.endsWith("/message/sendText/Financeiro%20CB"), "rota da Evolution");
ok(JSON.parse(evo.corpo!).text === "*Maria Clara - Dep. Financeiro:*\nBom dia, segue o boleto.", "assinatura no texto");
ok(JSON.parse(evo.corpo!).number === "556281437001", "número sem @");
ok(evo.headers.apikey === "chave-teste", "chave só no servidor");
ok(db.envios[0].status === "enviado" && db.envios[0].mensagem_id === "MSG123", "envio gravado como enviado");
ok(db.mensagens?.[0]?.id === "MSG123" && db.mensagens[0].remote_jid === "556281437001@s.whatsapp.net" && db.mensagens[0].texto.startsWith("*Maria Clara") && db.mensagens[0].de_nos === true, "mensagem enviada gravada na conversa");

[s, b] = await post({ acao: "enviar_texto", contato: 94, texto: "   " });
ok(s === 400, "texto vazio recusado");

evoStatus = 400;
[s, b] = await post({ acao: "enviar_texto", contato: 94, texto: "oi" });
ok(s === 502 && db.envios[1].status === "erro" && !JSON.stringify(b).includes("exists"), "falha da Evolution vira erro sem detalhe " + JSON.stringify(b));
evoDemora = true;
[s, b] = await post({ acao: "enviar_texto", contato: 94, texto: "oi" });
ok(s === 504 && db.envios[2].status === "incerto", "demora da Evolution vira incerto");
evoDemora = false;
evoStatus = 201;

[s, b] = await post({ acao: "enviar_arquivo", contato: 94, nome: "../boleto.pdf", mimetype: "application/pdf", base64: btoa("PDF-FALSO"), legenda: "" });
const med = JSON.parse(chamadas.filter((c) => c.url.includes("sendMedia")).pop()!.corpo!);
 ok(s === 200 && med.mediatype === "document" && med.fileName === ".._boleto.pdf" && med.caption === "*Maria Clara - Dep. Financeiro*", "arquivo enviado " + JSON.stringify(med.caption));
[s, b] = await post({ acao: "enviar_arquivo", contato: 94, nome: "x.exe", mimetype: "application/x-msdownload", base64: btoa("MZ") });
ok(s === 400, "executável recusado");
[s, b] = await post({ acao: "enviar_arquivo", contato: 94, nome: "boleto\u202efdp.exe", mimetype: "application/pdf", base64: btoa("PDF") });
const med2 = JSON.parse(chamadas.filter((c) => c.url.includes("sendMedia")).pop()!.corpo!);
ok(s === 200 && med2.fileName === "boletofdp.exe.pdf", "nome com bidi e extensão errada corrigido: " + med2.fileName);
limiteContato = 0;
[s, b] = await post({ acao: "enviar_texto", contato: 94, texto: "oi" });
ok(s === 429 && /5 mensagens/.test(b.erro), "limite por contato " + JSON.stringify(b));
limiteContato = 99;
[s, b] = await post({ acao: "enviar_texto", contato: 1e21, texto: "oi" });
ok(s === 400, "id enorme recusado");

[s, b] = await post({ acao: "buscar_historico", contato: 94 });
ok(s === 200 && b.novas === 2 && db.historico.length === 2 && db.historico[1].nome_arquivo === "BOLETO.pdf" && db.historico[0].status === "READ" && db.historico[0].enviada_em.startsWith("2026-09"), "histórico antigo trazido " + JSON.stringify(b));
[s, b] = await post({ acao: "marcar_lida", contato: 94 });
ok(s === 200 && b.marcadas === 1 && marcadas[0].readMessages[0].id === "U1" && marcadas[0].readMessages[0].fromMe === false && db.lidas.includes('"U1"'), "marcar como lida " + JSON.stringify(b));
[s, b] = await post({ acao: "resposta_criar", titulo: "Teste", texto: "Olá {nome}" });
ok(s === 200 && b.id === 5, "resposta pronta criada");
[s, b] = await post({ acao: "nota", contato: 94, texto: "Prometeu pagar sexta" });
ok(s === 200 && db.notas[0].usuario_nome === "Maria Clara", "nota gravada");

[s, b] = await post({ acao: "resolver", contato: 94, resolvida: true });
ok(s === 200 && db.resolucoes[0].metodo === "POST" && JSON.parse(db.resolucoes[0].corpo).usuario_nome === "Maria Clara", "conversa resolvida");
[s, b] = await post({ acao: "resolver", contato: 94, resolvida: false });
ok(s === 200 && db.resolucoes[1].metodo === "DELETE", "conversa reaberta");
[s, b] = await post({ acao: "lembrete_criar", contato: 94, dia: "2020-01-01" });
ok(s === 400, "retorno no passado recusado");
[s, b] = await post({ acao: "lembrete_criar", contato: 94, dia: "2099-01-01" });
ok(s === 400, "retorno longe demais recusado");
const amanha = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
[s, b] = await post({ acao: "lembrete_criar", contato: 94, dia: amanha, hora: "25:00" });
ok(s === 400, "hora inválida recusada");
[s, b] = await post({ acao: "lembrete_criar", contato: 94, dia: amanha, hora: "09:30", texto: "Ver se pagou" });
ok(s === 200 && db.lembretes[0].hora === "09:30" && db.lembretes[0].usuario_nome === "Maria Clara", "retorno marcado");
[s, b] = await post({ acao: "lembrete_feito", id: 11 });
ok(s === 200 && db.lembrete_patch.feito_por_nome === "Maria Clara", "retorno feito");
[s, b] = await post({ acao: "ligacao_registrar", contato: 94, direcao: "feita", resultado: "atendida", observacao: "Disse que paga sexta" });
ok(s === 200 && db.ligacoes[0].fonte === "manual" && db.ligacoes[0].id_chamada.startsWith("manual-") && db.ligacoes[0].usuario_id === "u-maria", "ligação registrada");
[s, b] = await post({ acao: "ligacao_registrar", contato: 94, direcao: "qualquer", resultado: "x" });
ok(s === 200 && db.ligacoes[0].direcao === "feita" && db.ligacoes[0].resultado === "nao_atendida", "ligação com valores fora da lista cai no padrão");
db.ligacaoRecente = true;
[s, b] = await post({ acao: "ligacao_registrar", contato: 94, direcao: "feita", resultado: "atendida" });
ok(s === 429, "clique duplo na ligação recusado");
db.ligacaoRecente = false;
[s, b] = await post({ acao: "resolver", contato: 94, resolvida: "false" });
ok(s === 200 && db.resolucoes.at(-1).metodo === "DELETE", "\"false\" em texto não resolve");
db.lembretes[0].feito_em = "2026-11-05T15:00:00Z";
[s, b] = await post({ acao: "lembrete_cancelar", id: 11 });
ok(s === 400, "retorno já feito não se cancela");
db.lembretes[0].feito_em = null;

perfil = { first_name: "Olavio", last_name: "Santos", role: "financeiro", sector: "financeiro" };
const r2 = await fetch("http://fn/", { method: "POST", headers: { Authorization: "Bearer outro", "Content-Type": "application/json" }, body: JSON.stringify({ acao: "enviar_texto", contato: 94, texto: "oi" }) });
ok(r2.status === 403, "Olavio não envia " + r2.status);
const r7 = await fetch("http://fn/", { method: "POST", headers: { Authorization: "Bearer outro", "Content-Type": "application/json" }, body: JSON.stringify({ acao: "ligacao_anular", id: 21 }) });
ok(r7.status === 403 && !db.ligacao_patch, "Olavio não desfaz a ligação da Maria Clara");
const r8 = await fetch("http://fn/", { method: "POST", headers: { Authorization: "Bearer outro", "Content-Type": "application/json" }, body: JSON.stringify({ acao: "lembrete_cancelar", id: 11 }) });
ok(r8.status === 403, "Olavio não cancela o retorno da Maria Clara");
const r2b = await fetch("http://fn/", { method: "POST", headers: { Authorization: "Bearer outro", "Content-Type": "application/json" }, body: JSON.stringify({ acao: "marcar_lida", contato: 94 }) });
const j2b = await r2b.json();
ok(r2b.status === 200 && j2b.marcadas === 0 && marcadas.length === 1, "Olavio abre a conversa sem marcar como lida");
const r3 = await fetch("http://fn/?acao=eu", { headers: { Authorization: "Bearer outro" } });
const eu = await r3.json();
ok(eu.usuario.pode_enviar === false && eu.usuario.envio_ligado === true, "eu do Olavio");

perfil = { first_name: "Maria", last_name: "Clara", role: "financeiro", sector: "financeiro" };
{ const [s9] = await post({ acao: "ligacao_anular", id: 21 }); ok(s9 === 200 && db.ligacao_patch.anulada_por === "u-maria", "Maria Clara desfaz a própria ligação"); }
senhaEmDia = false;
const r6 = await fetch("http://fn/?acao=eu", { headers: { Authorization: "Bearer senha-pendente" } });
ok(r6.status === 401, "senha ainda não trocada não entra");
senhaEmDia = true;
perfil = { first_name: "Fulano", last_name: "", role: "financeiro", sector: "fiscal" };
const r4 = await fetch("http://fn/?acao=eu", { headers: { Authorization: "Bearer terceiro" } });
ok(r4.status === 401, "fora do financeiro não entra");
const r5 = await fetch("http://fn/", { method: "POST", headers: { Authorization: "Bearer terceiro" }, body: "{}" });
ok(r5.status === 401, "POST sem permissão");

perfil = { first_name: "Maria", last_name: "Clara", role: "financeiro", sector: "financeiro" };
const midia = async (id: string) => { const r = await fetch(`http://fn/?acao=midia&id=${id}`, { headers: { Authorization: "Bearer tok" } }); return [r.status, await r.json()]; };
{
  let [s, b] = await midia("3EB0IMG1");
  ok(s === 200 && b.mimetype === "image/jpeg" && b.nome === "arquivo.jpg" && atob(b.base64) === "JPEG" && db.midiaPedida.message.key.remoteJid === "556281437001@s.whatsapp.net", "imagem baixada da Evolution " + JSON.stringify({ ...b, base64: undefined }));
  [s, b] = await midia("3EB0SVG1");
  ok(s === 200 && b.mimetype === "application/octet-stream" && b.nome.endsWith(".bin"), "SVG vira arquivo para baixar, nunca imagem");
  [s] = await midia("3EB0GRP1");
  ok(s === 404, "mensagem de grupo recusada");
  [s] = await midia("3EB0TXT1");
  ok(s === 404, "mensagem sem arquivo recusada");
  db.midiaPedida = null;
  [s] = await midia("3EB0BIG1");
  ok(s === 413 && !db.midiaPedida, "documento de 20 MB recusado sem pedir à Evolution");
  [s] = await midia("3EB0DOC1");
  ok(s === 422 && !db.midiaPedida, "documento sem tamanho conhecido recusado sem baixar");
  [s] = await midia("../x");
  ok(s === 400, "id inválido recusado");
}

{
  const r = await fetch("http://fn/?acao=titulos&contato=94", { headers: { Authorization: "Bearer tok" } });
  const b = await r.json();
  ok(r.status === 200 && b.omie_ligado && b.titulos.length === 3 && b.titulos[0].codigo === 2 && b.titulos[2].categoria === "Adicional anual" && !b.titulos.some((t: any) => t.codigo === 4), "títulos em aberto do contato, do mais antigo ao mais novo, sem o pago");
  let [s, x] = await post({ acao: "enviar_boleto", contato: 94, titulo: 1, texto: "Segue a segunda via." });
  const med = JSON.parse(chamadas.filter((c) => c.url.includes("sendMedia")).pop()!.corpo!);
  ok(s === 200 && med.fileName === "BOLETO CASTELO BRANCO CONTABILIDADE - BIMAIS CONSTRUTORA E INCORPORADORA LTDA.pdf" && atob(med.media).startsWith("%PDF") && med.caption === "*Maria Clara - Dep. Financeiro:*\nSegue a segunda via." && db.eventos_caixa.some((e: any) => e.tipo === "segunda_via"), "boleto do Omie enviado ao cliente " + JSON.stringify(x));
  [s, x] = await post({ acao: "enviar_boleto", contato: 94, titulo: 2 });
  ok(s === 400 && /não tem boleto emitido/.test(x.erro), "título sem boleto emitido recusado (não gera boleto)");
  [s] = await post({ acao: "enviar_boleto", contato: 94, titulo: 999 });
  ok(s === 404, "título inexistente recusado");
  [s] = await post({ acao: "enviar_boleto", contato: 94, titulo: 5 });
  ok(s === 404 && !b.titulos.some((t: any) => t.codigo === 5), "título de outro cliente que o Omie devolveu é descartado");
  db.linkRuim = true;
  [s] = await post({ acao: "enviar_boleto", contato: 94, titulo: 1 });
  ok(s === 502, "link de boleto fora do Omie recusado");
  db.linkRuim = false;
  ok((db.omieCalls || []).every((c: string) => c === "ListarContasReceber" || c === "ObterBoleto"), "no Omie, só consulta: " + [...new Set(db.omieCalls)].join(","));
  perfil = { first_name: "Olavio", last_name: "Santos", role: "financeiro", sector: "financeiro" };
  const r9 = await fetch("http://fn/", { method: "POST", headers: { Authorization: "Bearer outro2", "Content-Type": "application/json" }, body: JSON.stringify({ acao: "enviar_boleto", contato: 94, titulo: 1 }) });
  ok(r9.status === 403, "Olavio não envia boleto");
}

{
  // Relatório do Omie com os números do dia (só consulta: PesquisarLancamentos) e Quem cobrar hoje.
  db.omieCalls = [];
  const g = async (q: string) => { const r = await fetch("http://fn/?" + q, { headers: { Authorization: "Bearer tok3" } }); return [r.status, await r.json()] as const; };
  let [s, x] = await g("acao=omie_agora");
  const f = x.financeiro || {};
  ok(s === 200 && x.status === "completo" && f.titulos_faturado_mes === 2 && f.faturado_mes === 1700 && f.recebido_mes === 1000 && f.inadimplencia_total === 800 && f.a_vencer_mes === 700 && f.recebido_no_mes === 1000, "totais do Omie calculados na hora " + JSON.stringify({ s, f }));
  ok(db.pesquisas.length === 5 && db.pesquisas.every((p: any) => p.nRegPorPagina === 50 && p.cCodCateg === "1.02.02" && p.cNatureza === "R"), "4 consultas de Honorários (3 dos totais e a dos anos anteriores), 50 por página, todas as páginas");
  ok(f.inadimplencia_total === 800, "a dívida dos anos anteriores não entra nos totais");
  ok(db.retratos.length === 2 && db.retratos[0].status === "calculando", "trava gravada antes de consultar o Omie");
  const a77 = db.retratos[1].atrasados.find((a: any) => a.cliente === 77), a99 = db.retratos[1].atrasados.find((a: any) => a.cliente === 99);
  ok(db.retratos[1].atrasados.length === 3 && a77.valor === 700 && a77.valor_ano === 500 && a77.qtd === 2 && a77.qtd_ano === 1 && a77.mais_antigo === "2024-05-10", "retrato com a dívida de todos os anos e a do ano por cliente " + JSON.stringify(a77));
  ok(a99.valor === 1000 && a99.valor_ano === 0 && a99.qtd_ano === 0, "cliente só com dívida antiga entra com valor do ano zero");
  const antes = db.pesquisas.length;
  [s, x] = await g("acao=omie_agora&atualizar=1");
  ok(s === 200 && db.pesquisas.length === antes, "atualizar antes de 2 minutos reaproveita o cálculo");
  db.retratos[1].calculado_em = new Date(Date.now() - 5 * 60_000).toISOString();
  [s, x] = await g("acao=omie_agora");
  ok(s === 200 && db.pesquisas.length === antes, "sem atualizar, o cálculo de 5 minutos vale");
  [s, x] = await g("acao=omie_agora&atualizar=1");
  ok(s === 200 && db.pesquisas.length === antes + 5 && db.retratos.length === 4 && db.retratos[3].status === "completo", "atualizar depois de 2 minutos calcula de novo");
  [s, x] = await g("acao=quem_cobrar");
  ok(s === 200 && db.quemCobrar.p_atrasados.length === 3 && x.contatos.length === 1 && x.calculado_em, "quem cobrar usa os atrasados do retrato");
  [s, x] = await g("acao=omie");
  ok(s === 200 && x.financeiro.faturado_mes === 1700, "aba Omie mostra o cálculo mais novo");
  [s, x] = await g("acao=buscar_conversa&contato=94&q=a");
  ok(s === 400, "busca com 1 letra recusada");
  [s, x] = await g("acao=buscar_conversa&contato=94&q=" + encodeURIComponent("  boleto %_ "));
  ok(s === 200 && db.busca.p_q === "boleto %_" && db.busca.p_contato === 94, "busca na conversa passa o termo ao banco");
  ok((db.omieCalls || []).every((c: string) => c === "PesquisarLancamentos"), "no Omie, só consulta (PesquisarLancamentos)");
}

{
  // Omie com bloqueio: não insiste, grava o erro e segura novas tentativas por 2 minutos; trava de outro cálculo em andamento.
  const g = async (q: string) => { const r = await fetch("http://fn/?" + q, { headers: { Authorization: "Bearer tok4" } }); return [r.status, await r.json()] as const; };
  db.retratos = [{ id: 90, dia: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()), calculado_em: new Date(Date.now() - 20 * 60_000).toISOString(), status: "completo", totais: {}, atrasados: [] }];
  db.omieBloqueado = true;
  let [s, x] = await g("acao=omie_agora&atualizar=1");
  ok(s === 429 && db.pesquisasBloqueadas === 1 && db.retratos.at(-1).status === "erro", "bloqueio do Omie: uma chamada só, erro gravado " + JSON.stringify({ s, n: db.pesquisasBloqueadas }));
  [s, x] = await g("acao=omie_agora&atualizar=1");
  ok(s === 429 && db.pesquisasBloqueadas === 1, "depois do erro, 2 minutos sem consultar o Omie");
  db.retratos = db.retratos.filter((r: any) => r.status !== "completo");
  [s, x] = await g("acao=omie_agora&atualizar=1");
  ok(s === 429 && db.pesquisasBloqueadas === 1 && /2 minutos/.test(x.erro), "sem cálculo guardado, espera 2 minutos depois do erro");
  db.omieBloqueado = false;
}
