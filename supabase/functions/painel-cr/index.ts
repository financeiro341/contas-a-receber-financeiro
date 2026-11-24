// Função painel-cr (projeto whatsapp-financeiro): entrega as métricas ao sistema do contas a receber
// e, desde a fase 2 (05/11/2026), a caixa de entrada: responder em texto e arquivo pela Evolution,
// notas internas, etiquetas, dono da conversa, conversa resolvida, retornos e ligações registradas.
// Login: o mesmo do Painel de Demandas. O token do usuário é conferido no Supabase do Painel
// (produção): entra quem é admin ou do setor financeiro ou diretoria. Envia mensagem só quem é admin
// ou está na tabela atendentes com pode_enviar (decisão do Marcus: Maria Clara e os administradores).
// A chave da Evolution fica só no segredo EVOLUTION_APIKEY da função; nunca vai ao navegador.
import { retratoDoOmie } from "./omie_totais.ts";

const PAINEL_URL = "https://nbksfvivdodjdddreppv.supabase.co";
const PAINEL_CHAVE = "sb_publishable_nOTE6VavsxhOqwrPNjQuew_3kFt2xx5"; // chave pública do Painel
const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EVOLUTION_URL = "https://api-evolution.iapessoas.com.br";
const INSTANCIA = "Financeiro CB";
const EVO_CHAVE = Deno.env.get("EVOLUTION_APIKEY") || "";

// Produção e prévias da Vercel do próprio time; localhost só com PERMITIR_LOCALHOST=1 no segredo da função.
const ORIGENS = [
  /^https:\/\/contas-a-receber-financeiro\.vercel\.app$/,
  /^https:\/\/contas-a-receber-financeiro-(git-[a-z0-9-]+|[a-z0-9]+)-mariana-1923\.vercel\.app$/,
  ...(Deno.env.get("PERMITIR_LOCALHOST") === "1" ? [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] : []),
];

// Arquivos aceitos no envio (boletos, comprovantes, planilhas, imagens). Até 8 MB.
// A extensão do nome precisa ser a do tipo; se não for, a do tipo é acrescentada.
const TIPOS_ARQUIVO: Record<string, { midia: "document" | "image"; ext: string[] }> = {
  "application/pdf": { midia: "document", ext: ["pdf"] },
  "image/jpeg": { midia: "image", ext: ["jpg", "jpeg"] },
  "image/png": { midia: "image", ext: ["png"] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { midia: "document", ext: ["xlsx"] },
  "application/vnd.ms-excel": { midia: "document", ext: ["xls"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { midia: "document", ext: ["docx"] },
  "application/msword": { midia: "document", ext: ["doc"] },
  "text/csv": { midia: "document", ext: ["csv"] },
  "text/plain": { midia: "document", ext: ["txt"] },
  "application/zip": { midia: "document", ext: ["zip"] },
};
// Tira os caracteres invisíveis que invertem o texto (U+200E, U+200F, U+202A a U+202E, U+2066 a U+2069) e troca por "_"
// os de controle (abaixo de U+0020) e os proibidos em nome de arquivo. Feito pelo código do caractere, sem sequência de escape:
// a publicação pela ferramenta do Supabase converte essas sequências (06/11/2026).
function limparNome(texto: string): string {
  let saida = "";
  for (const ch of texto) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) continue;
    saida += c < 0x20 || c === 92 || '/:*?"<>|'.includes(ch) ? "_" : ch;
  }
  return saida;
}

function nomeSeguro(bruto: unknown, ext: string[]): string {
  let nome = limparNome(String(bruto || "arquivo"))
    .trim().slice(0, 120) || "arquivo";
  const atual = nome.includes(".") ? nome.split(".").pop()!.toLowerCase() : "";
  if (!ext.includes(atual)) nome = `${nome}.${ext[0]}`;
  return nome;
}
const MAX_ARQUIVO = 8 * 1024 * 1024;
const CORES = ["neutro", "azul", "verde", "amarelo", "vermelho", "roxo"];

function cors(origem: string | null): Record<string, string> {
  const ok = origem && ORIGENS.some((r) => r.test(origem));
  return {
    "Access-Control-Allow-Origin": ok ? origem! : "https://contas-a-receber-financeiro.vercel.app",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(corpo: unknown, status: number, h: Record<string, string>) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...h, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

class Erro extends Error {
  constructor(public status: number, mensagem: string) { super(mensagem); }
}

type Usuario = { id: string; nome: string; papel: string; setor: string; podeEnviar: boolean; assinatura: string; token: string };
const cache = new Map<string, { ate: number; usuario: Usuario }>();

async function rest(caminho: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    ...init,
    headers: { apikey: SERVICO, Authorization: `Bearer ${SERVICO}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${caminho.split("?")[0]}: ${r.status} ${texto.slice(0, 200)}`);
  return texto ? JSON.parse(texto) : null;
}

async function conferir(token: string): Promise<Usuario | null> {
  const c = cache.get(token);
  if (c && c.ate > Date.now()) return c.usuario;
  const r = await fetch(`${PAINEL_URL}/auth/v1/user`, { headers: { apikey: PAINEL_CHAVE, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const p = await fetch(`${PAINEL_URL}/rest/v1/profiles?select=first_name,last_name,role,sector&id=eq.${encodeURIComponent(u.id)}`, {
    headers: { apikey: PAINEL_CHAVE, Authorization: `Bearer ${token}` },
  });
  if (!p.ok) return null;
  const perfil = (await p.json())[0];
  if (!perfil || !(perfil.role === "admin" || ["financeiro", "diretoria"].includes(perfil.sector))) return null;
  // Conta com a troca de senha pendente no Painel não entra (o Painel também a limita: senha_em_dia).
  const sd = await fetch(`${PAINEL_URL}/rest/v1/rpc/senha_em_dia`, {
    method: "POST",
    headers: { apikey: PAINEL_CHAVE, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!sd.ok || (await sd.json()) !== true) return null;
  const nome = [perfil.first_name, perfil.last_name].filter(Boolean).join(" ");
  const at = (await rest(`atendentes?select=nome,assinatura,pode_enviar&usuario_id=eq.${encodeURIComponent(u.id)}`))[0];
  const usuario: Usuario = {
    id: u.id,
    nome: at?.nome || nome,
    papel: perfil.role,
    setor: perfil.sector,
    podeEnviar: perfil.role === "admin" || !!at?.pode_enviar,
    // Sem linha em atendentes: quem é da diretoria assina "Diretoria Castelo"; os outros, nome e setor.
    assinatura: at?.assinatura || (perfil.sector === "diretoria" ? "Diretoria Castelo" : `${nome} - Dep. Financeiro`),
    token,
  };
  cache.set(token, { ate: Date.now() + 60_000, usuario });
  if (cache.size > 200) cache.clear();
  return usuario;
}

async function rpc(nome: string, args: Record<string, unknown>) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: SERVICO, Authorization: `Bearer ${SERVICO}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${nome}: ${r.status}`);
  return await r.json();
}

function hojeBrasil() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function inteiro(v: unknown, campo: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Erro(400, `${campo} inválido.`);
  return n;
}

async function evento(contato: number | null, u: Usuario, tipo: string, detalhe: Record<string, unknown>) {
  await rest("eventos_caixa", { method: "POST", body: JSON.stringify({ contato_id: contato, usuario_id: u.id, usuario_nome: u.nome, tipo, detalhe }) });
}

// Para quem a Evolution manda (número sem @ ou o lid) e o jid que fica gravado na mensagem.
async function contatoDestino(id: number): Promise<{ destino: string; jid: string }> {
  const c = (await rest(`contatos?select=id,jid,lid,telefone&id=eq.${id}`))[0];
  if (!c) throw new Erro(404, "Contato não encontrado.");
  if (c.jid && String(c.jid).endsWith("@s.whatsapp.net")) return { destino: String(c.jid).split("@")[0], jid: String(c.jid) };
  if (c.lid) return { destino: String(c.lid), jid: String(c.lid) };
  throw new Erro(400, "Este contato não tem número para resposta.");
}

// A Evolution não manda o aviso de mensagem nova para o que sai pela API: a função grava a mensagem.
// Os avisos de status (entregue, lida) chegam depois e atualizam a mesma linha, pelo id.
async function gravarMensagemEnviada(id: string, contato: number, jid: string, tipo: string, texto: string | null, arquivo: string | null) {
  await rest("mensagens?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ id, contato_id: contato, remote_jid: jid, grupo: false, de_nos: true, tipo, texto, nome_arquivo: arquivo, aparelho: "sistema", enviada_em: new Date().toISOString(), status: "SERVER_ACK" }),
  });
}

// Permissão de envio conferida na hora (sem o cache de 60 s), para valer logo quando é tirada.
async function confirmarQuePodeEnviar(u: Usuario) {
  if (u.papel === "admin") return;
  const at = (await rest(`atendentes?select=pode_enviar&usuario_id=eq.${encodeURIComponent(u.id)}`))[0];
  if (!at?.pode_enviar) throw new Erro(403, "Seu usuário pode ver as conversas, mas não responder.");
}

const LIMITES: Record<string, string> = {
  limite_pessoa_minuto: "Muitos envios em pouco tempo. Espere um minuto.",
  limite_contato_minuto: "Já foram 5 mensagens para este contato no último minuto. Espere um pouco.",
  limite_pessoa_dia: "Você chegou ao limite de 300 envios hoje.",
};

// Conta os limites e grava o envio na mesma transação (função registrar_envio, com trava por pessoa).
async function reservarEnvio(dados: Record<string, unknown>): Promise<number> {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/registrar_envio`, {
    method: "POST",
    headers: { apikey: SERVICO, Authorization: `Bearer ${SERVICO}`, "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
  const texto = await r.text();
  if (!r.ok) {
    const chave = Object.keys(LIMITES).find((k) => texto.includes(k));
    if (chave) throw new Erro(429, LIMITES[chave]);
    throw new Error(`registrar_envio: ${r.status} ${texto.slice(0, 200)}`);
  }
  return Number(JSON.parse(texto));
}

async function chamarEvolution(rota: string, corpo: Record<string, unknown>) {
  if (!EVO_CHAVE) throw new Erro(503, "O envio ainda não foi ligado: falta configurar a chave da Evolution na função.");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25_000);
  try {
    const r = await fetch(`${EVOLUTION_URL}/message/${rota}/${encodeURIComponent(INSTANCIA)}`, {
      method: "POST",
      headers: { apikey: EVO_CHAVE, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: ctl.signal,
    });
    const texto = await r.text();
    let dados: any = null;
    try { dados = JSON.parse(texto); } catch { /* resposta sem JSON */ }
    if (!r.ok) {
      const motivo = JSON.stringify(dados?.response?.message ?? dados?.message ?? texto).slice(0, 300);
      return { ok: false, incerto: false, erro: `Evolution ${r.status}: ${motivo}` };
    }
    return { ok: true, incerto: false, id: dados?.key?.id ?? null };
  } catch (e) {
    const demorou = (e as Error).name === "AbortError";
    return { ok: false, incerto: demorou, erro: demorou ? "A Evolution não respondeu em 25 segundos." : String((e as Error).message).slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

// Chamada à Evolution para leitura e marcação (rotas de chat). Devolve o JSON ou lança Erro 502.
async function evolutionChat(rota: string, corpo: Record<string, unknown>) {
  if (!EVO_CHAVE) throw new Erro(503, "A ligação com o WhatsApp ainda não foi configurada.");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25_000);
  try {
    const r = await fetch(`${EVOLUTION_URL}/chat/${rota}/${encodeURIComponent(INSTANCIA)}`, {
      method: "POST", headers: { apikey: EVO_CHAVE, "Content-Type": "application/json" }, body: JSON.stringify(corpo), signal: ctl.signal,
    });
    const texto = await r.text();
    if (!r.ok) { console.error(`evolution ${rota}: ${r.status} ${texto.slice(0, 300)}`); throw new Erro(502, "O WhatsApp não respondeu como esperado. Tente de novo em instantes."); }
    return texto ? JSON.parse(texto) : null;
  } catch (e) {
    if (e instanceof Erro) throw e;
    console.error(`evolution ${rota}: ${(e as Error).message}`);
    throw new Erro(502, "O WhatsApp não respondeu. Tente de novo em instantes.");
  } finally {
    clearTimeout(t);
  }
}

// Mídia de uma mensagem (imagem, comprovante, áudio, vídeo, figurinha), baixada na hora do WhatsApp pela
// Evolution (/chat/getBase64FromMediaMessage). Nada fica guardado no Supabase. Só tipos da lista abaixo
// são entregues com o tipo verdadeiro; o resto vai como arquivo para baixar.
const TIPOS_MIDIA = new Set(["imageMessage", "documentMessage", "audioMessage", "videoMessage", "stickerMessage"]);
const MIME_MIDIA: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
  "video/mp4": "mp4", "video/3gpp": "3gp", "application/pdf": "pdf",
  ...Object.fromEntries(Object.entries(TIPOS_ARQUIVO).map(([k, v]) => [k, v.ext[0]])),
};
const MAX_MIDIA = 16 * 1024 * 1024;

// fileLength do WhatsApp: número, texto ou { low, high } (inteiro de 64 bits partido em dois).
function tamanhoDe(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d{1,15}$/.test(v)) return Number(v);
  if (v && typeof v === "object" && Number.isFinite(Number(v.low))) return (Number(v.low) >>> 0) + Number(v.high || 0) * 4294967296;
  return null;
}
function tamanhoDa(m: any): number | null {
  if (!m) return null;
  const x = m.imageMessage ?? m.documentMessage ?? m.audioMessage ?? m.videoMessage ?? m.stickerMessage ?? m.documentWithCaptionMessage?.message?.documentMessage;
  return x ? tamanhoDe(x.fileLength) : null;
}

// Lê a resposta em partes e para ao passar do limite (não guarda na memória um arquivo enorme).
async function lerAte(resp: Response, limite: number): Promise<string> {
  const declarado = Number(resp.headers.get("content-length") || 0);
  if (declarado > limite) { await resp.body?.cancel(); throw new Erro(413, "Arquivo grande demais para abrir aqui (mais de 16 MB). Abra no WhatsApp."); }
  const leitor = resp.body?.getReader();
  if (!leitor) return "";
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > limite) { await leitor.cancel(); throw new Erro(413, "Arquivo grande demais para abrir aqui (mais de 16 MB). Abra no WhatsApp."); }
    partes.push(value);
  }
  const tudo = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { tudo.set(p, pos); pos += p.length; }
  return new TextDecoder().decode(tudo);
}

async function midia(id: string) {
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(id)) throw new Erro(400, "Mensagem inválida.");
  const m = (await rest(`mensagens?select=id,contato_id,remote_jid,de_nos,tipo,grupo,nome_arquivo,tamanho_arquivo&id=eq.${encodeURIComponent(id)}`))[0];
  if (!m || m.grupo || !m.contato_id || !TIPOS_MIDIA.has(m.tipo)) throw new Erro(404, "Esta mensagem não tem arquivo para abrir.");
  if (!EVO_CHAVE) throw new Erro(503, "A ligação com o WhatsApp ainda não foi configurada.");
  // Tamanho antes de baixar: pela mensagem guardada ou, se não houver, pelo registro da Evolution (sem baixar o arquivo).
  let tamanho = m.tamanho_arquivo != null ? Number(m.tamanho_arquivo) : null;
  if (tamanho == null) {
    try {
      const r = await evolutionChat("findMessages", { where: { key: { id: m.id } }, page: 1, offset: 1 });
      const bloco = r?.messages ?? r;
      const reg = (Array.isArray(bloco) ? bloco : (bloco?.records ?? [])).find((x: any) => x?.key?.id === m.id);
      tamanho = tamanhoDa(reg?.message);
      if (tamanho != null) await rest(`mensagens?id=eq.${encodeURIComponent(m.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ tamanho_arquivo: tamanho }) });
    } catch (e) { console.error(`midia ${m.id}: tamanho não lido (${(e as Error).message})`); }
  }
  if (tamanho != null && tamanho > MAX_MIDIA) throw new Erro(413, "Arquivo grande demais para abrir aqui (mais de 16 MB). Abra no WhatsApp.");
  if (tamanho == null && (m.tipo === "documentMessage" || m.tipo === "videoMessage")) throw new Erro(422, "Não foi possível saber o tamanho deste arquivo. Abra no WhatsApp.");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25_000);
  let r: any = null;
  try {
    const resp = await fetch(`${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${encodeURIComponent(INSTANCIA)}`, {
      method: "POST",
      headers: { apikey: EVO_CHAVE, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { key: { id: m.id, remoteJid: m.remote_jid, fromMe: !!m.de_nos } }, convertToMp4: false }),
      signal: ctl.signal,
    });
    if (!resp.ok) { console.error(`midia ${m.id}: ${resp.status} ${(await resp.text()).slice(0, 200)}`); throw new Erro(404, "O WhatsApp não tem mais este arquivo (arquivos antigos expiram)."); }
    r = JSON.parse(await lerAte(resp, Math.ceil(MAX_MIDIA * 4 / 3) + 64 * 1024));
  } catch (e) {
    if (e instanceof Erro) throw e;
    console.error(`midia ${m.id}: ${(e as Error).message}`);
    throw new Erro(502, "O WhatsApp não respondeu. Tente de novo em instantes.");
  } finally {
    clearTimeout(t);
  }
  const base64 = String(r?.base64 || "").replace(/^data:[^,]*,/, "").replace(/\s/g, "");
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Erro(404, "O WhatsApp não tem mais este arquivo (arquivos antigos expiram).");
  if (base64.length * 3 / 4 > MAX_MIDIA) throw new Erro(413, "Arquivo grande demais para abrir aqui (mais de 16 MB). Abra no WhatsApp.");
  const bruto = String(r?.mimetype || "").split(";")[0].trim().toLowerCase();
  const ext = MIME_MIDIA[bruto];
  const mimetype = ext ? bruto : "application/octet-stream";
  const nome = nomeSeguro(r?.fileName || m.nome_arquivo || "arquivo", ext ? [ext] : ["bin"]);
  return { id: m.id, mimetype, nome, base64 };
}

// Segunda via do boleto pelo Omie (só consulta): títulos em aberto das empresas ligadas ao contato e o PDF
// do boleto JÁ EMITIDO (ObterBoleto, só quando boleto.cGerado = "S"). Nunca gera, prorroga ou cancela boleto
// (isso pode ter tarifa do banco). As chaves ficam só nos segredos OMIE_APP_KEY e OMIE_APP_SECRET da função.
const OMIE_KEY = Deno.env.get("OMIE_APP_KEY") || "";
const OMIE_SECRET = Deno.env.get("OMIE_APP_SECRET") || "";
// Só consulta: listar títulos, obter o boleto já emitido e pesquisar lançamentos (totais do dia e Quem cobrar hoje).
const OMIE_SO_LEITURA = new Set(["ListarContasReceber", "ObterBoleto", "PesquisarLancamentos"]);
const CATEGORIAS: Record<string, string> = { "1.02.02": "Honorários", "1.02.97": "Adicional anual" };

async function omie(caminho: string, call: string, param: Record<string, unknown>) {
  if (!OMIE_SO_LEITURA.has(call)) throw new Error(`omie: operação não permitida ${call}`);
  if (!OMIE_KEY || !OMIE_SECRET) throw new Erro(503, "A ligação com o Omie ainda não foi configurada: faltam as chaves na função.");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25_000);
  try {
    const r = await fetch(`https://app.omie.com.br/api/v1/${caminho}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call, app_key: OMIE_KEY, app_secret: OMIE_SECRET, param: [param] }),
      signal: ctl.signal,
    });
    const texto = await r.text();
    let dados: any = null;
    try { dados = JSON.parse(texto); } catch { /* sem JSON */ }
    if (dados?.faultstring) {
      if (/n[ãa]o existem registros/i.test(dados.faultstring)) return null;
      console.error(`omie ${call}: ${String(dados.faultstring).slice(0, 200)}`);
      // Bloqueio ou consumo indevido/redundante: não insistir (repetir só piora e pode travar a chave por mais tempo).
      if (/bloque|consumo|redundan|limite|excedid|too many/i.test(String(dados.faultstring)) || r.status === 429) {
        throw new Erro(429, "O Omie pediu para esperar antes de novas consultas. Tente de novo em alguns minutos.");
      }
      throw new Erro(502, "O Omie não respondeu como esperado. Tente de novo em instantes.");
    }
    if (!r.ok || !dados) { console.error(`omie ${call}: ${r.status} ${texto.slice(0, 200)}`); throw new Erro(502, "O Omie não respondeu como esperado. Tente de novo em instantes."); }
    return dados;
  } catch (e) {
    if (e instanceof Erro) throw e;
    console.error(`omie ${call}: ${(e as Error).message}`);
    throw new Erro(502, "O Omie não respondeu. Tente de novo em instantes.");
  } finally {
    clearTimeout(t);
  }
}

const dataIso = (br: unknown) => { const m = String(br || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// Títulos em aberto (não pagos nem cancelados) das empresas ligadas ao contato, do vencimento mais antigo ao mais novo.
// Guardados por 60 s por contato: abrir a lista e enviar em seguida não repete a consulta (o Omie recusa chamadas iguais seguidas).
const cacheTitulos = new Map<number, { ate: number; lista: any[] }>();
async function titulosDoContato(contato: number) {
  const c = cacheTitulos.get(contato);
  if (c && c.ate > Date.now()) return c.lista;
  const lista = await consultarTitulos(contato);
  cacheTitulos.set(contato, { ate: Date.now() + 60_000, lista });
  if (cacheTitulos.size > 200) cacheTitulos.clear();
  return lista;
}
async function consultarTitulos(contato: number) {
  const empresas = await rest(`contato_clientes?select=codigo_cliente_omie,empresa&contato_id=eq.${contato}&codigo_cliente_omie=not.is.null&limit=10`);
  const lista: any[] = [];
  for (const e of empresas) {
    for (let pagina = 1; pagina <= 3; pagina++) {
      const r = await omie("financas/contareceber", "ListarContasReceber", {
        pagina, registros_por_pagina: 100, filtrar_cliente: Number(e.codigo_cliente_omie), filtrar_apenas_titulos_em_aberto: "S", ordenar_por: "DATA_VENCIMENTO",
      });
      for (const t of r?.conta_receber_cadastro || []) {
        // Não confia só no filtro do Omie: o título precisa ser do cliente ligado a este contato.
        if (Number(t.codigo_cliente_fornecedor) !== Number(e.codigo_cliente_omie)) continue;
        const status = String(t.status_titulo || "").toUpperCase();
        if (["PAGO", "CANCELADO", "LIQUIDADO", "RECEBIDO"].includes(status)) continue;
        lista.push({
          codigo: Number(t.codigo_lancamento_omie),
          cliente: Number(t.codigo_cliente_fornecedor),
          empresa: e.empresa,
          documento: t.numero_documento || null,
          parcela: t.numero_parcela || null,
          vencimento: dataIso(t.data_vencimento),
          valor: Number(t.valor_documento) || 0,
          status: t.status_titulo || null,
          categoria: CATEGORIAS[t.codigo_categoria] || t.codigo_categoria || null,
          boleto: t.boleto?.cGerado === "S",
          codigo_barras: t.codigo_barras_ficha_compensacao || null,
        });
      }
      if (!r || pagina >= Number(r.total_de_paginas || 1)) break;
    }
  }
  return lista.sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
}

// PDF do boleto já emitido: o link vem do Omie (CDN do Omie, com validade) e só ele é aceito.
async function pdfDoBoleto(codigo: number): Promise<{ base64: string; barras: string | null }> {
  const b = await omie("financas/contareceberboleto", "ObterBoleto", { nCodTitulo: codigo });
  const link = String(b?.cLinkBoleto || "");
  let url: URL;
  try { url = new URL(link); } catch { throw new Erro(404, "O Omie não devolveu o boleto deste título."); }
  if (url.protocol !== "https:" || url.hostname !== "cdn.omie.com.br") throw new Erro(502, "O Omie devolveu um endereço de boleto inesperado.");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25_000);
  try {
    const r = await fetch(url.toString(), { signal: ctl.signal, redirect: "error" });
    if (!r.ok) throw new Erro(502, "Não foi possível baixar o boleto do Omie.");
    if (Number(r.headers.get("content-length") || 0) > MAX_ARQUIVO) { await r.body?.cancel(); throw new Erro(413, "O boleto passou de 8 MB."); }
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > MAX_ARQUIVO) throw new Erro(413, "O boleto passou de 8 MB.");
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") throw new Erro(502, "O arquivo do Omie não é um PDF.");
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { base64: btoa(bin), barras: b?.cCodBarras || null };
  } catch (e) {
    if (e instanceof Erro) throw e;
    throw new Erro(502, "Não foi possível baixar o boleto do Omie.");
  } finally {
    clearTimeout(t);
  }
}

// Mesma leitura de texto e arquivo da função receber-evolution.
function textoDa(m: any): string | null {
  if (!m) return null;
  return m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ??
    m.documentMessage?.caption ?? m.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ?? m.listResponseMessage?.title ??
    m.templateButtonReplyMessage?.selectedDisplayText ?? m.reactionMessage?.text ?? null;
}
function arquivoDa(m: any): string | null {
  return m?.documentMessage?.fileName ?? m?.documentWithCaptionMessage?.message?.documentMessage?.fileName ?? null;
}
function segundos(ts: unknown): number {
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") return Number(ts);
  if (ts && typeof ts === "object" && "low" in (ts as any)) return Number((ts as any).low);
  return NaN;
}

// Traz do WhatsApp (banco da Evolution) as mensagens antigas de uma conversa que ainda não estão guardadas.
async function buscarHistorico(contato: number) {
  const c = (await rest(`contatos?select=id,jid,lid&id=eq.${contato}`))[0];
  if (!c) throw new Erro(404, "Contato não encontrado.");
  const jids = [c.jid, c.lid].filter((j: string | null) => j && !String(j).endsWith("@g.us")) as string[];
  if (!jids.length) throw new Erro(400, "Este contato não tem número no WhatsApp.");
  const linhas: Record<string, unknown>[] = [];
  for (const remoteJid of jids) {
    for (let page = 1; page <= 10; page++) {
      const r = await evolutionChat("findMessages", { where: { key: { remoteJid } }, page, offset: 100 });
      const bloco = r?.messages ?? r;
      const registros: any[] = Array.isArray(bloco) ? bloco : (bloco?.records ?? []);
      for (const x of registros) {
        const k = x?.key ?? {};
        if (!k.id || x?.messageType === "protocolMessage") continue;
        const ts = segundos(x.messageTimestamp);
        if (!Number.isFinite(ts) || ts <= 0) continue;
        const atualizacoes: any[] = Array.isArray(x.MessageUpdate) ? x.MessageUpdate : [];
        const ultimo = atualizacoes.length ? atualizacoes[atualizacoes.length - 1]?.status : null;
        const texto = textoDa(x.message);
        linhas.push({
          id: k.id, contato_id: contato, remote_jid: k.remoteJid ?? remoteJid, remote_jid_alt: k.remoteJidAlt ?? null, grupo: false,
          de_nos: !!k.fromMe, tipo: x.messageType ?? null, texto: texto ? String(texto).slice(0, 4000) : null, nome_arquivo: arquivoDa(x.message),
          aparelho: x.source ?? null, enviada_em: new Date(ts * 1000).toISOString(), status: ultimo ? String(ultimo) : null, tamanho_arquivo: tamanhoDa(x.message),
        });
      }
      const paginas = Number(bloco?.pages ?? 0);
      if (!registros.length || (paginas && page >= paginas)) break;
    }
  }
  let novas = 0;
  for (let i = 0; i < linhas.length; i += 200) {
    const r = await rest("mensagens?on_conflict=id&select=id", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(linhas.slice(i, i + 200)),
    });
    novas += Array.isArray(r) ? r.length : 0;
  }
  return { ok: true, lidas: linhas.length, novas };
}

// Marca como lidas no WhatsApp as mensagens do cliente ainda não abertas (como o WhatsApp Web ao abrir a conversa).
async function marcarLida(contato: number) {
  const desde = new Date(Date.now() - 7 * 86400_000).toISOString();
  const pend = await rest(`mensagens?select=id,remote_jid&contato_id=eq.${contato}&de_nos=is.false&grupo=is.false&status=not.is.null&status=not.in.(READ,PLAYED)&enviada_em=gte.${encodeURIComponent(desde)}&order=enviada_em.desc&limit=50`);
  if (!pend.length) return { ok: true, marcadas: 0 };
  await evolutionChat("markMessageAsRead", { readMessages: pend.map((m: any) => ({ remoteJid: m.remote_jid, fromMe: false, id: m.id })) });
  const ids = pend.map((m: any) => `"${String(m.id).replace(/"/g, "")}"`).join(",");
  await rest(`mensagens?id=in.(${ids})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "READ" }) });
  return { ok: true, marcadas: pend.length };
}

async function registrarEnvio(u: Usuario, contato: number, alvo: { destino: string; jid: string }, dados: Record<string, any>, rota: string, corpo: Record<string, unknown>, gravado: { tipo: string; texto: string | null }) {
  const destino = alvo.destino;
  if (!EVO_CHAVE) throw new Erro(503, "O envio ainda não foi ligado: falta configurar a chave da Evolution na função.");
  await confirmarQuePodeEnviar(u);
  const envio = await reservarEnvio({
    p_contato: contato, p_usuario: u.id, p_usuario_nome: u.nome, p_tipo: dados.tipo, p_texto: dados.texto ?? null,
    p_nome_arquivo: dados.nome_arquivo ?? null, p_mimetype: dados.mimetype ?? null, p_tamanho: dados.tamanho ?? null, p_destino: destino,
  });
  const res = await chamarEvolution(rota, corpo);
  const agora = new Date().toISOString();
  const muda = res.ok
    ? { status: "enviado", mensagem_id: res.id, atualizado_em: agora }
    : { status: res.incerto ? "incerto" : "erro", erro: res.erro, atualizado_em: agora };
  await rest(`envios?id=eq.${envio}`, { method: "PATCH", body: JSON.stringify(muda) });
  if (res.ok && res.id) {
    try { await gravarMensagemEnviada(res.id, contato, alvo.jid, gravado.tipo, gravado.texto, dados.nome_arquivo ?? null); }
    catch (e) { console.error(`mensagem do envio ${envio} não gravada: ${(e as Error).message}`); }
  }
  await evento(contato, u, res.ok ? `enviou_${dados.tipo}` : res.incerto ? `incerto_${dados.tipo}` : `falha_${dados.tipo}`, { envio, arquivo: dados.nome_arquivo ?? undefined });
  if (!res.ok) {
    console.error(`envio ${envio}: ${res.erro}`);
    if (res.incerto) throw new Erro(504, "O WhatsApp demorou a responder e a mensagem pode ter saído. Confira na conversa antes de enviar de novo.");
    throw new Erro(502, "A mensagem não saiu. Confira se o contato tem WhatsApp e tente de novo.");
  }
  return { ok: true, envio, mensagem_id: res.id };
}

async function equipe(u: Usuario) {
  const r = await fetch(`${PAINEL_URL}/rest/v1/profiles?select=id,first_name,last_name,role,sector&order=first_name`, {
    headers: { apikey: PAINEL_CHAVE, Authorization: `Bearer ${u.token}` },
  });
  if (!r.ok) throw new Error(`equipe: ${r.status}`);
  const lista = await r.json();
  const at = await rest("atendentes?select=usuario_id,nome,pode_enviar");
  const porId = new Map(at.map((a: any) => [a.usuario_id, a]));
  return lista
    .filter((p: any) => p.role === "admin" || ["financeiro", "diretoria"].includes(p.sector))
    .map((p: any) => {
      const a: any = porId.get(p.id);
      return { id: p.id, nome: a?.nome || [p.first_name, p.last_name].filter(Boolean).join(" "), pode_enviar: p.role === "admin" || !!a?.pode_enviar };
    });
}

async function tratarPost(u: Usuario, corpo: any) {
  const acao = String(corpo?.acao || "");
  switch (acao) {
    case "enviar_texto": {
      if (!u.podeEnviar) throw new Erro(403, "Seu usuário pode ver as conversas, mas não responder.");
      const contato = inteiro(corpo.contato, "Contato");
      const texto = String(corpo.texto ?? "").replace(/\r\n/g, "\n").trim();
      if (!texto) throw new Erro(400, "Escreva a mensagem.");
      if (texto.length > 4000) throw new Erro(400, "A mensagem passou de 4.000 caracteres.");
      const alvo = await contatoDestino(contato);
      const final = `*${u.assinatura}:*\n${texto}`;
      return await registrarEnvio(u, contato, alvo, { tipo: "texto", texto }, "sendText", { number: alvo.destino, text: final }, { tipo: "conversation", texto: final });
    }
    case "enviar_arquivo": {
      if (!u.podeEnviar) throw new Erro(403, "Seu usuário pode ver as conversas, mas não responder.");
      const contato = inteiro(corpo.contato, "Contato");
      const mimetype = String(corpo.mimetype || "");
      const tipo = TIPOS_ARQUIVO[mimetype];
      if (!tipo) throw new Erro(400, "Tipo de arquivo não aceito. Use PDF, imagem, planilha, documento ou texto.");
      const base64 = String(corpo.base64 || "").replace(/^data:[^,]*,/, "");
      if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new Erro(400, "Arquivo inválido.");
      const tamanho = Math.floor(base64.replace(/\s/g, "").length * 3 / 4);
      if (tamanho <= 0 || tamanho > MAX_ARQUIVO) throw new Erro(400, "O arquivo precisa ter até 8 MB.");
      const nome = nomeSeguro(corpo.nome, tipo.ext);
      const legenda = String(corpo.legenda ?? "").trim().slice(0, 1000);
      const alvo = await contatoDestino(contato);
      const caption = legenda ? `*${u.assinatura}:*\n${legenda}` : `*${u.assinatura}*`;
      return await registrarEnvio(u, contato, alvo, { tipo: "arquivo", texto: legenda || null, nome_arquivo: nome, mimetype, tamanho }, "sendMedia", {
        number: alvo.destino, mediatype: tipo.midia, mimetype, caption, media: base64.replace(/\s/g, ""), fileName: nome,
      }, { tipo: tipo.midia === "image" ? "imageMessage" : "documentMessage", texto: caption });
    }
    case "enviar_boleto": {
      // Segunda via: o título precisa ser de uma empresa ligada a este contato, estar em aberto e ter boleto emitido.
      if (!u.podeEnviar) throw new Erro(403, "Seu usuário pode ver as conversas, mas não responder.");
      const contato = inteiro(corpo.contato, "Contato");
      const codigo = inteiro(corpo.titulo, "Título");
      const legenda = String(corpo.texto ?? "").replace(/\r\n/g, "\n").trim().slice(0, 1000);
      // Permissão e destino conferidos antes de qualquer chamada ao Omie.
      if (!EVO_CHAVE) throw new Erro(503, "O envio ainda não foi ligado: falta configurar a chave da Evolution na função.");
      await confirmarQuePodeEnviar(u);
      const alvo = await contatoDestino(contato);
      const titulo = (await titulosDoContato(contato)).find((t) => t.codigo === codigo);
      if (!titulo) throw new Erro(404, "Este título não está em aberto para as empresas deste contato.");
      if (!titulo.boleto) throw new Erro(400, "Este título não tem boleto emitido no Omie. Emita pelo Omie antes de enviar.");
      const pdf = await pdfDoBoleto(codigo);
      const nome = nomeSeguro(`BOLETO CASTELO BRANCO CONTABILIDADE - ${titulo.empresa}`, ["pdf"]);
      const caption = legenda ? `*${u.assinatura}:*\n${legenda}` : `*${u.assinatura}*`;
      const tamanho = Math.floor(pdf.base64.length * 3 / 4);
      const r = await registrarEnvio(u, contato, alvo, { tipo: "arquivo", texto: legenda || null, nome_arquivo: nome, mimetype: "application/pdf", tamanho }, "sendMedia", {
        number: alvo.destino, mediatype: "document", mimetype: "application/pdf", caption, media: pdf.base64, fileName: nome,
      }, { tipo: "documentMessage", texto: caption });
      await evento(contato, u, "segunda_via", { documento: titulo.documento, parcela: titulo.parcela, vencimento: titulo.vencimento, valor: titulo.valor });
      return r;
    }
    case "nota": {
      const contato = inteiro(corpo.contato, "Contato");
      const texto = String(corpo.texto ?? "").trim();
      if (!texto || texto.length > 4000) throw new Erro(400, "A nota precisa ter de 1 a 4.000 caracteres.");
      const [n] = await rest("notas", { method: "POST", body: JSON.stringify({ contato_id: contato, usuario_id: u.id, usuario_nome: u.nome, texto }) });
      await evento(contato, u, "nota", { nota: n.id });
      return { ok: true, id: n.id };
    }
    case "nota_apagar": {
      const id = inteiro(corpo.id, "Nota");
      const n = (await rest(`notas?select=id,contato_id,usuario_id,apagada_em&id=eq.${id}`))[0];
      if (!n || n.apagada_em) throw new Erro(404, "Nota não encontrada.");
      if (n.usuario_id !== u.id && u.papel !== "admin") throw new Erro(403, "Só quem escreveu ou um administrador apaga a nota.");
      await rest(`notas?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ apagada_em: new Date().toISOString(), apagada_por: u.id }) });
      await evento(n.contato_id, u, "nota_apagada", { nota: id });
      return { ok: true };
    }
    case "etiqueta": {
      const contato = inteiro(corpo.contato, "Contato");
      const etiqueta = inteiro(corpo.etiqueta, "Etiqueta");
      const e = (await rest(`etiquetas?select=id,nome&id=eq.${etiqueta}&apagada_em=is.null`))[0];
      if (!e) throw new Erro(404, "Etiqueta não encontrada.");
      if (corpo.ligar) {
        await rest("contato_etiquetas", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ contato_id: contato, etiqueta_id: etiqueta, usuario_id: u.id }) });
      } else {
        await rest(`contato_etiquetas?contato_id=eq.${contato}&etiqueta_id=eq.${etiqueta}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      }
      await evento(contato, u, corpo.ligar ? "etiqueta_posta" : "etiqueta_tirada", { etiqueta: e.nome });
      return { ok: true };
    }
    case "etiqueta_criar": {
      if (!u.podeEnviar) throw new Erro(403, "Só quem responde pelo sistema cria etiquetas.");
      const nome = String(corpo.nome ?? "").trim().replace(/\s+/g, " ");
      if (!nome || nome.length > 40) throw new Erro(400, "O nome da etiqueta precisa ter de 1 a 40 caracteres.");
      const cor = CORES.includes(corpo.cor) ? corpo.cor : "neutro";
      let e;
      try {
        [e] = await rest("etiquetas", { method: "POST", body: JSON.stringify({ nome, cor, criada_por: u.id }) });
      } catch (x) {
        if (String((x as Error).message).includes("23505")) throw new Erro(409, "Já existe uma etiqueta com esse nome.");
        throw x;
      }
      await evento(null, u, "etiqueta_criada", { etiqueta: nome });
      return { ok: true, id: e.id };
    }
    case "etiqueta_apagar": {
      if (u.papel !== "admin") throw new Erro(403, "Só um administrador apaga etiquetas.");
      const id = inteiro(corpo.id, "Etiqueta");
      await rest(`etiquetas?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ apagada_em: new Date().toISOString() }) });
      await evento(null, u, "etiqueta_apagada", { etiqueta: id });
      return { ok: true };
    }
    case "atribuir": {
      const contato = inteiro(corpo.contato, "Contato");
      if (corpo.usuario == null || corpo.usuario === "") {
        await rest(`atribuicoes?contato_id=eq.${contato}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        await evento(contato, u, "dono_tirado", {});
        return { ok: true };
      }
      const pessoa = (await equipe(u)).find((p: any) => p.id === String(corpo.usuario));
      if (!pessoa) throw new Erro(400, "Essa pessoa não está na equipe do financeiro.");
      await rest("atribuicoes", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ contato_id: contato, usuario_id: pessoa.id, usuario_nome: pessoa.nome, atribuido_por: u.id, atribuido_por_nome: u.nome, em: new Date().toISOString() }),
      });
      await evento(contato, u, "dono", { para: pessoa.nome });
      return { ok: true };
    }
    case "buscar_historico": {
      const contato = inteiro(corpo.contato, "Contato");
      const r = await buscarHistorico(contato);
      if (r.novas) await evento(contato, u, "historico", { novas: r.novas });
      return r;
    }
    case "marcar_lida": {
      if (!u.podeEnviar) return { ok: true, marcadas: 0 }; // quem só lê não marca nada no WhatsApp
      return await marcarLida(inteiro(corpo.contato, "Contato"));
    }
    case "resposta_criar": {
      if (!u.podeEnviar) throw new Erro(403, "Só quem responde pelo sistema cria respostas prontas.");
      const titulo = String(corpo.titulo ?? "").trim().replace(/\s+/g, " ");
      const texto = String(corpo.texto ?? "").replace(/\r\n/g, "\n").trim();
      if (!titulo || titulo.length > 60) throw new Erro(400, "O título precisa ter de 1 a 60 caracteres.");
      if (!texto || texto.length > 4000) throw new Erro(400, "O texto precisa ter de 1 a 4.000 caracteres.");
      const [r] = await rest("respostas_prontas", { method: "POST", body: JSON.stringify({ titulo, texto, criada_por: u.id, criada_por_nome: u.nome }) });
      return { ok: true, id: r.id };
    }
    case "resposta_apagar": {
      const id = inteiro(corpo.id, "Resposta");
      const r = (await rest(`respostas_prontas?select=id,criada_por,apagada_em&id=eq.${id}`))[0];
      if (!r || r.apagada_em) throw new Erro(404, "Resposta não encontrada.");
      if (r.criada_por !== u.id && u.papel !== "admin") throw new Erro(403, "Só quem criou ou um administrador apaga a resposta.");
      await rest(`respostas_prontas?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ apagada_em: new Date().toISOString() }) });
      return { ok: true };
    }
    case "resolver": {
      // Conversa resolvida: sai de "Esperando" e da fila do Atendimento até o cliente escrever de novo.
      const contato = inteiro(corpo.contato, "Contato");
      const resolvida = corpo.resolvida === true;
      if (!(await rest(`contatos?select=id&id=eq.${contato}`))[0]) throw new Erro(404, "Contato não encontrado.");
      if (resolvida) {
        await rest("resolucoes?on_conflict=contato_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ contato_id: contato, usuario_id: u.id, usuario_nome: u.nome, em: new Date().toISOString() }),
        });
      } else {
        await rest(`resolucoes?contato_id=eq.${contato}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      }
      await evento(contato, u, resolvida ? "resolveu" : "reabriu", {});
      return { ok: true };
    }
    case "lembrete_criar": {
      const contato = inteiro(corpo.contato, "Contato");
      const dia = String(corpo.dia || "");
      if (!DATA.test(dia) || Number.isNaN(Date.parse(dia))) throw new Erro(400, "Escolha a data do retorno.");
      const hoje = hojeBrasil();
      const limite = new Date(Date.parse(hoje) + 366 * 86400_000).toISOString().slice(0, 10);
      if (dia < hoje) throw new Erro(400, "A data do retorno não pode ser no passado.");
      if (dia > limite) throw new Erro(400, "Escolha uma data dentro de um ano.");
      const hora = corpo.hora ? String(corpo.hora) : null;
      if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw new Erro(400, "Hora inválida.");
      const texto = String(corpo.texto ?? "").trim().slice(0, 500) || null;
      const existe = (await rest(`contatos?select=id&id=eq.${contato}`))[0];
      if (!existe) throw new Erro(404, "Contato não encontrado.");
      const [l] = await rest("lembretes", { method: "POST", body: JSON.stringify({ contato_id: contato, dia, hora, texto, usuario_id: u.id, usuario_nome: u.nome }) });
      await evento(contato, u, "retorno_marcado", { dia, hora: hora ?? undefined });
      return { ok: true, id: l.id };
    }
    case "lembrete_feito":
    case "lembrete_cancelar": {
      const id = inteiro(corpo.id, "Retorno");
      const l = (await rest(`lembretes?select=id,contato_id,usuario_id,feito_em,cancelado_em,dia&id=eq.${id}`))[0];
      if (!l || l.cancelado_em) throw new Erro(404, "Retorno não encontrado.");
      const agora = new Date().toISOString();
      if (acao === "lembrete_feito") {
        if (l.feito_em) return { ok: true };
        await rest(`lembretes?id=eq.${id}&feito_em=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ feito_em: agora, feito_por: u.id, feito_por_nome: u.nome }) });
        await evento(l.contato_id, u, "retorno_feito", { dia: l.dia });
      } else {
        if (l.usuario_id !== u.id && u.papel !== "admin") throw new Erro(403, "Só quem marcou o retorno ou um administrador cancela.");
        if (l.feito_em) throw new Erro(400, "Este retorno já foi feito e não pode ser cancelado.");
        await rest(`lembretes?id=eq.${id}&feito_em=is.null&cancelado_em=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ cancelado_em: agora, cancelado_por: u.id }) });
        await evento(l.contato_id, u, "retorno_cancelado", { dia: l.dia });
      }
      return { ok: true };
    }
    case "ligacao_registrar": {
      // Contagem oficial das ligações (decisão do Marcus): quem ligou registra aqui; a leitura do Chrome confere.
      const contato = inteiro(corpo.contato, "Contato");
      const direcao = corpo.direcao === "recebida" ? "recebida" : "feita";
      const resultado = corpo.resultado === "atendida" ? "atendida" : "nao_atendida";
      const observacao = String(corpo.observacao ?? "").trim().slice(0, 500) || null;
      const existe = (await rest(`contatos?select=id&id=eq.${contato}`))[0];
      if (!existe) throw new Erro(404, "Contato não encontrado.");
      // Evita o clique duplo: uma ligação por pessoa e contato a cada minuto.
      const desde = new Date(Date.now() - 60_000).toISOString();
      const recente = await rest(`ligacoes?select=id&fonte=eq.manual&anulada_em=is.null&contato_id=eq.${contato}&usuario_id=eq.${encodeURIComponent(u.id)}&iniciada_em=gte.${encodeURIComponent(desde)}&limit=1`);
      if (recente.length) throw new Erro(429, "Você já registrou uma ligação para este contato agora há pouco.");
      const [l] = await rest("ligacoes", {
        method: "POST",
        body: JSON.stringify({
          id_chamada: `manual-${crypto.randomUUID()}`, contato_id: contato, direcao, resultado, fonte: "manual",
          iniciada_em: new Date().toISOString(), usuario_id: u.id, usuario_nome: u.nome, observacao,
        }),
      });
      await evento(contato, u, "ligacao", { direcao, resultado });
      return { ok: true, id: l.id };
    }
    case "ligacao_anular": {
      const id = inteiro(corpo.id, "Ligação");
      const l = (await rest(`ligacoes?select=id,contato_id,fonte,usuario_id,anulada_em&id=eq.${id}`))[0];
      if (!l || l.anulada_em) throw new Erro(404, "Ligação não encontrada.");
      if (l.fonte !== "manual") throw new Erro(400, "Só a ligação registrada no sistema pode ser desfeita.");
      if (l.usuario_id !== u.id && u.papel !== "admin") throw new Erro(403, "Só quem registrou ou um administrador desfaz.");
      await rest(`ligacoes?id=eq.${id}&fonte=eq.manual&anulada_em=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ anulada_em: new Date().toISOString(), anulada_por: u.id }) });
      await evento(l.contato_id, u, "ligacao_desfeita", {});
      return { ok: true };
    }
    case "extensao_codigo": {
      // Código de ligação da extensão de ligações (06/11/2026): só administrador gera; aparece uma vez só, aqui;
      // no banco fica só o resumo sha256. Quem tem o código só consegue GRAVAR ligações (função registrar-ligacoes).
      if (u.papel !== "admin") throw new Erro(403, "Só um administrador gera o código da extensão.");
      const nome = String(corpo.nome ?? "").trim().slice(0, 60);
      if (!nome) throw new Erro(400, "Dê um nome ao computador (por exemplo, \"Maria Clara (174)\").");
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const codigo = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const resumo = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codigo))))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      // Um código ativo por computador: gerar de novo com o mesmo nome desliga o anterior.
      await rest(`extensao_aparelhos?nome=eq.${encodeURIComponent(nome)}&revogado_em=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ revogado_em: new Date().toISOString(), revogado_por: u.id }) });
      const [a] = await rest("extensao_aparelhos", {
        method: "POST",
        body: JSON.stringify({ nome, token_sha256: resumo, criado_por: u.id, criado_por_nome: u.nome }),
      });
      return { ok: true, id: a.id, nome, codigo };
    }
    case "extensao_revogar": {
      if (u.papel !== "admin") throw new Erro(403, "Só um administrador desliga a extensão.");
      const id = inteiro(corpo.id, "Computador");
      await rest(`extensao_aparelhos?id=eq.${id}&revogado_em=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ revogado_em: new Date().toISOString(), revogado_por: u.id }) });
      return { ok: true };
    }
    default:
      throw new Erro(400, "Ação desconhecida.");
  }
}

// Retrato do Omie (totais do dia e atrasados por cliente), calculado na hora com a conta do financeiro.py v8. Lê cerca de
// 100 páginas do Omie (30 a 60 segundos), então fica guardado em omie_retratos e é reaproveitado por 10 minutos; "Atualizar"
// refaz, mas não antes de 2 minutos do último cálculo. Um cálculo por vez para todo o sistema: quem chega enquanto outro
// calcula (linha "calculando" de menos de 3 minutos) espera o resultado dele. Depois de um erro, 2 minutos sem tentar.
const RETRATO_VALE_MS = 10 * 60_000;
const RETRATO_MIN_MS = 2 * 60_000;
const TRAVA_MS = 3 * 60_000;
const PRAZO_MS = 110_000; // a função tem 150 s; passou disso, para de ler o Omie
let calculando: Promise<any> | null = null;
const CAMPOS_RETRATO = "id,dia,calculado_em,calculado_por,status,totais,atrasados";

async function ultimoRetrato(dia: string) {
  const r = await rest(`omie_retratos?select=${CAMPOS_RETRATO}&dia=eq.${dia}&status=in.(completo,incompleto)&order=calculado_em.desc&limit=1`);
  return r[0] || null;
}
async function ultimaTentativa(dia: string) {
  const r = await rest(`omie_retratos?select=id,calculado_em,status&dia=eq.${dia}&order=calculado_em.desc&limit=1`);
  return r[0] || null;
}
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function retratoOmie(usuario: Usuario, atualizar: boolean) {
  if (!OMIE_KEY || !OMIE_SECRET) throw new Erro(503, "A ligação com o Omie ainda não foi configurada: faltam as chaves na função.");
  const dia = hojeBrasil();
  const ult = await ultimoRetrato(dia);
  const idade = ult ? Date.now() - Date.parse(ult.calculado_em) : Infinity;
  if (ult && (idade < RETRATO_MIN_MS || (!atualizar && idade < RETRATO_VALE_MS))) return ult;
  if (calculando) return await calculando;

  const tentativa = await ultimaTentativa(dia);
  const idadeTentativa = tentativa ? Date.now() - Date.parse(tentativa.calculado_em) : Infinity;
  if (tentativa?.status === "calculando" && idadeTentativa < TRAVA_MS) {
    // Outra pessoa (ou outra instância da função) está calculando: espera o resultado, sem consultar o Omie de novo.
    for (let i = 0; i < 40; i++) {
      await espera(3000);
      const r = await ultimoRetrato(dia);
      if (r && Date.parse(r.calculado_em) >= Date.parse(tentativa.calculado_em)) return r;
      const t = await ultimaTentativa(dia);
      if (t && t.status === "erro" && Date.parse(t.calculado_em) >= Date.parse(tentativa.calculado_em)) break;
    }
    throw new Erro(409, "Outra pessoa está consultando o Omie agora. Tente de novo em 1 minuto.");
  }
  if (tentativa?.status === "erro" && idadeTentativa < RETRATO_MIN_MS) {
    throw new Erro(429, "A última consulta ao Omie falhou há pouco. Tente de novo em 2 minutos.");
  }

  calculando = (async () => {
    await rest("omie_retratos", { method: "POST", body: JSON.stringify({ dia, calculado_por: usuario.nome, status: "calculando", totais: {}, atrasados: [] }) });
    const prazo = Date.now() + PRAZO_MS;
    const consultar = async (param: Record<string, unknown>) => {
      for (let n = 0; ; n++) {
        if (Date.now() > prazo) throw new Erro(504, "O Omie demorou demais para responder. Tente de novo em alguns minutos.");
        try {
          return await omie("financas/pesquisartitulos", "PesquisarLancamentos", param);
        } catch (e) {
          // Só repete falha passageira (502), no máximo 2 vezes; bloqueio do Omie (429) e chave faltando (503) param na hora.
          if (n >= 2 || !(e instanceof Erro) || e.status !== 502) throw e;
          await espera(1500 * (n + 1));
        }
      }
    };
    try {
      const r = await retratoDoOmie(consultar, dia);
      return (await rest("omie_retratos", {
        method: "POST",
        body: JSON.stringify({ dia, calculado_por: usuario.nome, status: r.status, totais: r.totais, atrasados: r.atrasados, atraso_clientes: r.atraso_clientes }),
      }))[0];
    } catch (e) {
      await rest("omie_retratos", { method: "POST", body: JSON.stringify({ dia, calculado_por: usuario.nome, status: "erro", totais: {}, atrasados: [] }) }).catch(() => {});
      throw e;
    }
  })().finally(() => { calculando = null; });
  return await calculando;
}

// O que vai para a tela: os totais (sem os atrasados por cliente, que só o Quem cobrar usa).
function totaisParaTela(r: any) {
  return { dia: r.dia, calculado_em: r.calculado_em, calculado_por: r.calculado_por, status: r.status, financeiro: { ...r.totais, atualizado: r.calculado_em } };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "GET" && req.method !== "POST") return json({ erro: "Método não permitido." }, 405, h);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ erro: "Entre com o seu usuário do Painel de Demandas." }, 401, h);

  try {
    const usuario = await conferir(token);
    if (!usuario) return json({ erro: "Sessão inválida ou sem permissão." }, 401, h);

    if (req.method === "POST") {
      let corpo: unknown;
      try { corpo = await req.json(); } catch { return json({ erro: "Pedido inválido." }, 400, h); }
      return json(await tratarPost(usuario, corpo), 200, h);
    }

    const u = new URL(req.url);
    const acao = u.searchParams.get("acao") || "dia";
    const data = u.searchParams.get("data") || hojeBrasil();
    if (!DATA.test(data)) return json({ erro: "Data inválida." }, 400, h);

    switch (acao) {
      case "eu":
        return json({ usuario: { id: usuario.id, nome: usuario.nome, papel: usuario.papel, pode_enviar: usuario.podeEnviar, assinatura: usuario.assinatura, envio_ligado: !!EVO_CHAVE, omie_ligado: !!(OMIE_KEY && OMIE_SECRET) }, hoje: hojeBrasil() }, 200, h);
      case "dia":
        return json(await rpc("painel_dia", { p_dia: data }), 200, h);
      case "atendimento":
        return json(await rpc("painel_atendimento", { p_dia: data }), 200, h);
      case "historico": {
        const de = u.searchParams.get("de") || "";
        if (!DATA.test(de)) return json({ erro: "Data inicial inválida." }, 400, h);
        return json(await rpc("painel_historico", { p_de: de, p_ate: data }), 200, h);
      }
      case "conversa": {
        const contato = inteiro(u.searchParams.get("contato"), "Contato");
        return json(await rpc("painel_conversa", { p_contato: contato, p_dia: data }), 200, h);
      }
      case "omie": {
        // A aba Omie mostra o cálculo mais novo: o do relatório gravado ou o feito na hora (botão Baixar ou Atualizar).
        const [base, ret] = await Promise.all([rpc("painel_omie", {}), ultimoRetrato(hojeBrasil())]);
        const doRelatorio = base?.financeiro?.atualizado ? Date.parse(base.financeiro.atualizado) : 0;
        if (base && ret && ret.status === "completo" && Date.parse(ret.calculado_em) > doRelatorio) base.financeiro = { ...ret.totais, atualizado: ret.calculado_em };
        return json(base, 200, h);
      }
      case "omie_agora": {
        const r = await retratoOmie(usuario, u.searchParams.get("atualizar") === "1");
        return json(totaisParaTela(r), 200, h);
      }
      case "quem_cobrar": {
        const r = await retratoOmie(usuario, u.searchParams.get("atualizar") === "1");
        const lista = await rpc("painel_quem_cobrar", { p_atrasados: r.atrasados, p_dia: r.dia });
        return json({ ...lista, calculado_em: r.calculado_em, status: r.status }, 200, h);
      }
      case "buscar_conversa": {
        const contato = inteiro(u.searchParams.get("contato"), "Contato");
        const q = String(u.searchParams.get("q") || "").trim().slice(0, 100);
        if (q.length < 2) return json({ erro: "Digite pelo menos 2 letras para buscar." }, 400, h);
        return json(await rpc("painel_buscar_conversa", { p_contato: contato, p_q: q, p_limite: 50 }), 200, h);
      }
      case "caixa": {
        const dias = Math.min(90, Math.max(1, Math.trunc(Number(u.searchParams.get("dias"))) || 30));
        return json(await rpc("painel_caixa", { p_dias: dias }), 200, h);
      }
      case "conversa_completa": {
        const contato = inteiro(u.searchParams.get("contato"), "Contato");
        const antes = u.searchParams.get("antes");
        if (antes && Number.isNaN(Date.parse(antes))) return json({ erro: "Data inválida." }, 400, h);
        const conversa = rpc("painel_conversa_completa", { p_contato: contato, p_antes: antes || null, p_limite: 120 });
        if (antes) return json(await conversa, 200, h);
        const [c, extras] = await Promise.all([conversa, rpc("painel_conversa_extras", { p_contato: contato })]);
        return json({ ...c, ...extras }, 200, h);
      }
      case "titulos":
        return json({ omie_ligado: !!(OMIE_KEY && OMIE_SECRET), titulos: OMIE_KEY && OMIE_SECRET ? await titulosDoContato(inteiro(u.searchParams.get("contato"), "Contato")) : [] }, 200, h);
      case "midia":
        return json(await midia(String(u.searchParams.get("id") || "")), 200, h);
      case "etiquetas":
        return json(await rest("etiquetas?select=id,nome,cor&apagada_em=is.null&order=nome"), 200, h);
      case "equipe":
        return json(await equipe(usuario), 200, h);
      case "respostas":
        return json(await rest("respostas_prontas?select=id,titulo,texto,criada_por,criada_por_nome&apagada_em=is.null&order=titulo"), 200, h);
      case "extensoes": {
        // Situação da extensão de ligações em cada computador: só administrador, e só o que o quadro mostra.
        if (usuario.papel !== "admin") return json({ erro: "Só um administrador vê a extensão de ligações." }, 403, h);
        const lista = await rest("extensao_aparelhos?select=id,nome,criado_por_nome,criado_em,revogado_em,ultimo_contato,ultima_versao,ultimo_resumo&order=id");
        return json(lista.map((a: any) => ({
          id: a.id, nome: a.nome, criado_por_nome: a.criado_por_nome, criado_em: a.criado_em, revogado_em: a.revogado_em,
          ultimo_contato: a.ultimo_contato, ultima_versao: a.ultima_versao,
          lidas: Number.isInteger(a.ultimo_resumo?.lidas) ? a.ultimo_resumo.lidas : null,
        })), 200, h);
      }
      default:
        return json({ erro: "Ação desconhecida." }, 400, h);
    }
  } catch (e) {
    if (e instanceof Erro) return json({ erro: e.message }, e.status, h);
    console.error(String(e));
    return json({ erro: "Não foi possível concluir agora." }, 500, h);
  }
});
