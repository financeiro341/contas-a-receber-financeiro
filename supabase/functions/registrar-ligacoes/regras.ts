// Regras puras da função registrar-ligacoes (testadas sem banco).
export const DIRECOES = new Set(["feita", "recebida"]);
export const RESULTADOS = new Set(["atendida", "nao_atendida", "recusada", "perdida", "desconhecido"]);

// O WhatsApp Web chama o número de "<dígitos>@c.us"; no banco é "<dígitos>@s.whatsapp.net". @lid fica igual.
export function normalizarChat(chat: unknown): string | null {
  const s = String(chat ?? "").trim();
  const m = s.match(/^(\d{5,20})(?::\d+)?@(c\.us|s\.whatsapp\.net|lid)$/);
  if (!m) return null;
  return m[2] === "lid" ? `${m[1]}@lid` : `${m[1]}@s.whatsapp.net`;
}

export function validarLigacao(x: any, agora: number): { ok: true; v: any } | { ok: false; motivo: string } {
  const chave = String(x?.chave ?? "");
  if (!/^[A-Za-z0-9_.:@-]{4,120}$/.test(chave)) return { ok: false, motivo: "chave" };
  const chat = normalizarChat(x?.chat);
  if (!chat) return { ok: false, motivo: "chat" };
  if (!DIRECOES.has(x?.direcao)) return { ok: false, motivo: "direcao" };
  const resultado = RESULTADOS.has(x?.resultado) ? x.resultado : "desconhecido";
  const quando = Date.parse(String(x?.iniciada_em ?? ""));
  if (!Number.isFinite(quando) || quando > agora + 10 * 60_000 || quando < agora - 4 * 86_400_000) return { ok: false, motivo: "data" };
  const d = x?.duracao_seg;
  const duracao = Number.isInteger(d) && d >= 0 && d <= 86_400 ? d : null;
  return { ok: true, v: { chave, chat, direcao: x.direcao, resultado, duracao, video: x?.video === true, iniciada_em: new Date(quando).toISOString() } };
}

