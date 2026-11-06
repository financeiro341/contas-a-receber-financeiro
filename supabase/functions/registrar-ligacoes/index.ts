// Recebe as ligações lidas pela extensão do Chrome no WhatsApp Web do financeiro (pedido do Marcus, 06/11/2026).
// Autenticação própria: "Authorization: Bearer <código de ligação>", comparado pelo sha256 com extensao_aparelhos
// (código gerado no sistema por um administrador; revogado não entra). A extensão só GRAVA ligações: este endereço
// não devolve nenhum dado do banco além de contagens.
import { createClient } from "npm:@supabase/supabase-js@2";
import { validarLigacao } from "./regras.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const MAX_POR_ENVIO = 500;
async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

async function contatoDo(chat: string, cache: Map<string, number | null>): Promise<number | null> {
  if (cache.has(chat)) return cache.get(chat)!;
  const filtros = chat.endsWith("@lid") ? [`lid.eq.${chat}`] : [`jid.eq.${chat}`, `telefone.eq.${chat.split("@")[0]}`];
  const { data } = await supabase.from("contatos").select("id").or(filtros.join(",")).limit(1);
  const id = data?.[0]?.id ?? null;
  cache.set(chat, id);
  return id;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resposta(405, { erro: "use POST" });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return resposta(401, { erro: "código de ligação inválido" });
  const { data: aparelho } = await supabase.from("extensao_aparelhos")
    .select("id, revogado_em").eq("token_sha256", await sha256(token)).maybeSingle();
  if (!aparelho || aparelho.revogado_em) return resposta(401, { erro: "código de ligação inválido" });

  let corpo: any;
  try {
    corpo = await req.json();
  } catch {
    return resposta(400, { erro: "json inválido" });
  }
  const lista = Array.isArray(corpo?.ligacoes) ? corpo.ligacoes : [];
  if (lista.length > MAX_POR_ENVIO) return resposta(413, { erro: `no máximo ${MAX_POR_ENVIO} por envio` });

  const agora = Date.now();
  const cache = new Map<string, number | null>();
  const linhas: any[] = [];
  const recusadas: Record<string, number> = {};
  for (const x of lista) {
    const r = validarLigacao(x, agora);
    if (!r.ok) { recusadas[r.motivo] = (recusadas[r.motivo] ?? 0) + 1; continue; }
    const v = r.v;
    linhas.push({
      id_chamada: `ext-${v.chave}`,
      contato_id: await contatoDo(v.chat, cache),
      remote_jid: v.chat,
      direcao: v.direcao,
      resultado: v.resultado,
      video: v.video,
      iniciada_em: v.iniciada_em,
      duracao_seg: v.duracao,
      fonte: "extensao",
      aparelho_id: aparelho.id,
    });
  }
  let gravadas = 0;
  if (linhas.length) {
    // A mesma ligação chega em várias leituras: a chave do WhatsApp não muda; o resultado e a duração podem completar.
    const { error, count } = await supabase.from("ligacoes")
      .upsert(linhas, { onConflict: "id_chamada", count: "exact" });
    if (error) return resposta(500, { erro: "não gravou" });
    gravadas = count ?? linhas.length;
  }
  const versao = String(corpo?.versao ?? "").slice(0, 40) || null;
  let resumo: any = { recebidas: lista.length, gravadas, recusadas, leitura: corpo?.resumo ?? null };
  if (JSON.stringify(resumo).length > 4000) resumo = { recebidas: lista.length, gravadas, recusadas, leitura: "grande demais" };
  await supabase.from("extensao_aparelhos")
    .update({ ultimo_contato: new Date().toISOString(), ultima_versao: versao, ultimo_resumo: resumo })
    .eq("id", aparelho.id);
  return resposta(200, { ok: true, gravadas, recusadas: Object.values(recusadas).reduce((s, n) => s + n, 0) });
});
