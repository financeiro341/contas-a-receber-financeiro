// Recebe as ligações lidas pela extensão do Chrome no WhatsApp Web do financeiro (pedido do Marcus, 06/11/2026).
// Autenticação própria: "Authorization: Bearer <código de ligação>", comparado pelo sha256 com extensao_aparelhos
// (código gerado no sistema por um administrador; revogado não entra). A extensão só GRAVA ligações: este endereço
// não devolve nenhum dado do banco além de contagens.
// Revisão de segurança de 06/11/2026: ligação já gravada só se completa (resultado e duração), nunca é reescrita;
// só ligações de hoje; limites de tamanho, de frequência e de quantidade por dia.
import { createClient } from "npm:@supabase/supabase-js@2";
import { inicioAceito, validarLigacao } from "./regras.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const MAX_POR_ENVIO = 500;
const MAX_POR_DIA = 1500; // por computador; um dia cheio de cobrança tem algumas dezenas
const MAX_BYTES = 512 * 1024;
const INTERVALO_MIN_MS = 20_000; // a extensão lê a cada 5 minutos; "Ler agora" à mão fica bem acima disso

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

// Busca dos contatos em lote (os chats já vêm normalizados: só dígitos com @s.whatsapp.net ou @lid).
async function contatosDos(chats: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (!chats.length) return mapa;
  const lids = chats.filter((c) => c.endsWith("@lid"));
  const jids = chats.filter((c) => !c.endsWith("@lid"));
  const tels = jids.map((c) => c.split("@")[0]);
  const filtros: string[] = [];
  if (lids.length) filtros.push(`lid.in.(${lids.join(",")})`);
  if (jids.length) filtros.push(`jid.in.(${jids.join(",")})`, `telefone.in.(${tels.join(",")})`);
  const { data } = await supabase.from("contatos").select("id, jid, lid, telefone").or(filtros.join(",")).limit(2000);
  for (const c of data ?? []) {
    if (c.lid && !mapa.has(c.lid)) mapa.set(c.lid, c.id);
    if (c.jid && !mapa.has(c.jid)) mapa.set(c.jid, c.id);
    if (c.telefone && !mapa.has(`${c.telefone}@s.whatsapp.net`)) mapa.set(`${c.telefone}@s.whatsapp.net`, c.id);
  }
  return mapa;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resposta(405, { erro: "use POST" });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return resposta(401, { erro: "código de ligação inválido" });
  const { data: aparelho } = await supabase.from("extensao_aparelhos")
    .select("id, revogado_em, ultimo_contato").eq("token_sha256", await sha256(token)).maybeSingle();
  if (!aparelho || aparelho.revogado_em) return resposta(401, { erro: "código de ligação inválido" });

  const agora = Date.now();
  if (aparelho.ultimo_contato && agora - Date.parse(aparelho.ultimo_contato) < INTERVALO_MIN_MS) {
    return resposta(429, { erro: "envios rápidos demais; tente na próxima leitura" });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return resposta(413, { erro: "envio grande demais" });
  const texto = await req.text();
  if (texto.length > MAX_BYTES) return resposta(413, { erro: "envio grande demais" });
  let corpo: any;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return resposta(400, { erro: "json inválido" });
  }
  const lista = Array.isArray(corpo?.ligacoes) ? corpo.ligacoes : [];
  if (lista.length > MAX_POR_ENVIO) return resposta(413, { erro: `no máximo ${MAX_POR_ENVIO} por envio` });

  const validas: any[] = [];
  const recusadas: Record<string, number> = {};
  for (const x of lista) {
    const r = validarLigacao(x, agora);
    if (r.ok) validas.push(r.v);
    else recusadas[r.motivo] = (recusadas[r.motivo] ?? 0) + 1;
  }

  // Teto por computador e por dia (um código vazado não enche a tabela).
  const { count: jaHoje } = await supabase.from("ligacoes").select("id", { count: "exact", head: true })
    .eq("aparelho_id", aparelho.id).gte("iniciada_em", new Date(inicioAceito(agora)).toISOString());
  if ((jaHoje ?? 0) + validas.length > MAX_POR_DIA + MAX_POR_ENVIO) return resposta(429, { erro: "limite do dia atingido" });

  let resultado = { novas: 0, completadas: 0 };
  if (validas.length) {
    const contatos = await contatosDos([...new Set(validas.map((v) => v.chat))]);
    const linhas = validas.map((v) => ({
      id_chamada: `ext-${v.chave}`,
      contato_id: contatos.get(v.chat) ?? null,
      remote_jid: v.chat,
      direcao: v.direcao,
      resultado: v.resultado,
      video: v.video,
      iniciada_em: v.iniciada_em,
      duracao_seg: v.duracao,
    }));
    const { data, error } = await supabase.rpc("extensao_gravar_ligacoes", { p_aparelho: aparelho.id, p_linhas: linhas });
    if (error) return resposta(500, { erro: "não gravou" });
    resultado = data ?? resultado;
  }

  const versao = String(corpo?.versao ?? "").slice(0, 40) || null;
  const lidas = Number.isInteger(corpo?.resumo?.lidas) ? corpo.resumo.lidas : null;
  const fontes = Array.isArray(corpo?.resumo?.fontes) ? corpo.resumo.fontes.slice(0, 10).map((f: unknown) => String(f).slice(0, 60)) : [];
  const resumo = { recebidas: lista.length, ...resultado, recusadas, lidas, fontes };
  await supabase.from("extensao_aparelhos")
    .update({ ultimo_contato: new Date().toISOString(), ultima_versao: versao, ultimo_resumo: resumo })
    .eq("id", aparelho.id);
  return resposta(200, { ok: true, ...resultado, recusadas: Object.values(recusadas).reduce((s, n) => s + n, 0) });
});
