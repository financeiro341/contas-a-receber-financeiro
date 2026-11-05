// Recebe os avisos (webhooks) da Evolution API da instancia Financeiro CB e grava no banco.
// Autenticacao propria: ?token=... comparado com o sha256 guardado em public.configuracao.
// Nunca grava a apikey que a Evolution manda no corpo, o endereco do webhook (destination, que leva o token),
// nem miniaturas ou base64.
import { createClient } from "npm:@supabase/supabase-js@2";

const INSTANCIA = "Financeiro CB";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

let hashToken: string | null = null;

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tokenValido(token: string | null): Promise<boolean> {
  if (!token) return false;
  if (!hashToken) {
    const { data, error } = await supabase.from("configuracao").select("valor").eq("chave", "webhook_token_sha256").single();
    if (error || !data) return false;
    hashToken = data.valor;
  }
  return (await sha256(token)) === hashToken;
}

const CHAVES_FORA = new Set(["apikey", "destination", "jpegThumbnail", "thumbnail", "base64", "mediaKey", "fileSha256", "fileEncSha256", "thumbnailSha256", "thumbnailEncSha256", "streamingSidecar", "waveform"]);

function limpar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(limpar);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!CHAVES_FORA.has(k)) out[k] = limpar(x);
    }
    return out;
  }
  return v;
}

function textoDa(m: any): string | null {
  if (!m) return null;
  return m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ??
    m.documentMessage?.caption ?? m.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ?? m.listResponseMessage?.title ??
    m.templateButtonReplyMessage?.selectedDisplayText ?? m.reactionMessage?.text ?? null;
}

function nomeArquivo(m: any): string | null {
  return m?.documentMessage?.fileName ?? m?.documentWithCaptionMessage?.message?.documentMessage?.fileName ?? null;
}

// Tamanho do arquivo (fileLength: número, texto ou { low, high }), para a função painel-cr recusar arquivo enorme antes de baixar.
function tamanhoDa(m: any): number | null {
  const x = m?.imageMessage ?? m?.documentMessage ?? m?.audioMessage ?? m?.videoMessage ?? m?.stickerMessage ?? m?.documentWithCaptionMessage?.message?.documentMessage;
  const v = x?.fileLength;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d{1,15}$/.test(v)) return Number(v);
  if (v && typeof v === "object" && Number.isFinite(Number(v.low))) return (Number(v.low) >>> 0) + Number(v.high || 0) * 4294967296;
  return null;
}

function telefoneDo(jid: string | null): string | null {
  if (!jid || !jid.endsWith("@s.whatsapp.net")) return null;
  const d = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  return d || null;
}

function segundos(ts: unknown): number {
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") return Number(ts);
  if (ts && typeof ts === "object" && "low" in (ts as any)) return Number((ts as any).low);
  return NaN;
}

async function garantirContato(remoteJid: string, alt: string | null, nome: string | null, deNos: boolean): Promise<number | null> {
  // Só JIDs no formato do WhatsApp entram no filtro (número, aparelho opcional, @s.whatsapp.net ou @lid).
  const jids = [remoteJid, alt].filter((j) => !!j && /^\d+(:\d+)?@(s\.whatsapp\.net|lid)$/.test(j)) as string[];
  const jid = jids.find((j) => j.endsWith("@s.whatsapp.net")) ?? null;
  const lid = jids.find((j) => j.endsWith("@lid")) ?? null;
  const telefone = telefoneDo(jid);
  const filtros: string[] = [];
  if (jid) filtros.push(`jid.eq."${jid}"`);
  if (lid) filtros.push(`lid.eq."${lid}"`);
  if (telefone) filtros.push(`telefone.eq."${telefone}"`);
  if (!filtros.length) return null;
  const { data: achados } = await supabase.from("contatos").select("id, jid, lid, telefone, nome_whatsapp").or(filtros.join(",")).limit(1);
  const atual = achados?.[0];
  if (atual) {
    const muda: Record<string, unknown> = {};
    if (jid && !atual.jid) muda.jid = jid;
    if (lid && !atual.lid) muda.lid = lid;
    if (telefone && !atual.telefone) muda.telefone = telefone;
    if (!deNos && nome && nome !== atual.nome_whatsapp) muda.nome_whatsapp = nome;
    if (Object.keys(muda).length) await supabase.from("contatos").update(muda).eq("id", atual.id);
    return atual.id;
  }
  const { data: novo, error } = await supabase.from("contatos")
    .insert({ jid, lid, telefone, nome_whatsapp: deNos ? null : nome }).select("id").single();
  if (error) {
    const { data: deNovo } = await supabase.from("contatos").select("id").or(filtros.join(",")).limit(1);
    return deNovo?.[0]?.id ?? null;
  }
  return novo.id;
}

async function tratarMensagem(d: any) {
  const k = d?.key ?? {};
  const remoteJid: string = k.remoteJid ?? "";
  if (!k.id || !remoteJid || remoteJid === "status@broadcast" || remoteJid.endsWith("@newsletter")) return;
  const grupo = remoteJid.endsWith("@g.us");
  const alt: string | null = k.remoteJidAlt ?? null;
  const deNos = !!k.fromMe;
  const contatoId = grupo ? null : await garantirContato(remoteJid, alt, d.pushName ?? null, deNos);
  const texto = textoDa(d.message);
  const ts = segundos(d.messageTimestamp);
  const quando = new Date((Number.isFinite(ts) && ts > 0 ? ts : Date.now() / 1000) * 1000).toISOString();
  const { error } = await supabase.from("mensagens").upsert({
    id: k.id,
    contato_id: contatoId,
    remote_jid: remoteJid,
    remote_jid_alt: alt,
    grupo,
    de_nos: deNos,
    tipo: d.messageType ?? null,
    texto: texto ? String(texto).slice(0, 4000) : null,
    nome_arquivo: nomeArquivo(d.message),
    tamanho_arquivo: tamanhoDa(d.message),
    aparelho: d.source ?? null,
    enviada_em: quando,
    status: d.status ?? null,
  }, { onConflict: "id" });
  if (error) throw new Error("mensagem: " + error.message);
}

async function tratarAtualizacao(d: any) {
  const lista = Array.isArray(d) ? d : [d];
  for (const u of lista) {
    const id = u?.keyId ?? u?.key?.id;
    const status = u?.status ?? u?.update?.status;
    if (id && status) await supabase.from("mensagens").update({ status: String(status) }).eq("id", id);
  }
}

// Ligações: a Evolution só avisa parte delas e nem sempre diz quem é a outra ponta.
// O registro manual no sistema ("Registrar ligação") é a contagem oficial; isto aqui é complemento.
async function tratarChamada(d: any) {
  const lista = Array.isArray(d) ? d : [d];
  for (const c of lista) {
    if (!c?.id) continue;
    const de: string | null = c.from ?? c.chatId ?? null;
    const st = String(c.status ?? "");
    const resultado = st === "accept" ? "atendida" : st === "reject" ? "recusada" : st === "timeout" ? "perdida" : "desconhecido";
    const { data: existe } = await supabase.from("ligacoes").select("id").eq("id_chamada", c.id).maybeSingle();
    if (existe) {
      if (resultado !== "desconhecido") await supabase.from("ligacoes").update({ resultado }).eq("id", existe.id);
      continue;
    }
    const contatoId = de && !c.isGroup ? await garantirContato(de, null, null, false) : null;
    const { error } = await supabase.from("ligacoes").insert({
      id_chamada: c.id,
      contato_id: contatoId,
      remote_jid: de,
      direcao: "recebida",
      resultado,
      video: !!c.isVideo,
      iniciada_em: c.date ? new Date(c.date).toISOString() : new Date().toISOString(),
      fonte: "evolution",
    });
    if (error) throw new Error("ligacao: " + error.message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  const url = new URL(req.url);
  if (!(await tokenValido(url.searchParams.get("token")))) return new Response("nao autorizado", { status: 401 });
  let corpo: any;
  try {
    corpo = await req.json();
  } catch {
    return new Response("json invalido", { status: 400 });
  }
  const evento = String(corpo?.event ?? "").toLowerCase().replace(/_/g, ".");
  const instancia = corpo?.instance ?? null;
  if (instancia !== INSTANCIA) return new Response("instancia ignorada", { status: 200 });
  const { data: aviso } = await supabase.from("avisos_recebidos")
    .insert({ evento, instancia, payload: limpar(corpo) }).select("id").single();
  let erro: string | null = null;
  try {
    if (evento === "messages.upsert") await tratarMensagem(corpo.data);
    else if (evento === "messages.update") await tratarAtualizacao(corpo.data);
    else if (evento === "call") await tratarChamada(corpo.data);
  } catch (e) {
    erro = String((e as Error)?.message ?? e).slice(0, 500);
  }
  if (aviso?.id) await supabase.from("avisos_recebidos").update({ processado: !erro, erro }).eq("id", aviso.id);
  return new Response(erro ? "erro registrado" : "ok", { status: 200 });
});
