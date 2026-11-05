import { useEffect, useRef, useState } from 'react';
import { buscarNaConversa } from '../lib/api.js';

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const quando = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(',', '');

// Trecho em volta do termo, com o termo destacado (sem HTML: só texto e <mark>).
export function trecho(texto, q, largura = 70) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  const alvo = semAcento(q.trim());
  const i = semAcento(t).indexOf(alvo);
  if (!alvo || i < 0) return { antes: t.slice(0, largura * 2), achado: '', depois: '' };
  const ini = Math.max(0, i - largura);
  const fim = Math.min(t.length, i + alvo.length + largura);
  return {
    antes: (ini > 0 ? '…' : '') + t.slice(ini, i),
    achado: t.slice(i, i + alvo.length),
    depois: t.slice(i + alvo.length, fim) + (fim < t.length ? '…' : ''),
  };
}

// Busca dentro da conversa (pedido do Marcus, 05/11/2026): texto e nome de arquivo das mensagens guardadas do contato,
// sem diferença de acento e de maiúsculas. Clicar num resultado leva até a mensagem.
export default function BuscaConversa({ contato, aoIr, aoFechar }) {
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState(null); // null | 'lendo' | { resultados, mais } | { erro }
  const campo = useRef(null);
  const pedido = useRef(0);

  useEffect(() => { campo.current?.focus(); }, []);
  useEffect(() => {
    const termo = q.trim();
    if (termo.length < 2) { setEstado(null); return undefined; }
    const n = ++pedido.current;
    const t = setTimeout(async () => {
      setEstado('lendo');
      try {
        const r = await buscarNaConversa(contato, termo);
        if (n === pedido.current) setEstado(r);
      } catch (e) {
        if (n === pedido.current) setEstado({ erro: e.message });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, contato]);

  const lista = estado?.resultados || [];
  return (
    <div className="busca-conversa" role="search">
      <div className="busca-linha">
        <div className="busca">
          <i className="ti ti-search" aria-hidden="true" />
          <input ref={campo} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nesta conversa (texto ou nome de arquivo)"
            aria-label="Buscar nesta conversa" aria-describedby="busca-conversa-status" />
        </div>
        <button type="button" className="botao icone" onClick={aoFechar} aria-label="Fechar a busca" title="Fechar a busca (Esc)"><i className="ti ti-x" aria-hidden="true" /></button>
      </div>
      <p id="busca-conversa-status" className="mini" role="status" aria-live="polite">
        {q.trim().length < 2 ? 'Digite pelo menos 2 letras. Busca em todas as mensagens guardadas deste contato.'
          : estado === 'lendo' ? 'Buscando…'
            : estado?.erro ? estado.erro
              : estado ? (lista.length ? `${lista.length}${estado.mais ? '+' : ''} ${lista.length === 1 ? 'mensagem encontrada' : 'mensagens encontradas'}, da mais nova para a mais antiga.` : 'Nenhuma mensagem com esse texto.') : ''}
      </p>
      {lista.length > 0 && (
        <ul className="busca-resultados">
          {lista.map((m) => {
            const p = trecho(m.texto || m.arquivo, q);
            return (
              <li key={m.id}>
                <button type="button" onClick={() => aoIr(m)}>
                  <span className="mini">{m.nos ? 'Nós' : 'Cliente'} · {quando(m.em)}{m.arquivo && m.texto ? ` · ${m.arquivo}` : ''}</span>
                  <span className="trecho">{m.arquivo && !m.texto && <i className="ti ti-paperclip" aria-hidden="true" />}{p.antes}{p.achado && <mark>{p.achado}</mark>}{p.depois}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
