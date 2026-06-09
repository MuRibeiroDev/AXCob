/* Tela: Relatórios — catálogo de relatórios de cobrança.
   Comissárias (em/sem atraso) geram TEXTO (SQL + LLM).
   Títulos Quitados — Geral gera PNG (captura do Power BI via Playwright). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api, type RelatorioCard, type RelatorioPngStatus } from '@/lib/api';
import { getUser } from '@/lib/auth';

interface Modal { id: string; label: string; texto: string }
interface ImgModal { id: string; label: string; imagens: string[]; at?: string }

export function RelatoriosPage() {
  const [cards, setCards] = useState<RelatorioCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gerando, setGerando] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [copiado, setCopiado] = useState(false);
  // textos gerados (comissárias) guardados só em memória — p/ "Visualizar" sem regerar
  const [textos, setTextos] = useState<Record<string, string>>({});
  // estado de geração PNG por id (status/imagens/erro)
  const [pngState, setPngState] = useState<Record<string, RelatorioPngStatus>>({});
  const [imgModal, setImgModal] = useState<ImgModal | null>(null);
  const pollRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // envio em sequência por WhatsApp (gera os PNGs → espera → envia p/ o telefone do usuário)
  const [fluxoEnvio, setFluxoEnvio] = useState<'idle' | 'gerando' | 'enviando'>('idle');
  const [envioMsg, setEnvioMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const telefoneUsuario = (getUser()?.phone ?? '').replace(/\D/g, '');
  const telefoneMasc = telefoneUsuario ? telefoneUsuario.replace(/\d(?=\d{4})/g, '•') : '';

  useEffect(() => {
    api.relatorios().then(setCards).catch((e) => setError(e.message));
    return () => { Object.values(pollRef.current).forEach(clearTimeout); };
  }, []);

  const grupos = useMemo(() => {
    const map = new Map<string, RelatorioCard[]>();
    (cards ?? []).forEach((c) => (map.get(c.grupo) ?? map.set(c.grupo, []).get(c.grupo)!).push(c));
    return [...map.entries()];
  }, [cards]);

  const gerar = (c: RelatorioCard) => {
    setGerando(c.id);
    api.relatorioTexto(c.id)
      .then((r) => {
        setTextos((t) => ({ ...t, [c.id]: r.texto }));   // guarda em memória
        setModal({ id: c.id, label: c.label, texto: r.texto });
        setCopiado(false);
      })
      .catch((e) => window.alert(`Erro ao gerar: ${e.message}`))
      .finally(() => setGerando(null));
  };

  // ---- fluxo PNG (Power BI) ----
  const poll = (id: string) => {
    api.statusRelatorioPng(id)
      .then((s) => {
        setPngState((m) => ({ ...m, [id]: s }));
        if (s.status === 'gerando') pollRef.current[id] = setTimeout(() => poll(id), 3000);
      })
      .catch(() => { pollRef.current[id] = setTimeout(() => poll(id), 4000); });
  };

  const gerarPng = (c: RelatorioCard) => {
    setPngState((m) => ({ ...m, [c.id]: { status: 'gerando', imagens: [] } }));
    api.gerarRelatorioPng(c.id)
      .then((s) => {
        setPngState((m) => ({ ...m, [c.id]: s }));
        if (s.status === 'gerando') poll(c.id);
      })
      .catch((e) => setPngState((m) => ({ ...m, [c.id]: { status: 'erro', imagens: [], erro: e.message } })));
  };

  const visualizar = (c: RelatorioCard) => {
    if (c.formato === 'TEXTO') {
      const texto = textos[c.id];
      if (texto != null) { setModal({ id: c.id, label: c.label, texto }); setCopiado(false); }
      return;
    }
    const s = pngState[c.id];
    if (s?.status === 'pronto' && s.imagens.length) {
      setImgModal({ id: c.id, label: c.label, imagens: s.imagens, at: s.at });
    }
  };

  // gera TODOS os relatórios PNG (o backend enfileira; roda um de cada vez)
  const gerarTodos = () => {
    (cards ?? []).forEach((c) => {
      if (c.formato === 'PNG' && c.pronto && pngState[c.id]?.status !== 'gerando') gerarPng(c);
    });
  };

  // "Enviar relatórios": gera todos os PNGs e, quando prontos, envia p/ o WhatsApp do usuário logado
  const enviarRelatorios = () => {
    if (!telefoneUsuario) { setEnvioMsg({ ok: false, msg: 'Seu usuário não tem WhatsApp cadastrado.' }); return; }
    setEnvioMsg(null);
    setFluxoEnvio('gerando');
    (cards ?? []).forEach((c) => {
      if (c.formato === 'PNG' && c.pronto && pngState[c.id]?.status !== 'gerando') gerarPng(c);
    });
  };

  // quando todos os PNGs ficam prontos (durante o fluxo de envio), dispara o envio
  useEffect(() => {
    if (fluxoEnvio !== 'gerando') return;
    const sts = pngCards.map((c) => pngState[c.id]?.status);
    if (sts.some((s) => s === 'erro')) {
      setFluxoEnvio('idle');
      setEnvioMsg({ ok: false, msg: 'Falha ao gerar algum PNG — corrija e tente de novo.' });
      return;
    }
    if (pngCards.length > 0 && sts.every((s) => s === 'pronto')) {
      setFluxoEnvio('enviando');
      api.enviarSequenciaRelatorios()
        .then((r) => {
          const falhas = r.passos.filter((p) => !p.ok);
          setEnvioMsg(falhas.length === 0
            ? { ok: true, msg: `Enviado! ${r.passos.length} mensagens na ordem.` }
            : { ok: false, msg: `${r.passos.length - falhas.length}/${r.passos.length} enviados. Falhou: ${falhas[0].passo} (${falhas[0].erro ?? ''})` });
        })
        .catch((e) => setEnvioMsg({ ok: false, msg: e.message }))
        .finally(() => setFluxoEnvio('idle'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pngState, fluxoEnvio]);

  // ao carregar (ou recarregar) a página, reflete o status do DIA de cada PNG
  // (lido do SQLite no backend) → cards já gerados mostram "Visualizar".
  useEffect(() => {
    if (!cards) return;
    cards.forEach((c) => {
      if (c.formato !== 'PNG' || !c.pronto) return;
      api.statusRelatorioPng(c.id)
        .then((s) => {
          if (s.status === 'idle') return;
          setPngState((m) => ({ ...m, [c.id]: s }));
          if (s.status === 'gerando') poll(c.id);
        })
        .catch(() => { /* ignora */ });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  const pngCards = (cards ?? []).filter((c) => c.formato === 'PNG' && c.pronto);
  const gerandoQtd = pngCards.filter((c) => pngState[c.id]?.status === 'gerando').length;

  const copiar = () => {
    if (!modal) return;
    const ok = () => { setCopiado(true); setTimeout(() => setCopiado(false), 1800); };
    // navigator.clipboard só existe em contexto seguro (HTTPS/localhost). Acessando
    // via IP (http) ele é indefinido → usa fallback com textarea + execCommand.
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = modal.texto;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const sucesso = document.execCommand('copy');
        document.body.removeChild(ta);
        if (sucesso) ok();
        else window.alert('Não foi possível copiar automaticamente. Selecione o texto e use Ctrl+C.');
      } catch {
        window.alert('Não foi possível copiar automaticamente. Selecione o texto e use Ctrl+C.');
      }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(modal.texto).then(ok).catch(fallback);
    } else {
      fallback();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--paper)' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 26px', height: 60, background: 'var(--white)', borderBottom: '1px solid var(--line)', flex: '0 0 auto' }}>
        <Icon name="doc" size={17} style={{ color: 'var(--green-600)' }} />
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.01em' }}>Relatórios</div>
          <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 500 }}>Geração de relatórios de cobrança</div>
        </div>
        <div style={{ flex: 1 }} />
        {pngCards.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={gerarTodos} disabled={gerandoQtd > 0 || fluxoEnvio !== 'idle'} style={{ opacity: gerandoQtd > 0 ? 0.7 : 1 }}>
            <Icon name={gerandoQtd > 0 ? 'history' : 'bolt'} size={14} className={gerandoQtd > 0 ? 'spin' : undefined} />
            {gerandoQtd > 0 ? `Gerando ${gerandoQtd}…` : 'Gerar todos (PNG)'}
          </button>
        )}
        {/* envio em sequência por WhatsApp — para o número do PRÓPRIO usuário logado */}
        <button
          className="btn btn-primary btn-sm"
          onClick={enviarRelatorios}
          disabled={fluxoEnvio !== 'idle' || !telefoneUsuario}
          title={telefoneUsuario ? `Gera todos os relatórios e envia pro seu WhatsApp (${telefoneMasc})` : 'Seu usuário não tem WhatsApp cadastrado'}
        >
          <Icon name={fluxoEnvio !== 'idle' ? 'history' : 'whats'} size={14} className={fluxoEnvio !== 'idle' ? 'spin' : undefined} />
          {fluxoEnvio === 'gerando' ? 'Gerando…' : fluxoEnvio === 'enviando' ? 'Enviando…'
            : telefoneUsuario ? `Enviar pro meu WhatsApp (${telefoneMasc})` : 'Sem WhatsApp cadastrado'}
        </button>
      </div>

      {envioMsg && (
        <div style={{ padding: '8px 26px', fontSize: 12.5, fontWeight: 600, background: envioMsg.ok ? 'var(--green-50)' : 'var(--age-crit-bg, #fdeaea)', color: envioMsg.ok ? 'var(--green-700)' : 'var(--age-crit-fg)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name={envioMsg.ok ? 'check' : 'alert'} size={14} /> {envioMsg.msg}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 26px' }}>
        {error ? (
          <div style={{ color: 'var(--age-crit-fg)', fontSize: 14 }}>Erro ao carregar: {error}</div>
        ) : !cards ? (
          <div style={{ color: 'var(--ink-400)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="history" size={18} className="spin" /> Carregando…
          </div>
        ) : (
          grupos.map(([grupo, lista]) => (
            <section key={grupo} style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
                {grupo}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, alignItems: 'start' }}>
                {lista.map((c) => (
                  <ReportCard
                    key={c.id}
                    card={c}
                    gerando={gerando === c.id}
                    png={pngState[c.id]}
                    temTexto={textos[c.id] != null}
                    onGerar={() => (c.formato === 'PNG' ? gerarPng(c) : gerar(c))}
                    onVisualizar={() => visualizar(c)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {modal && (
        <ResultModal modal={modal} copiado={copiado} onCopiar={copiar} onAtualizar={() => gerar({ id: modal.id, label: modal.label } as RelatorioCard)} atualizando={gerando === modal.id} onClose={() => setModal(null)} />
      )}

      {imgModal && <ImageModal modal={imgModal} onClose={() => setImgModal(null)} />}
    </div>
  );
}

function ReportCard({ card, gerando, png, temTexto, onGerar, onVisualizar }: {
  card: RelatorioCard; gerando: boolean; png?: RelatorioPngStatus; temTexto?: boolean; onGerar: () => void; onVisualizar: () => void;
}) {
  const isTexto = card.formato === 'TEXTO';
  const isPng = card.formato === 'PNG';
  const pngGerando = isPng && png?.status === 'gerando';
  const pngPronto = isPng && png?.status === 'pronto' && png.imagens.length > 0;
  const textoPronto = isTexto && !!temTexto && !gerando;
  const pronto = pngPronto || textoPronto;   // tem resultado p/ Visualizar

  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 16, boxShadow: 'var(--sh-sm)', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 132, opacity: card.pronto ? 1 : 0.72 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-900)', lineHeight: 1.25 }}>{card.label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.03em', background: isTexto ? 'var(--green-50)' : 'var(--st-open-bg)', color: isTexto ? 'var(--green-700)' : 'var(--st-open-fg)' }}>
          {card.formato}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-500)', flex: 1, lineHeight: 1.4 }}>
        {card.descricao || '—'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {!card.pronto ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-400)', fontWeight: 600 }}>
            <Icon name="clock" size={13} /> Em breve
          </span>
        ) : pngGerando ? (
          <button className="btn btn-primary btn-sm" disabled style={{ opacity: 0.7 }}>
            <Icon name="history" size={14} className="spin" /> Gerando…
          </button>
        ) : pronto ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={onVisualizar}>
              <Icon name="search" size={14} /> Visualizar
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onGerar}>
              <Icon name="history" size={14} /> Gerar novamente
            </button>
          </>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={onGerar} disabled={gerando} style={{ opacity: gerando ? 0.7 : 1 }}>
            <Icon name={gerando ? 'history' : 'bolt'} size={14} className={gerando ? 'spin' : undefined} />
            {gerando ? 'Gerando…' : 'Gerar relatório'}
          </button>
        )}
        {isPng && png?.status === 'erro' && (
          <span style={{ fontSize: 11.5, color: 'var(--age-crit-fg)', fontWeight: 600 }}>{png.erro || 'falha na geração'}</span>
        )}
      </div>
      {pngGerando && (
        <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>Pode levar alguns minutos (captura do Power BI).</span>
      )}
    </div>
  );
}

function ImageModal({ modal, onClose }: { modal: ImgModal; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(16,35,27,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--sh-lg)', width: 'min(1000px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Icon name="doc" size={16} style={{ color: 'var(--green-600)' }} />
            <span style={{ fontSize: 15, fontWeight: 700 }}>{modal.label}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{modal.imagens.length} imagem(ns)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {modal.imagens.map((parte, i) => (
              <a key={parte} className="btn btn-ghost btn-sm" href={api.imagemRelatorioUrl(modal.id, parte, { download: true, v: modal.at })}>
                <Icon name="download" size={14} /> Baixar {modal.imagens.length > 1 ? i + 1 : ''}
              </a>
            ))}
            <button className="btn btn-quiet btn-sm" onClick={onClose} style={{ fontSize: 16, padding: '4px 8px' }}>×</button>
          </div>
        </div>

        <div style={{ padding: 16, overflowY: 'auto', flex: 1, background: 'var(--paper)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {modal.imagens.map((parte) => (
            <img
              key={parte}
              src={api.imagemRelatorioUrl(modal.id, parte, { v: modal.at })}
              alt={`${modal.label} ${parte}`}
              style={{ width: '100%', height: 'auto', display: 'block', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--white)' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultModal({ modal, copiado, onCopiar, onAtualizar, atualizando, onClose }: {
  modal: Modal; copiado: boolean; onCopiar: () => void; onAtualizar: () => void; atualizando: boolean; onClose: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const telefone = (getUser()?.phone ?? '').replace(/\D/g, '');
  const telefoneMasc = telefone ? telefone.replace(/\d(?=\d{4})/g, '•') : '';

  const enviar = () => {
    if (!telefone) { setFeedback({ ok: false, msg: 'Seu usuário não tem WhatsApp cadastrado.' }); return; }
    setEnviando(true);
    setFeedback(null);
    api.enviarWhatsapp([telefone], modal.texto)
      .then((r) => setFeedback(
        r.falhas === 0
          ? { ok: true, msg: 'Enviado pro seu WhatsApp.' }
          : { ok: false, msg: r.resultados.find((x) => !x.ok)?.erro ?? 'Falha no envio.' },
      ))
      .catch((e) => setFeedback({ ok: false, msg: e.message }))
      .finally(() => setEnviando(false));
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(16,35,27,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--white)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--sh-lg)', width: 'min(720px, 100%)', maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Icon name="doc" size={16} style={{ color: 'var(--green-600)' }} />
            <span style={{ fontSize: 15, fontWeight: 700 }}>{modal.label}</span>
          </div>
          <button className="btn btn-quiet btn-sm" onClick={onClose} style={{ fontSize: 16, padding: '4px 8px' }}>×</button>
        </div>

        <div style={{ padding: 16, overflowY: 'auto', flex: 1, background: 'var(--paper)' }}>
          <pre style={{ margin: 0, fontFamily: 'var(--font)', fontSize: 13, lineHeight: 1.5, color: 'var(--ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {modal.texto}
          </pre>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>Pronto para colar/enviar no WhatsApp.</span>
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={onAtualizar} disabled={atualizando}>
              <Icon name="history" size={14} className={atualizando ? 'spin' : undefined} />Atualizar
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onCopiar}>
              <Icon name="check" size={14} />{copiado ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-sm" onClick={enviar} disabled={enviando || !telefone}
              title={telefone ? `Enviar pro seu WhatsApp (${telefoneMasc})` : 'Seu usuário não tem WhatsApp cadastrado'}>
              <Icon name={enviando ? 'history' : 'whats'} size={14} className={enviando ? 'spin' : undefined} />
              {enviando ? 'Enviando…' : telefone ? `Enviar pro meu WhatsApp (${telefoneMasc})` : 'Sem WhatsApp cadastrado'}
            </button>
          </div>
          {feedback && (
            <div style={{ fontSize: 12, fontWeight: 600, color: feedback.ok ? 'var(--green-700)' : 'var(--age-crit-fg)' }}>
              {feedback.msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
