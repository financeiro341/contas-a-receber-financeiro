import { useEffect, useRef } from 'react';
import { lerConversa } from '../lib/api.js';
import { NOME_SITUACAO } from '../constants.js';
import { brl, dataLonga } from '../utils/formato.js';
import { Estado, Vazio, useDados } from './comum.jsx';
import Midia, { TIPOS_MIDIA } from './Midia.jsx';

const ARQUIVO = { documentMessage: 'ti-file-text', imageMessage: 'ti-photo', audioMessage: 'ti-microphone', videoMessage: 'ti-video', stickerMessage: 'ti-mood-smile' };

// Painel lateral com a conversa do dia, as ligações e a situação (só leitura).
export default function Conversa({ contato, dia, aoFechar, abrirNaCaixa }) {
  const { dados, erro, carregando, recarregar } = useDados(() => lerConversa(contato, dia), [contato, dia]);
  const fechar = useRef(null);
  const corpo = useRef(null);
  // Abre já no fim da conversa, onde está a última mensagem.
  useEffect(() => { if (dados && corpo.current) corpo.current.scrollTop = corpo.current.scrollHeight; }, [dados]);
  // Com o painel aberto, a página de trás não rola (uma barra de rolagem só, a da conversa).
  useEffect(() => {
    const raiz = document.documentElement;
    // Ocupa o lugar da barra que some, para a página não pular para o lado.
    raiz.style.setProperty('--barra', `${Math.max(0, window.innerWidth - raiz.clientWidth)}px`);
    raiz.classList.add('travado');
    return () => { raiz.classList.remove('travado'); raiz.style.removeProperty('--barra'); };
  }, []);
  useEffect(() => {
    fechar.current?.focus();
    const tecla = (e) => { if (e.key === 'Escape') aoFechar(); };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [aoFechar]);
  const s = dados?.situacao;
  return (
    <>
      <div className="fundo" onClick={aoFechar} aria-hidden="true" />
      <aside className="lateral" role="dialog" aria-modal="true" aria-labelledby="conversa-titulo">
        <header>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="conversa-titulo">{dados?.nome || 'Conversa'}</h2>
            <div className="sub" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {(dados?.empresas || []).join(' · ') || 'Sem empresa ligada no Omie'}
            </div>
            <div className="cabeca-conversa">
              {s?.situacao && <span className="chip"><span className={`bolinha s-${s.situacao}`} aria-hidden="true" />{NOME_SITUACAO[s.situacao] || s.situacao}</span>}
              <span>{dataLonga(dia)}</span>
            </div>
          </div>
          {abrirNaCaixa && <button className="botao" type="button" onClick={() => abrirNaCaixa(contato)}><i className="ti ti-brand-whatsapp" aria-hidden="true" />Abrir em Conversas</button>}
          <button ref={fechar} className="botao icone" type="button" onClick={aoFechar} aria-label="Fechar conversa"><i className="ti ti-x" aria-hidden="true" /></button>
        </header>
        <div className="corpo" ref={corpo}>
          <Estado carregando={carregando} erro={erro} recarregar={recarregar} forma="conversa">
            {(s?.motivo || s?.atraso_valor > 0) && (
              <div className="cartao resumo-conversa">
                {s.motivo && <p>{s.motivo}</p>}
                <div className="rodape">
                  <span className={`selo ${s.classificado_por === 'claude' ? 'claude' : 'neutro'}`}>{s.classificado_por === 'claude' ? 'Leitura do Claude' : 'Prévia pelas regras'}</span>
                  {s.atraso_valor > 0 && <span className="selo neutro"><i className="ti ti-alert-circle" aria-hidden="true" />Em atraso no Omie: {brl(s.atraso_valor)}, {s.atraso_qtd} {s.atraso_qtd > 1 ? 'títulos' : 'título'}</span>}
                </div>
              </div>
            )}
            {(dados?.ligacoes || []).length > 0 && (
              <details className="cartao ligacoes">
                <summary><i className="ti ti-phone" aria-hidden="true" />{dados.ligacoes.length} {dados.ligacoes.length > 1 ? 'ligações' : 'ligação'} no dia</summary>
                <ul>
                  {dados.ligacoes.map((l, i) => (
                    <li key={i}>{l.hora}, {l.direcao === 'feita' ? 'feita' : 'recebida'}, {l.resultado === 'atendida' ? 'atendida' : l.resultado === 'nao_atendida' ? 'não atendida' : 'resultado desconhecido'}{l.duracao_seg ? ` (${Math.max(1, Math.round(l.duracao_seg / 60))} min)` : ''}</li>
                  ))}
                </ul>
              </details>
            )}
            {(dados?.mensagens || []).length === 0 ? <Vazio icone="ti-message-off" titulo="Nenhuma mensagem neste dia" /> : dados.mensagens.map((m, i) => (
              <div key={i} className={`balao ${m.nos ? 'nos' : 'cliente'}`}>
                {m.arquivo && <span className="arquivo"><i className={`ti ${ARQUIVO[m.tipo] || 'ti-paperclip'}`} aria-hidden="true" />{m.arquivo}</span>}
                <Midia id={m.id} tipo={m.tipo} arquivo={m.arquivo} />
                {m.texto && <div>{m.texto}</div>}
                {!m.texto && !m.arquivo && !TIPOS_MIDIA.has(m.tipo) && <em style={{ color: 'var(--text-muted)' }}>{m.tipo === 'audioMessage' ? 'Áudio' : m.tipo === 'imageMessage' ? 'Imagem' : 'Mensagem sem texto'}</em>}
                <span className="hora">{m.nos ? 'Nós' : 'Cliente'} · {m.hora}</span>
              </div>
            ))}
          </Estado>
        </div>
      </aside>
    </>
  );
}
