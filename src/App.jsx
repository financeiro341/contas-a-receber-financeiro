import { useCallback, useEffect, useRef, useState } from 'react';
import { aoMudarSessao, lerAtendimento, lerEu, sair, sessaoAtual } from './lib/api.js';
import { dataLonga, diaSemana, diaUtilAnterior, hoje, somarDias } from './utils/formato.js';
import { useDados } from './components/comum.jsx';
import leao from './assets/leao.png';
import Login from './components/Login.jsx';
import Hoje from './components/Hoje.jsx';
import Atendimento from './components/Atendimento.jsx';
import Historico, { INICIO_DADOS } from './components/Historico.jsx';
import Omie from './components/Omie.jsx';
import Conversa from './components/Conversa.jsx';

const ABAS = [
  { id: 'hoje', nome: 'Cobrança do dia', curto: 'Cobrança', icone: 'ti-target-arrow' },
  { id: 'atendimento', nome: 'Atendimento', curto: 'Atendimento', icone: 'ti-messages' },
  { id: 'historico', nome: 'Histórico', curto: 'Histórico', icone: 'ti-chart-line' },
  { id: 'omie', nome: 'Omie', curto: 'Omie', icone: 'ti-building-bank' },
];

function diaInicial() {
  const h = hoje();
  return [0, 6].includes(diaSemana(h)) ? diaUtilAnterior(h) : h;
}

function alternarTema() {
  const r = document.documentElement;
  const escuro = r.getAttribute('data-tema') === 'escuro';
  if (escuro) r.removeAttribute('data-tema'); else r.setAttribute('data-tema', 'escuro');
  try { localStorage.setItem('cr:tema', JSON.stringify({ tema: escuro ? 'claro' : 'escuro' })); } catch { /* sem armazenamento */ }
}

// Quantos clientes esperam resposta agora (contagem da aba Atendimento; só faz sentido hoje).
function ContagemEspera() {
  const { dados } = useDados(() => lerAtendimento(hoje()), [], 120000);
  const lista = dados?.aguardando || [];
  if (!lista.length) return null;
  const atrasado = lista.some((c) => c.minutos > 60);
  return <span className={`contador${atrasado ? ' atrasado' : ''}`} aria-label={`${lista.length} esperando resposta`}>{lista.length}</span>;
}

function SeletorDia({ dia, setDia }) {
  const ehHoje = dia === hoje();
  const mudar = (n) => {
    let d = somarDias(dia, n);
    while ([0, 6].includes(diaSemana(d))) d = somarDias(d, n);
    if (d >= INICIO_DADOS && d <= hoje()) setDia(d);
  };
  return (
    <div className="seletor-dia" role="group" aria-label="Dia">
      <button className="botao-topo icone" type="button" onClick={() => mudar(-1)} aria-label="Dia útil anterior" disabled={dia <= INICIO_DADOS}><i className="ti ti-chevron-left" aria-hidden="true" /></button>
      <label className="so-leitor" htmlFor="dia">Escolher o dia</label>
      <input id="dia" type="date" value={dia} min={INICIO_DADOS} max={hoje()} onChange={(e) => e.target.value && setDia(e.target.value)} />
      <button className="botao-topo icone" type="button" onClick={() => mudar(1)} aria-label="Próximo dia útil" disabled={ehHoje}><i className="ti ti-chevron-right" aria-hidden="true" /></button>
      {ehHoje ? <span className="selo-hoje">Hoje</span> : <button className="botao-topo" type="button" onClick={() => setDia(hoje())}>Hoje</button>}
    </div>
  );
}

export default function App() {
  const [sessao, setSessao] = useState(undefined);
  const [eu, setEu] = useState(null);
  const [aviso, setAviso] = useState('');
  const [aba, setAba] = useState(() => { try { return localStorage.getItem('cr:aba') || 'hoje'; } catch { return 'hoje'; } });
  const [dia, setDia] = useState(diaInicial);
  const [conversa, setConversa] = useState(null);
  const origem = useRef(null);

  useEffect(() => { sessaoAtual().then(setSessao); return aoMudarSessao(setSessao); }, []);
  useEffect(() => {
    if (!sessao) { setEu(null); return; }
    lerEu().then((r) => { setEu(r.usuario); setAviso(''); }).catch(async (e) => {
      if (e.codigo === 401) { setAviso('Seu usuário não tem acesso a este sistema ou a sessão expirou.'); await sair(); }
    });
  }, [sessao]);
  useEffect(() => { try { localStorage.setItem('cr:aba', aba); } catch { /* sem armazenamento */ } }, [aba]);
  useEffect(() => { document.title = `${ABAS.find((a) => a.id === aba)?.nome || ''} · Contas a Receber`; }, [aba]);

  const abrirConversa = useCallback((contato, d) => {
    origem.current = document.activeElement;
    setConversa({ contato, dia: d || dia });
  }, [dia]);
  const fecharConversa = useCallback(() => {
    setConversa(null);
    // O foco volta para quem abriu a conversa.
    setTimeout(() => origem.current?.focus?.(), 0);
  }, []);

  if (sessao === undefined) return <div className="carregando" role="status">Carregando…</div>;
  if (!sessao) return <Login aviso={aviso} />;

  const ehHoje = dia === hoje();
  const abaAtual = ABAS.find((a) => a.id === aba);
  const usaDia = aba !== 'omie';

  return (
    <>
      <header className="topo tema-escuro">
        <div className="faixa">
          <div className="marca"><img src={leao} alt="" /><div><b>Contas a Receber</b><small>Castelo Branco · WhatsApp do financeiro e Omie</small></div></div>
          <div className="espaco" />
          <div className="usuario">
            {eu && <span className="nome-usuario">{eu.nome}</span>}
            <button className="botao-topo icone" type="button" onClick={alternarTema} aria-label="Alternar tema claro ou escuro" title="Tema claro ou escuro"><i className="ti ti-moon" aria-hidden="true" /></button>
            <button className="botao-topo" type="button" onClick={() => sair()}><i className="ti ti-logout" aria-hidden="true" /><span className="rotulo-sair">Sair</span></button>
          </div>
        </div>
        <div className="faixa-abas">
          <nav className="abas" role="tablist" aria-label="Telas">
            {ABAS.map((a) => (
              <button key={a.id} role="tab" type="button" aria-selected={aba === a.id} onClick={() => setAba(a.id)}>
                <i className={`ti ${a.icone}`} aria-hidden="true" /><span className="nome-longo">{a.nome}</span><span className="nome-curto">{a.curto}</span>
                {a.id === 'atendimento' && <ContagemEspera />}
              </button>
            ))}
          </nav>
          {usaDia && <SeletorDia dia={dia} setDia={setDia} />}
        </div>
      </header>
      <main>
        <h1 className="so-leitor">{abaAtual?.nome}</h1>
        {usaDia && <p className="data-pagina">{aba === 'historico' ? `Até ${dataLonga(dia)}` : dataLonga(dia)}</p>}
        {aba === 'hoje' && <Hoje dia={dia} ehHoje={ehHoje} abrirConversa={abrirConversa} />}
        {aba === 'atendimento' && <Atendimento dia={dia} ehHoje={ehHoje} abrirConversa={abrirConversa} />}
        {aba === 'historico' && <Historico dia={dia} abrirDia={(d) => { setDia(d); setAba('hoje'); }} />}
        {aba === 'omie' && <Omie abrirConversa={abrirConversa} />}
      </main>
      {conversa && <Conversa contato={conversa.contato} dia={conversa.dia} aoFechar={fecharConversa} />}
    </>
  );
}
