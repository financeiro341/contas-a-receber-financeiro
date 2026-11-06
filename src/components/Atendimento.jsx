import { lerAtendimento } from '../lib/api.js';
import { dataLonga, inteiro, minutos, pct } from '../utils/formato.js';
import { Barras, Estado, Kpi, Vazio, iniciais, useDados } from './comum.jsx';

// Faixas do tempo até a primeira resposta, com a cor de cada uma (verde rápido, amarelo, vermelho para muito tempo ou nada).
const FAIXAS = [
  ['ate_15', 'Até 15 min', '--sit-pagou'],
  ['ate_60', '15 min a 1 h', '--sit-respondeu'],
  ['ate_240', '1 h a 4 h', '--accent'],
  ['mais_240', 'Mais de 4 h', '--sit-sem'],
  ['sem_resposta', 'Sem resposta', '--sit-sem'],
  ['encerradas', 'Resolvidas', '--sit-boleto'],
];
const horaAgora = () => Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

// Visual novo (06/11/2026). A lista "Esperando resposta" saiu a pedido do Marcus: quem tem mensagem sem ler aparece na aba
// Conversas (filtro Não lidas).
export default function Atendimento({ dia, ehHoje, abrirConversa }) { // eslint-disable-line no-unused-vars
  const { dados: a, erro, carregando, em, recarregar } = useDados(() => lerAtendimento(dia), [dia], ehHoje ? 120000 : 0);
  const f = a?.faixas || {};
  const totalFaixas = (a?.blocos || 0);
  const pessoas = a?.por_pessoa || [];
  const semNome = pessoas.some((p) => p.nome === 'WhatsApp Web' || p.nome === 'WhatsApp no celular');
  const horas = a?.por_hora || [];
  // Eixo de 8h às 18h, alargado se houve mensagem antes ou depois (de 7h a 19h). Hoje vai só até a hora atual, para as
  // horas que ainda não chegaram não virarem barras vazias.
  const comDados = horas.filter((x) => x.hora >= 7 && x.hora <= 19 && x.cliente + x.nos > 0).map((x) => x.hora);
  const ini = Math.min(8, ...comDados);
  const fim = ehHoje ? Math.max(ini, Math.min(19, horaAgora()), ...comDados) : Math.max(18, ...comDados);
  const faixaHoras = [];
  for (let h = ini; h <= fim; h += 1) faixaHoras.push(horas.find((x) => x.hora === h) || { hora: h, cliente: 0, nos: 0 });
  const fora = horas.filter((x) => x.hora < 7 || x.hora > 19).reduce((s, x) => s + x.cliente + x.nos, 0);
  const proporcao = (n, t) => (t ? Math.round(((n || 0) / t) * 100) : 0);

  return (
    <Estado carregando={carregando && !a} erro={!a && erro} recarregar={recarregar}>
      {a && (
        <>
          <div className="cabeca-dia">
            <div>
              <p className="ola">Atendimento pelo WhatsApp</p>
              <p className="data-pagina">{dataLonga(dia)}</p>
            </div>
            <div className="estado-leitura">
              <span><span className="luz ok" aria-hidden="true" />Só conversas de clientes{em ? <>, atualizado às <b>{em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b></> : ''}</span>
              {erro && <span className="selo regras">Falha ao reler: {erro.message}</span>}
            </div>
          </div>

          <section className="grade g-kpi4" aria-label="Indicadores de atendimento">
            <Kpi icone="ti-messages" rotulo="Conversas do dia" valor={inteiro(a.conversas)} apoio={`${inteiro(a.mensagens_cliente)} mensagens de clientes, ${inteiro(a.mensagens_nossas)} nossas`} />
            <Kpi icone="ti-send" rotulo="Primeira resposta" valor={minutos(a.primeira_resposta_mediana_min)} apoio={`mediana do dia, média de ${minutos(a.primeira_resposta_media_min)}`} />
            <Kpi icone="ti-message-check" rotulo="Respondidas" valor={pct(a.respondidos, a.blocos)} apoio={`${inteiro(a.respondidos)} de ${inteiro(a.blocos)} vezes que o cliente escreveu`} barra={proporcao(a.respondidos, a.blocos)} corBarra="--sit-pagou" />
            <Kpi icone="ti-hourglass" rotulo="Tempo de conversa" valor={minutos(a.tempo_conversa_medio_min)} apoio="da primeira à última mensagem, em média" />
          </section>

          <div className="grade grade-atendimento bloco">
            <section className="cartao" aria-labelledby="t-faixas">
              <div className="cartao-topo">
                <h2 id="t-faixas">Tempo até a primeira resposta</h2>
                <span className="mini">cada vez que o cliente escreveu</span>
              </div>
              <div className="faixas-tempo">
                {FAIXAS.filter(([k]) => k !== 'encerradas' || f[k]).map(([k, rot, cor]) => (
                  <div className="faixa-h" key={k}>
                    <span>{rot}</span>
                    <span className="trilha" aria-hidden="true"><i style={{ width: pct(f[k] || 0, totalFaixas), background: `var(${cor})` }} /></span>
                    <b>{inteiro(f[k] || 0)}</b>
                  </div>
                ))}
              </div>
              <div className="faixa-total"><span>Vezes que o cliente escreveu</span><b>{inteiro(totalFaixas)}</b></div>
            </section>
            <section className="cartao grafico-cheio" aria-labelledby="t-hora">
              <div className="cartao-topo">
                <h2 id="t-hora">Mensagens por hora <span className="mini">{ehHoje ? `de ${ini}h até agora` : `de ${ini}h às ${fim}h`}</span></h2>
                <div className="legenda-grafico">
                  <span><span className="bolinha" style={{ background: 'var(--grafico-serie)' }} aria-hidden="true" />do cliente</span>
                  <span><span className="bolinha" style={{ background: 'var(--grafico-destaque)' }} aria-hidden="true" />nossas</span>
                  {fora > 0 && <span>fora das 7h às 19h: {inteiro(fora)}</span>}
                </div>
              </div>
              <Barras
                altura={null}
                rotulos={faixaHoras.map((h) => `${h.hora}h`)}
                series={[
                  { nome: 'do cliente', classe: 'b1', valores: faixaHoras.map((h) => h.cliente) },
                  { nome: 'nossas', classe: 'b2', valores: faixaHoras.map((h) => h.nos) },
                ]}
              />
            </section>
          </div>

          <section className="bloco lista-cobranca" aria-labelledby="t-pessoas">
            <div className="ferramentas">
              <h2 id="t-pessoas">Por pessoa</h2>
              {pessoas.length > 0 && <span className="contagem">{inteiro(pessoas.length)}</span>}
            </div>
            <div className="cartao tabela-cartao">
              {pessoas.length === 0 ? <Vazio icone="ti-user-off" titulo="Ninguém respondeu cliente neste dia" /> : (
                <div className="rolagem">
                  <table className="tabela em-cartoes tabela-pessoas">
                    <thead><tr><th>Quem</th><th className="num">Respostas</th><th className="num">Tempo (mediana)</th><th className="num">Até 15 min</th><th className="num">Mensagens enviadas</th><th className="num">Ligações</th></tr></thead>
                    <tbody>
                      {pessoas.map((p, i) => {
                        const semPessoa = p.nome === 'WhatsApp Web' || p.nome === 'WhatsApp no celular';
                        return (
                          <tr key={p.nome}>
                            <td>
                              <div className="cliente-celula">
                                <span className={`avatar ${semPessoa ? 'av-sem' : `av-cor-${(i + 1) % 6}`}`} aria-hidden="true">
                                  {semPessoa ? <i className={`ti ${p.nome === 'WhatsApp Web' ? 'ti-device-desktop' : 'ti-device-mobile'}`} /> : iniciais(p.nome)}
                                </span>
                                <div className="cliente-texto">
                                  <span className="nome">{p.nome}</span>
                                  <div className="empresa">{semPessoa ? 'sem o nome de quem enviou' : 'pelo sistema'}</div>
                                </div>
                              </div>
                            </td>
                            <td className="num" data-rotulo="Respostas">{inteiro(p.respostas)}</td>
                            <td className="num" data-rotulo="Tempo (mediana)">{p.respostas ? <><b style={{ color: 'var(--text-primary)' }}>{minutos(p.mediana_min)}</b><div className="empresa">média {minutos(p.media_min)}</div></> : '—'}</td>
                            <td className="num" data-rotulo="Até 15 min">
                              {p.respostas ? (
                                <span className="mini-barra">{pct(p.ate_15, p.respostas)}<span className="t" aria-hidden="true"><i style={{ width: pct(p.ate_15, p.respostas) }} /></span></span>
                              ) : '—'}
                            </td>
                            <td className="num" data-rotulo="Mensagens enviadas">{inteiro(p.enviadas)}</td>
                            <td className="num" data-rotulo="Ligações">{semPessoa ? '—' : p.ligacoes ? `${inteiro(p.ligacoes)} (${inteiro(p.lig_atendidas)} ${p.lig_atendidas === 1 ? 'atendida' : 'atendidas'})` : '0'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {semNome && <p className="nota-tabela">O que sai direto pelo WhatsApp não diz quem enviou: aparece como WhatsApp Web ou celular. Respondendo pelo sistema, entra o nome.</p>}
          </section>
        </>
      )}
    </Estado>
  );
}
