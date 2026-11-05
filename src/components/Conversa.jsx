import { useEffect, useRef } from 'react';
import { lerConversa } from '../lib/api.js';
import { NOME_SITUACAO } from '../constants.js';
import { brl, dataLonga } from '../utils/formato.js';
import { Estado, useDados } from './comum.jsx';

const ARQUIVO = { documentMessage: 'ti-file-text', imageMessage: 'ti-photo', audioMessage: 'ti-microphone', videoMessage: 'ti-video', stickerMessage: 'ti-mood-smile' };

// Painel lateral com a conversa do dia, as ligações e a situação (só leitura).
export default function Conversa({ contato, dia, aoFechar }) {
  const { dados, erro, carregando } = useDados(() => lerConversa(contato, dia), [contato, dia]);
  const fechar = useRef(null);
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
            <div className="sub" style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>{dataLonga(dia)}</div>
          </div>
          <button ref={fechar} className="botao icone" type="button" onClick={aoFechar} aria-label="Fechar conversa"><i className="ti ti-x" aria-hidden="true" /></button>
        </header>
        <div className="corpo">
          <Estado carregando={carregando} erro={erro}>
            {s?.situacao && (
              <div className="cartao" style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="chip"><span className={`bolinha s-${s.situacao}`} aria-hidden="true" />{NOME_SITUACAO[s.situacao] || s.situacao}</span>
                  <span className={`selo ${s.classificado_por === 'claude' ? 'claude' : 'neutro'}`}>{s.classificado_por === 'claude' ? 'Leitura do Claude' : s.classificado_por}</span>
                  {s.atraso_valor > 0 && <span className="chip">Em atraso no Omie: {brl(s.atraso_valor)} ({s.atraso_qtd})</span>}
                </div>
                {s.motivo && <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>{s.motivo}</p>}
              </div>
            )}
            {(dados?.ligacoes || []).length > 0 && (
              <div className="cartao" style={{ marginBottom: 10 }}>
                <h2 style={{ fontSize: 14 }}><i className="ti ti-phone" aria-hidden="true" />Ligações</h2>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13.5 }}>
                  {dados.ligacoes.map((l, i) => (
                    <li key={i}>{l.hora}, {l.direcao === 'feita' ? 'feita' : 'recebida'}, {l.resultado === 'atendida' ? 'atendida' : l.resultado === 'nao_atendida' ? 'não atendida' : 'resultado desconhecido'}{l.duracao_seg ? ` (${Math.round(l.duracao_seg / 60)} min)` : ''}</li>
                  ))}
                </ul>
              </div>
            )}
            {(dados?.mensagens || []).length === 0 ? <div className="vazio">Nenhuma mensagem neste dia.</div> : dados.mensagens.map((m, i) => (
              <div key={i} className={`balao ${m.nos ? 'nos' : 'cliente'}`}>
                {m.arquivo && <span className="arquivo"><i className={`ti ${ARQUIVO[m.tipo] || 'ti-paperclip'}`} aria-hidden="true" />{m.arquivo}</span>}
                {m.texto && <div>{m.texto}</div>}
                {!m.texto && !m.arquivo && <em style={{ color: 'var(--text-muted)' }}>{m.tipo === 'audioMessage' ? 'Áudio' : m.tipo === 'imageMessage' ? 'Imagem' : 'Mensagem sem texto'}</em>}
                <span className="hora">{m.nos ? 'Nós' : 'Cliente'} · {m.hora}</span>
              </div>
            ))}
          </Estado>
        </div>
      </aside>
    </>
  );
}
