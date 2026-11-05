// Função painel-cr (projeto whatsapp-financeiro): entrega as métricas ao sistema do contas a receber
// e, desde a fase 2 (05/11/2026), a caixa de entrada: responder em texto e arquivo pela Evolution,
// notas internas, etiquetas e dono da conversa.
// Login: o mesmo do Painel de Demandas. O token do usuário é conferido no Supabase do Painel
// (produção): entra quem é admin ou do setor financeiro ou diretoria. Envia mensagem só quem é admin
// ou está na tabela atendentes com pode_enviar (decisão do Marcus: Maria Clara e os administradores).
// A chave da Evolution fica só no segredo EVOLUTION_APIKEY da função; nunca vai ao navegador.
const PAINEL_URL = "https://nbksfvivdodjdddreppv.supabase.co";
const PAINEL_CHAVE = "sb_publishable_nOTE6VavsxhOqwrPNjQuew_3kFt2xx5"; // chave pública do Painel
const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EVOLUTION_URL = "https://api-evolution.iapessoas.com.br";
const INSTANCIA = "Financeiro CB";
const EVO_CHAVE = Deno.env.get("EVOLUTION_APIKEY") || "";

const ORIGENS = [
  /^https:\/\/contas-a-receber-financeiro(-[a-z0-9-]+)?\.vercel\.app$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

// Arquivos aceitos no envio (boletos, comprovantes, planilhas, imagens). Até 8 MB.
const TIPOS_ARQUIVO: Record<string, "document" | "image"> = {
  "application/pdf": "document",
  "image/jpeg": "image",
  "image/png": "image",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/msword": "document",
  "text/csv": "document",
  "text/plain": "document",
  "application/zip": "document",
};
const MAX_ARQUIVO = 8 * 1024 * 1024;
const MAX_ENVIOS_MINUTO = 20;
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
  const nome = [perfil.first_name, perfil.last_name].filter(Boolean).join(" ");
  const at = (await rest(`atendentes?select=nome,assinatura,pode_enviar&usuario_id=eq.${encodeURIComponent(u.id)}`))[0];
  const usuario: Usuario = {
    id: u.id,
    nome: at?.nome || nome,
    papel: perfil.role,
    setor: perfil.sector,
    podeEnviar: perfil.role === "admin" || !!at?.pode_enviar,
    assinatura: at?.assinatura || `${nome} - Dep. Financeiro`,
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
  if (!Number.isInteger(n) || n <= 0) throw new Erro(400, `${campo} inválido.`);
  return n;
}

async function evento(contato: number | null, u: Usuario, tipo: string, detalhe: Record<string, unknown>) {
  await rest("eventos_caixa", { method: "POST", body: JSON.stringify({ contato_id: contato, usuario_id: u.id, usuario_nome: u.nome, tipo, detalhe }) });
}

async function contatoDestino(id: number): Promise<string> {
  const c = (await rest(`contatos?select=id,jid,lid,telefone&id=eq.${id}`))[0];
  if (!c) throw new Erro(404, "Contato não encontrado.");
  if (c.jid && String(c.jid).endsWith("@s.whatsapp.net")) return String(c.jid).split("@")[0];
  if (c.lid) return String(c.lid);
  throw new Erro(400, "Este contato não tem número para resposta.");
}

async function limiteDeEnvio(u: Usuario) {
  const desde = new Date(Date.now() - 60_000).toISOString();
  const r = await fetch(`${URL_BASE}/rest/v1/envios?select=id&usuario_id=eq.${u.id}&criado_em=gte.${encodeURIComponent(desde)}`, {
    headers: { apikey: SERVICO, Authorization: `Bearer ${SERVICO}`, Prefer: "count=exact", Range: "0-0" },
  });
  const total = Number((r.headers.get("content-range") || "*/0").split("/")[1] || 0);
  if (total >= MAX_ENVIOS_MINUTO) throw new Erro(429, "Muitos envios em pouco tempo. Espere um minuto.");
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
      return { ok: false, erro: `Evolution ${r.status}: ${motivo}` };
    }
    return { ok: true, id: dados?.key?.id ?? null };
  } catch (e) {
    return { ok: false, erro: (e as Error).name === "AbortError" ? "A Evolution não respondeu em 25 segundos." : String((e as Error).message).slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

async function registrarEnvio(u: Usuario, contato: number, destino: string, dados: Record<string, unknown>, rota: string, corpo: Record<string, unknown>) {
  const [envio] = await rest("envios", {
    method: "POST",
    body: JSON.stringify({ contato_id: contato, usuario_id: u.id, usuario_nome: u.nome, destino, ...dados }),
  });
  const res = await chamarEvolution(rota, corpo);
  const muda = res.ok
    ? { status: "enviado", mensagem_id: res.id, atualizado_em: new Date().toISOString() }
    : { status: "erro", erro: res.erro, atualizado_em: new Date().toISOString() };
  await rest(`envios?id=eq.${envio.id}`, { method: "PATCH", body: JSON.stringify(muda) });
  await evento(contato, u, res.ok ? `enviou_${dados.tipo}` : `falha_${dados.tipo}`, { envio: envio.id, arquivo: dados.nome_arquivo ?? undefined, erro: res.ok ? undefined : res.erro });
  if (!res.ok) throw new Erro(502, `A mensagem não saiu. ${res.erro}`);
  return { ok: true, envio: envio.id, mensagem_id: res.id };
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
      await limiteDeEnvio(u);
      const destino = await contatoDestino(contato);
      return await registrarEnvio(u, contato, destino, { tipo: "texto", texto }, "sendText", { number: destino, text: `*${u.assinatura}:*\n${texto}` });
    }
    case "enviar_arquivo": {
      if (!u.podeEnviar) throw new Erro(403, "Seu usuário pode ver as conversas, mas não responder.");
      const contato = inteiro(corpo.contato, "Contato");
      const mimetype = String(corpo.mimetype || "");
      const mediatype = TIPOS_ARQUIVO[mimetype];
      if (!mediatype) throw new Erro(400, "Tipo de arquivo não aceito. Use PDF, imagem, planilha, documento ou texto.");
      const base64 = String(corpo.base64 || "").replace(/^data:[^,]*,/, "");
      if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new Erro(400, "Arquivo inválido.");
      const tamanho = Math.floor(base64.replace(/\s/g, "").length * 3 / 4);
      if (tamanho <= 0 || tamanho > MAX_ARQUIVO) throw new Erro(400, "O arquivo precisa ter até 8 MB.");
      const nome = String(corpo.nome || "arquivo").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "arquivo";
      const legenda = String(corpo.legenda ?? "").trim().slice(0, 1000);
      await limiteDeEnvio(u);
      const destino = await contatoDestino(contato);
      const caption = legenda ? `*${u.assinatura}:*\n${legenda}` : `*${u.assinatura}*`;
      return await registrarEnvio(u, contato, destino, { tipo: "arquivo", texto: legenda || null, nome_arquivo: nome, mimetype, tamanho }, "sendMedia", {
        number: destino, mediatype, mimetype, caption, media: base64.replace(/\s/g, ""), fileName: nome,
      });
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
      const ja = await rest(`etiquetas?select=id&apagada_em=is.null&nome=ilike.${encodeURIComponent(nome.replace(/[%_*]/g, ""))}`);
      if (ja.length) throw new Erro(409, "Já existe uma etiqueta com esse nome.");
      const [e] = await rest("etiquetas", { method: "POST", body: JSON.stringify({ nome, cor, criada_por: u.id }) });
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
    default:
      throw new Erro(400, "Ação desconhecida.");
  }
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
        return json({ usuario: { id: usuario.id, nome: usuario.nome, papel: usuario.papel, pode_enviar: usuario.podeEnviar, assinatura: usuario.assinatura, envio_ligado: !!EVO_CHAVE }, hoje: hojeBrasil() }, 200, h);
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
      case "omie":
        return json(await rpc("painel_omie", {}), 200, h);
      case "caixa": {
        const dias = Math.min(90, Math.max(1, Number(u.searchParams.get("dias")) || 30));
        return json(await rpc("painel_caixa", { p_dias: dias }), 200, h);
      }
      case "conversa_completa": {
        const contato = inteiro(u.searchParams.get("contato"), "Contato");
        const antes = u.searchParams.get("antes");
        if (antes && Number.isNaN(Date.parse(antes))) return json({ erro: "Data inválida." }, 400, h);
        return json(await rpc("painel_conversa_completa", { p_contato: contato, p_antes: antes || null, p_limite: 120 }), 200, h);
      }
      case "etiquetas":
        return json(await rest("etiquetas?select=id,nome,cor&apagada_em=is.null&order=nome"), 200, h);
      case "equipe":
        return json(await equipe(usuario), 200, h);
      default:
        return json({ erro: "Ação desconhecida." }, 400, h);
    }
  } catch (e) {
    if (e instanceof Erro) return json({ erro: e.message }, e.status, h);
    console.error(String(e));
    return json({ erro: "Não foi possível concluir agora." }, 500, h);
  }
});
