import { useCallback, useEffect, useState } from 'react';
import { aoMudarSessao, lerEu, sair, sessaoAtual } from './lib/api.js';
import { dataLonga, diaSemana, diaUtilAnterior, hoje, somarDias } from './utils/formato.js';
import leao from './assets/leao.png';
import Login from './components/Login.jsx';
import Hoje from './components/Hoje.jsx';
import Atendimento from './components/Atendimento.jsx';
import Historico, { INICIO_DADOS } from './components/Historico.jsx';
import Omie from './components/Omie.jsx';
import Conversa from './components/Conversa.jsx';

const ABAS = [
  { id: 'hoje', nome: 'Cobrança do dia', icone: 'ti-target-arrow' },
  { id: 'atendimento', nome: 'Atendimento', icone: 'ti-messages' },
  { id: 'historico', nome: 'Histórico', icone: 'ti-chart-line' },
  { id: 'omie', nome: 'Omie', icone: 'ti-building-bank' },
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

export default function App() {
  const [sessao, setSessao] = useState(undefined);
  const [eu, setEu] = useState(null);
  const [aviso, setAviso] = useState('');
  const [aba, setAba] = useState(() => { try { return localStorage.getItem('cr:aba') || 'hoje'; } catch { return 'hoje'; } });
  const [dia, setDia] = useState(diaInicial);
  const [conversa, setConversa] = useState(null);

  useEffect(() => { sessaoAtual().then(setSessao); return aoMudarSessao(setSessao); }, []);
  useEffect(() => {
    if (!sessao) { setEu(null); return; }
    lerEu().then((r) => { setEu(r.usuario); setAviso(''); }).catch(async (e) => {
      if (e.codigo === 401) { setAviso('Seu usuário não tem acesso a este sistema ou a sessão expirou.'); await sair(); }
    });
  }, [sessao]);
  useEffect(() => { try { localStorage.setItem('cr:aba', aba); } catch { /* sem armazenamento */ } }, [aba]);
  useEffect(() => { document.title = `${ABAS.find((a) => a.id === aba)?.nome || ''} · Contas a Receber`; }, [aba]);

  const abrirConversa = useCallback((contato, d) => setConversa({ contato, dia: d || dia }), [dia]);
  const fecharConversa = useCallback(() => setConversa(null), []);

  if (sessao === undefined) return <div className="carregando" role="status">Carregando…</div>;
  if (!sessao) return <Login aviso={aviso} />;

  const ehHoje = dia === hoje();
  const mudarDia = (n) => {
    let d = somarDias(dia, n);
    while ([0, 6].includes(diaSemana(d))) d = somarDias(d, n);
    if (d >= INICIO_DADOS && d <= hoje()) setDia(d);
  };

  return (
    <>
      <header className="topo">
        <div className="faixa">
          <div className="marca"><img src={leao} alt="" /><div><b>Contas a Receber</b><small>Castelo Branco · WhatsApp do financeiro e Omie</small></div></div>
          <div className="espaco" />
          <div className="usuario">
            {eu && <span>{eu.nome}</span>}
            <button className="botao-topo" type="button" onClick={alternarTema} aria-label="Alternar tema claro ou escuro"><i className="ti ti-moon" aria-hidden="true" /></button>
            <button className="botao-topo" type="button" onClick={() => sair()}><i className="ti ti-logout" aria-hidden="true" />Sair</button>
          </div>
        </div>
        <nav className="abas" role="tablist" aria-label="Telas">
          {ABAS.map((a) => (
            <button key={a.id} role="tab" type="button" aria-selected={aba === a.id} onClick={() => setAba(a.id)}>
              <i className={`ti ${a.icone}`} aria-hidden="true" />{a.nome}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <div className="cabeca">
          <div>
            <h1>{ABAS.find((a) => a.id === aba)?.nome}</h1>
            {aba !== 'omie' && <p>{aba === 'historico' ? `Até ${dataLonga(dia)}` : dataLonga(dia)}{ehHoje && aba !== 'historico' ? ' (hoje)' : ''}</p>}
          </div>
          {aba !== 'omie' && (
            <div className="seletor-dia">
              <button className="botao icone" type="button" onClick={() => mudarDia(-1)} aria-label="Dia útil anterior" disabled={dia <= INICIO_DADOS}><i className="ti ti-chevron-left" aria-hidden="true" /></button>
              <label className="so-leitor" htmlFor="dia">Escolher o dia</label>
              <input id="dia" type="date" value={dia} min={INICIO_DADOS} max={hoje()} onChange={(e) => e.target.value && setDia(e.target.value)} />
              <button className="botao icone" type="button" onClick={() => mudarDia(1)} aria-label="Próximo dia útil" disabled={ehHoje}><i className="ti ti-chevron-right" aria-hidden="true" /></button>
              {!ehHoje && <button className="botao" type="button" onClick={() => setDia(hoje())}>Hoje</button>}
            </div>
          )}
        </div>
        {aba === 'hoje' && <Hoje dia={dia} ehHoje={ehHoje} abrirConversa={abrirConversa} />}
        {aba === 'atendimento' && <Atendimento dia={dia} ehHoje={ehHoje} abrirConversa={abrirConversa} />}
        {aba === 'historico' && <Historico dia={dia} abrirDia={(d) => { setDia(d); setAba('hoje'); }} />}
        {aba === 'omie' && <Omie abrirConversa={abrirConversa} />}
      </main>
      {conversa && <Conversa contato={conversa.contato} dia={conversa.dia} aoFechar={fecharConversa} />}
    </>
  );
}
