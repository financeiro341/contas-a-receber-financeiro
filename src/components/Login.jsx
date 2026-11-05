import { useRef, useState } from 'react';
import { entrar } from '../lib/api.js';
import { dataLonga, hoje, saudacao } from '../utils/formato.js';
import { alternarTema, temaAtual } from '../utils/tema.js';
import leao from '../assets/leao.png';

// Entrada no mesmo molde do Painel de Demandas: painel da marca (azul-marinho, grade fina, brilho dourado e uma
// prévia desenhada do sistema) ao lado do formulário. Mesmo usuário e senha do Painel; sem cadastro aqui.
// A prévia é só ilustração: nenhum cliente, conversa ou número aparece antes do login.
export default function Login({ aviso }) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [caps, setCaps] = useState(false);
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [tema, setTema] = useState(temaAtual);
  const campoSenha = useRef(null);

  async function enviar(e) {
    e.preventDefault();
    if (!login.trim() || !senha) { setErro('Informe o usuário e a senha.'); return; }
    setErro(''); setVerSenha(false); setEntrando(true);
    try { await entrar(login, senha); } catch (f) {
      setErro(f.message); setSenha(''); setEntrando(false);
      campoSenha.current?.focus();
    }
  }

  const conferirCaps = (e) => setCaps(e.getModifierState?.('CapsLock') === true);
  const data = dataLonga(hoje());

  return (
    <main className="ent">
      <div className="ent-marca tema-escuro">
        <div className="ent-grade" aria-hidden="true" />
        <div className="ent-logo">
          <span className="ent-selo" aria-hidden="true"><img src={leao} alt="" /></span>
          <span>
            <span className="ent-nome">Contas a Receber</span>
            <span className="ent-sub">Cobrança e conversas do financeiro</span>
          </span>
        </div>
        <div className="ent-ola">
          <p className="ent-data">{data.charAt(0).toUpperCase() + data.slice(1)}</p>
          <p className="ent-titulo">{saudacao()}, Financeiro.</p>
          <p className="ent-apoio">Entre para acompanhar a cobrança do dia e responder os clientes pelo WhatsApp do financeiro.</p>
        </div>
        <Previa />
        <p className="ent-rodape">Castelo Branco Contabilidade · Feira de Santana, BA</p>
      </div>

      <div className="ent-lado">
        <form className="ent-form" onSubmit={enviar} noValidate>
          <div>
            <h1>Entrar</h1>
            <p className="ent-dica">Use o mesmo usuário e senha do Painel de Demandas.</p>
          </div>
          {aviso && <div id="ent-aviso" className="aviso" role="status"><i className="ti ti-clock" aria-hidden="true" />{aviso}</div>}

          <label className="ent-campo">
            <span>Usuário</span>
            <span className="ent-caixa">
              <i className="ti ti-user" aria-hidden="true" />
              <input name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                placeholder="nome.sobrenome" value={login} onChange={(e) => setLogin(e.target.value)} readOnly={entrando}
                aria-invalid={erro ? true : undefined} aria-describedby={[erro && 'ent-erro', aviso && 'ent-aviso'].filter(Boolean).join(' ') || undefined}
                autoFocus />
            </span>
          </label>

          <label className="ent-campo">
            <span>Senha</span>
            <span className="ent-caixa">
              <i className="ti ti-lock" aria-hidden="true" />
              <input ref={campoSenha} name="password" type={verSenha ? 'text' : 'password'} autoComplete="current-password"
                spellCheck={false} autoCapitalize="none" autoCorrect="off" value={senha}
                onChange={(e) => setSenha(e.target.value)} onKeyDown={conferirCaps} onKeyUp={conferirCaps} onBlur={() => setCaps(false)}
                readOnly={entrando} aria-invalid={erro ? true : undefined}
                aria-describedby={[erro && 'ent-erro', caps && 'ent-caps'].filter(Boolean).join(' ') || undefined} />
              <button type="button" className="ent-olho" aria-label="Mostrar a senha" aria-pressed={verSenha} title="Mostrar a senha"
                onClick={() => setVerSenha((v) => !v)}>
                <i className={`ti ${verSenha ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
              </button>
            </span>
          </label>

          <div aria-live="polite" className={caps ? '' : 'ent-vazio'}>
            {caps && <div id="ent-caps" className="aviso"><i className="ti ti-arrow-big-up-lines" aria-hidden="true" />Caps Lock está ligado. A senha diferencia maiúsculas de minúsculas.</div>}
          </div>
          {erro && <div id="ent-erro" className="aviso erro" role="alert"><i className="ti ti-alert-circle" aria-hidden="true" />{erro}</div>}

          <button className="botao principal ent-entrar" type="submit" disabled={entrando}>
            <i className={`ti ${entrando ? 'ti-loader-2 girando' : 'ti-login-2'}`} aria-hidden="true" />
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
          <p className="ent-esqueceu">Esqueceu a senha? Fale com um administrador.</p>
        </form>

        <button type="button" className="ent-tema" onClick={() => setTema(alternarTema())}
          aria-label={tema === 'escuro' ? 'Usar o tema claro' : 'Usar o tema escuro'} title="Tema claro ou escuro">
          <i className={`ti ${tema === 'escuro' ? 'ti-sun' : 'ti-moon'}`} aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}

// Desenho do sistema em barras: indicadores do dia, lista de conversas e uma conversa com o boleto enviado.
const CONVERSAS = [
  { t: 74, a: 52, nova: true },
  { t: 62, a: 70, marca: 'retorno' },
  { t: 80, a: 46, ativa: true },
  { t: 56, a: 60, marca: 'ok' },
];

function Previa() {
  return (
    <div className="ent-previa" aria-hidden="true">
      <div className="pv-topo">
        {[0, 1, 2].map((i) => <span key={i} className="pv-ponto" />)}
        <span className="pv-titulo">Cobrança do dia</span>
        <span className="pv-meta">Responderam<span className="pv-trilha"><span style={{ width: '58%' }} /></span></span>
      </div>
      <div className="pv-kpis">
        {[['ti-send', 'Cobrados', 64], ['ti-message-circle', 'Responderam', 42], ['ti-phone', 'Ligações', 50], ['ti-circle-check', 'Pagaram', 30]].map(([ic, nome, w]) => (
          <span key={nome} className="pv-kpi">
            <span className="pv-kpi-nome"><i className={`ti ${ic}`} />{nome}</span>
            <span className="pv-barra forte" style={{ width: `${w}%` }} />
          </span>
        ))}
      </div>
      <div className="pv-corpo">
        <div className="pv-lista">
          {CONVERSAS.map((c, i) => (
            <span key={i} className={`pv-item${c.ativa ? ' ativa' : ''}`}>
              <span className="pv-avatar" />
              <span className="pv-linhas">
                <span className="pv-barra forte" style={{ width: `${c.t}%` }} />
                <span className="pv-barra" style={{ width: `${c.a}%` }} />
              </span>
              {c.nova && <span className="pv-contador">2</span>}
              {c.marca === 'retorno' && <span className="pv-chip retorno"><i className="ti ti-alarm" />Retorno</span>}
              {c.marca === 'ok' && <span className="pv-chip ok"><i className="ti ti-check" />Pagou</span>}
            </span>
          ))}
        </div>
        <div className="pv-conversa">
          <span className="pv-balao dele"><span className="pv-barra" style={{ width: '82%' }} /><span className="pv-barra" style={{ width: '54%' }} /></span>
          <span className="pv-balao nosso">
            <span className="pv-anexo"><i className="ti ti-file-invoice" /><span className="pv-barra forte" style={{ width: '64%' }} /></span>
            <span className="pv-barra" style={{ width: '70%' }} />
          </span>
          <span className="pv-balao dele"><span className="pv-barra" style={{ width: '60%' }} /></span>
          <span className="pv-compositor"><span className="pv-barra" style={{ width: '46%' }} /><span className="pv-enviar"><i className="ti ti-send" /></span></span>
        </div>
      </div>
    </div>
  );
}
