// Sem dependência externa (a rede da máquina de testes nem sempre alcança o jsr).
function assertEquals(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
}
import { normalizarChat, validarLigacao } from "./regras.ts";

const agora = Date.parse("2026-11-06T15:00:00Z");
const base = { chave: "CALL1", chat: "557599990000@c.us", direcao: "feita", resultado: "atendida", duracao_seg: 33, iniciada_em: "2026-11-06T14:00:00Z" };

Deno.test("normaliza o chat do WhatsApp Web para o formato do banco", () => {
  assertEquals(normalizarChat("557599990000@c.us"), "557599990000@s.whatsapp.net");
  assertEquals(normalizarChat("1234567890123:12@lid"), "1234567890123@lid");
  assertEquals(normalizarChat("120363@g.us"), null);
  assertEquals(normalizarChat("status@broadcast"), null);
});

Deno.test("aceita a ligação completa e recusa o que não serve", () => {
  const r = validarLigacao(base, agora);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.v.chat, "557599990000@s.whatsapp.net");
  assertEquals(validarLigacao({ ...base, chave: "x" }, agora), { ok: false, motivo: "chave" });
  assertEquals(validarLigacao({ ...base, direcao: "outra" }, agora), { ok: false, motivo: "direcao" });
  assertEquals(validarLigacao({ ...base, iniciada_em: "2026-10-01T14:00:00Z" }, agora), { ok: false, motivo: "data" });
  assertEquals(validarLigacao({ ...base, iniciada_em: "2026-11-06T16:00:00Z" }, agora), { ok: false, motivo: "data" });
});

Deno.test("resultado e duração estranhos viram desconhecido e vazio", () => {
  const r = validarLigacao({ ...base, resultado: "zzz", duracao_seg: 2.5 }, agora);
  assertEquals(r.ok && r.v.resultado, "desconhecido");
  assertEquals(r.ok && r.v.duracao, null);
});
