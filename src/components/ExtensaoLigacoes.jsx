import { useEffect, useState } from 'react';
import { desligarExtensao, gerarCodigoExtensao, lerExtensoes } from '../lib/api.js';
import { quando } from '../utils/formato.js';

// Ligações automáticas (06/11/2026): a extensão do Chrome no computador da Maria Clara lê as ligações do WhatsApp Web
// e grava aqui. Só administrador vê este quadro, gera o código de ligação e desliga um computador.
const UMA_HORA = 60 * 60 * 1000;

export default function ExtensaoLigacoes() {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [nome, setNome] = useState('Maria Clara (174)');
  const [codigo, setCodigo] = useState(null); // { nome, codigo } mostrado uma vez só
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    try { setLista(await lerExtensoes()); setErro(''); } catch (e) { setErro(e.message); }
  }
  useEffect(() => { carregar(); const t = setInterval(carregar, 60_000); return () => clearInterval(t); }, []);

  async function gerar() {
    setOcupado(true);
    try { const r = await gerarCodigoExtensao(nome.trim()); setCodigo(r); await carregar(); } catch (e) { setErro(e.message); }
    setOcupado(false);
  }
  async function desligar(a) {
    if (!window.confirm(`Desligar a extensão em "${a.nome}"? Ela para de gravar até receber um código novo.`)) return;
    try { await desligarExtensao(a.id); await carregar(); } catch (e) { setErro(e.message); }
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(codigo.codigo); } catch { /* sem permissão: a pessoa copia à mão */ }
  }

  const ativos = (lista || []).filter((a) => !a.revogado_em);
  return (
    <section className="cartao bloco" aria-labelledby="t-extensao">
      <h2 id="t-extensao"><i className="ti ti-phone-call" aria-hidden="true" />Ligações automáticas (extensão do Chrome)</h2>
      <div className="sub">A extensão lê as ligações do WhatsApp Web no computador onde está instalada e grava aqui a cada 5 minutos.</div>
      {erro && <div className="aviso erro" role="alert"><i className="ti ti-alert-triangle" aria-hidden="true" />{erro}</div>}

      {ativos.length > 0 && (
        <ul className="lista-extensao">
          {ativos.map((a) => {
            const parado = !a.ultimo_contato || Date.now() - Date.parse(a.ultimo_contato) > UMA_HORA;
            return (
              <li key={a.id}>
                <span className={`etq ${parado ? 'cor-vermelho' : 'cor-verde'}`}>{parado ? 'sem notícia há mais de 1 hora' : 'funcionando'}</span>
                <b>{a.nome}</b>
                <span className="mini">{a.ultimo_contato ? `último envio ${quando(a.ultimo_contato)}` : 'ainda não enviou'}{a.ultima_versao ? ` · versão ${a.ultima_versao}` : ''}{a.ultimo_resumo?.leitura?.lidas != null ? ` · ${a.ultimo_resumo.leitura.lidas} ligações lidas hoje` : ''}</span>
                <button type="button" className="link-botao" onClick={() => desligar(a)}>Desligar</button>
              </li>
            );
          })}
        </ul>
      )}

      {codigo ? (
        <div className="aviso" role="status">
          <div style={{ flex: 1 }}>
            <b>Código de "{codigo.nome}"</b> (aparece só agora; cole nas opções da extensão e feche este aviso):
            <code className="codigo-extensao">{codigo.codigo}</code>
          </div>
          <button type="button" className="botao" onClick={copiar}><i className="ti ti-copy" aria-hidden="true" />Copiar</button>
          <button type="button" className="botao" onClick={() => setCodigo(null)}>Fechar</button>
        </div>
      ) : (
        <div className="extensao-novo">
          <label htmlFor="nome-extensao" className="mini">Computador</label>
          <input id="nome-extensao" value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} />
          <button type="button" className="botao" disabled={ocupado || !nome.trim()} onClick={gerar}>
            <i className="ti ti-key" aria-hidden="true" />Gerar código de ligação
          </button>
        </div>
      )}
    </section>
  );
}
