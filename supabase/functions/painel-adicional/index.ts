// Função painel-adicional (projeto whatsapp-financeiro, 24/11/2026): a aba Adicional Anual do sistema do contas a receber.
// Fica separada da painel-cr para a publicação dela não mexer na função que já está no ar.
// Login: o mesmo da painel-cr (usuário do Painel de Demandas; entra quem é admin ou do setor financeiro ou diretoria).
// Omie só consulta (PesquisarLancamentos e ListarClientes), com as chaves dos segredos OMIE_APP_KEY e OMIE_APP_SECRET.
import { adicionalDoOmie } from "./adicional.ts";

const PAINEL_URL = "https://nbksfvivdodjdddreppv.supabase.co";
const PAINEL_CHAVE = "sb_publishable_nOTE6VavsxhOqwrPNjQuew_3kFt2xx5"; // chave pública do Painel
const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OMIE_KEY = Deno.env.get("OMIE_APP_KEY") || "";
const OMIE_SECRET = Deno.env.get("OMIE_APP_SECRET") || "";
const OMIE_SO_LEITURA = new Set(["PesquisarLancamentos", "ListarClientes"]);
const CAMPANHA_DESDE = "2026-11-05"; // primeiros boletos do adicional pelo PayBot (processo-paybot.md)

const ORIGENS = [
  /^https:\/\/contas-a-receber-financeiro\.vercel\.app$/,
  /^https:\/\/contas-a-receber-financeiro-(git-[a-z0-9-]+|[a-z0-9]+)-mariana-1923\.vercel\.app$/,
  ...(Deno.env.get("PERMITIR_LOCALHOST") === "1" ? [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] : []),
];

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
type Usuario = { id: string; nome: string };
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
async function rpc(nome: string, args: Record<string, unknown>) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: SERVICO, Authorization: `Bearer ${SERVICO}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${nome}: ${r.status}`);
  return await r.json();
}

// Mesma conferência da painel-cr: token do Painel de Demandas, perfil admin ou setor financeiro/diretoria e senha em dia.
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
  const sd = await fetch(`${PAINEL_URL}/rest/v1/rpc/senha_em_dia`, {
    method: "POST",
    headers: { apikey: PAINEL_CHAVE, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!sd.ok || (await sd.json()) !== true) return null;
  const at = (await rest(`atendentes?select=nome&usuario_id=eq.${encodeURIComponent(u.id)}`))[0];
  const usuario: Usuario = { id: u.id, nome: at?.nome || [perfil.first_name, perfil.last_name].filter(Boolean).join(" ") };
  cache.set(token, { ate: Date.now() + 60_000, usuario });
  if (cache.size > 200) cache.clear();
  return usuario;
}

function hojeBrasil() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function inteiro(v: unknown, campo: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Erro(400, `${campo} inválido.`);
  return n;
}
async function evento(u: Usuario, tipo: string, detalhe: Record<string, unknown>) {
  await rest("eventos_caixa", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ contato_id: null, usuario_id: u.id, usuario_nome: u.nome, tipo, detalhe }) });
}
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

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
      // Bloqueio ou consumo redundante: não insistir (repetir só piora e pode travar a chave por mais tempo).
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

// Retrato do adicional: cerca de 15 páginas de títulos e 7 de cadastro (20 a 40 s), guardado em adicional_retratos e
// reaproveitado por 10 minutos; "Atualizar" refaz, mas não antes de 2 minutos. Um cálculo por vez para todo o sistema:
// quem chega enquanto outro calcula espera o resultado. Depois de um erro, 2 minutos sem tentar.
const VALE_MS = 10 * 60_000;
const MIN_MS = 2 * 60_000;
const TRAVA_MS = 3 * 60_000;
const PRAZO_MS = 110_000; // a função tem 150 s; passou disso, para de ler o Omie
let calculando: Promise<any> | null = null;

async function ultimo(comDados: boolean) {
  const campos = comDados ? "id,calculado_em,calculado_por,status,dados" : "id,calculado_em,status";
  const r = await rest(`adicional_retratos?select=${campos}&status=in.(completo,incompleto)&order=calculado_em.desc&limit=1`);
  return r[0] || null;
}
async function ultimaTentativa() {
  return (await rest("adicional_retratos?select=id,calculado_em,status&order=calculado_em.desc&limit=1"))[0] || null;
}

async function retrato(usuario: Usuario, atualizar: boolean) {
  if (!OMIE_KEY || !OMIE_SECRET) throw new Erro(503, "A ligação com o Omie ainda não foi configurada: faltam as chaves na função.");
  const ult = await ultimo(false);
  const idade = ult ? Date.now() - Date.parse(ult.calculado_em) : Infinity;
  if (ult && (idade < MIN_MS || (!atualizar && idade < VALE_MS))) return await ultimo(true);
  if (calculando) return await calculando;

  const tentativa = await ultimaTentativa();
  const idadeTentativa = tentativa ? Date.now() - Date.parse(tentativa.calculado_em) : Infinity;
  if (tentativa?.status === "calculando" && idadeTentativa < TRAVA_MS) {
    for (let i = 0; i < 40; i++) {
      await espera(3000);
      const r = await ultimo(false);
      if (r && Date.parse(r.calculado_em) >= Date.parse(tentativa.calculado_em)) return await ultimo(true);
      const t = await ultimaTentativa();
      if (t && t.status === "erro" && Date.parse(t.calculado_em) >= Date.parse(tentativa.calculado_em)) break;
    }
    throw new Erro(409, "Outra pessoa está consultando o Omie agora. Tente de novo em 1 minuto.");
  }
  if (tentativa?.status === "erro" && idadeTentativa < MIN_MS) {
    if (ult) return await ultimo(true);
    throw new Erro(429, "A última consulta ao Omie falhou há pouco. Tente de novo em 2 minutos.");
  }

  calculando = (async () => {
    await rest("adicional_retratos", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ calculado_por: usuario.nome, status: "calculando" }) });
    const prazo = Date.now() + PRAZO_MS;
    const repetir = async <T>(fn: () => Promise<T>): Promise<T> => {
      for (let n = 0; ; n++) {
        if (Date.now() > prazo) throw new Erro(504, "O Omie demorou demais para responder. Tente de novo em alguns minutos.");
        try { return await fn(); } catch (e) {
          // Só repete falha passageira (502), no máximo 2 vezes; bloqueio do Omie (429) e chave faltando (503) param na hora.
          if (n >= 2 || !(e instanceof Erro) || e.status !== 502) throw e;
          await espera(1500 * (n + 1));
        }
      }
    };
    const consultar = (param: Record<string, unknown>) => repetir(() => omie("financas/pesquisartitulos", "PesquisarLancamentos", param));
    const clientes = async (codigos: number[]) => {
      const r = await repetir(() => omie("geral/clientes", "ListarClientes", {
        pagina: 1, registros_por_pagina: 50, apenas_importado_api: "N", clientesPorCodigo: codigos.map((c) => ({ codigo_cliente_omie: c })),
      }));
      return r?.clientes_cadastro || [];
    };
    try {
      const dados = await adicionalDoOmie(consultar, clientes);
      const novo = (await rest("adicional_retratos", {
        method: "POST",
        body: JSON.stringify({ calculado_por: usuario.nome, status: dados.status, dados }),
      }))[0];
      // Só o retrato mais novo guarda os títulos (cerca de 150 KB): os anteriores ficam só com a data e o status.
      await rest(`adicional_retratos?id=lt.${Number(novo.id)}&dados=neq.%7B%7D`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ dados: {} }) })
        .catch((e) => console.error(`adicional: retratos antigos não limpos (${(e as Error).message})`));
      return novo;
    } catch (e) {
      await rest("adicional_retratos", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ calculado_por: usuario.nome, status: "erro" }) }).catch(() => {});
      throw e;
    }
  })().finally(() => { calculando = null; });
  return await calculando;
}

async function paraTela(usuario: Usuario, atualizar: boolean) {
  const r = await retrato(usuario, atualizar);
  const d = r?.dados || {};
  const codigos = [...new Set((d.titulos || []).map((t: any) => Number(t.cliente)).filter((c: number) => Number.isSafeInteger(c) && c > 0))];
  const whatsapp = await rpc("painel_adicional_whatsapp", { p_clientes: codigos, p_desde: CAMPANHA_DESDE });
  return { calculado_em: r.calculado_em, calculado_por: r.calculado_por, status: r.status, hoje: hojeBrasil(), ...d, whatsapp };
}

// Anotação manual por cliente do Omie, por cima do que vem do Omie e do WhatsApp. Vazio apaga.
async function anotar(u: Usuario, corpo: any) {
  const cliente = inteiro(corpo?.cliente, "Cliente");
  const texto = String(corpo?.texto ?? "").replace(/\s+/g, " ").trim();
  if (texto.length > 500) throw new Erro(400, "A anotação passou de 500 caracteres.");
  if (!texto) {
    await rest(`adicional_anotacoes?cliente_omie=eq.${cliente}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    await evento(u, "adicional_anotacao_apagada", { cliente });
    return { ok: true, anotacao: null };
  }
  const [a] = await rest("adicional_anotacoes?on_conflict=cliente_omie", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ cliente_omie: cliente, texto, usuario_id: u.id, usuario_nome: u.nome, em: new Date().toISOString() }),
  });
  await evento(u, "adicional_anotacao", { cliente });
  return { ok: true, anotacao: { texto: a.texto, por: a.usuario_nome, em: a.em } };
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
      let corpo: any;
      try { corpo = await req.json(); } catch { return json({ erro: "Pedido inválido." }, 400, h); }
      if (corpo?.acao !== "adicional_anotar") return json({ erro: "Ação desconhecida." }, 400, h);
      return json(await anotar(usuario, corpo), 200, h);
    }
    const u = new URL(req.url);
    if ((u.searchParams.get("acao") || "adicional") !== "adicional") return json({ erro: "Ação desconhecida." }, 400, h);
    return json(await paraTela(usuario, u.searchParams.get("atualizar") === "1"), 200, h);
  } catch (e) {
    if (e instanceof Erro) return json({ erro: e.message }, e.status, h);
    console.error(String(e));
    return json({ erro: "Não foi possível concluir agora." }, 500, h);
  }
});
