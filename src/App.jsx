import { useCallback, useEffect, useRef, useState } from 'react';
import { aoMudarSessao, lerAtendimento, lerCaixa, lerEu, sair, sessaoAtual } from './lib/api.js';
import { dataLonga, diaSemana, diaUtilAnterior, hoje, somarDias } from './utils/formato.js';
import { useDados } from './components/comum.jsx';
import leao from './assets/leao.png';
import Login from './components/Login.jsx';
import { alternarTema } from './utils/tema.js';
import Hoje from './components/Hoje.jsx';
import Atendimento from './components/Atendimento.jsx';
import Historico, { INICIO_DADOS } from './components/Historico.jsx';
import Omie from './components/Omie.jsx';
import Conversa from './components/Conversa.jsx';
import Caixa from './components/Caixa.jsx';

const ABAS = [
  { id: 'hoje', nome: 'Cobrança do dia', curto: 'Cobrança', icone: 'ti-target-arrow' },
  { id: 'conversas', nome: 'Conversas', curto: 'Conversas', icone: 'ti-brand-whatsapp' },
  { id: 'atendimento', nome: 'Atendimento', curto: 'Atendimento', icone: 'ti-messages' },
  { id: 'historico', nome: 'Histórico', curto: 'Histórico', icone: 'ti-chart-line' },
  { id: 'omie', nome: 'Omie', curto: 'Omie', icone: 'ti-building-bank' },
];

function diaInicial() {
  const h = hoje();
  return [0, 6].includes(diaSemana(h)) ? diaUtilAnterior(h) : h;
}

// Na aba Atendimento: quantos clientes esperam resposta hoje com a última mensagem ainda não lida.
// Quem já foi lido e não respondido fica fora do número (pode ser um "obrigado" que encerra a conversa).
function ContagemEspera() {
  const { dados } = useDados(() => lerAtendimento(hoje()), [], 120000);
  const lista = (dados?.aguardando || []).filter((c) => c.lida === false);
  if (!lista.length) return null;
  const atrasado = lista.some((c) => c.minutos > 60);
  return <span className={`contador${atrasado ? ' atrasado' : ''}`} aria-label={`${lista.length} sem ler`} title={`${lista.length} ${lista.length > 1 ? 'mensagens' : 'mensagem'} de cliente sem ler`}>{lista.length}</span>;
}

// Na aba Conversas: quantas conversas de clientes têm mensagem sem ler (últimos 30 dias).
// Com a aba do navegador em segundo plano e o aviso permitido, avisa a mensagem nova de cliente.
function ContagemSemLer({ aoContar, aoAbrir }) {
  const { dados } = useDados(() => lerCaixa(30), [], 30000);
  const antes = useRef(null);
  const lista = (dados || []).filter((c) => c.situacao === 'cliente' && c.sem_ler > 0);
  const n = lista.length;
  useEffect(() => { aoContar?.(n); }, [n, aoContar]);
  useEffect(() => {
    if (!dados) return;
    const agora = new Map(lista.map((c) => [c.contato_id, c.ultima_em]));
    if (antes.current && document.visibilityState !== 'visible' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const novas = lista.filter((c) => !c.ultima_de_nos && antes.current.get(c.contato_id) !== c.ultima_em);
      if (novas.length) {
        try {
          const aviso = new Notification(novas.length > 1 ? `${novas.length} mensagens novas de clientes` : `Mensagem nova de ${novas[0].nome}`, {
            body: novas.length > 1 ? novas.map((c) => c.nome).slice(0, 4).join(', ') : (novas[0].ultima_texto || ''), tag: 'cr-caixa', icon: '/apple-touch-icon.png',
          });
          aviso.onclick = () => { window.focus(); aoAbrir?.(novas[0].contato_id); aviso.close(); };
        } catch { /* navegador sem aviso */ }
      }
    }
    antes.current = agora;
  }, [dados]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!n) return null;
  return <span className="contador" aria-label={`${n} sem ler`}>{n}</span>;
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
  const [pedidoCaixa, setPedidoCaixa] = useState(null);
  const [semLer, setSemLer] = useState(0);
  const origem = useRef(null);
  const topo = useRef(null);

  // Altura do topo em uma variável de CSS, para a caixa de entrada ocupar o resto da tela.
  useEffect(() => {
    const el = topo.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--alt-topo', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  });

  useEffect(() => { sessaoAtual().then(setSessao); return aoMudarSessao(setSessao); }, []);
  useEffect(() => {
    if (!sessao) { setEu(null); return; }
    lerEu().then((r) => { setEu(r.usuario); setAviso(''); }).catch(async (e) => {
      if (e.codigo === 401) { setAviso('Seu usuário não tem acesso a este sistema ou a sessão expirou.'); await sair(); }
    });
  }, [sessao]);
  useEffect(() => { try { localStorage.setItem('cr:aba', aba); } catch { /* sem armazenamento */ } }, [aba]);
  useEffect(() => { document.title = `${semLer ? `(${semLer}) ` : ''}${ABAS.find((a) => a.id === aba)?.nome || ''} · Contas a Receber`; }, [aba, semLer]);

  const abrirConversa = useCallback((contato, d) => {
    origem.current = document.activeElement;
    setConversa({ contato, dia: d || dia });
  }, [dia]);
  const abrirNaCaixa = useCallback((contato) => {
    setConversa(null);
    setPedidoCaixa({ id: contato, em: Date.now() });
    setAba('conversas');
  }, []);
  const fecharConversa = useCallback(() => {
    setConversa(null);
    // O foco volta para quem abriu a conversa.
    setTimeout(() => origem.current?.focus?.(), 0);
  }, []);

  if (sessao === undefined) return <div className="carregando" role="status">Carregando…</div>;
  if (!sessao) return <Login aviso={aviso} />;

  const ehHoje = dia === hoje();
  const abaAtual = ABAS.find((a) => a.id === aba);
  const usaDia = aba !== 'omie' && aba !== 'conversas';

  return (
    <>
      <header className="topo tema-escuro" ref={topo}>
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
                {a.id === 'conversas' && <ContagemSemLer aoContar={setSemLer} aoAbrir={abrirNaCaixa} />}
              </button>
            ))}
          </nav>
          {usaDia && <SeletorDia dia={dia} setDia={setDia} />}
        </div>
      </header>
      <main className={aba === 'conversas' ? 'main-caixa' : undefined}>
        <h1 className="so-leitor">{abaAtual?.nome}</h1>
        {usaDia && <p className="data-pagina">{aba === 'historico' ? `Até ${dataLonga(dia)}` : dataLonga(dia)}</p>}
        {aba === 'hoje' && <Hoje dia={dia} ehHoje={ehHoje} abrirConversa={abrirConversa} abrirNaCaixa={abrirNaCaixa} />}
        {aba === 'conversas' && <Caixa eu={eu} contatoPedido={pedidoCaixa} />}
        {aba === 'atendimento' && <Atendimento dia={dia} ehHoje={ehHoje} abrirConversa={abrirConversa} />}
        {aba === 'historico' && <Historico dia={dia} abrirDia={(d) => { setDia(d); setAba('hoje'); }} />}
        {aba === 'omie' && <Omie abrirConversa={abrirConversa} />}
      </main>
      {conversa && <Conversa contato={conversa.contato} dia={conversa.dia} aoFechar={fecharConversa} abrirNaCaixa={abrirNaCaixa} />}
    </>
  );
}
