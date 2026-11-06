const $ = (id) => document.getElementById(id);
const quando = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

async function mostrarSituacao() {
  const { situacao, codigo } = await chrome.storage.local.get(['situacao', 'codigo']);
  $('aviso-codigo').textContent = codigo ? 'Código salvo neste Chrome.' : 'Nenhum código salvo ainda.';
  if (!situacao) return;
  $('situacao').textContent = `${quando(situacao.em)}: ${situacao.texto}`;
  $('situacao').className = situacao.ok ? 'ok' : 'erro';
}

async function abaDoWhatsApp() {
  const [aba] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  return aba || null;
}

$('salvar').addEventListener('click', async () => {
  const v = $('codigo').value.trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(v)) { $('aviso-codigo').textContent = 'Esse não parece o código do sistema. Copie de novo.'; return; }
  await chrome.storage.local.set({ codigo: v });
  $('codigo').value = '';
  mostrarSituacao();
});

$('ler').addEventListener('click', async () => {
  const aba = await abaDoWhatsApp();
  if (!aba) { $('situacao').textContent = 'Abra o WhatsApp Web neste Chrome primeiro.'; $('situacao').className = 'erro'; return; }
  $('situacao').textContent = 'Lendo…'; $('situacao').className = '';
  try { await chrome.tabs.sendMessage(aba.id, { tipo: 'ler_agora' }); } catch { /* aba recarregando */ }
  setTimeout(mostrarSituacao, 1500);
});

$('diag').addEventListener('click', async () => {
  const aba = await abaDoWhatsApp();
  const saida = $('saida-diag');
  saida.hidden = false;
  if (!aba) { saida.textContent = 'Abra o WhatsApp Web neste Chrome primeiro.'; return; }
  try {
    const r = await chrome.tabs.sendMessage(aba.id, { tipo: 'diagnostico' });
    saida.textContent = JSON.stringify(r, null, 1);
  } catch (e) {
    saida.textContent = 'Recarregue a aba do WhatsApp Web e tente de novo.';
  }
});

chrome.storage.onChanged.addListener(mostrarSituacao);
mostrarSituacao();
