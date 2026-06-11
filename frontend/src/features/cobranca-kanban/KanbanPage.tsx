/* Tela: Negativação / Protestos — espelho read-only dos pipelines do Bitrix.
   Abas internas (Protestos | Negativações) trocam o pipeline. Dados reais via API. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Popover } from '@/components/Popover';
import { api } from '@/lib/api';
import { KanbanColumn } from './components/KanbanColumn';
import { StatusSummary } from './components/StatusSummary';
import { KANBAN_STATUS } from './status';
import type { KanbanCard, KanbanData, KanbanStatus, PipelineKey } from './types';

const TABS: { key: PipelineKey; label: string }[] = [
  { key: 'protesto', label: 'Protestos' },
  { key: 'negativacao', label: 'Negativações' },
];

const STATUS_OPCOES: KanbanStatus[] = ['quitado_pronto', 'quitado_parcial', 'nao_quitado'];

// Etapa que exige comentário ao receber um card (carta de anuência → comentário no timeline do Bitrix).
const STAGE_COMENTARIO = 'DT1200_116:UC_O0SUT2';

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

export function KanbanPage() {
  const [pipeline, setPipeline] = useState<PipelineKey>('protesto');
  const [data, setData] = useState<KanbanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>('');
  // cache por pipeline: troca de aba é instantânea; só rebusca em "Atualizar" ou sem cache
  const cacheRef = useRef<Partial<Record<PipelineKey, { data: KanbanData; at: string }>>>({});

  const load = useCallback((pk: PipelineKey, force = false) => {
    const cached = cacheRef.current[pk];
    if (!force && cached) {
      setData(cached.data);
      setUpdatedAt(cached.at);
      setError(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.kanban<KanbanData>(pk, force)
      .then((d) => {
        if (cancelled) return;
        const at = new Date().toLocaleTimeString('pt-BR');
        cacheRef.current[pk] = { data: d, at };
        setData(d);
        setUpdatedAt(at);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const cleanup = load(pipeline);
    return cleanup;
  }, [pipeline, load]);

  // filtros (client-side sobre os cards carregados)
  const [query, setQuery] = useState('');
  const [etapas, setEtapas] = useState<string[]>([]);
  const [statusSel, setStatusSel] = useState<KanbanStatus[]>([]);
  const [abertoPor, setAbertoPor] = useState<string[]>([]);

  // trocar de pipeline reseta filtros (etapas diferem entre pipelines)
  useEffect(() => { setQuery(''); setEtapas([]); setStatusSel([]); setAbertoPor([]); }, [pipeline]);

  // quem abriu os cards (distintos), para o filtro
  const abertoPorOpcoes = useMemo(
    () => (data ? [...new Set(data.stages.flatMap((s) => s.cards.map((c) => c.criado_por)).filter((x) => x && x !== '—'))].sort() : []),
    [data],
  );

  const filteredStages = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.stages
      .filter((s) => etapas.length === 0 || etapas.includes(s.id))
      .map((s) => ({
        ...s,
        cards: s.cards.filter((c) => {
          const mq = !q || [c.numero_titulo, c.razao_social_cedente, c.razao_social_sacado, c.cnpj_cpf_sacado]
            .some((x) => (x ?? '').toLowerCase().includes(q));
          const ms = statusSel.length === 0 || statusSel.includes(c.status);
          const mb = abertoPor.length === 0 || abertoPor.includes(c.criado_por);
          return mq && ms && mb;
        }),
      }));
  }, [data, query, etapas, statusSel, abertoPor]);

  const totaisFiltrado = useMemo(() => {
    const t = { total: 0, quitado_pronto: 0, quitado_parcial: 0, nao_quitado: 0 };
    filteredStages.forEach((s) => s.cards.forEach((c) => { t.total += 1; t[c.status] += 1; }));
    return t;
  }, [filteredStages]);

  const temFiltro = query !== '' || etapas.length > 0 || statusSel.length > 0 || abertoPor.length > 0;
  const limparFiltros = () => { setQuery(''); setEtapas([]); setStatusSel([]); setAbertoPor([]); };
  const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // ---- arrastar o board pra rolar na horizontal (só em área vazia) ----
  const boardRef = useRef<HTMLDivElement>(null);
  const pan = useRef({ down: false, startX: 0, scrollLeft: 0 });
  const onBoardMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = boardRef.current;
    if (!el || e.button !== 0) return;
    // não inicia se pegou num card/botão/link/campo (pra não atrapalhar o drag de etapa)
    if ((e.target as HTMLElement).closest('button, a, input, textarea, [draggable="true"]')) return;
    pan.current = { down: true, startX: e.pageX, scrollLeft: el.scrollLeft };
    el.style.cursor = 'grabbing';
    el.style.userSelect = 'none';
  }, []);
  const onBoardMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = boardRef.current;
    if (!el || !pan.current.down) return;
    el.scrollLeft = pan.current.scrollLeft - (e.pageX - pan.current.startX);
  }, []);
  const endBoardPan = useCallback(() => {
    const el = boardRef.current;
    pan.current.down = false;
    if (el) { el.style.cursor = ''; el.style.userSelect = ''; }
  }, []);

  // ---- drag-and-drop: mover card de etapa (replica no Bitrix) ----
  const dragRef = useRef<{ card: KanbanCard; fromStageId: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const [comentarioModal, setComentarioModal] = useState<{ card: KanbanCard; toStageId: string } | null>(null);
  const [comentario, setComentario] = useState('');

  const onCardDragStart = useCallback((card: KanbanCard, fromStageId: string) => {
    dragRef.current = { card, fromStageId };
  }, []);

  // aplica a movimentação local (otimista) sobre data + cache, e chama a API
  const doMove = useCallback((card: KanbanCard, toStageId: string, coment?: string) => {
    setData((prev) => {
      if (!prev) return prev;
      const next: KanbanData = {
        ...prev,
        stages: prev.stages.map((s) => {
          if (s.id === card.stage_id) return { ...s, cards: s.cards.filter((c) => c.id !== card.id) };
          if (s.id === toStageId) return { ...s, cards: [{ ...card, stage_id: toStageId }, ...s.cards] };
          return s;
        }),
      };
      cacheRef.current[pipeline] = { data: next, at: cacheRef.current[pipeline]?.at ?? updatedAt };
      return next;
    });

    setMoving(true);
    api.moverCard(card.id, toStageId, coment)
      .then(() => load(pipeline, true)) // reconcilia com o Bitrix (status/etapas reais)
      .catch((e) => { setError(e.message); load(pipeline, true); })
      .finally(() => setMoving(false));
  }, [pipeline, updatedAt, load]);

  const onDropCard = useCallback((toStageId: string) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.fromStageId === toStageId) return;
    if (toStageId === STAGE_COMENTARIO) {
      setComentario('');
      setComentarioModal({ card: drag.card, toStageId });
      return;
    }
    doMove(drag.card, toStageId);
  }, [doMove]);

  const confirmarComentario = () => {
    if (!comentarioModal || !comentario.trim()) return;
    doMove(comentarioModal.card, comentarioModal.toStageId, comentario.trim());
    setComentarioModal(null);
    setComentario('');
  };

  // ---- lazy load por coluna (scroll infinito): busca a próxima página e anexa ----
  const [carregandoMais, setCarregandoMais] = useState<Set<string>>(new Set());
  const emVoo = useRef<Set<string>>(new Set()); // guard síncrono (scroll dispara vários eventos)
  const carregarMais = useCallback((stageId: string) => {
    if (emVoo.current.has(stageId)) return;
    const stage = data?.stages.find((s) => s.id === stageId);
    if (!stage || stage.next == null) return;
    const start = stage.next;
    emVoo.current.add(stageId);
    setCarregandoMais((s) => new Set(s).add(stageId));
    api.kanbanStageMore<KanbanCard>(pipeline, stageId, start)
      .then((pg) => {
        setData((prev) => {
          if (!prev) return prev;
          const next: KanbanData = {
            ...prev,
            stages: prev.stages.map((s) => {
              if (s.id !== stageId) return s;
              const vistos = new Set(s.cards.map((c) => String(c.id)));
              const novos = pg.cards.filter((c) => !vistos.has(String(c.id)));
              return { ...s, cards: [...s.cards, ...novos], total: pg.total, next: pg.next };
            }),
          };
          cacheRef.current[pipeline] = { data: next, at: cacheRef.current[pipeline]?.at ?? updatedAt };
          return next;
        });
      })
      .catch(() => undefined)
      .finally(() => {
        emVoo.current.delete(stageId);
        setCarregandoMais((s) => { const n = new Set(s); n.delete(stageId); return n; });
      });
  }, [data, pipeline, updatedAt]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--paper)' }}>
      {/* ---- Top bar da página ---- */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 26px', height: 60, background: 'var(--white)',
          borderBottom: '1px solid var(--line)', flex: '0 0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="gavel" size={17} style={{ color: 'var(--green-600)' }} />
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.01em' }}>
              Negativação / Protestos
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 500 }}>
              Espelho read-only dos pipelines do Bitrix
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {updatedAt && (
            <span style={{ fontSize: 11, color: 'var(--ink-400)' }} className="tnum">
              Atualizado em {updatedAt}
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => load(pipeline, true)} disabled={loading}>
            <Icon name="history" size={14} className={loading ? 'spin' : undefined} />
            {loading ? 'Carregando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {/* ---- Conteúdo ---- */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '16px 26px 0' }}>
        {/* abas */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 14 }}>
          {TABS.map((t) => {
            const on = pipeline === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setPipeline(t.key)}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit',
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, marginBottom: -1,
                  color: on ? 'var(--green-800)' : 'var(--ink-400)',
                  borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                  transition: 'color .15s, border-color .15s',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {error ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--age-crit-fg)', fontSize: 14 }}>
            <Icon name="alert" size={24} /> Erro ao carregar: {error}
          </div>
        ) : loading || !data ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--ink-400)', fontSize: 14 }}>
            <Icon name="history" size={28} className="spin" style={{ color: 'var(--green-500)' }} />
            Carregando {TABS.find((t) => t.key === pipeline)?.label}…
          </div>
        ) : (
          <>
            {/* filtros */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div className="field" style={{ width: 260, cursor: 'text' }}>
                <Icon name="search" size={15} style={{ color: 'var(--ink-400)' }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar nº, cedente ou sacado…"
                  style={{ border: 'none', outline: 'none', background: 'transparent', font: 'inherit', flex: 1, minWidth: 0, color: 'var(--ink-900)' }}
                />
              </div>

              {/* Etapa */}
              <Popover
                minWidth={260}
                trigger={({ open, toggle: tg }) => (
                  <button type="button" className={'field' + (etapas.length ? ' active' : '')} onClick={tg}>
                    <Icon name="layers" size={14} />
                    <span style={{ whiteSpace: 'nowrap' }}>Etapa{etapas.length ? ` · ${etapas.length}` : ''}</span>
                    <Icon name="chevron" size={13} className={etapas.length ? undefined : 'cv'} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .12s' }} />
                  </button>
                )}
              >
                {() => (
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {data.stages.map((s) => (
                      <CheckRow key={s.id} checked={etapas.includes(s.id)} onClick={() => setEtapas((a) => toggle(a, s.id))}
                        label={<span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nome}</span><span className="tnum" style={{ color: 'var(--ink-400)' }}>{s.total}</span></span>} />
                    ))}
                    {etapas.length > 0 && <button className="btn btn-quiet btn-sm" style={{ width: '100%', marginTop: 4 }} onClick={() => setEtapas([])}>Limpar</button>}
                  </div>
                )}
              </Popover>

              {/* Status */}
              <Popover
                minWidth={200}
                trigger={({ open, toggle: tg }) => (
                  <button type="button" className={'field' + (statusSel.length ? ' active' : '')} onClick={tg}>
                    <span style={{ whiteSpace: 'nowrap' }}>Status{statusSel.length ? ` · ${statusSel.length}` : ''}</span>
                    <Icon name="chevron" size={13} className={statusSel.length ? undefined : 'cv'} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .12s' }} />
                  </button>
                )}
              >
                {() => (
                  <div>
                    {STATUS_OPCOES.map((st) => (
                      <CheckRow key={st} checked={statusSel.includes(st)} onClick={() => setStatusSel((a) => toggle(a, st))}
                        label={<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: KANBAN_STATUS[st].dot }} />{KANBAN_STATUS[st].label}</span>} />
                    ))}
                    {statusSel.length > 0 && <button className="btn btn-quiet btn-sm" style={{ width: '100%', marginTop: 4 }} onClick={() => setStatusSel([])}>Limpar</button>}
                  </div>
                )}
              </Popover>

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
              {temFiltro && (
                <button className="btn btn-quiet btn-sm" onClick={limparFiltros}><Icon name="filter" size={14} />Limpar filtros</button>
              )}
            </div>

            <div key={pipeline} className="fade-in" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* resumo + legenda */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
              <StatusSummary totais={totaisFiltrado} />
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-400)', maxWidth: 460 }}>
                Cards classificados pelo cruzamento com o Smart:{' '}
                <strong style={{ color: 'var(--age-crit-fg)' }}>vermelho</strong> quitado,{' '}
                <strong style={{ color: 'var(--age-warn-fg)' }}>amarelo</strong> parcial (ainda há títulos em aberto),{' '}
                <strong style={{ color: 'var(--ink-500)' }}>cinza</strong> em aberto.
              </p>
            </div>

            {/* board */}
            <div
              ref={boardRef}
              onMouseDown={onBoardMouseDown}
              onMouseMove={onBoardMouseMove}
              onMouseUp={endBoardPan}
              onMouseLeave={endBoardPan}
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${filteredStages.length || 1}, minmax(260px, 1fr))`,
                gap: 12, marginTop: 12, paddingBottom: 26,
                flex: 1, minHeight: 360, overflowX: 'auto', overflowY: 'hidden',
                cursor: 'grab',
              }}
            >
              {filteredStages.map((stage) => (
                <KanbanColumn
                  key={stage.id}
                  stage={stage}
                  onCardDragStart={onCardDragStart}
                  onDropCard={onDropCard}
                  onCarregarMais={carregarMais}
                  carregandoMais={carregandoMais.has(stage.id)}
                />
              ))}
            </div>
            </div>
          </>
        )}
      </div>

      {/* indicador de movimentação em curso */}
      {moving && (
        <div style={{ position: 'fixed', bottom: 22, right: 26, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--ink-900)', color: '#fff', borderRadius: 10, padding: '9px 14px', fontSize: 12.5, fontWeight: 600, boxShadow: 'var(--sh-md)', zIndex: 60 }}>
          <Icon name="history" size={14} className="spin" /> Movendo card no Bitrix…
        </div>
      )}

      {/* modal de comentário — exigido ao mover p/ Solicitação de Carta de Anuência */}
      {comentarioModal && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) { setComentarioModal(null); setComentario(''); } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(16,35,27,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 24 }}
        >
          <div className="fade-in" style={{ width: 'min(520px, 100%)', background: 'var(--white)', borderRadius: 14, boxShadow: 'var(--sh-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="message" size={17} style={{ color: 'var(--green-600)' }} />
              <div style={{ lineHeight: 1.2 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Solicitação de Carta de Anuência</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>
                  {comentarioModal.card.numero_titulo || comentarioModal.card.titulo_card || '—'} · {comentarioModal.card.razao_social_sacado || '—'}
                </div>
              </div>
            </div>
            <div style={{ padding: 20 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-700)', display: 'block', marginBottom: 7 }}>
                Comentário (será registrado no timeline do card no Bitrix)
              </label>
              <textarea
                autoFocus
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder="Escreva o comentário…"
                rows={5}
                style={{ width: '100%', resize: 'vertical', font: 'inherit', fontSize: 13, color: 'var(--ink-900)', border: '1px solid var(--line)', borderRadius: 9, padding: '10px 12px', outline: 'none', boxSizing: 'border-box' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--green-400)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--line)')}
              />
            </div>
            <div style={{ padding: '0 20px 18px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setComentarioModal(null); setComentario(''); }}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={confirmarComentario} disabled={!comentario.trim()}>
                <Icon name="check" size={14} /> Mover e comentar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
