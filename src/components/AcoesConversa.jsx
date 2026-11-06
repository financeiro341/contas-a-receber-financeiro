import { useEffect, useRef, useState } from 'react';
import { marcarRetorno, registrarLigacao, resolverConversa } from '../lib/api.js';
import { dataCurta, diaSemana, hoje, somarDias } from '../utils/formato.js';

// Próximo dia útil a partir de amanhã, a próxima segunda e uma semana: os atalhos do retorno.
export function atalhosRetorno(h = hoje()) {
  let util = somarDias(h, 1);
  while ([0, 6].includes(diaSemana(util))) util = somarDias(util, 1);
  let seg = somarDias(h, 1);
  while (diaSemana(seg) !== 1) seg = somarDias(seg, 1);
  const lista = [
    { rotulo: diaSemana(h) === 5 ? 'Segunda' : 'Amanhã', dia: util },
    { rotulo: 'Em 3 dias', dia: somarDias(h, 3) },
    { rotulo: 'Próxima segunda', dia: seg },
    { rotulo: 'Em 1 semana', dia: somarDias(h, 7) },
  ];
  const vistos = new Set();
  return lista.filter((a) => (vistos.has(a.dia) ? false : vistos.add(a.dia)));
}

// "Hoje", "Amanhã", "atrasado desde 03/11" ou "12/11", com a hora quando houver.
export function rotuloRetorno(r, h = hoje()) {
  if (!r) return '';
  const quandoDia = r.dia === h ? 'hoje' : r.dia === somarDias(h, 1) ? 'amanhã' : r.dia < h ? `atrasado (${dataCurta(r.dia)})` : dataCurta(r.dia);
  return `${quandoDia}${r.hora ? ` às ${r.hora}` : ''}`;
}

function usePopover(aberto, fechar) {
  const caixa = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (caixa.current && !caixa.current.contains(e.target) && !e.target.closest?.('.acao-topo')) fechar(); };
    const tecla = (e) => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [aberto, fechar]);
  return caixa;
}

function Ligacao({ contato, aoFechar, aoFeito }) {
  const [direcao, setDirecao] = useState('feita');
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const caixa = usePopover(true, aoFechar);
  async function registrar(resultado) {
    setOcupado(true);
    setErro('');
    try {
      await registrarLigacao(contato, { direcao, resultado, observacao: obs });
      aoFeito(resultado === 'atendida' ? 'Ligação registrada: atendeu.' : 'Ligação registrada: não atendeu.');
    } catch (e) { setErro(e.message); setOcupado(false); }
  }
  return (
    <div className="popover" ref={caixa} role="dialog" aria-label="Registrar ligação">
      <h3><i className="ti ti-phone" aria-hidden="true" />Registrar ligação</h3>
      <div className="periodos" role="group" aria-label="Quem ligou">
        <button type="button" aria-pressed={direcao === 'feita'} onClick={() => setDirecao('feita')}>Nós ligamos</button>
        <button type="button" aria-pressed={direcao === 'recebida'} onClick={() => setDirecao('recebida')}>O cliente ligou</button>
      </div>
      <label className="so-leitor" htmlFor={`obs-lig-${contato}`}>Observação</label>
      <input id={`obs-lig-${contato}`} className="campo" maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional): ex. vai pagar sexta" />
      {erro && <div className="aviso erro" role="alert">{erro}</div>}
      <div className="linha-botoes">
        <button type="button" className="botao principal" disabled={ocupado} onClick={() => registrar('atendida')}><i className="ti ti-phone-check" aria-hidden="true" />Atendeu</button>
        <button type="button" className="botao" disabled={ocupado} onClick={() => registrar('nao_atendida')}><i className="ti ti-phone-x" aria-hidden="true" />Não atendeu</button>
      </div>
      <p className="mini">Conta nas ligações do dia. A leitura do WhatsApp às 17h30 só completa o que ficar sem registro.</p>
    </div>
  );
}

function Retorno({ contato, aoFechar, aoFeito }) {
  const atalhos = atalhosRetorno();
  const [dia, setDia] = useState(atalhos[0].dia);
  const [hora, setHora] = useState('');
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const caixa = usePopover(true, aoFechar);
  const h = hoje();
  async function salvar(ev) {
    ev.preventDefault();
    setOcupado(true);
    setErro('');
    try {
      await marcarRetorno(contato, { dia, hora: hora || null, texto });
      aoFeito(`Retorno marcado para ${rotuloRetorno({ dia, hora })}.`);
    } catch (e) { setErro(e.message); setOcupado(false); }
  }
  return (
    <form className="popover" ref={caixa} onSubmit={salvar} aria-label="Marcar retorno">
      <h3><i className="ti ti-alarm" aria-hidden="true" />Lembrete de retorno</h3>
      <div className="atalhos" role="group" aria-label="Quando">
        {atalhos.map((a) => (
          <button key={a.dia} type="button" className="etq-botao cor-neutro" aria-pressed={dia === a.dia} onClick={() => setDia(a.dia)}>
            {a.rotulo} <span className="mini">{dataCurta(a.dia)}</span>
          </button>
        ))}
      </div>
      <div className="linha-campos">
        <label><span>Dia</span><input type="date" className="campo" value={dia} min={h} max={somarDias(h, 365)} required onChange={(e) => setDia(e.target.value)} /></label>
        <label><span>Hora <span className="mini">(opcional)</span></span><input type="time" className="campo" value={hora} onChange={(e) => setHora(e.target.value)} /></label>
      </div>
      <label className="so-leitor" htmlFor={`txt-ret-${contato}`}>O que fazer</label>
      <input id={`txt-ret-${contato}`} className="campo" maxLength={500} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="O que fazer (opcional): ex. ver se o Pix caiu" />
      {erro && <div className="aviso erro" role="alert">{erro}</div>}
      <div className="linha-botoes">
        <button type="submit" className="botao principal" disabled={ocupado || !dia}>Marcar retorno</button>
        <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
      </div>
      <p className="mini">Aparece no filtro Retornos das Conversas e na Cobrança do dia.</p>
    </form>
  );
}

// Botões do topo da conversa: resolver, registrar ligação e marcar retorno.
export default function AcoesConversa({ contato, resolvida, aoMudar, aoAvisar }) {
  const [aberto, setAberto] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const fechar = () => setAberto(null);
  const feito = (msg) => { setAberto(null); aoAvisar(msg); aoMudar(); };
  async function alternarResolvida() {
    setOcupado(true);
    try {
      await resolverConversa(contato, !resolvida);
      aoAvisar(resolvida ? 'Conversa reaberta.' : 'Conversa resolvida. Volta a ficar em aberto se o cliente escrever de novo.');
      aoMudar();
    } catch (e) { aoAvisar(e.message, true); } finally { setOcupado(false); }
  }
  return (
    <>
      <button type="button" className="botao acao-topo" aria-pressed={!!resolvida} aria-label="Conversa resolvida" disabled={ocupado} onClick={alternarResolvida}
        title={resolvida ? 'Reabrir a conversa' : 'Marcar como resolvida: fica fechada até o cliente escrever de novo'}>
        <i className="ti ti-circle-check" aria-hidden="true" />
        <span className="rotulo-acao">{resolvida ? 'Resolvida' : 'Resolver'}</span>
      </button>
      <button type="button" className="botao icone acao-topo" aria-expanded={aberto === 'ligacao'} onClick={() => setAberto(aberto === 'ligacao' ? null : 'ligacao')} aria-label="Registrar ligação" title="Registrar ligação">
        <i className="ti ti-phone-plus" aria-hidden="true" />
      </button>
      <button type="button" className="botao icone acao-topo" aria-expanded={aberto === 'retorno'} onClick={() => setAberto(aberto === 'retorno' ? null : 'retorno')} aria-label="Marcar retorno" title="Lembrete de retorno">
        <i className="ti ti-alarm-plus" aria-hidden="true" />
      </button>
      {aberto === 'ligacao' && <Ligacao contato={contato} aoFechar={fechar} aoFeito={feito} />}
      {aberto === 'retorno' && <Retorno contato={contato} aoFechar={fechar} aoFeito={feito} />}
    </>
  );
}
