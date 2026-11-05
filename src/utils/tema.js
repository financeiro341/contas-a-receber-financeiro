// Tema claro ou escuro, guardado neste navegador (cr:tema). O escuro liga com data-tema="escuro" no <html>.
const CHAVE = 'cr:tema';

export function temaAtual() {
  return document.documentElement.getAttribute('data-tema') === 'escuro' ? 'escuro' : 'claro';
}

export function aplicarTemaGuardado() {
  try {
    const t = JSON.parse(localStorage.getItem(CHAVE) || '{}').tema;
    if (t === 'escuro') document.documentElement.setAttribute('data-tema', 'escuro');
  } catch { /* sem armazenamento: fica o claro */ }
}

export function alternarTema() {
  const novo = temaAtual() === 'escuro' ? 'claro' : 'escuro';
  if (novo === 'escuro') document.documentElement.setAttribute('data-tema', 'escuro');
  else document.documentElement.removeAttribute('data-tema');
  try { localStorage.setItem(CHAVE, JSON.stringify({ tema: novo })); } catch { /* sem armazenamento */ }
  return novo;
}
