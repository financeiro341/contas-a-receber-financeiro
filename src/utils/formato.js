// Formatos e datas. "Hoje" sempre no fuso de Brasília (America/Sao_Paulo), nunca toISOString.
export function hoje() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
export function somarDias(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
export function diaSemana(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}
export function diaUtilAnterior(iso) {
  let d = somarDias(iso, -1);
  while ([0, 6].includes(diaSemana(d))) d = somarDias(d, -1);
  return d;
}
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function dataLonga(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return `${DIAS[diaSemana(iso)]}, ${d} de ${MESES[m - 1]} de ${a}`;
}
export const dataCurta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
export const nomeMes = (iso) => MESES[Number(iso.slice(5, 7)) - 1];
export function brl(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
export const inteiro = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
export function minutos(m) {
  if (m == null) return '—';
  const v = Math.round(m);
  if (v < 60) return `${v} min`;
  const h = Math.floor(v / 60);
  const r = v % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}
export const pct = (n, t) => (t ? `${Math.round((n / t) * 100)}%` : '0%');
export const plural = (n, um, varios) => (n === 1 ? um : varios);
