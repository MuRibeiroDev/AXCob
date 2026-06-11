/* Configurações do usuário. Hoje: webhook pessoal do Bitrix24 — os cards de
   protesto/negativação que o usuário criar saem como "Criado por" ele. */
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { AdminPermissoes } from './AdminPermissoes';

export function ConfiguracoesPage() {
  const usuario = getUser();
  const [webhook, setWebhook] = useState('');
  const [donoNome, setDonoNome] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const isAdmin = !!usuario?.isAdmin;
  const [aba, setAba] = useState<'webhook' | 'permissoes'>('webhook');

  useEffect(() => {
    api.minhaConfig()
      .then((c) => { setWebhook(c.bitrixWebhook ?? ''); setDonoNome(c.bitrixNome); })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, []);

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true); setErro(null); setOkMsg(null);
    try {
      const c = await api.salvarBitrixWebhook(webhook.trim());
      setWebhook(c.bitrixWebhook ?? '');
      setDonoNome(c.bitrixNome);
      setOkMsg(c.bitrixWebhook ? (c.bitrixNome ? `Webhook salvo — vinculado a ${c.bitrixNome}.` : 'Webhook salvo.') : 'Webhook removido.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--paper)', padding: '26px 30px' }}>
      <div style={{ maxWidth: aba === 'permissoes' ? 980 : 720, margin: '0 auto', transition: 'max-width .15s' }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', margin: 0 }}>Configurações</h1>
          <div style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 4 }}>
            {usuario?.nome ? `${usuario.nome} · ` : ''}preferências da sua conta no AxCob.
          </div>
        </div>

        {/* abas (a de Permissões só para admin) */}
        {isAdmin && (
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 18 }}>
            {([['webhook', 'Webhook'], ['permissoes', 'Permissões']] as const).map(([k, label]) => {
              const on = aba === k;
              return (
                <button
                  key={k}
                  onClick={() => setAba(k)}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit',
                    padding: '8px 16px', fontSize: 13, fontWeight: 600, marginBottom: -1,
                    color: on ? 'var(--green-800)' : 'var(--ink-400)',
                    borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                    transition: 'color .15s, border-color .15s',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {aba === 'webhook' && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: 'var(--sh-sm)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--green-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green-700)' }}>
              <Icon name="gavel" size={17} />
            </div>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>Webhook do Bitrix24</div>
              <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>Seu webhook pessoal — define o "Criado por" dos cards que você abrir.</div>
            </div>
          </div>

          <div style={{ padding: '18px 20px' }}>
            <p style={{ fontSize: 13, color: 'var(--ink-700)', lineHeight: 1.55, marginTop: 0, marginBottom: 16 }}>
              Cole abaixo a URL do seu <b>webhook de entrada</b> do Bitrix24. Ao solicitar um
              protesto ou negativação, o card será criado por <b>você</b> (e não pela integração
              padrão). Sem isso, o card sai como criado pela integração.
            </p>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-700)', marginBottom: 6 }}>
              URL do webhook
            </label>
            <input
              type="text"
              value={webhook}
              onChange={(e) => { setWebhook(e.target.value); setOkMsg(null); setErro(null); }}
              placeholder="https://suaconta.bitrix24.com.br/rest/123/seutoken/"
              spellCheck={false}
              disabled={carregando || salvando}
              style={{
                width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13,
                padding: '10px 12px', borderRadius: 9, border: '1.5px solid var(--line)',
                background: carregando ? 'var(--paper)' : 'var(--white)', color: 'var(--ink-900)', outline: 'none',
              }}
            />

            {donoNome && !erro && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: 12.5, color: 'var(--green-700)', fontWeight: 600 }}>
                <Icon name="check" size={15} /> Vinculado a {donoNome}
              </div>
            )}
            {okMsg && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: 12.5, color: 'var(--green-700)' }}>
                <Icon name="check" size={15} /> {okMsg}
              </div>
            )}
            {erro && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: 12.5, color: 'var(--age-crit-fg)' }}>
                <Icon name="alert" size={15} /> {erro}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button className="btn btn-primary btn-sm" onClick={salvar} disabled={carregando || salvando}>
                <Icon name={salvando ? 'history' : 'check'} size={14} className={salvando ? 'spin' : undefined} />
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>

          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line)', background: 'var(--paper)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-700)', marginBottom: 6 }}>Como gerar seu webhook</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.7 }}>
              <li>No Bitrix24, logado <b>na sua conta</b>, abra <b>Desenvolvedor</b> (menu lateral → "Mais" → "Recursos para desenvolvedores").</li>
              <li>Escolha <b>Webhook de entrada</b> e marque a permissão <b>CRM</b>.</li>
              <li>Copie a URL gerada (com a barra final) e cole aqui.</li>
            </ol>
          </div>
        </div>
        )}

        {/* Administração — só para admins: permissões de tela por usuário */}
        {isAdmin && aba === 'permissoes' && <AdminPermissoes />}
      </div>
    </div>
  );
}
