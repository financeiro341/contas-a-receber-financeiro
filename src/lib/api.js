// Camada de dados única do sistema.
// Login: o mesmo usuário e senha do Painel de Demandas (Supabase do Painel, produção).
// Dados: a função painel-cr do Supabase do WhatsApp, que confere o login antes de responder.
import { createClient } from '@supabase/supabase-js';

const PAINEL_URL = 'https://nbksfvivdodjdddreppv.supabase.co';
const PAINEL_CHAVE = 'sb_publishable_nOTE6VavsxhOqwrPNjQuew_3kFt2xx5'; // chave pública
const FUNCAO = 'https://mhihrbchidudhgvpouia.supabase.co/functions/v1/painel-cr';

// Igual ao Painel de Demandas (D-006): o login vira um e-mail interno.
export const LOGIN_EMAIL_DOMAIN = 'demandas.castelobrancocontabilidade.com.br';
export const loginParaEmail = (login) => `${String(login).trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;

const sb = createClient(PAINEL_URL, PAINEL_CHAVE, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cr:sessao' },
});

export async function entrar(login, senha) {
  const { data, error } = await sb.auth.signInWithPassword({ email: loginParaEmail(login), password: senha });
  if (error) {
    const credencial = error.status === 400 || error.code === 'invalid_credentials';
    throw new Error(credencial ? 'Usuário ou senha incorretos.' : 'Não foi possível entrar agora. Tente de novo.');
  }
  return data.session;
}

// Ao sair, apaga os rascunhos de mensagem guardados nesta aba.
export function limparRascunhos() {
  for (const area of [globalThis.sessionStorage, globalThis.localStorage]) {
    try {
      Object.keys(area || {}).filter((k) => k.startsWith('cr:rascunho:')).forEach((k) => area.removeItem(k));
    } catch { /* sem armazenamento */ }
  }
}

export async function sair() { limparRascunhos(); await sb.auth.signOut(); }

export async function sessaoAtual() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export function aoMudarSessao(fn) {
  const { data } = sb.auth.onAuthStateChange((_e, s) => { if (!s) limparRascunhos(); fn(s); });
  return () => data.subscription.unsubscribe();
}

// Os nomes de empresa vêm do Omie com entidades HTML (&amp;). Só esses campos são convertidos;
// o texto das mensagens fica como chegou (o React escapa tudo na tela).
const CAMPOS_OMIE = new Set(['empresa', 'empresas', 'nome']);
const semEntidades = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function decodificarNomes(v, chave) {
  if (typeof v === 'string') return CAMPOS_OMIE.has(chave) ? semEntidades(v) : v;
  if (Array.isArray(v)) return v.map((x) => decodificarNomes(x, chave));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodificarNomes(x, k)]));
  return v;
}

async function ler(params) {
  const s = await sessaoAtual();
  if (!s) throw Object.assign(new Error('Entre de novo.'), { codigo: 401 });
  const q = new URLSearchParams(params).toString();
  const r = await fetch(`${FUNCAO}?${q}`, { headers: { Authorization: `Bearer ${s.access_token}` } });
  let corpo = {};
  try { corpo = decodificarNomes(JSON.parse(await r.text())); } catch { corpo = {}; }
  if (!r.ok) throw Object.assign(new Error(corpo.erro || 'Não foi possível ler os dados.'), { codigo: r.status });
  return corpo;
}

export const lerEu = () => ler({ acao: 'eu' });
export const lerDia = (data) => ler({ acao: 'dia', data });
export const lerAtendimento = (data) => ler({ acao: 'atendimento', data });
export const lerHistorico = (de, ate) => ler({ acao: 'historico', de, data: ate });
export const lerConversa = (contato, data) => ler({ acao: 'conversa', contato: String(contato), data });
export const lerOmie = () => ler({ acao: 'omie' });

// Caixa de entrada (fase 2).
export const lerCaixa = (dias = 30) => ler({ acao: 'caixa', dias: String(dias) });
export const lerConversaCompleta = (contato, antes) => ler({ acao: 'conversa_completa', contato: String(contato), ...(antes ? { antes } : {}) });
export const lerEtiquetas = () => ler({ acao: 'etiquetas' });
export const lerEquipe = () => ler({ acao: 'equipe' });

async function postar(corpo) {
  const s = await sessaoAtual();
  if (!s) throw Object.assign(new Error('Entre de novo.'), { codigo: 401 });
  const r = await fetch(FUNCAO, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  let resposta = {};
  try { resposta = await r.json(); } catch { resposta = {}; }
  if (!r.ok) throw Object.assign(new Error(resposta.erro || 'Não foi possível concluir agora.'), { codigo: r.status });
  return resposta;
}

export const enviarTexto = (contato, texto) => postar({ acao: 'enviar_texto', contato, texto });
export const enviarArquivo = (contato, { nome, mimetype, base64, legenda }) => postar({ acao: 'enviar_arquivo', contato, nome, mimetype, base64, legenda });
export const criarNota = (contato, texto) => postar({ acao: 'nota', contato, texto });
export const apagarNota = (id) => postar({ acao: 'nota_apagar', id });
export const marcarEtiqueta = (contato, etiqueta, ligar) => postar({ acao: 'etiqueta', contato, etiqueta, ligar });
export const criarEtiqueta = (nome, cor) => postar({ acao: 'etiqueta_criar', nome, cor });
export const definirDono = (contato, usuario) => postar({ acao: 'atribuir', contato, usuario });
export const buscarHistorico = (contato) => postar({ acao: 'buscar_historico', contato });
export const marcarLida = (contato) => postar({ acao: 'marcar_lida', contato });
export const lerRespostas = () => ler({ acao: 'respostas' });
export const criarResposta = (titulo, texto) => postar({ acao: 'resposta_criar', titulo, texto });
export const apagarResposta = (id) => postar({ acao: 'resposta_apagar', id });
