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

// Instantes (ISO com fuso) no horário de Brasília.
const FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
const FMT_HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
export const diaDe = (instante) => FMT_DIA.format(new Date(instante));
export const horaDe = (instante) => FMT_HORA.format(new Date(instante));
// "14:32" hoje, "Ontem", "03/11" no ano, "03/11/25" antes.
export function quando(instante) {
  if (!instante) return '';
  const d = diaDe(instante);
  const h = hoje();
  if (d === h) return horaDe(instante);
  if (d === somarDias(h, -1)) return 'Ontem';
  return d.slice(0, 4) === h.slice(0, 4) ? dataCurta(d) : `${dataCurta(d)}/${d.slice(2, 4)}`;
}
// Separador do dia na conversa: "Hoje", "Ontem" ou "terça-feira, 3 de novembro de 2026".
export function rotuloDia(iso) {
  const h = hoje();
  if (iso === h) return 'Hoje';
  if (iso === somarDias(h, -1)) return 'Ontem';
  return dataLonga(iso);
}
export function tamanhoArquivo(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
