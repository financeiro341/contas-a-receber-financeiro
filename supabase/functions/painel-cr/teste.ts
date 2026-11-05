// Teste local: deno run -A supabase/functions/painel-cr/teste.ts (não é publicado com a função).
// Teste da função painel-cr com fetch simulado (Painel, banco e Evolution).
const chamadas: { url: string; metodo: string; corpo?: string; headers?: any }[] = [];
let evoStatus = 201;
let senhaEmDia = true;
let limiteContato = 99;
let evoDemora = false;
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
  if (url.includes("/rest/v1/mensagens") && metodo === "POST") { db.mensagens = [...(db.mensagens || []), JSON.parse(init.body)]; return new Response(null, { status: 201 }); }
  if (url.includes("/rest/v1/notas") && metodo === "POST") { const n = { id: 7, ...JSON.parse(init.body) }; db.notas.push(n); return resp([n], 201); }
  if (url.includes("api-evolution.iapessoas.com.br") && evoDemora) { const e = new Error("abortado"); e.name = "AbortError"; throw e; }
  if (url.includes("api-evolution.iapessoas.com.br")) return evoStatus < 300 ? resp({ key: { id: "MSG123", fromMe: true }, status: "PENDING" }, evoStatus) : resp({ status: 400, response: { message: [{ exists: false, number: "x" }] } }, evoStatus);
  return resp({ desconhecido: url }, 599);
};
Deno.env.set("SUPABASE_URL", "https://mhihrbchidudhgvpouia.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "servico-teste");
Deno.env.set("EVOLUTION_APIKEY", "chave-teste");
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

[s, b] = await post({ acao: "nota", contato: 94, texto: "Prometeu pagar sexta" });
ok(s === 200 && db.notas[0].usuario_nome === "Maria Clara", "nota gravada");

perfil = { first_name: "Olavio", last_name: "Santos", role: "financeiro", sector: "financeiro" };
const r2 = await fetch("http://fn/", { method: "POST", headers: { Authorization: "Bearer outro", "Content-Type": "application/json" }, body: JSON.stringify({ acao: "enviar_texto", contato: 94, texto: "oi" }) });
ok(r2.status === 403, "Olavio não envia " + r2.status);
const r3 = await fetch("http://fn/?acao=eu", { headers: { Authorization: "Bearer outro" } });
const eu = await r3.json();
ok(eu.usuario.pode_enviar === false && eu.usuario.envio_ligado === true, "eu do Olavio");

perfil = { first_name: "Maria", last_name: "Clara", role: "financeiro", sector: "financeiro" };
senhaEmDia = false;
const r6 = await fetch("http://fn/?acao=eu", { headers: { Authorization: "Bearer senha-pendente" } });
ok(r6.status === 401, "senha ainda não trocada não entra");
senhaEmDia = true;
perfil = { first_name: "Fulano", last_name: "", role: "financeiro", sector: "fiscal" };
const r4 = await fetch("http://fn/?acao=eu", { headers: { Authorization: "Bearer terceiro" } });
ok(r4.status === 401, "fora do financeiro não entra");
const r5 = await fetch("http://fn/", { method: "POST", headers: { Authorization: "Bearer terceiro" }, body: "{}" });
ok(r5.status === 401, "POST sem permissão");
