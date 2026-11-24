// Contas da aba Adicional Anual (24/11/2026, pedido do Marcus). As regras das metas são as do protótipo, aprovadas por ele:
//  - Novembro: receber 100% da 1ª parcela (vencimento 10/11) até 30/11.
//  - Dezembro: receber a 2ª parcela (vencimento 10/12) e o que sobrou da 1ª até 31/12.
//  - Meta do dia: saldo em aberto no começo do dia ÷ dias úteis que faltam até o prazo, contando o próprio dia. Se um dia
//    fica abaixo, a meta dos dias seguintes sobe. Pagamento em fim de semana ou feriado conta no dia útil seguinte.
// Ficam fora das metas e da lista: títulos cancelados e os clientes que não recebem o adicional (marcados pelo servidor).
// As metas usam o valor da parcela (sem juros e multa); o "recebido" é o do Omie (coluna "Pago ou Recebido").
import { FERIADOS, diaSemana, somarDias } from './formato.js';

export const P1 = { inicio: '2026-11-10', prazo: '2026-11-30' };
export const P2 = { inicio: '2026-12-10', prazo: '2026-12-31' };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const soma = (lista, f) => r2(lista.reduce((s, x) => s + (Number(f(x)) || 0), 0));

export function diasUteis(de, ate) {
  const out = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) if (![0, 6].includes(diaSemana(d)) && !FERIADOS.has(d)) out.push(d);
  return out;
}

export const valido = (t) => !t.cancelado && !t.excluido;

// Situação de cada parcela: previsto, recebido (Omie), quitado (parcela), em aberto e contagens.
export function resumoParcelas(titulos) {
  return [1, 2].map((p) => {
    const todos = titulos.filter((t) => t.parcela === p);
    const ok = todos.filter(valido);
    const previsto = soma(ok, (t) => t.valor);
    const quitado = soma(ok, (t) => t.quitado);
    return {
      parcela: p,
      previsto,
      recebido: soma(ok, (t) => t.recebido),
      quitado,
      aberto: soma(ok, (t) => t.aberto),
      juros_multa: soma(ok, (t) => t.juros_multa),
      pct: previsto ? quitado / previsto : 0,
      titulos: ok.length,
      pagos: ok.filter((t) => t.aberto <= 0.004).length,
      em_aberto: ok.filter((t) => t.aberto > 0.004).length,
      cancelados: todos.filter((t) => t.cancelado).length,
      excluidos: todos.filter((t) => !t.cancelado && t.excluido).length,
    };
  });
}

// Dia útil em que um pagamento conta (fim de semana e feriado vão para o dia útil seguinte).
function diaQueConta(d, uteis) {
  return uteis.find((u) => u >= d) || null;
}

// Meta e quitado de cada dia útil de 10/11 a 31/12.
export function diaADia(titulos, hoje) {
  const uteis = diasUteis(P1.inicio, P2.prazo);
  const ok = titulos.filter(valido);
  const prev = { 1: soma(ok.filter((t) => t.parcela === 1), (t) => t.valor), 2: soma(ok.filter((t) => t.parcela === 2), (t) => t.valor) };
  const acum = { 1: 0, 2: 0 };
  const porDia = {};
  for (const t of ok) {
    for (const p of t.pagamentos || []) {
      if (!p.dia) continue;
      if (p.dia < uteis[0]) { acum[t.parcela] += p.parcela; continue; }
      const d = diaQueConta(p.dia, uteis);
      if (!d) continue;
      porDia[d] = porDia[d] || { 1: 0, 2: 0, recebido: 0 };
      porDia[d][t.parcela] += p.parcela;
      porDia[d].recebido += p.valor;
    }
  }
  const restam = (d, fim) => uteis.filter((x) => x >= d && x <= fim).length;
  return uteis.map((d) => {
    const s1 = Math.max(0, prev[1] - acum[1]);
    const s2 = Math.max(0, prev[2] - acum[2]);
    let meta = d <= P1.prazo ? s1 / restam(d, P1.prazo) : s1 / restam(d, P2.prazo);
    if (d >= P2.inicio) meta += s2 / restam(d, P2.prazo);
    const r = porDia[d] || { 1: 0, 2: 0, recebido: 0 };
    acum[1] += r[1]; acum[2] += r[2];
    return {
      dia: d,
      meta: r2(meta),
      quitado_1: r2(r[1]),
      quitado_2: r2(r[2]),
      quitado: r2(r[1] + r[2]),
      recebido: r2(r.recebido),
      saldo_inicio: r2(s1 + (d >= P2.inicio ? s2 : 0)),
      momento: d < hoje ? 'passado' : d === hoje ? 'hoje' : 'futuro',
    };
  });
}

// O dia de hoje (ou o próximo dia útil) com o prazo, quanto falta e os dias úteis que restam.
export function metaDeHoje(dias, hoje) {
  const dia = dias.find((d) => d.dia >= hoje) || null;
  if (!dia) return null;
  const prazo = dia.dia <= P1.prazo ? P1.prazo : P2.prazo;
  return {
    ...dia,
    eh_hoje: dia.dia === hoje,
    prazo,
    falta: r2(Math.max(0, dia.meta - dia.quitado)),
    pct: dia.meta ? dia.quitado / dia.meta : 0,
    saldo: r2(Math.max(0, dia.saldo_inicio - dia.quitado)),
    dias_restantes: dias.filter((d) => d.dia >= dia.dia && d.dia <= prazo).length,
  };
}

// Metas de novembro e dezembro.
export function metasDoMes(titulos) {
  const ok = titulos.filter(valido);
  const prev = { 1: soma(ok.filter((t) => t.parcela === 1), (t) => t.valor), 2: soma(ok.filter((t) => t.parcela === 2), (t) => t.valor) };
  let p1Nov = 0, p1Dez = 0, p2 = 0;
  for (const t of ok) {
    for (const p of t.pagamentos || []) {
      if (!p.dia) continue;
      if (t.parcela === 1) { if (p.dia <= P1.prazo) p1Nov += p.parcela; else if (p.dia <= P2.prazo) p1Dez += p.parcela; } else if (p.dia <= P2.prazo) p2 += p.parcela;
    }
  }
  const linha = (mes, meta, quitado, prazo) => ({ mes, prazo, meta: r2(meta), quitado: r2(quitado), falta: r2(Math.max(0, meta - quitado)), pct: meta ? quitado / meta : 0 });
  const sobra = Math.max(0, prev[1] - p1Nov);
  return [linha('Novembro', prev[1], p1Nov, P1.prazo), linha('Dezembro', prev[2] + sobra, p2 + p1Dez, P2.prazo)];
}

// Situação de pagamento do cliente nas duas parcelas (pedido do Marcus, 24/11/2026, 11h46: "se não pagou, se pagou só a
// primeira parcela, ou se pagou as duas"). Parcela paga = nada em aberto; com algo quitado e saldo em aberto = paga em parte.
// Cliente com uma parcela só (a outra cancelada) que pagou a que tem fica como "Pagou tudo".
export const PAGAMENTOS = [
  { id: 'nenhuma', nome: 'Não pagou', plural: 'Não pagaram', cor: 'cor-vermelho' },
  { id: 'parte', nome: 'Pagou uma parte', plural: 'Pagaram uma parte', cor: 'cor-amarelo' },
  { id: 'primeira', nome: 'Pagou só a 1ª', plural: 'Pagaram só a 1ª', cor: 'cor-azul' },
  { id: 'segunda', nome: 'Pagou só a 2ª', plural: 'Pagaram só a 2ª', cor: 'cor-azul' },
  { id: 'duas', nome: 'Pagou as duas', plural: 'Pagaram as duas', cor: 'cor-verde' },
  { id: 'tudo', nome: 'Pagou tudo', plural: 'Pagaram tudo', cor: 'cor-verde' },
];
export const NOME_PAGAMENTO = Object.fromEntries(PAGAMENTOS.map((x) => [x.id, x]));

const estadoParcela = (t) => (!t ? null : t.aberto <= 0.004 ? 'paga' : t.quitado > 0.004 ? 'parte' : 'aberta');
export function situacaoPagamento(p1, p2) {
  const a = estadoParcela(p1), b = estadoParcela(p2);
  if (a && b) {
    if (a === 'paga' && b === 'paga') return 'duas';
    if (a === 'paga' && b === 'aberta') return 'primeira';
    if (a === 'aberta' && b === 'paga') return 'segunda';
    if (a === 'aberta' && b === 'aberta') return 'nenhuma';
    return 'parte';
  }
  const x = a || b;
  return x === 'paga' ? 'tudo' : x === 'parte' ? 'parte' : 'nenhuma';
}

// Um cliente do Omie por linha (todos os da campanha, inclusive quem já pagou tudo), com a situação de pagamento, o que
// deve do adicional, o WhatsApp ligado a ele e a anotação manual.
export function clientesDoAdicional(dados, hoje) {
  const g = new Map();
  for (const t of (dados.titulos || []).filter(valido)) {
    const c = g.get(t.cliente) || { cliente: t.cliente, p: {}, aberto: 0, vencido: 0, quitado: 0, recebido: 0, venc_mais_antigo: null, obs: new Set(), ultimo_pagamento: null };
    // Dois títulos da mesma parcela para o mesmo cliente (raro): soma, e a parcela só fica paga se os dois estiverem pagos.
    const atual = c.p[t.parcela] || { valor: 0, aberto: 0, quitado: 0, recebido: 0, vencimento: t.vencimento, pagamentos: [] };
    atual.valor += t.valor;
    atual.aberto += t.aberto;
    atual.quitado += t.quitado;
    atual.recebido += t.recebido;
    if (t.vencimento && (!atual.vencimento || t.vencimento < atual.vencimento)) atual.vencimento = t.vencimento;
    atual.pagamentos.push(...(t.pagamentos || []));
    c.p[t.parcela] = atual;
    c.aberto += t.aberto;
    c.quitado += t.quitado;
    c.recebido += t.recebido;
    if (t.aberto > 0.004 && t.vencimento && t.vencimento < hoje) {
      c.vencido += t.aberto;
      if (!c.venc_mais_antigo || t.vencimento < c.venc_mais_antigo) c.venc_mais_antigo = t.vencimento;
    }
    for (const pg of t.pagamentos || []) if (pg.dia && (!c.ultimo_pagamento || pg.dia > c.ultimo_pagamento)) c.ultimo_pagamento = pg.dia;
    if (t.obs) c.obs.add(t.obs);
    g.set(t.cliente, c);
  }
  const cad = dados.clientes || {};
  const wpp = dados.whatsapp?.clientes || {};
  const notas = dados.whatsapp?.anotacoes || {};
  return [...g.values()].map((c) => {
    const contatos = wpp[String(c.cliente)] || [];
    // O número com a situação mais recente representa o cliente; os outros ficam como "mais N números".
    const principal = [...contatos].sort((a, b) => String(b.situacao_dia || '').localeCompare(String(a.situacao_dia || '')) || String(b.boleto_em || '').localeCompare(String(a.boleto_em || '')))[0] || null;
    const dias = c.venc_mais_antigo ? Math.round((Date.parse(hoje) - Date.parse(c.venc_mais_antigo)) / 864e5) : 0;
    const emAberto = [1, 2].filter((n) => c.p[n] && c.p[n].aberto > 0.004);
    return {
      cliente: c.cliente,
      nome: cad[String(c.cliente)]?.nome || (principal?.nome) || `Cliente ${c.cliente}`,
      telefone: cad[String(c.cliente)]?.telefone || null,
      pagamento: situacaoPagamento(c.p[1], c.p[2]),
      aberto: r2(c.aberto),
      vencido: r2(c.vencido),
      quitado: r2(c.quitado),
      recebido: r2(c.recebido),
      ultimo_pagamento: c.ultimo_pagamento,
      dias_atraso: dias,
      parcelas: emAberto,
      obs: [...c.obs],
      contato: principal,
      outros_numeros: Math.max(0, contatos.length - 1),
      anotacao: notas[String(c.cliente)] || null,
      // Detalhe de cada parcela para o resumo do cliente (pedido do Marcus, 24/11/2026, 11h55).
      detalhe: [1, 2].filter((n) => c.p[n]).map((n) => {
        const x = c.p[n];
        const pags = [...x.pagamentos].filter((pg) => pg.dia).sort((a, b) => a.dia.localeCompare(b.dia));
        return {
          parcela: n, valor: r2(x.valor), aberto: r2(x.aberto), quitado: r2(x.quitado), recebido: r2(x.recebido), vencimento: x.vencimento,
          estado: x.aberto <= 0.004 ? 'paga' : x.quitado > 0.004 ? 'parte' : (x.vencimento && x.vencimento < hoje ? 'vencida' : 'a_vencer'),
          dias_atraso: x.aberto > 0.004 && x.vencimento && x.vencimento < hoje ? Math.round((Date.parse(hoje) - Date.parse(x.vencimento)) / 864e5) : 0,
          pagamentos: pags.map((pg) => ({ dia: pg.dia, valor: pg.valor, forma: [pg.forma, pg.banco].filter(Boolean).join(', ') })),
        };
      }),
      contatos_qtd: contatos.length,
    };
  }).sort((a, b) => b.vencido - a.vencido || b.aberto - a.aberto || a.nome.localeCompare(b.nome));
}

const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const real = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Uma frase por parcela, para o resumo do cliente: "1ª parcela (R$ 135,08, venc. 10/11): paga em 12/11." etc.
export function fraseParcela(d) {
  const cab = `${d.parcela}ª parcela (${real(d.valor)}, vencimento ${dm(d.vencimento)})`;
  const ultimo = d.pagamentos.length ? d.pagamentos[d.pagamentos.length - 1].dia : null;
  if (d.estado === 'paga') return `${cab}: paga${ultimo ? ` em ${dm(ultimo)}` : ''}${d.recebido - d.quitado > 0.004 ? `, ${real(d.recebido)} com juros e multa` : ''}.`;
  if (d.estado === 'parte') return `${cab}: pagou ${real(d.quitado)}${ultimo ? ` (último pagamento em ${dm(ultimo)})` : ''}, faltam ${real(d.aberto)}${d.dias_atraso ? `, vencida há ${d.dias_atraso} ${d.dias_atraso === 1 ? 'dia' : 'dias'}` : ''}.`;
  if (d.estado === 'vencida') return `${cab}: não paga, vencida há ${d.dias_atraso} ${d.dias_atraso === 1 ? 'dia' : 'dias'}.`;
  return `${cab}: ainda não venceu.`;
}

// Quem ainda deve alguma coisa do adicional.
export const clientesEmAberto = (dados, hoje) => clientesDoAdicional(dados, hoje).filter((c) => c.aberto > 0.004);

// Histórico do que já foi pago do adicional: um pagamento por linha, do mais novo para o mais antigo.
export function historicoPagamentos(dados) {
  const cad = dados.clientes || {};
  const linhas = [];
  for (const t of (dados.titulos || []).filter((x) => !x.cancelado)) {
    for (const p of t.pagamentos || []) {
      linhas.push({
        dia: p.dia, cliente: t.cliente, nome: cad[String(t.cliente)]?.nome || `Cliente ${t.cliente}`,
        parcela: t.parcela, valor: p.valor, quitou: p.parcela, forma: p.forma || '', banco: p.banco || '', titulo: t.titulo, excluido: !!t.excluido,
      });
    }
  }
  return linhas.sort((a, b) => b.dia.localeCompare(a.dia) || b.valor - a.valor || a.nome.localeCompare(b.nome));
}

// Quem ficou de fora (para o aviso discreto).
export function deFora(dados) {
  const t = dados.titulos || [];
  const exc = t.filter((x) => !x.cancelado && x.excluido);
  return {
    cancelados: t.filter((x) => x.cancelado).length,
    excluidos_clientes: new Set(exc.map((x) => x.cliente)).size,
    excluidos_aberto: soma(exc, (x) => x.aberto),
    outros_acordos: dados.fora_da_campanha?.qtd || 0,
  };
}
