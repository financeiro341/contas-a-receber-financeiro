import { useState } from 'react';
import { apagarNota, cancelarRetorno, criarEtiqueta, criarNota, definirDono, desfazerLigacao, marcarEtiqueta } from '../lib/api.js';
import { rotuloRetorno } from './AcoesConversa.jsx';
import { NOME_SITUACAO } from '../constants.js';
import { brl, dataCurta, quando } from '../utils/formato.js';

const CORES = [['neutro', 'Cinza'], ['azul', 'Azul'], ['verde', 'Verde'], ['amarelo', 'Amarelo'], ['vermelho', 'Vermelho'], ['roxo', 'Roxo']];
const EVENTOS = {
  enviou_texto: 'enviou mensagem', enviou_arquivo: 'enviou arquivo', falha_texto: 'tentou enviar mensagem (não saiu)', falha_arquivo: 'tentou enviar arquivo (não saiu)', incerto_texto: 'enviou mensagem (sem confirmação)', incerto_arquivo: 'enviou arquivo (sem confirmação)',
  nota: 'escreveu nota', nota_apagada: 'apagou nota', etiqueta_posta: 'pôs a etiqueta', etiqueta_tirada: 'tirou a etiqueta', dono: 'passou a conversa para', dono_tirado: 'tirou o dono',
  resolveu: 'marcou como resolvida', reabriu: 'reabriu a conversa', retorno_marcado: 'marcou retorno', retorno_feito: 'fez o retorno', retorno_cancelado: 'cancelou o retorno',
  ligacao: 'registrou ligação', segunda_via: 'enviou a segunda via do boleto', ligacao_desfeita: 'desfez o registro de ligação', historico: 'trouxe mensagens antigas',
};

// Coluna da direita: empresas, cobrança, dono, etiquetas, notas internas e histórico da conversa.
export default function CaixaDetalhes({ contato, dados, eu, etiquetas, equipe, aoFechar, aoMudar, recarregarEtiquetas }) {
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [erro, setErro] = useState('');
  const [apagando, setApagando] = useState(null);
  const [novaEtq, setNovaEtq] = useState(null);
  const [confirmar, setConfirmar] = useState(null); // 'r<id>' ou 'l<id>'
  const s = dados.situacao;
  const minhas = new Set((dados.etiquetas || []).map((e) => e.id));

  async function fazer(chave, fn) {
    setOcupado(chave);
    setErro('');
    try { await fn(); aoMudar(); return true; } catch (e) { setErro(e.message); return false; } finally { setOcupado(''); }
  }

  return (
    <aside className="conversa-detalhes" aria-label="Detalhes da conversa">
      <div className="detalhes-topo">
        <h3>Detalhes</h3>
        <button type="button" className="botao icone" onClick={aoFechar} aria-label="Esconder detalhes"><i className="ti ti-x" aria-hidden="true" /></button>
      </div>
      {erro && <div className="aviso erro" role="alert"><i className="ti ti-alert-triangle" aria-hidden="true" />{erro}</div>}

      <section className="bloco-det">
        <h4>Dono da conversa</h4>
        <div className="linha-dono">
          <label className="so-leitor" htmlFor={`dono-${contato}`}>Dono da conversa</label>
          <select id={`dono-${contato}`} value={dados.dono?.id || ''} disabled={ocupado === 'dono'}
            onChange={(e) => fazer('dono', () => definirDono(contato, e.target.value || null))}>
            <option value="">Sem dono</option>
            {equipe.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.id === eu?.id ? ' (você)' : ''}</option>)}
          </select>
          {dados.dono?.id !== eu?.id && (
            <button type="button" className="botao" disabled={ocupado === 'dono'} onClick={() => fazer('dono', () => definirDono(contato, eu.id))}>Ficar com ela</button>
          )}
        </div>
        {dados.dono && <p className="mini">Desde {quando(dados.dono.em)}{dados.dono.por ? `, por ${dados.dono.por}` : ''}.</p>}
      </section>

      <section className="bloco-det">
        <h4>Etiquetas</h4>
        <div className="etiquetas-opcoes" role="group" aria-label="Etiquetas da conversa">
          {etiquetas.map((e) => (
            <button key={e.id} type="button" className={`etq-botao cor-${e.cor}`} aria-pressed={minhas.has(e.id)} disabled={ocupado === `e${e.id}`}
              onClick={() => fazer(`e${e.id}`, () => marcarEtiqueta(contato, e.id, !minhas.has(e.id)))}>
              {minhas.has(e.id) && <i className="ti ti-check" aria-hidden="true" />}{e.nome}
            </button>
          ))}
        </div>
        {eu?.pode_enviar && (novaEtq ? (
          <form className="nova-etq" onSubmit={async (ev) => {
            ev.preventDefault();
            const ok = await fazer('nova', () => criarEtiqueta(novaEtq.nome, novaEtq.cor));
            if (ok) { setNovaEtq(null); recarregarEtiquetas?.(); }
          }}>
            <label className="so-leitor" htmlFor="nome-etq">Nome da etiqueta</label>
            <input id="nome-etq" value={novaEtq.nome} maxLength={40} placeholder="Nome da etiqueta" onChange={(e) => setNovaEtq({ ...novaEtq, nome: e.target.value })} autoFocus />
            <label className="so-leitor" htmlFor="cor-etq">Cor</label>
            <select id="cor-etq" value={novaEtq.cor} onChange={(e) => setNovaEtq({ ...novaEtq, cor: e.target.value })}>
              {CORES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
            <button type="submit" className="botao" disabled={!novaEtq.nome.trim() || ocupado === 'nova'}>Criar</button>
            <button type="button" className="botao" onClick={() => setNovaEtq(null)}>Cancelar</button>
          </form>
        ) : (
          <button type="button" className="link-botao" onClick={() => setNovaEtq({ nome: '', cor: 'neutro' })}><i className="ti ti-plus" aria-hidden="true" />Nova etiqueta</button>
        ))}
      </section>

      <section className="bloco-det">
        <h4>Notas internas <span className="mini">(o cliente não vê)</span></h4>
        <form onSubmit={async (ev) => {
          ev.preventDefault();
          const ok = await fazer('nota', () => criarNota(contato, nota));
          if (ok) setNota('');
        }}>
          <label className="so-leitor" htmlFor={`nota-${contato}`}>Nova nota</label>
          <textarea id={`nota-${contato}`} rows={2} maxLength={4000} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: prometeu pagar sexta pelo Pix" />
          <button type="submit" className="botao" disabled={!nota.trim() || ocupado === 'nota'}><i className="ti ti-note" aria-hidden="true" />Salvar nota</button>
        </form>
        {(dados.notas || []).length > 0 && (
          <ul className="notas">
            {dados.notas.map((n) => (
              <li key={n.id}>
                <p>{n.texto}</p>
                <div className="mini">
                  {n.autor} · {quando(n.em)}
                  {(n.autor_id === eu?.id || eu?.papel === 'admin') && (apagando === n.id ? (
                    <> · <button type="button" className="link-botao perigo" onClick={async () => { await fazer(`n${n.id}`, () => apagarNota(n.id)); setApagando(null); }}>Confirmar</button>
                      <button type="button" className="link-botao" onClick={() => setApagando(null)}>Cancelar</button></>
                  ) : (
                    <> · <button type="button" className="link-botao" onClick={() => setApagando(n.id)} aria-label="Apagar a nota">Apagar</button></>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(dados.lembretes || []).length > 0 && (
        <section className="bloco-det">
          <h4>Retornos</h4>
          <ul className="lista-simples">
            {dados.lembretes.map((l) => (
              <li key={l.id} className={l.feito ? 'feito' : undefined}>
                <i className={`ti ${l.feito ? 'ti-check' : 'ti-alarm'}`} aria-hidden="true" /> <b>{l.feito ? `Feito por ${l.feito_por?.split(' ')[0] || ''}` : rotuloRetorno(l)}</b>{l.texto ? `: ${l.texto}` : ''}
                <div className="mini">
                  Marcado por {l.por} para {rotuloRetorno(l)}
                  {!l.feito && (l.por_id === eu?.id || eu?.papel === 'admin') && (confirmar === `r${l.id}` ? (
                    <> · <button type="button" className="link-botao perigo" onClick={async () => { await fazer(`r${l.id}`, () => cancelarRetorno(l.id)); setConfirmar(null); }}>Cancelar o retorno</button>
                      <button type="button" className="link-botao" onClick={() => setConfirmar(null)}>Manter</button></>
                  ) : (
                    <> · <button type="button" className="link-botao" onClick={() => setConfirmar(`r${l.id}`)}>Cancelar</button></>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(dados.ligacoes || []).length > 0 && (
        <section className="bloco-det">
          <h4>Ligações</h4>
          <ul className="lista-simples">
            {dados.ligacoes.map((l) => (
              <li key={l.id}>
                <i className={`ti ${l.direcao === 'feita' ? 'ti-phone-outgoing' : 'ti-phone-incoming'}`} aria-hidden="true" /> {l.direcao === 'feita' ? 'Ligamos' : 'O cliente ligou'}, {l.resultado === 'atendida' ? 'atendeu' : l.resultado === 'desconhecido' ? 'sem resultado' : 'não atendeu'}
                <span className="mini"> · {quando(l.em)}</span>
                {l.observacao && <div className="mini">{l.observacao}</div>}
                <div className="mini">
                  {l.fonte === 'manual' ? `Registrada por ${l.por}` : l.fonte === 'chrome' ? 'Lida no WhatsApp Web' : 'Aviso do WhatsApp'}
                  {l.fonte === 'manual' && (l.por_id === eu?.id || eu?.papel === 'admin') && (confirmar === `l${l.id}` ? (
                    <> · <button type="button" className="link-botao perigo" onClick={async () => { await fazer(`l${l.id}`, () => desfazerLigacao(l.id)); setConfirmar(null); }}>Desfazer o registro</button>
                      <button type="button" className="link-botao" onClick={() => setConfirmar(null)}>Manter</button></>
                  ) : (
                    <> · <button type="button" className="link-botao" onClick={() => setConfirmar(`l${l.id}`)}>Desfazer</button></>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bloco-det">
        <h4>Empresas no Omie</h4>
        {(dados.empresas || []).length === 0 ? <p className="mini">Nenhuma empresa ligada a este número.</p> : (
          <ul className="lista-simples">{dados.empresas.map((e) => <li key={e.codigo}>{e.empresa}{e.cnpj && <span className="mini"> · {e.cnpj}</span>}</li>)}</ul>
        )}
      </section>

      {s && (
        <section className="bloco-det">
          <h4>Última cobrança ({dataCurta(s.dia)})</h4>
          <p><span className="chip"><span className={`bolinha s-${s.situacao}`} aria-hidden="true" />{NOME_SITUACAO[s.situacao] || s.situacao}</span></p>
          {s.motivo && <p className="mini">{s.motivo}</p>}
          {s.atraso_valor > 0 && <p className="mini">Em atraso no Omie: <b>{brl(s.atraso_valor)}</b> ({s.atraso_qtd} {s.atraso_qtd > 1 ? 'títulos' : 'título'})</p>}
        </section>
      )}

      {(dados.eventos || []).length > 0 && (
        <section className="bloco-det">
          <h4>O que a equipe fez</h4>
          <ul className="eventos">
            {dados.eventos.map((ev, i) => (
              <li key={i}><b>{ev.por.split(' ')[0]}</b> {EVENTOS[ev.tipo] || ev.tipo}{ev.detalhe?.etiqueta ? ` "${ev.detalhe.etiqueta}"` : ''}{ev.detalhe?.para ? ` ${ev.detalhe.para}` : ''}{ev.detalhe?.arquivo ? ` (${ev.detalhe.arquivo})` : ''}{ev.detalhe?.dia ? ` (${dataCurta(ev.detalhe.dia)})` : ''}{ev.tipo === 'ligacao' && ev.detalhe?.resultado ? (ev.detalhe.resultado === 'atendida' ? ': atendeu' : ': não atendeu') : ''} <span className="mini">· {quando(ev.em)}</span></li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
