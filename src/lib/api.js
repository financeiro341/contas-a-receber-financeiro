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

export async function sair() { await sb.auth.signOut(); }

export async function sessaoAtual() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export function aoMudarSessao(fn) {
  const { data } = sb.auth.onAuthStateChange((_e, s) => fn(s));
  return () => data.subscription.unsubscribe();
}

async function ler(params) {
  const s = await sessaoAtual();
  if (!s) throw Object.assign(new Error('Entre de novo.'), { codigo: 401 });
  const q = new URLSearchParams(params).toString();
  const r = await fetch(`${FUNCAO}?${q}`, { headers: { Authorization: `Bearer ${s.access_token}` } });
  // Os nomes vêm do Omie com entidades HTML (&amp;); a tela mostra texto puro (o React escapa).
  const texto = (await r.text()).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\\"').replace(/&#39;/g, "'");
  let corpo = {};
  try { corpo = JSON.parse(texto); } catch { corpo = {}; }
  if (!r.ok) throw Object.assign(new Error(corpo.erro || 'Não foi possível ler os dados.'), { codigo: r.status });
  return corpo;
}

export const lerEu = () => ler({ acao: 'eu' });
export const lerDia = (data) => ler({ acao: 'dia', data });
export const lerAtendimento = (data) => ler({ acao: 'atendimento', data });
export const lerHistorico = (de, ate) => ler({ acao: 'historico', de, data: ate });
export const lerConversa = (contato, data) => ler({ acao: 'conversa', contato: String(contato), data });
export const lerOmie = () => ler({ acao: 'omie' });
