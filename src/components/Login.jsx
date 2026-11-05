import { useState } from 'react';
import { entrar } from '../lib/api.js';
import leao from '../assets/leao.png';

// Mesmo usuário e senha do Painel de Demandas. Sem cadastro aqui.
export default function Login({ aviso }) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    if (!login.trim() || !senha) { setErro('Informe o usuário e a senha.'); return; }
    setErro(''); setEntrando(true);
    try { await entrar(login, senha); } catch (f) { setErro(f.message); setSenha(''); setEntrando(false); }
  }

  return (
    <div className="entrada">
      <form onSubmit={enviar} noValidate>
        <div className="logo">
          <img src={leao} alt="" />
          <div><h1 style={{ fontSize: 20 }}>Contas a Receber</h1><div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Castelo Branco Contabilidade</div></div>
        </div>
        <p style={{ margin: 0, fontSize: 13.5 }}>Entre com o mesmo usuário e senha do Painel de Demandas.</p>
        {aviso && <div className="aviso" role="status">{aviso}</div>}
        <label>Usuário
          <input name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="nome.sobrenome" value={login} onChange={(e) => setLogin(e.target.value)} readOnly={entrando} autoFocus />
        </label>
        <label>Senha
          <input name="password" type="password" autoComplete="current-password" value={senha}
            onChange={(e) => setSenha(e.target.value)} readOnly={entrando} />
        </label>
        {erro && <div className="aviso erro" role="alert">{erro}</div>}
        <button className="botao principal" type="submit" disabled={entrando} style={{ justifyContent: 'center', minHeight: 44 }}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
