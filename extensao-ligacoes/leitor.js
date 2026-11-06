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
      r.onsuccess = () => {
        const db = r.result;
        // Se o próprio WhatsApp Web precisar atualizar o banco (ou sair da conta), solta na hora.
        db.onversionchange = () => db.close();
        ok(db);
      };
      r.onerror = () => falha(r.error);
    });
  }

  // Percorre a loja; com um índice de horário ("t"), lê só a partir do começo do dia.
  function todos(db, loja, filtro, limite, desdeT) {
    return new Promise((ok, falha) => {
      const saida = [];
      const tx = db.transaction(loja, 'readonly');
      const os = tx.objectStore(loja);
      const indice = desdeT != null ? Array.from(os.indexNames).find((n) => { try { return os.index(n).keyPath === 't'; } catch { return false; } }) : null;
      const req = indice ? os.index(indice).openCursor(IDBKeyRange.lowerBound(desdeT), 'prev') : os.openCursor(null, 'prev');
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
    if (/connect|accept|answer|atend|complet/.test(s)) return 'atendida';
    if (/reject|declin|recus|busy/.test(s)) return 'recusada';
    if (/miss|unanswer|no.?answer|timeout|perd|cancel/.test(s)) return 'nao_atendida';
    return 'desconhecido';
  }

  // Formato A: mensagem "call_log" da conversa (conferido no 174 em 06/11/2026). No WhatsApp Web o id é um texto
  // "true_<chat>_<id>" (true = nós ligamos) ou "false_<chat>_<id>"; "from" e "to" dizem quem ligou para quem;
  // callCreator traz o aparelho que fez a ligação ("<número>:<aparelho>@lid"; sem ":", o celular principal);
  // finalCallOutcome: Completed, AcceptedElsewhere (atendida em outro aparelho), Missed, Rejected.
  function partesDoId(id) {
    if (typeof id === 'string') {
      const m = id.match(/^(true|false)_([^_]+)_(.+)$/);
      if (m) return { nossa: m[1] === 'true', remoto: m[2], msgId: m[3] };
      return { nossa: null, remoto: null, msgId: id };
    }
    if (id && typeof id === 'object') return { nossa: !!id.fromMe, remoto: jidDe(id.remote), msgId: id.id || null };
    return { nossa: null, remoto: null, msgId: null };
  }
  const aparelhoDe = (jid) => { const s = jidDe(jid); const m = s && s.match(/^\d+:(\d+)@/); return m ? m[1] : (s ? '0' : null); };

  function deMensagem(m, meuAparelho) {
    const t = numero(m.t);
    const p = partesDoId(m.id);
    const nossa = p.nossa ?? !!m.fromMe;
    const chat = p.remoto || jidDe(nossa ? m.to : m.from);
    const dur = numero(m.callDuration ?? m.duration);
    let res = resultado(m.finalCallOutcome || m.callOutcome || m.subtype);
    if (res === 'desconhecido' && Number.isFinite(dur)) res = dur > 0 ? 'atendida' : 'nao_atendida';
    const criador = aparelhoDe(m.callCreator);
    return {
      // "w-" + id da mensagem: chave nova da versão 0.2.0 (a 0.1.0 usava o id inteiro e foi anulada).
      chave: ('w-' + String(p.msgId || '')).slice(0, 120),
      chat, direcao: nossa ? 'feita' : 'recebida', resultado: res,
      duracao_seg: Number.isFinite(dur) ? Math.round(dur) : null,
      video: !!(m.isVideoCall ?? m.isVideo), iniciada_em: new Date(t * 1000).toISOString(),
      // Ligação feita: deste computador (true), de outro aparelho do mesmo número (false) ou sem como saber (null).
      deste_computador: nossa && criador != null && meuAparelho != null ? criador === meuAparelho : null,
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
  const valida = (x) => x.chave && x.chave !== 'w-' && x.chat && !/@g\.us$|status@broadcast/.test(x.chat);

  async function lerDoDia(inicioMs, meuAparelho) {
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
          const msgs = await todos(db, 'message', (m) => ehMensagemDeLigacao(m) && numero(m.t) >= limiteT, 2000, limiteT);
          // A mesma ligação pode estar nos dois formatos com chaves diferentes: vale o registro da aba Ligações
          // (mesmo número e direção até 2 minutos de diferença).
          const doRegistro = Array.from(achadas.values());
          const repetida = (x) => doRegistro.some((y) => y.chat === x.chat && y.direcao === x.direcao
            && Math.abs(Date.parse(y.iniciada_em) - Date.parse(x.iniciada_em)) <= 120000);
          msgs.map((m) => deMensagem(m, meuAparelho)).filter(valida).filter(ehDoDia(inicioMs)).filter((x) => !repetida(x))
            .forEach((x) => { if (!achadas.has(x.chave)) achadas.set(x.chave, x); });
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
      try {
        for (const loja of Array.from(db.objectStoreNames)) {
          const ex = await todos(db, loja, () => true, 1);
          const indices = Array.from(db.transaction(loja, 'readonly').objectStore(loja).indexNames);
          saida[nome][loja] = { campos: ex[0] && typeof ex[0] === 'object' ? Object.keys(ex[0]).slice(0, 40) : typeof ex[0], indices };
        }
        if (Array.from(db.objectStoreNames).includes('message')) {
          const lig = await todos(db, 'message', ehMensagemDeLigacao, 3);
          saida[nome]['message(call_log)'] = lig.map((m) => Object.keys(m).slice(0, 60));
        }
      } catch (e) {
        saida[nome].erro = String(e && e.message || e);
      } finally {
        db.close();
      }
    }
    return saida;
  }

  globalThis.LeitorLigacoes = { lerDoDia, diagnostico, deMensagem, deRegistro, resultado, partesDoId, aparelhoDe };
})();
