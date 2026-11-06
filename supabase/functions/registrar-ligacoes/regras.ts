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

// Meia-noite de hoje em Feira de Santana (UTC-3, sem horário de verão); entre 00h e 01h, a meia-noite de ontem.
export function inicioAceito(agora: number): number {
  const local = new Date(agora - 3 * 3_600_000);
  const meiaNoite = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 3, 0, 0);
  return local.getUTCHours() < 1 ? meiaNoite - 86_400_000 : meiaNoite;
}

export function validarLigacao(x: any, agora: number): { ok: true; v: any } | { ok: false; motivo: string } {
  const chave = String(x?.chave ?? "");
  if (!/^[A-Za-z0-9_.:@-]{4,120}$/.test(chave)) return { ok: false, motivo: "chave" };
  const chat = normalizarChat(x?.chat);
  if (!chat) return { ok: false, motivo: "chat" };
  if (!DIRECOES.has(x?.direcao)) return { ok: false, motivo: "direcao" };
  const resultado = RESULTADOS.has(x?.resultado) ? x.resultado : "desconhecido";
  const quando = Date.parse(String(x?.iniciada_em ?? ""));
  // Só ligações de hoje (fuso da Bahia); até 01h ainda aceita as de ontem (última leitura antes da meia-noite).
  // Assim um código vazado não mexe em dias já fechados (revisão de segurança de 06/11/2026).
  if (!Number.isFinite(quando) || quando > agora + 10 * 60_000 || quando < inicioAceito(agora)) return { ok: false, motivo: "data" };
  const d = x?.duracao_seg;
  const duracao = Number.isInteger(d) && d >= 0 && d <= 86_400 ? d : null;
  return { ok: true, v: { chave, chat, direcao: x.direcao, resultado, duracao, video: x?.video === true, iniciada_em: new Date(quando).toISOString() } };
}

