import { lerAtendimento } from '../lib/api.js';
import { inteiro, minutos, pct } from '../utils/formato.js';
import { Barras, Estado, Kpi, Vazio, useDados } from './comum.jsx';

function tomEspera(m) { return m <= 15 ? 'ok' : m <= 60 ? 'atencao' : 'atraso'; }

// Como no Umbler: "Esperando" = conversas em que a última mensagem do dia é do cliente.
export default function Atendimento({ dia, ehHoje, abrirConversa }) {
  const { dados: a, erro, carregando, em, recarregar } = useDados(() => lerAtendimento(dia), [dia], ehHoje ? 120000 : 0);
  const f = a?.faixas || {};
  const totalFaixas = (a?.blocos || 0);
  const FAIXAS = [['ate_15', 'Até 15 min'], ['ate_60', '15 min a 1 h'], ['ate_240', '1 h a 4 h'], ['mais_240', 'Mais de 4 h'], ['sem_resposta', 'Sem resposta']];
  const horas = a?.por_hora || [];
  // Eixo de 8h às 18h, alargado só se houve mensagem antes ou depois (até 7h e 19h).
  const comDados = horas.filter((x) => x.hora >= 7 && x.hora <= 19 && x.cliente + x.nos > 0).map((x) => x.hora);
  const ini = Math.min(8, ...comDados);
  const fim = Math.max(18, ...comDados);
  const faixaHoras = [];
  for (let h = ini; h <= fim; h += 1) faixaHoras.push(horas.find((x) => x.hora === h) || { hora: h, cliente: 0, nos: 0 });
  const fora = horas.filter((x) => x.hora < 7 || x.hora > 19).reduce((s, x) => s + x.cliente + x.nos, 0);

  return (
    <Estado carregando={carregando && !a} erro={!a && erro} recarregar={recarregar}>
      {a && (
        <>
          <div className="linha-status">
            <span><i className="ti ti-filter" aria-hidden="true" /> Só conversas de clientes</span>
            {em && <span>· atualizado às {em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{ehHoje ? ', relê a cada 2 min' : ''}</span>}
          </div>
          <div className="grade g-lado">
            <section className="cartao destaque" aria-labelledby="t-espera">
              <h2 id="t-espera"><i className="ti ti-user-exclamation" aria-hidden="true" />Esperando resposta ({a.aguardando.length})</h2>
              <div className="sub">A última mensagem é do cliente{ehHoje ? '; a mais antiga primeiro' : ' (como o dia terminou)'}.</div>
              {a.aguardando.length === 0 ? <Vazio icone="ti-circle-check" titulo="Ninguém esperando resposta" texto={ehHoje ? 'Todas as conversas de hoje estão respondidas.' : 'O dia terminou sem cliente esperando.'} /> : (
                <ul className="fila" tabIndex={a.aguardando.length > 6 ? 0 : undefined} aria-label="Clientes esperando resposta">
                  {a.aguardando.map((c) => (
                    <li key={c.contato_id}>
                      <button type="button" onClick={() => abrirConversa(c.contato_id)}>
                        <span className={`espera ${tomEspera(c.minutos)}`}>{ehHoje ? minutos(c.minutos) : c.desde}</span>
                        <span style={{ minWidth: 0 }}><span className="quem">{c.nome}</span><span className="texto" style={{ display: 'block' }}>{c.texto.trim() || 'Arquivo ou mídia'}</span></span>
                        <span className="desde">desde {c.desde}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="grade g-2 kpis-lado" aria-label="Indicadores de atendimento">
              <Kpi icone="ti-messages" rotulo="Conversas do dia" valor={inteiro(a.conversas)} apoio={`${inteiro(a.mensagens_cliente)} mensagens de clientes · ${inteiro(a.mensagens_nossas)} nossas`} />
              <Kpi icone="ti-clock-play" rotulo="Primeira resposta (mediana)" valor={minutos(a.primeira_resposta_mediana_min)} apoio={`Média: ${minutos(a.primeira_resposta_media_min)}`} />
              <Kpi icone="ti-message-check" rotulo="Mensagens respondidas" valor={pct(a.respondidos, a.blocos)} apoio={`${inteiro(a.respondidos)} de ${inteiro(a.blocos)} vezes que o cliente escreveu`} />
              <Kpi icone="ti-hourglass" rotulo="Tempo médio de conversa" valor={minutos(a.tempo_conversa_medio_min)} apoio="Da primeira à última mensagem do dia" />
            </section>
          </div>

          <div className="grade g-lado bloco">
            <section className="cartao" aria-labelledby="t-hora">
              <h2 id="t-hora"><i className="ti ti-chart-bar" aria-hidden="true" />Mensagens por hora</h2>
              <div className="sub" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span><span className="bolinha" style={{ background: 'var(--grafico-serie)' }} aria-hidden="true" /> Do cliente</span>
                <span><span className="bolinha" style={{ background: 'var(--grafico-destaque)' }} aria-hidden="true" /> Nossas</span>
                {fora > 0 && <span>Fora das 7h às 19h: {fora}</span>}
              </div>
              <Barras
                rotulos={faixaHoras.map((h) => `${h.hora}h`)}
                series={[
                  { nome: 'do cliente', classe: 'b1', valores: faixaHoras.map((h) => h.cliente) },
                  { nome: 'nossas', classe: 'b2', valores: faixaHoras.map((h) => h.nos) },
                ]}
              />
            </section>
            <section className="cartao" aria-labelledby="t-faixas">
              <h2 id="t-faixas"><i className="ti ti-stopwatch" aria-hidden="true" />Tempo até a primeira resposta</h2>
              <div className="sub">Cada vez que o cliente escreveu, quanto tempo levamos para responder.</div>
              <div style={{ marginTop: 10 }}>
                {FAIXAS.map(([k, rot]) => (
                  <div className="faixa-h" key={k}>
                    <span>{rot}</span>
                    <span className="trilha" aria-hidden="true"><i style={{ width: pct(f[k] || 0, totalFaixas), background: k === 'sem_resposta' ? 'var(--danger)' : undefined }} /></span>
                    <b>{inteiro(f[k] || 0)}</b>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </Estado>
  );
}
