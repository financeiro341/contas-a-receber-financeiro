// Serviço da extensão: recebe as ligações lidas no WhatsApp Web e grava no sistema do contas a receber.
// O código de ligação fica só neste navegador (chrome.storage.local) e só vai para o endereço abaixo.
const ENDERECO = 'https://mhihrbchidudhgvpouia.supabase.co/functions/v1/registrar-ligacoes';

async function guardarSituacao(s) {
  await chrome.storage.local.set({ situacao: { ...s, em: new Date().toISOString() } });
}

// Só manda o que mudou desde o último envio (a mesma ligação aparece em toda leitura do dia).
async function novasOuMudadas(ligacoes) {
  const { enviadas = {} } = await chrome.storage.local.get('enviadas');
  const hoje = new Date().toISOString().slice(0, 10);
  const limpas = Object.fromEntries(Object.entries(enviadas).filter(([, v]) => v.dia >= hoje.slice(0, 8) + '01'));
  const marca = (x) => `${x.resultado}|${x.duracao_seg ?? ''}`;
  const mandar = ligacoes.filter((x) => !limpas[x.chave] || limpas[x.chave].marca !== marca(x));
  return { mandar, limpas, marca };
}

async function enviar(msg) {
  const { codigo } = await chrome.storage.local.get('codigo');
  if (!codigo) return guardarSituacao({ ok: false, texto: 'Falta colar o código de ligação nas opções da extensão.' });
  const { mandar, limpas, marca } = await novasOuMudadas(msg.ligacoes || []);
  const corpo = { versao: msg.versao, ligacoes: mandar.slice(0, 500), resumo: msg.resumo };
  let r;
  try {
    r = await fetch(ENDERECO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + codigo },
      body: JSON.stringify(corpo),
    });
  } catch {
    return guardarSituacao({ ok: false, texto: 'Sem conexão com o sistema. Tenta de novo na próxima leitura.' });
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) return guardarSituacao({ ok: false, texto: 'O código de ligação não vale mais. Gere outro no sistema e cole nas opções.' });
  if (!r.ok) return guardarSituacao({ ok: false, texto: 'O sistema recusou o envio (' + r.status + ').' });
  const dia = new Date().toISOString().slice(0, 10);
  for (const x of corpo.ligacoes) limpas[x.chave] = { dia, marca: marca(x) };
  await chrome.storage.local.set({ enviadas: limpas });
  return guardarSituacao({ ok: true, texto: `Lidas hoje: ${msg.resumo?.lidas ?? 0}. Enviadas agora: ${j.gravadas ?? 0}.`, fontes: msg.resumo?.fontes });
}

chrome.runtime.onMessage.addListener((msg, _de, responder) => {
  if (msg?.tipo === 'ligacoes') { enviar(msg).finally(() => responder({ ok: true })); return true; }
  if (msg?.tipo === 'erro_leitura') { guardarSituacao({ ok: false, texto: 'Não consegui ler as ligações: ' + msg.erro }).finally(() => responder({ ok: true })); return true; }
  return false;
});
