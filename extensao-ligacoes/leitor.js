// Leitura das ligações guardadas pelo próprio WhatsApp Web no navegador (IndexedDB do web.whatsapp.com).
// Só lê: abre o banco do WhatsApp Web sem pedir mudança de versão e nunca grava nele.
// O formato exato é conferido no teste de 06/11/2026 (diagnostico()); a conversão aceita os dois formatos conhecidos:
//  A) mensagem do tipo "call_log" no histórico da conversa (a marca "Ligação de voz" que aparece na conversa);
//  B) registro da aba Ligações ("call log": um por ligação, com o resultado e a duração).
(function () {
  const BANCOS = ['model-storage'];

  function abrir(nome) {
    return new Promise((ok, falha) => {
      const r = indexedDB.open(nome); // sem versão: nunca dispara criação nem mudança do banco do WhatsApp
      r.onupgradeneeded = () => { r.transaction.abort(); falha(new Error('banco ' + nome + ' não existe')); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => falha(r.error);
    });
  }

  function todos(db, loja, filtro, limite) {
    return new Promise((ok, falha) => {
      const saida = [];
      const tx = db.transaction(loja, 'readonly');
      const req = tx.objectStore(loja).openCursor(null, 'prev');
      req.onsuccess = () => {
        const c = req.result;
        if (!c || saida.length >= limite) return ok(saida);
        try { if (filtro(c.value)) saida.push(c.value); } catch { /* registro estranho: ignora */ }
        c.continue();
      };
      req.onerror = () => falha(req.error);
    });
  }

  const jidDe = (v) => {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (v._serialized) return v._serialized;
    if (v.user && v.server) return v.user + '@' + v.server;
    return null;
  };
  const numero = (v) => (typeof v === 'number' ? v : (v && typeof v.low === 'number' ? v.low : Number(v)));

  // Resultado da ligação nos nomes do sistema.
  function resultado(r) {
    const s = String(r ?? '').toLowerCase();
    if (/connect|accept|answer|atend/.test(s)) return 'atendida';
    if (/reject|declin|recus|busy/.test(s)) return 'recusada';
    if (/miss|unanswer|no.?answer|timeout|perd|cancel/.test(s)) return 'nao_atendida';
    return 'desconhecido';
  }

  // Formato A: mensagem "call_log" da conversa.
  function deMensagem(m) {
    const t = numero(m.t);
    const chat = jidDe(m.id && m.id.remote) || jidDe(m.to) || jidDe(m.from);
    const nossa = m.id ? !!m.id.fromMe : !!m.fromMe;
    const dur = numero(m.callDuration ?? m.duration);
    let res = resultado(m.callOutcome ?? m.subtype);
    if (res === 'desconhecido' && Number.isFinite(dur)) res = dur > 0 ? 'atendida' : 'nao_atendida';
    return {
      chave: String((m.id && m.id.id) || m.id || '').slice(0, 120),
      chat, direcao: nossa ? 'feita' : 'recebida', resultado: res,
      duracao_seg: Number.isFinite(dur) ? Math.round(dur) : null,
      video: !!(m.isVideoCall ?? m.isVideo), iniciada_em: new Date(t * 1000).toISOString(),
    };
  }

  // Formato B: registro da aba Ligações.
  function deRegistro(c) {
    let t = numero(c.timestamp ?? c.ts ?? c.startTime ?? c.t);
    if (t > 1e12) t = t / 1000;
    const chat = jidDe(c.peerJid ?? c.chatId ?? c.jid ?? c.from ?? (c.participants && c.participants[0]));
    const dur = numero(c.duration ?? c.callDuration);
    const entrada = c.isIncoming ?? (c.fromMe === undefined ? undefined : !c.fromMe);
    return {
      chave: String(c.id ?? c.callId ?? '').slice(0, 120),
      chat, direcao: entrada ? 'recebida' : 'feita',
      resultado: resultado(c.outcome ?? c.callResult ?? c.result),
      duracao_seg: Number.isFinite(dur) ? Math.round(dur) : null,
      video: !!(c.isVideo ?? c.isVideoCall), iniciada_em: new Date(t * 1000).toISOString(),
    };
  }

  const ehMensagemDeLigacao = (m) => m && (m.type === 'call_log' || m.type === 'call-log');
  const ehDoDia = (inicioMs) => (x) => {
    const t = Date.parse(x.iniciada_em);
    return Number.isFinite(t) && t >= inicioMs;
  };
  const valida = (x) => x.chave && x.chat && !/@g\.us$|status@broadcast/.test(x.chat);

  async function lerDoDia(inicioMs) {
    const achadas = new Map();
    const fontes = [];
    for (const nome of BANCOS) {
      let db;
      try { db = await abrir(nome); } catch { continue; }
      try {
        const lojas = Array.from(db.objectStoreNames);
        // Formato B: loja própria do histórico de ligações.
        for (const loja of lojas.filter((l) => /call/i.test(l))) {
          const regs = await todos(db, loja, () => true, 2000);
          regs.map(deRegistro).filter(valida).filter(ehDoDia(inicioMs)).forEach((x) => achadas.set(x.chave, x));
          fontes.push(loja + ':' + regs.length);
        }
        // Formato A: mensagens "call_log" (as mais novas primeiro; para quando passa do começo do dia).
        if (lojas.includes('message')) {
          const limiteT = Math.floor(inicioMs / 1000);
          const msgs = await todos(db, 'message', (m) => ehMensagemDeLigacao(m) && numero(m.t) >= limiteT, 2000);
          msgs.map(deMensagem).filter(valida).filter(ehDoDia(inicioMs)).forEach((x) => { if (!achadas.has(x.chave)) achadas.set(x.chave, x); });
          fontes.push('message:' + msgs.length);
        }
      } finally {
        db.close();
      }
    }
    return { ligacoes: Array.from(achadas.values()), fontes };
  }

  // Para o teste: nomes das lojas, quantos registros e só os NOMES dos campos de um exemplo (nenhum conteúdo).
  async function diagnostico() {
    const saida = {};
    for (const nome of BANCOS) {
      let db;
      try { db = await abrir(nome); } catch (e) { saida[nome] = String(e.message); continue; }
      saida[nome] = {};
      for (const loja of Array.from(db.objectStoreNames)) {
        const ex = await todos(db, loja, () => true, 1);
        saida[nome][loja] = ex[0] && typeof ex[0] === 'object' ? Object.keys(ex[0]).slice(0, 40) : typeof ex[0];
      }
      if (Array.from(db.objectStoreNames).includes('message')) {
        const lig = await todos(db, 'message', ehMensagemDeLigacao, 3);
        saida[nome]['message(call_log)'] = lig.map((m) => Object.keys(m).slice(0, 60));
      }
      db.close();
    }
    return saida;
  }

  globalThis.LeitorLigacoes = { lerDoDia, diagnostico, deMensagem, deRegistro, resultado };
})();
