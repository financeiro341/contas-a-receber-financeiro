/* global localStorage, document */
// Modo escuro (D-107) antes do primeiro desenho: lê a cópia do navegador (a mesma chave de src/utils/tema.js)
// e liga o escuro no <html>. Sem armazenamento, fica no claro. O app confirma depois (main.jsx e o perfil).
try {
  var salvo = JSON.parse(localStorage.getItem('cr:tema') || 'null');
  if (salvo && salvo.tema === 'escuro') document.documentElement.setAttribute('data-tema', 'escuro');
} catch {
  // Sem armazenamento: claro.
}
