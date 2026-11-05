import { useEffect, useRef, useState } from 'react';
import { enviarBoleto, lerTitulos } from '../lib/api.js';
import { brl, dataCurta, hoje } from '../utils/formato.js';
import { preencher } from './RespostasProntas.jsx';

const dataBr = (iso) => (iso ? `${dataCurta(iso)}/${iso.slice(0, 4)}` : '');

export function textoSegundaVia(t, contato, empresas) {
  const base = `Olá, {nome}! Segue a segunda via do boleto${t.categoria && !/^\d/.test(t.categoria) ? ` (${t.categoria.toLowerCase()})` : ''}.`;
  return [
    preencher(base, contato, empresas),
    '',
    `Vencimento: ${dataBr(t.vencimento)}`,
    `Valor: ${brl(t.valor)}`,
    ...(t.codigo_barras ? [`Código de barras: ${t.codigo_barras}`] : []),
  ].join('\n');
}

// Lista os títulos em aberto do cliente no Omie e envia o boleto já emitido, em PDF, com a mensagem.
export default function SegundaVia({ contato, dados, aoFechar, aoEnviado }) {
  const [titulos, setTitulos] = useState(null);
  const [erro, setErro] = useState('');
  const [escolhido, setEscolhido] = useState(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const caixa = useRef(null);
  const h = hoje();

  useEffect(() => {
    let vivo = true;
    lerTitulos(contato).then((r) => { if (vivo) setTitulos(r.titulos || []); }).catch((e) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [contato]);
  useEffect(() => {
    const fora = (e) => { if (!enviando && caixa.current && !caixa.current.contains(e.target) && !e.target.closest?.('.botao-segunda-via')) aoFechar(); };
    const tecla = (e) => { if (e.key === 'Escape' && !enviando) aoFechar(); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [aoFechar, enviando]);

  function escolher(t) {
    setEscolhido(t);
    setTexto(textoSegundaVia(t, dados?.contato, dados?.empresas));
    setErro('');
  }
  async function enviar() {
    setEnviando(true);
    setErro('');
    try {
      await enviarBoleto(contato, escolhido.codigo, texto);
      aoEnviado(`Boleto de ${dataBr(escolhido.vencimento)} enviado.`);
    } catch (e) {
      setErro(e.message);
      setEnviando(false);
    }
  }

  return (
    <div className="respostas segunda-via" ref={caixa} role="dialog" aria-label="Segunda via do boleto">
      <div className="respostas-topo">
        <i className="ti ti-file-invoice" aria-hidden="true" />
        <b style={{ flex: 1 }}>{escolhido ? 'Enviar a segunda via' : 'Segunda via do boleto (Omie)'}</b>
        <button type="button" className="limpar" onClick={aoFechar} disabled={enviando} aria-label="Fechar segunda via"><i className="ti ti-x" aria-hidden="true" /></button>
      </div>
      {erro && <div className="aviso erro" role="alert" style={{ margin: 8 }}>{erro}</div>}
      {escolhido ? (
        <div className="nova-resposta">
          <p className="mini" style={{ margin: 0 }}>{escolhido.empresa} · doc. {escolhido.documento}{escolhido.parcela ? `, parcela ${escolhido.parcela}` : ''}. O PDF do boleto vai junto, com o nome padrão.</p>
          <label className="so-leitor" htmlFor="txt-2via">Mensagem</label>
          <textarea id="txt-2via" rows={6} maxLength={1000} value={texto} onChange={(e) => setTexto(e.target.value)} disabled={enviando} />
          <div className="linha-botoes">
            <button type="button" className="botao principal" onClick={enviar} disabled={enviando}>
              <i className={`ti ${enviando ? 'ti-loader-2 girando' : 'ti-send'}`} aria-hidden="true" />{enviando ? 'Enviando' : 'Enviar boleto'}
            </button>
            <button type="button" className="botao" onClick={() => setEscolhido(null)} disabled={enviando}>Voltar</button>
          </div>
        </div>
      ) : titulos === null && !erro ? (
        <p className="mini" style={{ padding: 12 }}><i className="ti ti-loader-2 girando" aria-hidden="true" /> Consultando o Omie…</p>
      ) : titulos && titulos.length === 0 ? (
        <p className="mini" style={{ padding: 12 }}>Nenhum título em aberto no Omie para {(dados?.empresas || []).length ? 'as empresas deste contato' : 'este contato (nenhuma empresa ligada)'}.</p>
      ) : (
        <ul className="respostas-lista" aria-label="Títulos em aberto">
          {(titulos || []).map((t) => {
            const atrasado = t.vencimento && t.vencimento < h;
            return (
              <li key={t.codigo}>
                <button type="button" className="resposta-item titulo-item" onClick={() => escolher(t)} disabled={!t.boleto}
                  title={t.boleto ? 'Enviar este boleto' : 'Sem boleto emitido no Omie'}>
                  <span className="linha-titulo">
                    <b>{brl(t.valor)}</b>
                    <span className={`etq ${atrasado ? 'cor-vermelho' : 'cor-neutro'}`}>{atrasado ? `Venceu ${dataCurta(t.vencimento)}` : `Vence ${dataBr(t.vencimento)}`}</span>
                    {!t.boleto && <span className="etq cor-amarelo">Sem boleto</span>}
                  </span>
                  <span>{t.categoria ? `${t.categoria} · ` : ''}{t.empresa}{t.parcela ? ` · parcela ${t.parcela}` : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!escolhido && titulos?.some((t) => t.vencimento < h) && (
        <p className="mini" style={{ margin: '0 12px 10px' }}>Boleto vencido vai com a data original; o banco cobra juros e multa do próprio boleto.</p>
      )}
    </div>
  );
}
