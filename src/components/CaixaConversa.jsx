import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { enviarArquivo, enviarTexto, lerConversaCompleta } from '../lib/api.js';
import { NOME_SITUACAO } from '../constants.js';
import { diaDe, horaDe, rotuloDia, tamanhoArquivo } from '../utils/formato.js';
import { Estado, Vazio, useDados } from './comum.jsx';
import { Iniciais } from './CaixaLista.jsx';
import CaixaDetalhes from './CaixaDetalhes.jsx';

const ICONE_ARQUIVO = { documentMessage: 'ti-file-text', imageMessage: 'ti-photo', audioMessage: 'ti-microphone', videoMessage: 'ti-video', stickerMessage: 'ti-mood-smile' };
const ACEITOS = '.pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.doc,.csv,.txt,.zip';
const MIME_POR_EXTENSAO = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', csv: 'text/csv', txt: 'text/plain', zip: 'application/zip' };
const MAX_ARQUIVO = 8 * 1024 * 1024;
const INICIO_HISTORICO = '2026-11-01';

// Negrito do WhatsApp (*texto*) sem montar HTML: o React escapa o resto.
function TextoWhats({ texto }) {
  const partes = String(texto).split(/(\*[^*\n]+\*)/g);
  return partes.map((p, i) => (/^\*[^*\n]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b> : <Fragment key={i}>{p}</Fragment>));
}

function Leitura({ status }) {
  if (status === 'READ' || status === 'PLAYED') return <i className="ti ti-checks lida" aria-label="lida" title="Lida" />;
  if (status === 'DELIVERY_ACK') return <i className="ti ti-checks" aria-label="entregue" title="Entregue" />;
  if (status === 'ERROR') return <i className="ti ti-alert-circle erro" aria-label="não entregue" title="Não entregue" />;
  return <i className="ti ti-check" aria-label="enviada" title="Enviada" />;
}

// Rascunho só nesta aba (sessionStorage) e por pessoa; some ao sair ou fechar a aba.
const chaveRascunho = (eu, contato) => `cr:rascunho:${eu?.id || 'x'}:${contato}`;
function lerRascunho(chave) { try { return sessionStorage.getItem(chave) || ''; } catch { return ''; } }
function guardarRascunho(chave, t) { try { if (t) sessionStorage.setItem(chave, t); else sessionStorage.removeItem(chave); } catch { /* sem armazenamento */ } }

export default function CaixaConversa({ contato, eu, etiquetas, equipe, aoVoltar, aoMudar, recarregarEtiquetas }) {
  const conv = useDados(() => lerConversaCompleta(contato), [contato], 5000);
  const [saindo, setSaindo] = useState([]); // mensagens que estão saindo agora (aparecem na hora)
  const d = conv.dados;
  const [anteriores, setAnteriores] = useState([]);
  const [lendoAntigas, setLendoAntigas] = useState(false);
  const [maisAntigas, setMaisAntigas] = useState(null);
  // Detalhes abertos por padrão só em tela larga (no notebook e no celular cobrem a conversa).
  const [detalhes, setDetalhes] = useState(() => { if (window.innerWidth <= 1280) return false; try { return localStorage.getItem('cr:detalhes') !== 'n'; } catch { return true; } });
  const rascunho = chaveRascunho(eu, contato);
  const [texto, setTexto] = useState(() => lerRascunho(rascunho));
  const [arquivo, setArquivo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const corpo = useRef(null);
  const noFim = useRef(true);
  const qtdAntes = useRef(0);
  const campo = useRef(null);
  const anexo = useRef(null);

  useEffect(() => { guardarRascunho(rascunho, texto); }, [rascunho, texto]);
  useEffect(() => { if (window.innerWidth > 1280) { try { localStorage.setItem('cr:detalhes', detalhes ? 's' : 'n'); } catch { /* sem armazenamento */ } } }, [detalhes]);

  const vistas = new Set();
  const mensagens = [...anteriores, ...(d?.mensagens || [])].filter((m) => (vistas.has(m.id) ? false : vistas.add(m.id)));

  // Desce para a última mensagem ao abrir e quando chega mensagem nova (se a pessoa já estava no fim).
  useLayoutEffect(() => {
    const el = corpo.current;
    if (!el || !d) return;
    const novas = (d.mensagens || []).length !== qtdAntes.current;
    qtdAntes.current = (d.mensagens || []).length;
    if (novas && noFim.current) el.scrollTop = el.scrollHeight;
  }, [d]);

  function aoRolar() {
    const el = corpo.current;
    if (el) noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function verAntigas() {
    if (!mensagens.length) return;
    setLendoAntigas(true);
    const el = corpo.current;
    const alturaAntes = el?.scrollHeight || 0;
    try {
      const r = await lerConversaCompleta(contato, mensagens[0].em);
      setAnteriores((a) => [...(r.mensagens || []), ...a]);
      setMaisAntigas(!!r.mais_antigas);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - alturaAntes; });
    } catch (e) {
      setAviso(e.message);
    } finally {
      setLendoAntigas(false);
    }
  }

  function escolherArquivo(ev) {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    const mimetype = MIME_POR_EXTENSAO[ext];
    if (!mimetype) { setAviso('Tipo de arquivo não aceito. Use PDF, imagem, planilha, documento ou texto.'); return; }
    if (f.size > MAX_ARQUIVO) { setAviso('O arquivo precisa ter até 8 MB.'); return; }
    const leitor = new FileReader();
    leitor.onload = () => {
      setArquivo({ nome: f.name, mimetype, tamanho: f.size, base64: String(leitor.result).replace(/^data:[^,]*,/, '') });
      setAviso(null);
      campo.current?.focus();
    };
    leitor.onerror = () => setAviso('Não foi possível ler o arquivo.');
    leitor.readAsDataURL(f);
  }

  async function enviar() {
    const t = texto.trim();
    if (enviando || (!t && !arquivo)) return;
    const provisoria = { id: `p${Date.now()}`, texto: t, arquivo: arquivo?.nome || null, em: new Date().toISOString() };
    setEnviando(true);
    setAviso(null);
    setSaindo((x) => [...x, provisoria]);
    setTexto('');
    const anexado = arquivo;
    setArquivo(null);
    noFim.current = true;
    requestAnimationFrame(() => { if (corpo.current) corpo.current.scrollTop = corpo.current.scrollHeight; });
    try {
      if (anexado) await enviarArquivo(contato, { ...anexado, legenda: t });
      else await enviarTexto(contato, t);
      await conv.atualizar();
      aoMudar?.();
      // Os avisos de entregue e lida chegam em seguida.
      setTimeout(() => conv.atualizar(), 3000);
    } catch (e) {
      setAviso(e.message);
      setTexto((atual) => atual || t);
      if (anexado) setArquivo((atual) => atual || anexado);
      await conv.atualizar();
    } finally {
      setSaindo((x) => x.filter((m) => m.id !== provisoria.id));
      setEnviando(false);
      campo.current?.focus();
    }
  }

  function teclas(ev) {
    const toque = window.matchMedia?.('(pointer: coarse)').matches;
    if (ev.key === 'Enter' && !ev.shiftKey && !toque && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      enviar();
    }
  }

  const c = d?.contato;
  const s = d?.situacao;
  const podeResponder = eu?.pode_enviar && eu?.envio_ligado && c?.tem_destino;
  const mais = maisAntigas ?? d?.mais_antigas;
  let diaAnterior = null;

  return (
    <section className={`caixa-painel caixa-conversa${detalhes ? ' com-detalhes' : ''}`} aria-label={`Conversa com ${c?.nome || 'o contato'}`}>
      <header className="conversa-topo">
        <button type="button" className="botao icone so-celular" onClick={aoVoltar} aria-label="Voltar para a lista"><i className="ti ti-arrow-left" aria-hidden="true" /></button>
        <Iniciais nome={c?.nome} />
        <div className="quem-topo">
          <h2>{c?.nome || 'Carregando…'}</h2>
          <div className="sub">
            {(d?.empresas || []).length ? `${d.empresas[0].empresa}${d.empresas.length > 1 ? ` +${d.empresas.length - 1}` : ''}` : (c?.situacao === 'cliente' ? 'Cliente' : c?.situacao === 'nao_cliente' ? 'Não é cliente' : 'A identificar')}
            {s?.situacao && <span className="chip"><span className={`bolinha s-${s.situacao}`} aria-hidden="true" />{NOME_SITUACAO[s.situacao]}</span>}
          </div>
        </div>
        {d?.dono && <span className="dono-topo"><i className="ti ti-user" aria-hidden="true" />{d.dono.id === eu?.id ? 'Você' : d.dono.nome}</span>}
        <button type="button" className="botao icone" aria-pressed={detalhes} onClick={() => setDetalhes(!detalhes)} aria-label={detalhes ? 'Esconder detalhes' : 'Mostrar detalhes'} title="Detalhes, notas e etiquetas">
          <i className="ti ti-layout-sidebar-right" aria-hidden="true" />
        </button>
      </header>

      <div className="conversa-meio">
        <div className="conversa-corpo" ref={corpo} onScroll={aoRolar}>
          <Estado carregando={conv.carregando && !d} erro={!d && conv.erro} recarregar={conv.recarregar} forma="conversa">
            {d && (
              <>
                {mais ? (
                  <div className="antigas"><button type="button" className="botao" onClick={verAntigas} disabled={lendoAntigas}>{lendoAntigas ? 'Lendo…' : 'Ver mensagens anteriores'}</button></div>
                ) : (
                  <p className="inicio-historico">Mensagens guardadas desde {INICIO_HISTORICO.split('-').reverse().join('/')}{c?.situacao !== 'cliente' ? ' (alguns contatos têm desde agosto)' : ''}.</p>
                )}
                {mensagens.length === 0 && <Vazio icone="ti-message-off" titulo="Nenhuma mensagem guardada" />}
                {mensagens.map((m) => {
                  const dia = diaDe(m.em);
                  const separador = dia !== diaAnterior ? <div className="sep-dia" role="separator"><span>{rotuloDia(dia)}</span></div> : null;
                  diaAnterior = dia;
                  return (
                    <Fragment key={m.id}>
                      {separador}
                      <div className={`balao ${m.nos ? 'nos' : 'cliente'}`}>
                        {m.arquivo && <span className="arquivo"><i className={`ti ${ICONE_ARQUIVO[m.tipo] || 'ti-paperclip'}`} aria-hidden="true" />{m.arquivo}</span>}
                        {m.texto && <div><TextoWhats texto={m.texto} /></div>}
                        {!m.texto && !m.arquivo && <em className="sem-texto">{m.tipo === 'audioMessage' ? 'Áudio' : m.tipo === 'imageMessage' ? 'Imagem' : m.tipo === 'videoMessage' ? 'Vídeo' : m.tipo === 'stickerMessage' ? 'Figurinha' : 'Mensagem sem texto'}</em>}
                        <span className="hora">
                          {m.nos ? (m.por ? `${m.por}, pelo sistema` : 'Nós') : 'Cliente'} · {horaDe(m.em)}
                          {m.nos && <> <Leitura status={m.status} /></>}
                        </span>
                      </div>
                    </Fragment>
                  );
                })}
                {saindo.map((m) => (
                  <div key={m.id} className="balao nos pendente" aria-live="polite">
                    {m.arquivo && <span className="arquivo"><i className="ti ti-paperclip" aria-hidden="true" />{m.arquivo}</span>}
                    {m.texto && <div><b>{eu?.assinatura}:</b>{'\n'}{m.texto}</div>}
                    <span className="hora"><i className="ti ti-clock" aria-hidden="true" /> Enviando · {horaDe(m.em)}</span>
                  </div>
                ))}
                {(d.envios || []).filter((e) => e.status !== 'enviado' && !(e.status === 'enviando' && saindo.length)).map((e) => (
                  <div key={`e${e.id}`} className={`balao nos pendente${e.status === 'erro' ? ' falhou' : ''}${e.status === 'incerto' ? ' incerto' : ''}`}>
                    {e.arquivo && <span className="arquivo"><i className="ti ti-paperclip" aria-hidden="true" />{e.arquivo}</span>}
                    {e.texto && <div>{e.texto}</div>}
                    <span className="hora">{e.status === 'erro' ? <><i className="ti ti-alert-circle" aria-hidden="true" /> Não saiu ({e.por}, {horaDe(e.em)})</>
                      : e.status === 'incerto' ? <><i className="ti ti-help-circle" aria-hidden="true" /> Pode ter saído: confira acima antes de reenviar ({e.por}, {horaDe(e.em)})</>
                        : `Enviando… (${e.por})`}</span>
                  </div>
                ))}
              </>
            )}
          </Estado>
        </div>

        <div className="compositor">
          {aviso && <div className="aviso erro" role="alert"><i className="ti ti-alert-triangle" aria-hidden="true" /><span style={{ flex: 1 }}>{aviso}</span><button type="button" className="limpar" onClick={() => setAviso(null)} aria-label="Fechar aviso"><i className="ti ti-x" aria-hidden="true" /></button></div>}
          {!eu?.pode_enviar ? (
            <p className="aviso-compositor"><i className="ti ti-lock" aria-hidden="true" /> Seu usuário pode ver as conversas e escrever notas, mas não responder ao cliente.</p>
          ) : !eu?.envio_ligado ? (
            <p className="aviso-compositor"><i className="ti ti-plug-connected-x" aria-hidden="true" /> O envio pelo sistema ainda não foi ligado. Falta configurar a chave da Evolution na função.</p>
          ) : c && !c.tem_destino ? (
            <p className="aviso-compositor"><i className="ti ti-alert-circle" aria-hidden="true" /> Este contato não tem número para resposta.</p>
          ) : (
            <>
              {arquivo && (
                <div className="anexo-escolhido">
                  <i className="ti ti-paperclip" aria-hidden="true" /><span className="nome-anexo">{arquivo.nome}</span><span className="tam">{tamanhoArquivo(arquivo.tamanho)}</span>
                  <button type="button" className="limpar" onClick={() => setArquivo(null)} aria-label="Tirar o arquivo"><i className="ti ti-x" aria-hidden="true" /></button>
                </div>
              )}
              <div className="linha-compor">
                <input ref={anexo} type="file" accept={ACEITOS} onChange={escolherArquivo} hidden />
                <button type="button" className="botao icone" onClick={() => anexo.current?.click()} aria-label="Anexar arquivo" title="Anexar arquivo (até 8 MB)" disabled={!podeResponder || enviando}><i className="ti ti-paperclip" aria-hidden="true" /></button>
                <label className="so-leitor" htmlFor={`msg-${contato}`}>Mensagem</label>
                <textarea
                  id={`msg-${contato}`}
                  ref={campo}
                  rows={1}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={teclas}
                  maxLength={arquivo ? 1000 : 4000}
                  placeholder={arquivo ? 'Legenda (opcional)' : 'Escreva a mensagem'}
                  disabled={!podeResponder}
                />
                <button type="button" className="botao principal" onClick={enviar} aria-label={enviando ? 'Enviando' : 'Enviar'} disabled={!podeResponder || enviando || (!texto.trim() && !arquivo)}>
                  <i className={`ti ${enviando ? 'ti-loader-2 girando' : 'ti-send'}`} aria-hidden="true" /><span className="rotulo-enviar">{enviando ? 'Enviando' : 'Enviar'}</span>
                </button>
              </div>
              <p className="assinatura">Sai com a assinatura <b>{eu.assinatura}</b>. Enter envia, Shift+Enter quebra a linha.</p>
            </>
          )}
        </div>
      </div>

      {detalhes && d && (
        <CaixaDetalhes contato={contato} dados={d} eu={eu} etiquetas={etiquetas} equipe={equipe}
          aoFechar={() => setDetalhes(false)}
          aoMudar={() => { conv.atualizar(); aoMudar?.(); }} recarregarEtiquetas={recarregarEtiquetas} />
      )}
    </section>
  );
}
