import { useEffect, useMemo, useState } from 'react';
import { hoje, quando } from '../utils/formato.js';
import { Estado, Vazio } from './comum.jsx';
import { rotuloRetorno } from './AcoesConversa.jsx';

const FILTROS = [
  { id: 'esperando', nome: 'Esperando', dica: 'A última mensagem é do cliente e a conversa não foi resolvida' },
  { id: 'sem_ler', nome: 'Sem ler', dica: 'Mensagem do cliente que ninguém abriu' },
  { id: 'retornos', nome: 'Retornos', dica: 'Retorno marcado para hoje ou atrasado' },
  { id: 'minhas', nome: 'Minhas', dica: 'Conversas em que você é o dono' },
  { id: 'todas', nome: 'Todas', dica: 'Todas as conversas do grupo escolhido' },
];
const GRUPOS = [
  { id: 'cliente', nome: 'Clientes' },
  { id: 'a_identificar', nome: 'A identificar' },
  { id: 'todos', nome: 'Todos os contatos' },
];
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function lerFiltros() {
  try { return { filtro: 'todas', grupo: 'cliente', etiqueta: '', ...JSON.parse(localStorage.getItem('cr:caixa') || '{}') }; } catch { return { filtro: 'todas', grupo: 'cliente', etiqueta: '' }; }
}

export function Iniciais({ nome }) {
  const p = String(nome || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  const ini = ((p[0]?.[0] || '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  return <span className="avatar" aria-hidden="true">{ini}</span>;
}

export function ChipEtiqueta({ e }) {
  return <span className={`etq cor-${e.cor}`}>{e.nome}</span>;
}

// Aviso do navegador para mensagem nova de cliente (quando o sistema está em outra aba ou minimizado).
function BotaoAviso() {
  const suporta = typeof Notification !== 'undefined';
  const [estado, setEstado] = useState(suporta ? Notification.permission : 'denied');
  if (!suporta) return null;
  if (estado === 'granted') return <span className="mini botao-aviso" title="O navegador avisa quando chega mensagem nova de cliente e o sistema não está na tela"><i className="ti ti-bell-ringing" aria-hidden="true" /> Avisos ligados</span>;
  if (estado === 'denied') return <span className="mini botao-aviso" title="Os avisos foram bloqueados neste navegador. Libere no cadeado da barra de endereço."><i className="ti ti-bell-off" aria-hidden="true" /> Avisos bloqueados</span>;
  return (
    <button type="button" className="link-botao botao-aviso" style={{ margin: 0 }} onClick={() => Notification.requestPermission().then(setEstado)}>
      <i className="ti ti-bell" aria-hidden="true" />Avisar mensagem nova
    </button>
  );
}

export default function CaixaLista({ itens, carregando, erro, recarregar, aberto, aoAbrir, eu, etiquetas }) {
  const [f, setF] = useState(lerFiltros);
  const [busca, setBusca] = useState('');
  useEffect(() => { try { localStorage.setItem('cr:caixa', JSON.stringify(f)); } catch { /* sem armazenamento */ } }, [f]);

  const doGrupo = useMemo(() => itens.filter((c) => f.grupo === 'todos' || c.situacao === f.grupo), [itens, f.grupo]);
  const h = hoje();
  const passa = (c, filtro) => (filtro === 'esperando' ? !c.ultima_de_nos && !c.resolvida
    : filtro === 'sem_ler' ? c.sem_ler > 0
      : filtro === 'retornos' ? !!c.retorno && c.retorno.dia <= h
      : filtro === 'minhas' ? c.dono?.id === eu?.id
        : true);
  const contagem = useMemo(() => Object.fromEntries(FILTROS.map((x) => [x.id, doGrupo.filter((c) => passa(c, x.id)).length])), [doGrupo, eu]); // eslint-disable-line react-hooks/exhaustive-deps
  const lista = useMemo(() => {
    const q = semAcento(busca);
    const ordem = f.filtro === 'retornos'
      ? (a, b) => (a.retorno.dia + (a.retorno.hora || '99')).localeCompare(b.retorno.dia + (b.retorno.hora || '99'))
      : null;
    const filtrada = doGrupo.filter((c) => passa(c, f.filtro)
      && (!f.etiqueta || (c.etiquetas || []).some((e) => String(e.id) === f.etiqueta))
      && (!q || semAcento(c.nome).includes(q) || String(c.telefone || '').includes(q.replace(/\D/g, '') || '§')
        || (c.empresas || []).some((e) => semAcento(e).includes(q))));
    return ordem ? filtrada.sort(ordem) : filtrada;
  }, [doGrupo, f, busca, eu, h]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="caixa-painel caixa-lista" aria-label="Conversas">
      <div className="caixa-ferramentas">
        <div className="busca">
          <i className="ti ti-search" aria-hidden="true" />
          <input type="search" placeholder="Buscar nome, empresa ou telefone" aria-label="Buscar conversa" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="linha-filtros">
          <label className="so-leitor" htmlFor="grupo">Contatos</label>
          <select id="grupo" value={f.grupo} onChange={(e) => setF({ ...f, grupo: e.target.value })}>
            {GRUPOS.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
          </select>
          <label className="so-leitor" htmlFor="etq">Etiqueta</label>
          <select id="etq" value={f.etiqueta} onChange={(e) => setF({ ...f, etiqueta: e.target.value })}>
            <option value="">Todas as etiquetas</option>
            {etiquetas.map((e) => <option key={e.id} value={String(e.id)}>{e.nome}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><BotaoAviso /></div>
        <div className="periodos filtros-caixa" role="group" aria-label="Mostrar">
          {FILTROS.map((x) => (
            <button key={x.id} type="button" aria-pressed={f.filtro === x.id} title={x.dica} onClick={() => setF({ ...f, filtro: x.id })}>
              {x.nome} <span className="n">{contagem[x.id]}</span>
            </button>
          ))}
        </div>
      </div>
      <Estado carregando={carregando} erro={erro} recarregar={recarregar} forma="lista">
        {lista.length === 0 ? (
          <Vazio icone={f.filtro === 'sem_ler' ? 'ti-checks' : f.filtro === 'retornos' ? 'ti-alarm-off' : 'ti-message-off'}
            titulo={f.filtro === 'sem_ler' ? 'Nada sem ler' : f.filtro === 'retornos' ? 'Nenhum retorno para hoje' : 'Nenhuma conversa aqui'}
            texto={busca ? 'Tente outra busca.' : f.filtro === 'retornos' ? 'Para marcar, abra a conversa e use o botão do despertador.' : 'Troque o filtro para ver outras conversas.'} />
        ) : (
          <ul className="caixa-itens">
            {lista.map((c) => (
              <li key={c.contato_id}>
                <button type="button" className="caixa-item" data-contato={c.contato_id} aria-current={aberto === c.contato_id ? 'true' : undefined} onClick={() => aoAbrir(c.contato_id)}>
                  <Iniciais nome={c.nome} />
                  <span className="meio">
                    <span className="linha1">
                      <span className="quem">{c.nome}</span>
                      <span className={`hora${c.sem_ler ? ' forte' : ''}`}>{quando(c.ultima_em)}</span>
                    </span>
                    {(c.empresas || []).length > 0 && <span className="empresa">{c.empresas[0]}{c.empresas.length > 1 ? ` +${c.empresas.length - 1}` : ''}</span>}
                    <span className="linha2">
                      <span className="previa">
                        {c.ultima_de_nos && <i className="ti ti-arrow-back-up" aria-label="Nossa:" />}
                        {c.ultima_texto || (c.ultima_tipo === 'audioMessage' ? 'Áudio' : c.ultima_tipo === 'imageMessage' ? 'Imagem' : 'Mensagem')}
                      </span>
                      {c.sem_ler > 0 && <span className="contador" aria-label={`${c.sem_ler} sem ler`}>{c.sem_ler}</span>}
                    </span>
                    {(c.dono || c.retorno || c.resolvida || (c.etiquetas || []).length > 0) && (
                      <span className="linha3">
                        {c.retorno && <span className={`etq marca-retorno${c.retorno.dia <= h ? ' vence' : ''}`}><i className="ti ti-alarm" aria-hidden="true" />Retorno {rotuloRetorno(c.retorno, h)}</span>}
                        {c.resolvida && <span className="etq marca-resolvida"><i className="ti ti-circle-check" aria-hidden="true" />Resolvida</span>}
                        {c.dono &&<span className="dono"><i className="ti ti-user" aria-hidden="true" />{c.dono.id === eu?.id ? 'Você' : c.dono.nome.split(' ')[0]}</span>}
                        {(c.etiquetas || []).slice(0, 2).map((e) => <ChipEtiqueta key={e.id} e={e} />)}
                        {(c.etiquetas || []).length > 2 && <span className="etq cor-neutro">+{c.etiquetas.length - 2}</span>}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Estado>
    </section>
  );
}
