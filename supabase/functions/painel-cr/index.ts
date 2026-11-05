// Função painel-cr (projeto whatsapp-financeiro): entrega as métricas ao sistema do contas a receber.
// Login: o mesmo do Painel de Demandas. O token do usuário é conferido no Supabase do Painel
// (produção): entra quem é admin ou do setor financeiro ou diretoria. Só leitura; nada é gravado.
const PAINEL_URL = "https://nbksfvivdodjdddreppv.supabase.co";
const PAINEL_CHAVE = "sb_publishable_nOTE6VavsxhOqwrPNjQuew_3kFt2xx5"; // chave pública do Painel
const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ORIGENS = [
  /^https:\/\/contas-a-receber-financeiro(-[a-z0-9-]+)?\.vercel\.app$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

function cors(origem: string | null): Record<string, string> {
  const ok = origem && ORIGENS.some((r) => r.test(origem));
  return {
    "Access-Control-Allow-Origin": ok ? origem! : "https://contas-a-receber-financeiro.vercel.app",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

function json(corpo: unknown, status: number, h: Record<string, string>) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...h, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

const cache = new Map<string, { ate: number; usuario: { id: string; nome: string; papel: string } }>();

async function conferir(token: string) {
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
  const usuario = { id: u.id, nome: [perfil.first_name, perfil.last_name].filter(Boolean).join(" "), papel: perfil.role };
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

Deno.serve(async (req) => {
  const h = cors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "GET") return json({ erro: "Método não permitido." }, 405, h);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ erro: "Entre com o seu usuário do Painel de Demandas." }, 401, h);
  const usuario = await conferir(token);
  if (!usuario) return json({ erro: "Sessão inválida ou sem permissão." }, 401, h);

  const u = new URL(req.url);
  const acao = u.searchParams.get("acao") || "dia";
  const data = u.searchParams.get("data") || hojeBrasil();
  if (!DATA.test(data)) return json({ erro: "Data inválida." }, 400, h);

  try {
    switch (acao) {
      case "eu":
        return json({ usuario, hoje: hojeBrasil() }, 200, h);
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
        const contato = Number(u.searchParams.get("contato"));
        if (!Number.isInteger(contato) || contato <= 0) return json({ erro: "Contato inválido." }, 400, h);
        return json(await rpc("painel_conversa", { p_contato: contato, p_dia: data }), 200, h);
      }
      case "omie":
        return json(await rpc("painel_omie", {}), 200, h);
      default:
        return json({ erro: "Ação desconhecida." }, 400, h);
    }
  } catch (e) {
    console.error(String(e));
    return json({ erro: "Não foi possível ler os dados agora." }, 500, h);
  }
});
