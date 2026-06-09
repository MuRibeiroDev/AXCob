/* Tela de login do AxCob — autentica na users_qitech (compartilhada).
   Visual: painel escuro com a marca + cartão branco do formulário. */
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { setAuth } from '@/lib/auth';

const logoUrl = '/logo-audax.png';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const entrar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !senha) { setErro('Informe usuário e senha.'); return; }
    setErro(null);
    setCarregando(true);
    api.login(login.trim(), senha)
      .then((r) => { setAuth(r.token, r.user); onLogin(); })
      .catch((err) => setErro(err.message || 'Falha no login.'))
      .finally(() => setCarregando(false));
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--paper)' }}>
      {/* painel da marca (escuro) */}
      <div
        style={{
          flex: '1 1 46%', background: 'var(--ink-900)', color: '#fff',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          padding: '44px 48px', position: 'relative', overflow: 'hidden',
        }}
      >
        {/* leão cortado pela metade, fixo à ESQUERDA e centralizado na vertical */}
        <img
          src="/lion.png"
          alt=""
          aria-hidden
          style={{ position: 'absolute', left: 0, top: '50%', transform: 'translate(-50%, -50%)', width: '180%', maxWidth: 1100, opacity: 0.9, pointerEvents: 'none', userSelect: 'none' }}
        />
        <div style={{ position: 'absolute', top: -120, right: -120, width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,253,84,.16), transparent 70%)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <img src={logoUrl} alt="Audax" width={34} height={34} style={{ display: 'block' }} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 30, letterSpacing: '-.02em' }}>AxCob<span style={{ color: 'var(--accent)' }}>.</span></div>
        </div>
        <div style={{ position: 'absolute', right: 56, top: '72%', maxWidth: 320, textAlign: 'right' }}>
          <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-.02em' }}>
            Gestão de Cobrança<span style={{ color: 'var(--accent)' }}>.</span>
          </div>
          <p style={{ marginTop: 12, fontSize: 13.5, color: 'rgba(255,255,255,.6)', lineHeight: 1.6 }}>
            Títulos, protestos, PIX e relatórios.
          </p>
        </div>
      </div>

      {/* cartão do formulário */}
      <div style={{ flex: '1 1 54%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <form onSubmit={entrar} style={{ width: 'min(380px, 100%)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', color: 'var(--ink-900)' }}>Bem-vindo de volta</div>
            <div style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 4 }}>Faça login para continuar</div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' }}>Usuário ou e-mail</span>
            <div className="field" style={{ cursor: 'text' }}>
              <Icon name="user" size={15} style={{ color: 'var(--ink-400)' }} />
              <input
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="seu.usuario ou email@audax…"
                style={{ border: 'none', outline: 'none', background: 'transparent', font: 'inherit', fontSize: 13.5, flex: 1, minWidth: 0, color: 'var(--ink-900)' }}
              />
            </div>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' }}>Senha</span>
            <div className="field" style={{ cursor: 'text' }}>
              <Icon name="clock" size={15} style={{ color: 'var(--ink-400)' }} />
              <input
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                type={verSenha ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                style={{ border: 'none', outline: 'none', background: 'transparent', font: 'inherit', fontSize: 13.5, flex: 1, minWidth: 0, color: 'var(--ink-900)' }}
              />
              <button type="button" onClick={() => setVerSenha((v) => !v)} title={verSenha ? 'Ocultar' : 'Mostrar'}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-400)', fontSize: 11.5, fontWeight: 600, padding: '0 2px' }}>
                {verSenha ? 'ocultar' : 'mostrar'}
              </button>
            </div>
          </label>

          {erro && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--age-crit-fg)', background: 'var(--age-crit-bg, #fdeaea)', border: '1px solid var(--line)', borderRadius: 9, padding: '9px 11px' }}>
              <Icon name="alert" size={14} /> {erro}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={carregando} style={{ height: 42, justifyContent: 'center', fontSize: 14, marginTop: 4 }}>
            <Icon name={carregando ? 'history' : 'check'} size={16} className={carregando ? 'spin' : undefined} />
            {carregando ? 'Entrando…' : 'Entrar'}
          </button>

          <div style={{ fontSize: 11.5, color: 'var(--ink-400)', textAlign: 'center', marginTop: 6 }}>
            © {new Date().getFullYear()} Audax Capital
          </div>
        </form>
      </div>
    </div>
  );
}
