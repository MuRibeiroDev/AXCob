/* Tela: PIX a Identificar — espelho do pipeline COMPLETO da SPA Financeiro (1248)
   do Bitrix (todas as etapas). Cada card abre no Bitrix ao clicar; o botão
   "Identificar título" aparece só na etapa "Financeiro: PIX à Identificar". */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Popover } from '@/components/Popover';
import { api, type ConciliacaoResultado, type PixCard, type PixKanbanData } from '@/lib/api';
import { fmtBRL, fmtDate } from '@/lib/format';

// O botão "Identificar título" aparece SÓ na etapa "Financeiro: PIX à Identificar".
const STAGES_IDENTIFICAR = new Set(['DT1248_146:NEW']);

// Relatório de Títulos Abertos (Power BI). Tabela/colunas conferidas no modelo:
// fTitulosAbertos / Documento / Data Vencimento (espaço vira _x0020_ no filtro de URL).
const BI_ABERTOS_URL =
  'https://app.powerbi.com/groups/3a380369-2411-47f7-9c7f-d5fa51d75cac/reports/e8c4f016-f8d3-445c-a333-b93a06d6b119/d81022c743c5a5ca976f?language=pt-BR&experience=power-bi&clientSideAuth=0';

/** Link do BI filtrado pelo(s) título(s). Mantém '/' literal (Power BI não aceita
 *  %2F no separador tabela/coluna nem no valor) — só os espaços viram %20. */
function biUrlTitulos(documentos: string[]): string {
  const docs = documentos.filter(Boolean).map((d) => `'${d.replace(/'/g, "''")}'`);
  const expr = docs.length === 1
    ? `fTitulosAbertos/Documento eq ${docs[0]}`
    : `fTitulosAbertos/Documento in (${docs.join(', ')})`;
  return `${BI_ABERTOS_URL}&filter=${expr.replace(/ /g, '%20')}`;
}

function CheckRow({ checked, label, onClick }: { checked: boolean; label: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', padding: '7px 8px', borderRadius: 7, fontSize: 13, color: 'var(--ink-700)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ width: 16, height: 16, borderRadius: 5, flex: '0 0 auto', border: `1.5px solid ${checked ? 'var(--green-500)' : 'var(--ink-300)'}`, background: checked ? 'var(--green-500)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
        {checked && <Icon name="check" size={11} stroke={2.6} />}
      </span>
      {label}
    </button>
  );
}

// borda lateral por etapa (mesma paleta de status do board de protestos)
const STAGE_BORDER: Record<string, string> = {
  'DT1248_146:NEW': 'var(--ink-300)',
  'DT1248_146:PREPARATION': 'var(--age-warn-fg)',
  'DT1248_146:UC_90OA0T': 'var(--age-crit-fg)',
  'DT1248_146:SUCCESS': 'var(--green-500)',
};

function Card({ card, onIdentificar, identificando, analisado, onDragStart, onDragEnd, dragging }: {
  card: PixCard; onIdentificar?: () => void; identificando?: boolean; analisado?: boolean;
  onDragStart?: () => void; onDragEnd?: () => void; dragging?: boolean;
}) {
  const border = STAGE_BORDER[card.stage_id] ?? 'var(--ink-300)';
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragEnd={() => onDragEnd?.()}
      onClick={() => window.open(card.card_link, '_blank', 'noopener')}
      title="Arraste para mover de etapa · clique para abrir no Bitrix"
      style={{
        textAlign: 'left', width: '100%', font: 'inherit', cursor: 'grab', boxSizing: 'border-box',
        background: 'var(--white)', border: '1px solid var(--line)',
        borderLeft: `4px solid ${border}`, borderRadius: 10, padding: '10px 12px',
        boxShadow: 'var(--sh-sm)', transition: 'box-shadow .15s', display: 'block',
        opacity: dragging ? 0.4 : 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 6px 16px rgba(16,35,27,.10)')}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'var(--sh-sm)')}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-900)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {card.nome || card.titulo_card || '—'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
        <span className="tnum" style={{ fontWeight: 700, color: 'var(--ink-900)', fontSize: 13 }}>
          {card.valor != null ? fmtBRL(card.valor) : '—'}
        </span>
        {card.data && <span style={{ color: 'var(--ink-400)' }} className="tnum">{fmtDate(card.data)}</span>}
      </div>
      {card.criado_por && card.criado_por !== '—' && (
        <div style={{ marginTop: 5, fontSize: 10.5, color: 'var(--ink-400)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Icon name="user" size={10} />
          {card.criado_por}
        </div>
      )}
      {onIdentificar && (
        <button
          type="button"
          className={analisado ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
          disabled={identificando}
          onClick={(e) => { e.stopPropagation(); onIdentificar(); }}
          style={{ width: '100%', marginTop: 9, justifyContent: 'center' }}
        >
          <Icon name={identificando ? 'history' : (analisado ? 'check' : 'bolt')} size={13} className={identificando ? 'spin' : undefined} />
          {identificando ? 'Identificando…' : (analisado ? 'Ver identificação' : 'Identificar título')}
        </button>
      )}
    </div>
  );
}

function Column({ stage, onIdentificar, identificandoId, analisadoIds, onCarregarMais, carregandoMais, onDropCard, onDragStartCard, onDragEndCard, draggingId }: {
  stage: PixKanbanData['stages'][number];
  onIdentificar?: (card: PixCard) => void;
  identificandoId?: string | number | null;
  analisadoIds?: Set<string>;
  onCarregarMais?: (stageId: string) => void;
  carregandoMais?: boolean;
  onDropCard?: (stageId: string) => void;
  onDragStartCard?: (card: PixCard, fromStageId: string) => void;
  onDragEndCard?: () => void;
  draggingId?: string | number | null;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { if (onDropCard) { e.preventDefault(); if (!over) setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { if (!onDropCard) return; e.preventDefault(); setOver(false); onDropCard(stage.id); }}
      style={{
        display: 'flex', flexDirection: 'column', minHeight: 0,
        background: over ? 'var(--green-50)' : 'var(--paper)',
        border: `1px solid ${over ? 'var(--green-400)' : 'var(--line)'}`,
        borderRadius: 12, padding: 10, transition: 'background .12s, border-color .12s',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 6px 8px', borderBottom: '1px dashed var(--line)', marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--ink-700)', textTransform: 'uppercase', letterSpacing: '.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {stage.nome}
        </h3>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-500)', background: 'var(--white)', borderRadius: 999, padding: '2px 8px', border: '1px solid var(--line)', flex: '0 0 auto', marginLeft: 8 }}>
          {stage.cards.length}{stage.total > stage.cards.length ? ` / ${stage.total}` : ''}
        </span>
      </div>

      <div
        onScroll={(e) => {
          // scroll infinito: ao chegar perto do fim da coluna, carrega a próxima página
          if (!onCarregarMais || carregandoMais || stage.next == null) return;
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) onCarregarMais(stage.id);
        }}
        style={{ flex: 1, overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {stage.cards.length === 0 ? (
          <div style={{ color: 'var(--ink-300)', fontSize: 12, textAlign: 'center', padding: '24px 6px' }}>
            Nenhum card
          </div>
        ) : (
          stage.cards.map((c) => (
            <Card
              key={c.id}
              card={c}
              onIdentificar={onIdentificar ? () => onIdentificar(c) : undefined}
              identificando={identificandoId === c.id}
              analisado={analisadoIds?.has(String(c.id))}
              onDragStart={() => onDragStartCard?.(c, stage.id)}
              onDragEnd={onDragEndCard}
              dragging={draggingId === c.id}
            />
          ))
        )}

        {/* Lazy load: carrega a próxima página de cards desta etapa sob demanda */}
        {stage.next != null && (
          <button
            type="button" className="btn btn-quiet btn-sm"
            disabled={carregandoMais}
            onClick={() => onCarregarMais?.(stage.id)}
            style={{ width: '100%', marginTop: 2, justifyContent: 'center' }}
          >
            <Icon name="history" size={13} className={carregandoMais ? 'spin' : undefined} />
            {carregandoMais ? 'Carregando…' : 'Carregar mais'}
          </button>
        )}
      </div>
    </div>
  );
}

const CONF_META: Record<string, { bg: string; fg: string; label: string }> = {
  alta: { bg: 'var(--green-50)', fg: 'var(--green-700)', label: 'ALTA' },
  media: { bg: 'var(--age-warn-bg, #fff4e0)', fg: 'var(--age-warn-fg)', label: 'MÉDIA' },
  baixa: { bg: 'var(--hover)', fg: 'var(--ink-500)', label: 'BAIXA' },
};

function ConciliacaoModal({ estado, onClose, onReanalisar }: {
  estado: { card: PixCard; data?: ConciliacaoResultado; erro?: string };
  onClose: () => void;
  onReanalisar: () => void;
}) {
  const { card, data, erro } = estado;
  const carregando = !data && !erro;
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(16,35,27,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 24 }}
    >
      <div className="fade-in" style={{ width: 'min(680px, 100%)', maxHeight: '88vh', background: 'var(--white)', borderRadius: 14, boxShadow: 'var(--sh-lg)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* header */}
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <Icon name="bolt" size={17} style={{ color: 'var(--green-600)', marginTop: 2 }} />
          <div style={{ lineHeight: 1.25, flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Identificação do PIX</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {card.titulo_card || card.nome || '—'}
            </div>
            {data?.criado_em && (
              <div style={{ fontSize: 10.5, color: 'var(--ink-300)', marginTop: 2 }}>
                Analisado em {new Date(data.criado_em).toLocaleString('pt-BR')}
              </div>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onReanalisar} disabled={carregando} title="Rechamar a IA">
            <Icon name="history" size={13} className={carregando ? 'spin' : undefined} /> Analisar novamente
          </button>
          <button className="btn btn-quiet btn-sm" onClick={onClose}>Fechar</button>
        </div>

        {/* corpo */}
        <div style={{ padding: 20, overflowY: 'auto' }}>
          {carregando && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '28px 0', color: 'var(--ink-400)', fontSize: 13.5 }}>
              <Icon name="history" size={26} className="spin" style={{ color: 'var(--green-500)' }} />
              A IA está analisando os títulos em aberto…
            </div>
          )}
          {erro && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--age-crit-fg)', fontSize: 13.5 }}>
              <Icon name="alert" size={18} /> {erro}
            </div>
          )}
          {data && (
            <>
              {/* PIX */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--ink-600)', marginBottom: 14 }}>
                <span><strong style={{ color: 'var(--ink-900)' }} className="tnum">{data.pix.valor != null ? fmtBRL(data.pix.valor) : '—'}</strong></span>
                <span>{data.pix.nome || '—'}</span>
                {data.pix.sistema && <span style={{ color: 'var(--ink-400)' }}>{data.pix.sistema}</span>}
                <span style={{ color: 'var(--ink-400)' }}>{data.relevantes} títulos analisados</span>
              </div>
              {data.resumo && (
                <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--ink-600)', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 9, padding: '9px 12px' }}>
                  {data.resumo}
                </p>
              )}

              {data.sugestoes.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--ink-500)', textAlign: 'center', padding: '18px 0' }}>
                  Nenhuma sugestão com confiança suficiente. Verifique o nome do card ou informe o CPF/CNPJ do pagador.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {data.sugestoes.map((s, i) => {
                    const cm = CONF_META[s.confianca] ?? CONF_META.baixa;
                    return (
                      <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 11, padding: '12px 14px', background: i === 0 ? 'var(--paper)' : 'var(--white)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: cm.bg, color: cm.fg, letterSpacing: '.03em' }}>{cm.label}</span>
                          <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{(s.tipo_match || '').replace(/_/g, ' ')}</span>
                          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>· pagou como <strong style={{ color: 'var(--ink-700)' }}>{s.pagador}</strong></span>
                          {s.score != null && <span className="tnum" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-400)' }}>score {s.score}</span>}
                        </div>
                        {s.titulos.map((t) => (
                          <div key={t.documento} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, padding: '3px 0', borderTop: '1px dashed var(--line)' }}>
                            <span className="mono-id" style={{ fontWeight: 700, color: 'var(--ink-900)', minWidth: 76 }}>{t.documento}</span>
                            <span style={{ flex: 1, color: 'var(--ink-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.cedente || t.sacado || ''}</span>
                            <span className="tnum" style={{ fontWeight: 700, color: 'var(--ink-900)' }}>{t.total != null ? fmtBRL(t.total) : (t.valor != null ? fmtBRL(t.valor) : '—')}</span>
                            {t.vencimento && <span className="tnum" style={{ color: 'var(--ink-400)' }}>{fmtDate(t.vencimento)}</span>}
                          </div>
                        ))}
                        {s.cobrador && (
                          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-600)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Icon name="user" size={12} style={{ color: 'var(--green-600)' }} /> Cobrador: <strong>{s.cobrador}</strong>
                          </div>
                        )}
                        {s.justificativa && <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink-500)', fontStyle: 'italic' }}>{s.justificativa}</div>}
                        <div style={{ marginTop: 9, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <a
                            className="btn btn-primary btn-sm"
                            href={biUrlTitulos(s.titulos.map((t) => t.documento))}
                            target="_blank"
                            rel="noopener"
                          >
                            <Icon name="trend" size={13} />
                            Abrir no BI{s.titulos.length > 1 ? ` (${s.titulos.length} títulos)` : ''}
                          </a>
                          <a className="btn btn-ghost btn-sm" href={card.card_link} target="_blank" rel="noopener">Abrir card no Bitrix</a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type Anexo = { nome: string; base64: string; preview: string };

function MoverModal({ estado, movendo, onClose, onConfirmar }: {
  estado: { card: PixCard; toStageId: string; toStageNome: string };
  movendo: boolean;
  onClose: () => void;
  onConfirmar: (comentario: string, anexos: { nome: string; base64: string }[]) => void;
}) {
  const [comentario, setComentario] = useState('');
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [coladoOk, setColadoOk] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: File[]) => {
    const novos: Anexo[] = [];
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      // imagem colada costuma vir sem nome ("image.png") → gera um único
      const nome = f.name && f.name !== 'image.png' ? f.name : `colado-${Date.now()}.${(f.type.split('/')[1] || 'png')}`;
      novos.push({ nome, base64: dataUrl.split(',')[1] ?? '', preview: dataUrl });
    }
    if (novos.length) setAnexos((a) => [...a, ...novos]);
    return novos.length;
  }, []);

  // Ctrl+V: cola imagem(ns) do clipboard enquanto o modal está aberto
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const imgs = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (!imgs.length) return;
      e.preventDefault(); // não cola o binário dentro do textarea
      const n = await addFiles(imgs);
      if (n) { setColadoOk(true); setTimeout(() => setColadoOk(false), 1500); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const podeMover = !movendo && (comentario.trim().length > 0 || anexos.length > 0);

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !movendo) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(16,35,27,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 24 }}
    >
      <div className="fade-in" style={{ width: 'min(520px, 100%)', background: 'var(--white)', borderRadius: 14, boxShadow: 'var(--sh-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="message" size={17} style={{ color: 'var(--green-600)' }} />
          <div style={{ lineHeight: 1.2, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Mover para “{estado.toStageNome}”</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {estado.card.nome || estado.card.titulo_card || '—'}
            </div>
          </div>
        </div>

        <div style={{ padding: 20 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-700)', display: 'block', marginBottom: 7 }}>
            Comentário (registrado no timeline do card no Bitrix)
          </label>
          <textarea
            autoFocus
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Escreva o comentário…"
            rows={4}
            style={{ width: '100%', resize: 'vertical', font: 'inherit', fontSize: 13, color: 'var(--ink-900)', border: '1px solid var(--line)', borderRadius: 9, padding: '10px 12px', outline: 'none', boxSizing: 'border-box' }}
          />

          {/* anexos */}
          <div style={{ marginTop: 12 }}>
            <input
              ref={inputRef} type="file" accept="image/*" multiple hidden
              onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.currentTarget.value = ''; }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => inputRef.current?.click()} disabled={movendo}>
                <Icon name="doc" size={14} /> Anexar foto
              </button>
              <span style={{ fontSize: 11, color: coladoOk ? 'var(--green-700)' : 'var(--ink-400)' }}>
                {coladoOk ? '✓ imagem colada' : 'ou cole com Ctrl+V'}
              </span>
            </div>
            {anexos.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {anexos.map((a, i) => (
                  <div key={i} style={{ position: 'relative', width: 64, height: 64, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
                    <img src={a.preview} alt={a.nome} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button
                      type="button" title="Remover"
                      onClick={() => setAnexos((arr) => arr.filter((_, j) => j !== i))}
                      style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 999, border: 'none', background: 'rgba(16,35,27,.7)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1 }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '0 20px 18px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={movendo}>Cancelar</button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onConfirmar(comentario.trim(), anexos.map(({ nome, base64 }) => ({ nome, base64 })))}
            disabled={!podeMover}
          >
            <Icon name={movendo ? 'history' : 'check'} size={14} className={movendo ? 'spin' : undefined} />
            {movendo ? 'Movendo…' : 'Mover'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PixPage() {
  const [data, setData] = useState<PixKanbanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState('');
  const [query, setQuery] = useState('');
  const [abertoPor, setAbertoPor] = useState<string[]>([]);
  const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // identificação (conciliação PIX → título) — resultados ficam salvos por card
  const [identificandoId, setIdentificandoId] = useState<string | number | null>(null);
  const [resultado, setResultado] = useState<{ card: PixCard; data?: ConciliacaoResultado; erro?: string } | null>(null);
  const [conciliacoes, setConciliacoes] = useState<Map<string, ConciliacaoResultado>>(new Map());

  // carrega os resultados já salvos (persistem após refresh da página)
  useEffect(() => {
    api.listConciliacoesPix()
      .then((list) => setConciliacoes(new Map(list.map((c) => [String(c.cardId), c.resultado]))))
      .catch(() => undefined);
  }, []);

  // chama a IA (refresh=true força reanalisar mesmo com resultado salvo)
  const identificar = useCallback((card: PixCard, refresh = false) => {
    setIdentificandoId(card.id);
    setResultado({ card });
    api.identificarPix(card.titulo_card || card.nome || '', { cardId: card.id, refresh })
      .then((d) => {
        setResultado({ card, data: d });
        setConciliacoes((prev) => new Map(prev).set(String(card.id), d));
      })
      .catch((e) => setResultado({ card, erro: e.message }))
      .finally(() => setIdentificandoId(null));
  }, []);

  // abre o card: usa o resultado salvo (sem IA) ou analisa pela 1ª vez
  const abrirIdentificacao = useCallback((card: PixCard) => {
    const salvo = conciliacoes.get(String(card.id));
    if (salvo) setResultado({ card, data: salvo });
    else identificar(card, false);
  }, [conciliacoes, identificar]);

  const analisadoIds = useMemo(() => new Set(conciliacoes.keys()), [conciliacoes]);

  // lazy load por coluna: busca a próxima página de uma etapa e anexa (sem duplicar)
  const [carregandoMais, setCarregandoMais] = useState<Set<string>>(new Set());
  const emVoo = useRef<Set<string>>(new Set()); // guard síncrono (scroll dispara vários eventos)
  const carregarMais = useCallback((stageId: string) => {
    if (emVoo.current.has(stageId)) return;
    const stage = data?.stages.find((s) => s.id === stageId);
    if (!stage || stage.next == null) return;
    const start = stage.next;
    emVoo.current.add(stageId);
    setCarregandoMais((s) => new Set(s).add(stageId));
    api.pixStageMore(stageId, start)
      .then((pg) => {
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            stages: prev.stages.map((s) => {
              if (s.id !== stageId) return s;
              const vistos = new Set(s.cards.map((c) => String(c.id)));
              const novos = pg.cards.filter((c) => !vistos.has(String(c.id)));
              return { ...s, cards: [...s.cards, ...novos], total: pg.total, next: pg.next };
            }),
          };
        });
      })
      .catch(() => undefined)
      .finally(() => {
        emVoo.current.delete(stageId);
        setCarregandoMais((s) => { const n = new Set(s); n.delete(stageId); return n; });
      });
  }, [data]);

  const load = useCallback((force = false) => {
    setLoading(true);
    setError(null);
    api.pixKanban(force)
      .then((d) => {
        setData(d);
        setUpdatedAt(new Date().toLocaleTimeString('pt-BR'));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(false); }, [load]);

  // drag-and-drop entre etapas → modal de comentário + anexo antes de mover
  const dragRef = useRef<{ card: PixCard; fromStageId: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | number | null>(null);
  const [moverModal, setMoverModal] = useState<{ card: PixCard; toStageId: string; toStageNome: string } | null>(null);
  const [movendo, setMovendo] = useState(false);

  const onDragStartCard = useCallback((card: PixCard, fromStageId: string) => {
    dragRef.current = { card, fromStageId };
    setDraggingId(card.id);
  }, []);
  const onDragEndCard = useCallback(() => { dragRef.current = null; setDraggingId(null); }, []);

  const onDropCard = useCallback((toStageId: string) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingId(null);
    if (!drag || drag.fromStageId === toStageId) return;
    const nome = data?.stages.find((s) => s.id === toStageId)?.nome ?? toStageId;
    setMoverModal({ card: drag.card, toStageId, toStageNome: nome });
  }, [data]);

  const confirmarMover = useCallback((comentario: string, anexos: { nome: string; base64: string }[]) => {
    if (!moverModal) return;
    setMovendo(true);
    api.moverCardPix(moverModal.card.id, moverModal.toStageId, comentario || undefined, anexos.length ? anexos : undefined)
      .then(() => { setMoverModal(null); load(true); })
      .catch((e) => setError(e.message))
      .finally(() => setMovendo(false));
  }, [moverModal, load]);

  const abertoPorOpcoes = useMemo(
    () => (data ? [...new Set(data.stages.flatMap((s) => s.cards.map((c) => c.criado_por)).filter((x) => x && x !== '—'))].sort() : []),
    [data],
  );

  const stages = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.stages.map((s) => ({
      ...s,
      cards: s.cards.filter((c) => {
        const mq = !q || [c.nome, c.titulo_card, c.criado_por].some((x) => (x ?? '').toLowerCase().includes(q));
        const mb = abertoPor.length === 0 || abertoPor.includes(c.criado_por);
        return mq && mb;
      }),
    }));
  }, [data, query, abertoPor]);

  const totalFiltrado = useMemo(
    () => stages.reduce((acc, s) => ({ total: acc.total + s.cards.length, valor: acc.valor + s.cards.reduce((v, c) => v + (c.valor ?? 0), 0) }), { total: 0, valor: 0 }),
    [stages],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--paper)' }}>
      {/* ---- Top bar ---- */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px', height: 60, background: 'var(--white)', borderBottom: '1px solid var(--line)', flex: '0 0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="bolt" size={17} style={{ color: 'var(--green-600)' }} />
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.01em' }}>PIX a Identificar</div>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 500 }}>
              Arraste um card para mover de etapa (comentário e foto opcionais)
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {updatedAt && <span style={{ fontSize: 11, color: 'var(--ink-400)' }} className="tnum">Atualizado em {updatedAt}</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => load(true)} disabled={loading}>
            <Icon name="history" size={14} className={loading ? 'spin' : undefined} />
            {loading ? 'Carregando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {/* ---- Conteúdo ---- */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '16px 26px 0' }}>
        {error ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--age-crit-fg)', fontSize: 14 }}>
            <Icon name="alert" size={24} /> Erro ao carregar: {error}
          </div>
        ) : loading || !data ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--ink-400)', fontSize: 14 }}>
            <Icon name="history" size={28} className="spin" style={{ color: 'var(--green-500)' }} />
            Carregando PIX…
          </div>
        ) : (
          <>
            {/* filtro */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div className="field" style={{ width: 280, cursor: 'text' }}>
                <Icon name="search" size={15} style={{ color: 'var(--ink-400)' }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por nome ou responsável…"
                  style={{ border: 'none', outline: 'none', background: 'transparent', font: 'inherit', flex: 1, minWidth: 0, color: 'var(--ink-900)' }}
                />
              </div>

              {/* Aberto por */}
              <Popover
                minWidth={240}
                trigger={({ open, toggle: tg }) => (
                  <button type="button" className={'field' + (abertoPor.length ? ' active' : '')} onClick={tg}>
                    <Icon name="user" size={14} />
                    <span style={{ whiteSpace: 'nowrap' }}>Aberto por{abertoPor.length ? ` · ${abertoPor.length}` : ''}</span>
                    <Icon name="chevron" size={13} className={abertoPor.length ? undefined : 'cv'} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .12s' }} />
                  </button>
                )}
              >
                {() => (
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {abertoPorOpcoes.length === 0 && <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--ink-400)' }}>—</div>}
                    {abertoPorOpcoes.map((u) => (
                      <CheckRow key={u} checked={abertoPor.includes(u)} onClick={() => setAbertoPor((a) => toggle(a, u))}
                        label={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u}</span>} />
                    ))}
                    {abertoPor.length > 0 && <button className="btn btn-quiet btn-sm" style={{ width: '100%', marginTop: 4 }} onClick={() => setAbertoPor([])}>Limpar</button>}
                  </div>
                )}
              </Popover>

              <div style={{ flex: 1 }} />
              {abertoPor.length > 0 && (
                <button className="btn btn-quiet btn-sm" onClick={() => setAbertoPor([])}><Icon name="filter" size={14} />Limpar filtros</button>
              )}
            </div>

            {/* resumo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-700)', background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 999, padding: '5px 12px' }}>
                <strong className="tnum" style={{ color: 'var(--ink-900)' }}>{totalFiltrado.total}</strong> cards
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-700)', background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 999, padding: '5px 12px' }}>
                <strong className="tnum" style={{ color: 'var(--ink-900)' }}>{fmtBRL(totalFiltrado.valor)}</strong>
              </span>
            </div>

            {/* board: 3 colunas */}
            <div
              className="fade-in"
              style={{
                display: 'grid', gridTemplateColumns: `repeat(${stages.length || 1}, minmax(280px, 1fr))`,
                gap: 12, marginTop: 12, paddingBottom: 26, flex: 1, minHeight: 360, overflowX: 'auto', overflowY: 'hidden',
              }}
            >
              {stages.map((stage) => (
                <Column
                  key={stage.id}
                  stage={stage}
                  onIdentificar={STAGES_IDENTIFICAR.has(stage.id) ? abrirIdentificacao : undefined}
                  identificandoId={identificandoId}
                  analisadoIds={analisadoIds}
                  onCarregarMais={carregarMais}
                  carregandoMais={carregandoMais.has(stage.id)}
                  onDropCard={onDropCard}
                  onDragStartCard={onDragStartCard}
                  onDragEndCard={onDragEndCard}
                  draggingId={draggingId}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {resultado && (
        <ConciliacaoModal
          estado={resultado}
          onClose={() => setResultado(null)}
          onReanalisar={() => identificar(resultado.card, true)}
        />
      )}

      {moverModal && (
        <MoverModal
          estado={moverModal}
          movendo={movendo}
          onClose={() => setMoverModal(null)}
          onConfirmar={confirmarMover}
        />
      )}
    </div>
  );
}
