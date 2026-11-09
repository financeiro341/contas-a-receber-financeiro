// Aviso do WhatsApp do financeiro (09/11/2026). Em 08 e 09/11/2026 o WhatsApp ficou quase um dia sem
// receber nada sem ninguém perceber; as conversas e as métricas deste sistema dependem dele.
// O vigia (função vigia-evolution do Supabase do WhatsApp) responde sem senha e com CORS liberado:
// {"ok":true,"situacao":"ok"|"atencao"|"falha"|"erro"|"vigia_parado"|"sem_dados","verificado_em":"<ISO>"}.
// A faixa só aparece com "falha" ou "vigia_parado". Qualquer outra resposta, erro de rede ou resposta
// estranha não mostra nada (sem alarme falso).
import { horaDe } from '../utils/formato.js';

export const VIGIA_URL = 'https://mhihrbchidudhgvpouia.supabase.co/functions/v1/vigia-evolution';
export const INTERVALO_VIGIA = 5 * 60 * 1000;
const LIMITE_ESPERA = 15000;

// Consulta o vigia. Nunca lança erro: devolve { situacao, verificado_em } ou null.
export async function lerSituacaoVigia(buscar = globalThis.fetch, limite = LIMITE_ESPERA) {
  const controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const relogio = controle ? setTimeout(() => controle.abort(), limite) : null;
  try {
    const r = await buscar(VIGIA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'situacao' }),
      cache: 'no-store',
      ...(controle ? { signal: controle.signal } : {}),
    });
    if (!r || !r.ok) return null;
    const corpo = await r.json();
    if (!corpo || corpo.ok !== true || typeof corpo.situacao !== 'string') return null;
    return { situacao: corpo.situacao, verificado_em: typeof corpo.verificado_em === 'string' ? corpo.verificado_em : null };
  } catch {
    return null;
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}

function horaValida(instante) {
  if (!instante) return null;
  const d = new Date(instante);
  return Number.isNaN(d.getTime()) ? null : horaDe(d);
}

// Texto da faixa, ou null quando não há o que avisar. Hora no horário de Brasília.
export function textoAvisoWhatsapp(resposta) {
  if (!resposta) return null;
  const hora = horaValida(resposta.verificado_em);
  const ultima = hora ? `Última conferência às ${hora}.` : '';
  if (resposta.situacao === 'falha') {
    return ['WhatsApp do financeiro com problema na automação. Conversas, respostas e confirmações de envio podem não estar chegando a este sistema, e os números do dia podem ficar incompletos. O Marcus já foi avisado.', ultima].filter(Boolean).join(' ');
  }
  if (resposta.situacao === 'vigia_parado') {
    return ['O vigia do WhatsApp do financeiro parou de conferir.', ultima, 'O Marcus já foi avisado.'].filter(Boolean).join(' ');
  }
  return null;
}

// Consulta ao abrir, a cada 5 minutos (só com a aba visível) e quando a janela volta ao foco.
// Só a resposta mais recente vale; devolve a função que desliga tudo.
export function vigiarWhatsapp({ ler = lerSituacaoVigia, aoMudar, intervalo = INTERVALO_VIGIA, janela = globalThis.window, documento = globalThis.document }) {
  let ativo = true;
  let pedido = 0;
  let ultimaVez = 0;
  const visivel = () => !documento || documento.visibilityState !== 'hidden';
  const conferir = async () => {
    const meu = ++pedido;
    ultimaVez = Date.now();
    let resposta = null;
    try { resposta = await ler(); } catch { resposta = null; }
    if (ativo && meu === pedido) aoMudar(resposta);
  };
  // O foco e a volta da aba costumam chegar juntos: uma consulta só.
  const aoVoltar = () => { if (visivel() && Date.now() - ultimaVez > 5000) conferir(); };
  conferir();
  const id = setInterval(() => { if (visivel()) conferir(); }, intervalo);
  janela?.addEventListener?.('focus', aoVoltar);
  documento?.addEventListener?.('visibilitychange', aoVoltar);
  return () => {
    ativo = false;
    clearInterval(id);
    janela?.removeEventListener?.('focus', aoVoltar);
    documento?.removeEventListener?.('visibilitychange', aoVoltar);
  };
}
