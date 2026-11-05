// PDF do relatório de cobrança, no mesmo modelo do PDF que ia no e-mail das 17h (gerador_resumo v8.5/v8.6 do Painel das
// Automações, feito em reportlab): uma página A4 com a Cobrança de Hoje e a parte do Omie (Carteira do ano, Mês vigente,
// Faturado e Entrou no mês). Aqui é montado no navegador com o jsPDF; as medidas são as mesmas, em mm a partir do topo.
// Pedido do Marcus (05/11/2026): baixar pela aba Omie, sempre com os números do dia, calculados na hora do clique.

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Cores do modelo (paleta da Castelo Branco).
const C = {
  PG: '#F3F1EB', CARD: '#FFFFFF', TX: '#1F2D3D', TX2: '#586A7C', BRD: '#E3DFD3', TRACK: '#ECE8DE',
  NAVY: '#00204D', GOLD: '#D2AD73', GOLDL: '#C89F50', HMUT: '#AEBFD8', CREME: '#F7F5F0',
  OK: '#0F7B58', WARN: '#9A6A00', BADM: '#E5735E', NEU: '#C9CFD6', INF: '#2B5FB4', NUM: '#00204D',
};

export function brl(n) {
  const v = Number(n || 0);
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const inteiro = (n) => Number(n || 0).toLocaleString('pt-BR');
const pct = (n, t) => (t ? `${Math.round((n / t) * 100)}%` : '0%');
const plural = (n, um, varios) => (n === 1 ? um : varios);
const tit = (n, um, varios) => `${inteiro(n)} ${n === 1 ? um : varios}`;
const ddmm = (s, padrao) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : padrao);
const ddmmaa = (s, padrao) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : padrao);
export function duracao(m) {
  if (m == null || Number.isNaN(m)) return null;
  const x = Math.round(m);
  return x < 60 ? `${x} min` : `${Math.floor(x / 60)} h ${String(x % 60).padStart(2, '0')} min`;
}

// Situação de cada cliente nos grupos do PDF (mesma regra do gerador: pagou e prometeu juntos; só boleto fica em "outras").
const GRUPO = { pagou: 'pag', pagou_parcial: 'pag', disse_que_pagou: 'conf', prometeu: 'prom', respondeu_sem_pagar: 'semp', sem_retorno: 'nao', so_boleto: 'bol' };
export function contar(resumo, clientes) {
  const b = { pag: 0, conf: 0, prom: 0, semp: 0, nao: 0, bol: 0 };
  for (const c of clientes || []) b[GRUPO[c.status] || 'semp'] += 1;
  const com = resumo.com_interacao || 0;
  const sem = resumo.sem_interacao || 0;
  const sp = Math.max(b.semp, com - b.pag - b.conf - b.prom);
  const nr = Math.max(b.nao, sem - b.bol);
  const pp = b.pag + b.conf + b.prom;
  return { sp, nr, pp, outros: Math.max(0, (resumo.conversas || 0) - sp - nr - pp) };
}

// Monta os dados do PDF a partir da Cobrança do dia do sistema (painel_dia) e dos totais do Omie calculados agora.
export function dadosDoDia(dia, financeiro, agora = new Date()) {
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(agora);
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(agora);
  const r = dia?.resumo || {};
  const lig = r.ligacoes || {};
  const clientes = (dia?.clientes || []).map((c) => ({ status: c.situacao }));
  // Tempo médio de conversa: por cliente, da primeira à última mensagem de hoje.
  const min = (hhmm) => { const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const duracoes = (dia?.clientes || []).map((c) => (min(c.ultima) != null && min(c.primeira) != null ? min(c.ultima) - min(c.primeira) : null)).filter((x) => x != null && x >= 0);
  return {
    data: dia?.dia || financeiro?.data,
    periodo: `00:00 a ${hora}`,
    gerado_em: `${data} às ${hora}`,
    resumo: {
      conversas: r.cobrados || 0,
      com_interacao: r.responderam || 0,
      sem_interacao: r.sem_resposta || 0,
      lig_atendidas: lig.atendidas || 0,
      lig_nao_atendidas: lig.nao_atendidas || 0,
      // Só o aviso da Evolution não garante a contagem (ela não avisa todas as ligações): o número sai com "+".
      lig_completo: lig.fonte !== 'evolution',
      finalizacao_min: duracoes.length ? duracoes.reduce((s, x) => s + x, 0) / duracoes.length : null,
    },
    clientes,
    financeiro: financeiro || {},
  };
}

export const nomeDoArquivo = (iso) => `RelatorioCobranca-${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}.pdf`;

export async function gerarPdf(d, { leaoPng, quem } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: 'Relatório de Cobrança', author: 'Castelo Branco Contabilidade', creator: 'Contas a Receber' });
  const r = d.resumo || {};
  const f = d.financeiro || {};
  const [ano, mesN, diaN] = String(d.data).split('-').map(Number);
  const dt = new Date(Date.UTC(ano, mesN - 1, diaN));
  const dataLonga = `${DIAS[dt.getUTCDay()].charAt(0).toUpperCase()}${DIAS[dt.getUTCDay()].slice(1)}, ${diaN} de ${MESES[mesN - 1]}`;

  const fonte = (estilo, tam) => { doc.setFont('helvetica', estilo === 'b' ? 'bold' : 'normal'); doc.setFontSize(tam); };
  const largura = (t, estilo, tam) => { fonte(estilo, tam); return doc.getTextWidth(t); };
  // Reduz a letra até o texto caber (como o fit do gerador).
  const fit = (t, estilo, tam, maxw, mn = 6.5) => { let s = tam; while (largura(t, estilo, s) > maxw && s > mn) s -= 0.1; return s; };
  const T = (x, yt, t, estilo = 'n', tam = 10, cor = C.TX, al = 'left') => { fonte(estilo, tam); doc.setTextColor(cor); doc.text(String(t), x, yt, { align: al, baseline: 'alphabetic' }); };
  const R = (x, yt, w, h, cor, rad = 3, borda = null) => {
    doc.setFillColor(cor);
    if (borda) { doc.setDrawColor(borda); doc.setLineWidth(0.21); }
    doc.roundedRect(x, yt, w, h, rad, rad, borda ? 'FD' : 'F');
  };
  const card = (x, yt, w, h) => R(x, yt, w, h, C.CARD, 3.2, C.BRD);
  const pilha = (x, yt, w, h, partes) => {
    R(x, yt, w, h, C.TRACK, h / 2);
    const tot = partes.reduce((s, [v]) => s + v, 0);
    if (!tot) return;
    const gap = 0.6;
    const vis = partes.filter(([v]) => v > 0);
    const livre = w - gap * (vis.length - 1);
    let cx = x;
    for (const [v, cor] of vis) { const ww = Math.max(h, (livre * v) / tot); R(cx, yt, ww, h, cor, h / 2); cx += ww + gap; }
  };
  const marca = (x, yt, cor) => R(x, yt - 2.3, 2.6, 2.6, cor, 0.6);
  const linha = (x, yt, w, cor, rot, n, p) => {
    marca(x, yt, cor);
    T(x + 11, yt, String(n), 'b', 8.6, C.TX, 'right');
    const wp = largura(p, 'n', 8.6);
    T(x + 13, yt, rot, 'n', fit(rot, 'n', 8.6, w - 13 - wp - 2.5), C.TX);
    T(x + w, yt, p, 'n', 8.6, C.TX2, 'right');
  };
  const secao = (yt, t, nota = '') => {
    const wn = nota ? largura(nota, 'n', 8.4) : 0;
    const sz = fit(t, 'b', 11.5, 182 - 3.6 - wn - 6, 9.5);
    R(14, yt - 3.6, 1.3, 4.6, C.GOLDL, 0.5);
    T(17.6, yt, t, 'b', sz, C.NAVY);
    if (nota) T(196, yt, nota, 'n', 8.4, C.TX2, 'right');
  };

  // Fundo e cabeçalho azul-marinho com o leão.
  doc.setFillColor(C.PG); doc.rect(0, 0, 210, 297, 'F');
  doc.setFillColor(C.NAVY); doc.rect(0, 0, 210, 38, 'F');
  doc.setFillColor(C.GOLD); doc.rect(0, 37.2, 210, 0.8, 'F');
  if (leaoPng) doc.addImage(leaoPng, 'PNG', 14, 8, 23 * (277 / 320), 23);
  T(42, 12.5, 'Castelo Branco Contabilidade · Contas a Receber', 'b', 8.6, C.GOLD);
  T(42, 23.5, 'Cobrança do Dia', 'b', 25, C.CREME);
  const [pIni, pFim] = String(d.periodo || '00:00 a 00:00').split(' a ');
  T(42, 30.5, `${dataLonga}, das ${pIni} às ${pFim}`, 'n', 9.5, C.HMUT);

  // 1. Cobrança de Hoje
  secao(49, 'Cobrança de Hoje', 'Pelo WhatsApp do financeiro');
  const y = 53; const gap = 4; const h1 = 64;
  const ws = [74, 56, 44]; const xs = [14, 14 + 74 + gap, 14 + 74 + 56 + 2 * gap];
  xs.forEach((x, i) => card(x, y, ws[i], h1));
  const conv = r.conversas || 0;
  const la = r.lig_atendidas || 0; const ln = r.lig_nao_atendidas || 0; const lt = la + ln;
  const { sp, nr, pp, outros } = contar(r, d.clientes);
  let x = xs[0]; let w = ws[0];
  T(x + 6, y + 9, plural(conv, 'Cliente Cobrado', 'Clientes Cobrados'), 'b', 9.6, C.TX);
  T(x + 6, y + 24, String(conv), 'b', 30, C.NUM);
  pilha(x + 6, y + 30, w - 12, 3.4, [[nr, C.BADM], [sp, C.WARN], [pp, C.OK], [outros, C.NEU]]);
  linha(x + 6, y + 41.5, w - 12, C.BADM, plural(nr, 'Não respondeu', 'Não responderam'), nr, pct(nr, conv));
  linha(x + 6, y + 47, w - 12, C.WARN, plural(sp, 'Respondeu, sem pagamento', 'Responderam, sem pagamento'), sp, pct(sp, conv));
  linha(x + 6, y + 52.5, w - 12, C.OK, 'Pagaram ou prometeram', pp, pct(pp, conv));
  linha(x + 6, y + 58, w - 12, C.NEU, 'Outras respostas', outros, pct(outros, conv));
  x = xs[1]; w = ws[1];
  const lc = r.lig_completo !== false;
  T(x + 6, y + 9, plural(lt, 'Ligação Feita', 'Ligações Feitas'), 'b', 9.6, C.TX);
  T(x + 6, y + 24, lc ? String(lt) : `+${lt}`, 'b', 30, C.NUM);
  pilha(x + 6, y + 30, w - 12, 3.4, [[la, C.OK], [ln, C.BADM]]);
  linha(x + 6, y + 43, w - 12, C.OK, plural(la, 'Atendida', 'Atendidas'), la, pct(la, lt));
  linha(x + 6, y + 50, w - 12, C.BADM, plural(ln, 'Não atendida', 'Não atendidas'), ln, pct(ln, lt));
  if (!lc) T(x + 6, y + 57, 'Contagem incompleta hoje', 'n', 8.4, C.TX2);
  x = xs[2]; w = ws[2];
  const tm = duracao(r.finalizacao_min);
  T(x + 6, y + 9, 'Tempo Médio', 'b', 9.6, C.TX); T(x + 6, y + 13.4, 'de Conversa', 'b', 9.6, C.TX);
  T(x + 6, y + 28, tm || '—', 'b', fit(tm || '—', 'b', 26, w - 12, 14), tm ? C.NUM : C.TX2);
  fonte('n', 8.6);
  doc.splitTextToSize(tm ? 'Por cliente, da primeira à última mensagem de hoje.' : 'Não calculado hoje.', w - 12)
    .forEach((tt, j) => T(x + 6, y + 42 + j * 4.6, tt, 'n', 8.6, C.TX2));

  // 2. Carteira do ano, 3. Mês vigente, 4. Faturado e 5. Entrou no mês (Omie).
  const posOmie = () => {
    const m = String(f.atualizado || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return 'Fonte: Omie';
    const local = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      .format(new Date(f.atualizado)).replace(',', ' às');
    return `Fonte: Omie, ${local}`;
  };
  const cartoes = (yy, itens, h = 36) => {
    const k = itens.length; const wc = (182 - gap * (k - 1)) / k;
    itens.forEach(([tt, v, cor, a1, a2], i) => {
      const xx = 14 + i * (wc + gap); card(xx, yy, wc, h);
      marca(xx + 6, yy + 9, cor); T(xx + 10.2, yy + 9, tt, 'b', 9.6, C.TX);
      if (v == null) { T(xx + 6, yy + 21.5, 'Ainda não informado', 'b', 12, C.TX2); return; }
      T(xx + 6, yy + 21.5, brl(v), 'b', fit(brl(v), 'b', 21, wc - 12, 14), C.NUM);
      T(xx + 6, yy + 27.8, a1, 'b', fit(a1, 'b', 8.2, wc - 12, 6.8), C.TX);
      T(xx + 6, yy + 32.6, a2, 'n', fit(a2, 'n', 8.2, wc - 12, 6.8), C.TX2);
    });
  };
  const ini = ddmm(f.inicio, '01/01'); const fim = ddmm(f.totais_ate, `${String(diaN).padStart(2, '0')}/${String(mesN).padStart(2, '0')}`);
  const inia = ddmmaa(f.inicio, `01/01/${ano}`); const fima = ddmmaa(f.totais_ate, ddmmaa(d.data, ''));
  const inim = ddmm(f.inicio_mes, `01/${String(mesN).padStart(2, '0')}`); const inima = ddmmaa(f.inicio_mes, `01/${String(mesN).padStart(2, '0')}/${ano}`);
  const fimm = ddmm(f.fim_mes, fim); const fimma = ddmmaa(f.fim_mes, fima);
  const mesNome = MESES[mesN - 1].charAt(0).toUpperCase() + MESES[mesN - 1].slice(1);

  secao(130, `Carteira de ${ano}: vencimentos de ${inia} a ${fima}`, posOmie());
  const nt = f.titulos; const ni = f.titulos_inadimplentes;
  cartoes(134, [
    ['Valor Recebido', f.recebido_total, C.OK, nt != null ? `Já pago dos ${tit(nt, 'título', 'títulos')} do período` : 'Já pago dos títulos do período', `Honorários com vencimento de ${ini} a ${fim}`],
    ['Inadimplência', f.inadimplencia_total, C.BADM, ni != null ? `${tit(ni, 'título em aberto', 'títulos em aberto')}, vencidos até ${fim}` : 'Em aberto, previsão até hoje', `Honorários atrasados, desde ${ini}`],
  ]);
  if (f.inicio_mes) {
    secao(183, `Mês vigente: vencimentos de ${inima} a ${fimma}`, posOmie());
    const ntm = f.titulos_mes; const nim = f.titulos_inadimplentes_mes; const na = f.titulos_a_vencer_mes;
    cartoes(187, [
      ['Valor Recebido', f.recebido_mes, C.OK, ntm != null ? `Já pago de ${tit(ntm, 'título', 'títulos')} do mês` : 'Já pago dos títulos do mês', `Vencimentos de ${inim} a ${fimm}`],
      ['Inadimplência', f.inadimplencia_mes, C.BADM, nim != null ? `${tit(nim, 'título vencido', 'títulos vencidos')} em aberto` : 'Vencidos e em aberto', `Vencidos de ${inim} até ${fim}`],
      ['A Vencer', f.a_vencer_mes, C.INF, na != null ? tit(na, 'título em aberto', 'títulos em aberto') : 'Em aberto', `Vencimentos de ${fim} a ${fimm}`],
    ]);
  }
  if (f.faturado_mes != null) {
    const yf = 227; const hf = 25; card(14, yf, 182, hf);
    const cl = 14 + (182 * 0.42) / 2 + 2; const cr = 105 + (182 * 0.58) / 2 - 17;
    const tf = `Faturado de Honorários em ${mesNome}`;
    const wt = largura(tf, 'b', 9.6); const x0 = cl - (4.2 + wt) / 2;
    marca(x0, yf + 9, C.GOLDL); T(x0 + 4.2, yf + 9, tf, 'b', 9.6, C.TX);
    const vf = brl(f.faturado_mes);
    T(cl, yf + 19.5, vf, 'b', fit(vf, 'b', 23, 72, 14), C.NUM, 'center');
    R(14 + 182 * 0.42 + 2, yf + 6, 0.35, hf - 12, C.BRD, 0);
    const nf = f.titulos_faturado_mes;
    const t1 = nf != null ? `Soma dos ${tit(nf, 'título', 'títulos')} do mês, pagos e em aberto` : 'Soma dos títulos do mês, pagos e em aberto';
    const t2 = `Honorários com vencimento de ${inim} a ${fimm}`;
    T(cr, yf + hf / 2 - 1.3, t1, 'b', fit(t1, 'b', 8.6, 92, 7), C.TX, 'center');
    T(cr, yf + hf / 2 + 4.7, t2, 'n', fit(t2, 'n', 8.6, 92, 7), C.TX2, 'center');
  }
  if (f.recebido_no_mes != null) {
    const ye = 256; const he = 19; card(14, ye, 182, he);
    marca(20, ye + 8.4, C.GOLDL); T(24.2, ye + 8.4, `Entrou em ${mesNome}`, 'b', 9.6, C.TX);
    const ne = f.titulos_recebidos_no_mes;
    const se = `${ne != null ? `${tit(ne, 'recebimento', 'recebimentos')} de Honorários, de qualquer vencimento, de ` : 'Recebimentos de Honorários, de qualquer vencimento, de '}${inim} até ${fim}`;
    T(20, ye + 14.2, se, 'n', fit(se, 'n', 8.2, 110, 6.8), C.TX2);
    const ve = brl(f.recebido_no_mes);
    T(190, ye + 12.6, ve, 'b', fit(ve, 'b', 20, 58, 14), C.NUM, 'right');
  }
  T(14, 284, 'Cobrança de hoje pelo sistema Contas a Receber; números do Omie calculados na hora do download.', 'n', 7.8, C.TX2);
  T(14, 289, `Gerado em ${d.gerado_em}${quem ? `, por ${quem}` : ''}`, 'n', 7.4, C.TX2);
  T(196, 289, 'Relatório do sistema Contas a Receber', 'n', 7.4, C.TX2, 'right');
  return doc;
}
