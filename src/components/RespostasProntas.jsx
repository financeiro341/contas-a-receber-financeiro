import { useEffect, useRef, useState } from 'react';
import { apagarResposta, criarResposta } from '../lib/api.js';

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Troca {nome} pelo primeiro nome do contato e {empresa} pela primeira empresa ligada.
export function preencher(texto, contato, empresas) {
  const bruto = String(contato?.nome || '').trim();
  const primeiro = /\d{6,}/.test(bruto) ? '' : bruto.split(/\s+/)[0] || '';
  const nome = primeiro ? primeiro[0].toUpperCase() + primeiro.slice(1).toLowerCase() : '';
  const empresa = empresas?.[0]?.empresa || '';
  return String(texto)
    .replace(/\{nome\}/gi, nome)
    .replace(/\{empresa\}/gi, empresa)
    .replace(/,\s*!/g, '!').replace(/\s+([!?.,])/g, '$1').replace(/ {2,}/g, ' ');
}

// Lista de respostas prontas sobre o campo de mensagem. Abre pelo botão ou digitando "/".
export default function RespostasProntas({ filtro, respostas, eu, aoEscolher, aoFechar, recarregar }) {
  const [busca, setBusca] = useState(filtro || '');
  const [nova, setNova] = useState(null);
  const [erro, setErro] = useState('');
  const [apagando, setApagando] = useState(null);
  const [ativo, setAtivo] = useState(0);
  const caixa = useRef(null);
  useEffect(() => { setBusca(filtro || ''); setAtivo(0); }, [filtro]);
  useEffect(() => {
    const fora = (e) => { if (caixa.current && !caixa.current.contains(e.target) && !e.target.closest?.('.botao-respostas')) aoFechar(); };
    const tecla = (e) => { if (e.key === 'Escape') aoFechar(); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [aoFechar]);

  const q = semAcento(busca);
  const lista = respostas.filter((r) => !q || semAcento(r.titulo).includes(q) || semAcento(r.texto).includes(q));

  async function salvar(ev) {
    ev.preventDefault();
    setErro('');
    try { await criarResposta(nova.titulo, nova.texto); setNova(null); recarregar?.(); } catch (e) { setErro(e.message); }
  }
  async function apagar(id) {
    setErro('');
    try { await apagarResposta(id); setApagando(null); recarregar?.(); } catch (e) { setErro(e.message); }
  }

  return (
    <div className="respostas" ref={caixa} role="dialog" aria-label="Respostas prontas">
      <div className="respostas-topo">
        <i className="ti ti-bolt" aria-hidden="true" />
        <label className="so-leitor" htmlFor="busca-resp">Buscar resposta pronta</label>
        <input id="busca-resp" autoFocus={!filtro} value={busca} placeholder="Buscar resposta pronta" onChange={(e) => { setBusca(e.target.value); setAtivo(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((a) => Math.min(a + 1, lista.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' && lista[ativo]) { e.preventDefault(); aoEscolher(lista[ativo].texto); }
          }} />
        <button type="button" className="limpar" onClick={aoFechar} aria-label="Fechar respostas prontas"><i className="ti ti-x" aria-hidden="true" /></button>
      </div>
      {erro && <div className="aviso erro" role="alert">{erro}</div>}
      {nova ? (
        <form className="nova-resposta" onSubmit={salvar}>
          <label className="so-leitor" htmlFor="tit-resp">Título</label>
          <input id="tit-resp" maxLength={60} value={nova.titulo} placeholder="Título (ex.: Segunda via)" autoFocus onChange={(e) => setNova({ ...nova, titulo: e.target.value })} />
          <label className="so-leitor" htmlFor="txt-resp">Texto</label>
          <textarea id="txt-resp" rows={3} maxLength={4000} value={nova.texto} placeholder="Texto. Use {nome} e {empresa} para preencher sozinho." onChange={(e) => setNova({ ...nova, texto: e.target.value })} />
          <div className="linha-botoes">
            <button type="submit" className="botao principal" disabled={!nova.titulo.trim() || !nova.texto.trim()}>Salvar</button>
            <button type="button" className="botao" onClick={() => setNova(null)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <>
          <ul className="respostas-lista" role="listbox" aria-label="Respostas prontas">
            {lista.length === 0 && <li className="mini" style={{ padding: 10 }}>Nenhuma resposta com essa busca.</li>}
            {lista.map((r, i) => (
              <li key={r.id} role="option" aria-selected={i === ativo}>
                <button type="button" className={`resposta-item${i === ativo ? ' ativo' : ''}`} onClick={() => aoEscolher(r.texto)} onMouseEnter={() => setAtivo(i)}>
                  <b>{r.titulo}</b><span>{r.texto}</span>
                </button>
                {(r.criada_por === eu?.id || eu?.papel === 'admin') && (apagando === r.id ? (
                  <span className="confirma"><button type="button" className="link-botao perigo" onClick={() => apagar(r.id)}>Apagar</button><button type="button" className="link-botao" onClick={() => setApagando(null)}>Não</button></span>
                ) : (
                  <button type="button" className="limpar" onClick={() => setApagando(r.id)} aria-label={`Apagar a resposta ${r.titulo}`}><i className="ti ti-trash" aria-hidden="true" /></button>
                ))}
              </li>
            ))}
          </ul>
          {eu?.pode_enviar && <button type="button" className="link-botao" style={{ margin: '6px 10px 10px' }} onClick={() => setNova({ titulo: '', texto: '' })}><i className="ti ti-plus" aria-hidden="true" />Nova resposta pronta</button>}
        </>
      )}
    </div>
  );
}
