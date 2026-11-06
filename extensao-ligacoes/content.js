// Roda dentro do WhatsApp Web do financeiro. A cada 5 minutos lê as ligações de hoje (fuso da Bahia) e passa para o
// serviço da extensão, que grava no sistema. Não toca na tela: nada de clique, digitação ou mudança de aba.
(function () {
  const INTERVALO_MS = 5 * 60 * 1000;
  const VERSAO = chrome.runtime.getManifest().version;

  // Meia-noite de hoje em Feira de Santana (UTC-3, sem horário de verão).
  function inicioDeHoje() {
    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(new Date()); // AAAA-MM-DD
    const [a, m, d] = dia.split('-').map(Number);
    return Date.UTC(a, m - 1, d, 3, 0, 0);
  }

  let rodando = false;
  async function ler(motivo) {
    if (rodando) return;
    rodando = true;
    try {
      const { ligacoes, fontes } = await globalThis.LeitorLigacoes.lerDoDia(inicioDeHoje());
      await chrome.runtime.sendMessage({ tipo: 'ligacoes', versao: VERSAO, ligacoes, resumo: { motivo, fontes, lidas: ligacoes.length } });
    } catch (e) {
      try { await chrome.runtime.sendMessage({ tipo: 'erro_leitura', versao: VERSAO, erro: String(e && e.message || e).slice(0, 200) }); } catch { /* extensão recarregada */ }
    } finally {
      rodando = false;
    }
  }

  // Pedido da página de opções ("Ler agora" e "Diagnóstico" do teste).
  chrome.runtime.onMessage.addListener((msg, _de, responder) => {
    if (msg && msg.tipo === 'ler_agora') { ler('manual').then(() => responder({ ok: true })); return true; }
    if (msg && msg.tipo === 'diagnostico') {
      globalThis.LeitorLigacoes.diagnostico().then((d) => responder({ ok: true, d }), (e) => responder({ ok: false, erro: String(e) }));
      return true;
    }
    return false;
  });

  // Primeira leitura 30 s depois de abrir (o WhatsApp Web termina de sincronizar) e depois a cada 5 minutos.
  setTimeout(() => ler('abertura'), 30 * 1000);
  setInterval(() => ler('intervalo'), INTERVALO_MS);
})();
