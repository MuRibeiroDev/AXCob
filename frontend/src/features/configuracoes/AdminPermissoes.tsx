/* Administração (somente admin): permissões de tela por usuário. Duas abas:
   - "Por tela": cada tela lista quem tem acesso; digite um nome para liberar.
   - "Por pessoa": busque alguém e veja/edite todas as telas dela.
   Modelo allowlist — quem não está liberado, não vê. Admin sempre vê tudo.
   Grava na coluna permissions_cobranca (JSON de telas). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api, type AdminUser } from '@/lib/api';
import { SCREENS } from '@/lib/screens';

const ALL_KEYS = SCREENS.map((s) => s.key);

export function AdminPermissoes() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<Set<string>>(new Set()); // `${id}:${key}`
  const [view, setView] = useState<'tela' | 'pessoa'>('tela');

  useEffect(() => {
    api.adminUsers().then(setUsers).catch((e) => setErro(e.message));
  }, []);

  const analistas = useMemo(() => (users ?? []).filter((u) => !u.isAdmin), [users]);
  const temAcesso = (u: AdminUser, key: string) => u.permissoes == null || u.permissoes.includes(key);

  const persistir = (u: AdminUser, novas: string[], key: string) => {
    const tag = `${u.id}:${key}`;
    setSalvando((s) => new Set(s).add(tag));
    setErro(null);
    api.adminSetPermissoes(u.id, novas)
      .then((r) => setUsers((us) => us?.map((x) => (x.id === u.id ? { ...x, permissoes: r.permissoes } : x)) ?? null))
      .catch((e) => setErro(e.message))
      .finally(() => setSalvando((s) => { const n = new Set(s); n.delete(tag); return n; }));
  };
  const liberar = (u: AdminUser, key: string) => persistir(u, [...new Set([...(u.permissoes ?? ALL_KEYS), key])], key);
  const revogar = (u: AdminUser, key: string) => persistir(u, (u.permissoes ?? ALL_KEYS).filter((k) => k !== key), key);

  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: 'var(--sh-sm)', marginTop: 22 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--green-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green-700)' }}>
          <Icon name="cog" size={17} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700 }}>Permissões de acesso (admin)</div>
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>Quem não está liberado não vê a tela. Administradores sempre veem tudo.</div>
        </div>
      </div>

      {/* abas */}
      <div style={{ display: 'flex', gap: 4, padding: '0 20px', borderBottom: '1px solid var(--line)' }}>
        {([['tela', 'Por tela'], ['pessoa', 'Por pessoa']] as const).map(([k, label]) => {
          const on = view === k;
          return (
            <button
              key={k}
              onClick={() => setView(k)}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit',
                padding: '10px 14px', fontSize: 13, fontWeight: 600, marginBottom: -1,
                color: on ? 'var(--green-800)' : 'var(--ink-400)',
                borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '14px 20px' }}>
        {erro && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, fontSize: 12.5, color: 'var(--age-crit-fg)' }}>
            <Icon name="alert" size={15} /> {erro}
          </div>
        )}

        {!users ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-400)', fontSize: 13, padding: '14px 0' }}>
            <Icon name="history" size={16} className="spin" /> Carregando usuários…
          </div>
        ) : view === 'tela' ? (
          <PorTela analistas={analistas} temAcesso={temAcesso} salvando={salvando} liberar={liberar} revogar={revogar} />
        ) : (
          <PorPessoa analistas={analistas} temAcesso={temAcesso} salvando={salvando} liberar={liberar} revogar={revogar} />
        )}
      </div>
    </div>
  );
}

interface SubProps {
  analistas: AdminUser[];
  temAcesso: (u: AdminUser, key: string) => boolean;
  salvando: Set<string>;
  liberar: (u: AdminUser, key: string) => void;
  revogar: (u: AdminUser, key: string) => void;
}

/* ---------------- Aba: Por tela ---------------- */
function PorTela({ analistas, temAcesso, salvando, liberar, revogar }: SubProps) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(null); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={boxRef} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {SCREENS.map((tela) => {
        const liberados = analistas.filter((u) => temAcesso(u, tela.key));
        const candidatos = analistas
          .filter((u) => !temAcesso(u, tela.key))
          .filter((u) => { const t = q.trim().toLowerCase(); return !t || [u.nome, u.username].some((x) => (x ?? '').toLowerCase().includes(t)); });
        const isOpen = aberto === tela.key;
        return (
          <div key={tela.key} style={{ border: '1px solid var(--line)', borderRadius: 11, padding: '12px 14px', background: 'var(--paper)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
              <Icon name={tela.icon} size={15} style={{ color: 'var(--green-600)' }} />
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-900)' }}>{tela.label}</div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-500)', background: 'var(--white)', borderRadius: 999, padding: '2px 8px', border: '1px solid var(--line)' }}>{liberados.length}</span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 10 }}>
              {liberados.length === 0 && <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>Ninguém liberado (além dos admins).</span>}
              {liberados.map((u) => {
                const sav = salvando.has(`${u.id}:${tela.key}`);
                return (
                  <span key={u.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 6px 4px 10px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--white)', color: 'var(--ink-700)' }}>
                    {u.nome}
                    <button type="button" title="Remover acesso" disabled={sav} onClick={() => revogar(u, tela.key)}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-400)', display: 'flex', alignItems: 'center', padding: 2, borderRadius: 999 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--age-crit-fg)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-400)')}>
                      {sav ? <Icon name="history" size={12} className="spin" /> : <span style={{ fontSize: 14, lineHeight: 1, fontWeight: 700 }}>×</span>}
                    </button>
                  </span>
                );
              })}
            </div>

            <div style={{ position: 'relative', maxWidth: 320 }}>
              <div className="field" style={{ cursor: 'text' }} onClick={() => setAberto(tela.key)}>
                <Icon name="user" size={14} style={{ color: 'var(--ink-400)' }} />
                <input
                  value={isOpen ? q : ''}
                  onChange={(e) => { setQ(e.target.value); setAberto(tela.key); }}
                  onFocus={() => { setAberto(tela.key); setQ(''); }}
                  placeholder="Digite um nome para liberar…"
                  style={{ border: 'none', outline: 'none', background: 'transparent', font: 'inherit', flex: 1, minWidth: 0, color: 'var(--ink-900)' }}
                />
              </div>
              {isOpen && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--sh-md)', maxHeight: 240, overflowY: 'auto', zIndex: 20 }}>
                  {candidatos.length === 0 ? (
                    <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-400)' }}>{q.trim() ? 'Nenhum usuário encontrado.' : 'Todos já liberados.'}</div>
                  ) : candidatos.slice(0, 30).map((u) => (
                    <button key={u.id} type="button" onMouseDown={(e) => { e.preventDefault(); liberar(u, tela.key); setQ(''); setAberto(null); }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', padding: '8px 12px' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-900)' }}>{u.nome}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{u.username} · {u.role}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Aba: Por pessoa ---------------- */
function PorPessoa({ analistas, temAcesso, salvando, liberar, revogar }: SubProps) {
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<number | null>(null);
  const [aberto, setAberto] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const sel = analistas.find((u) => u.id === selId) ?? null;
  const matches = analistas.filter((u) => { const t = q.trim().toLowerCase(); return !t || [u.nome, u.username].some((x) => (x ?? '').toLowerCase().includes(t)); });

  return (
    <div ref={boxRef}>
      {/* busca de pessoa */}
      <div style={{ position: 'relative', maxWidth: 360, marginBottom: 16 }}>
        <div className="field" style={{ cursor: 'text' }} onClick={() => setAberto(true)}>
          <Icon name="search" size={15} style={{ color: 'var(--ink-400)' }} />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setAberto(true); }}
            onFocus={() => setAberto(true)}
            placeholder="Buscar pessoa…"
            style={{ border: 'none', outline: 'none', background: 'transparent', font: 'inherit', flex: 1, minWidth: 0, color: 'var(--ink-900)' }}
          />
        </div>
        {aberto && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--sh-md)', maxHeight: 340, overflowY: 'auto', zIndex: 30 }}>
            {matches.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-400)' }}>Nenhum usuário encontrado.</div>
            ) : matches.slice(0, 40).map((u) => (
              <button key={u.id} type="button" onMouseDown={(e) => { e.preventDefault(); setSelId(u.id); setAberto(false); setQ(u.nome); }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', padding: '8px 12px' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-900)' }}>{u.nome}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{u.username} · {u.role}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!sel ? (
        <div style={{ color: 'var(--ink-400)', fontSize: 13, padding: '6px 2px' }}>Busque uma pessoa para ver e editar as telas dela.</div>
      ) : (
        <div style={{ border: '1px solid var(--line)', borderRadius: 11, padding: '14px 16px', background: 'var(--paper)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-900)' }}>{sel.nome}</div>
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--hover)', color: 'var(--ink-500)', letterSpacing: '.02em' }}>{sel.role}</span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{sel.username}</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>
              vê {SCREENS.filter((s) => temAcesso(sel, s.key)).length} de {SCREENS.length} telas
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SCREENS.map((s) => {
              const on = temAcesso(sel, s.key);
              const sav = salvando.has(`${sel.id}:${s.key}`);
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={sav}
                  onClick={() => (on ? revogar(sel, s.key) : liberar(sel, s.key))}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', font: 'inherit',
                    fontSize: 12, fontWeight: 600, padding: '7px 11px', borderRadius: 8,
                    border: `1.5px solid ${on ? 'var(--green-500)' : 'var(--line)'}`,
                    background: on ? 'var(--green-50)' : 'var(--white)',
                    color: on ? 'var(--green-700)' : 'var(--ink-500)',
                  }}
                >
                  <span style={{ width: 15, height: 15, borderRadius: 5, flex: '0 0 auto', border: `1.5px solid ${on ? 'var(--green-500)' : 'var(--ink-300)'}`, background: on ? 'var(--green-500)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                    {sav ? <Icon name="history" size={10} className="spin" /> : on && <Icon name="check" size={10} stroke={2.6} />}
                  </span>
                  <Icon name={s.icon} size={13} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
