/* Matriz "Sacado × Faixa de atraso" (heatmap) + detalhe expandido de títulos.
   No detalhe, cada título tem checkbox de seleção e há botões Protestar/Negativar. */
import { useState, type CSSProperties } from 'react';
import { Icon } from '@/components/Icon';
import { Chip } from '@/components/Chip';
import { AgePill } from '@/components/AgePill';
import { AGE_SCALE, tituloEstados, type AgeMeta } from '@/lib/aging';
import { fmtBRL, fmtBRLshort, fmtDate } from '@/lib/format';
import type { Buckets, Sacado, Titulo } from '@/lib/types';

export type AcaoTitulo = 'protestar' | 'negativar';

/** Título já protestado (em processo ou protestado) — não pode protestar de novo. */
const jaProtestado = (t: Titulo): boolean => t.protesto != null;
/** Título já negativado (Bitrix ou situação "Aberto com Negativação"). */
const jaNegativado = (t: Titulo): boolean => t.negativado;

const GRID = 'minmax(210px,1.3fr) 116px 116px 116px 116px 132px';
const DETAIL_GRID = '30px 160px 110px 80px 140px 168px 1fr';

function sacadoBuckets(s: Sacado): Buckets {
  const b: Buckets = { fresh: 0, warn: 0, hot: 0, crit: 0 };
  s.titulos.forEach((t) => { b[t.aging] += t.valorOriginal; }); // Valor Face (base do Power BI)
  return b;
}

function CheckBox({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-checked={checked}
      role="checkbox"
      style={{
        width: 17, height: 17, borderRadius: 5, flex: '0 0 auto', padding: 0, cursor: 'pointer',
        border: `1.5px solid ${checked ? 'var(--green-500)' : 'var(--ink-300)'}`,
        background: checked ? 'var(--green-500)' : 'var(--white)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
      }}
    >
      {checked && <Icon name="check" size={11} stroke={2.8} />}
    </button>
  );
}

function HeatCell({ value, meta, max }: { value: number; meta: AgeMeta; max: number }) {
  if (!value) {
    return <div style={{ textAlign: 'center', color: 'var(--ink-300)', fontSize: 13 }}>–</div>;
  }
  const intensity = 0.16 + 0.74 * (value / max);
  return (
    <div
      style={{
        textAlign: 'center', padding: '7px 4px', borderRadius: 7,
        background: `rgba(${meta.rgb}, ${intensity * 0.22})`,
        border: `1px solid rgba(${meta.rgb}, ${intensity * 0.4})`,
      }}
    >
      <div className="tnum" style={{ fontSize: 13, fontWeight: 700, color: meta.fg }}>
        {fmtBRLshort(value)}
      </div>
    </div>
  );
}

function TituloDetail({ titulos, onAction }: { titulos: Titulo[]; onAction: (a: AcaoTitulo, ts: Titulo[]) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allOn = titulos.length > 0 && titulos.every((t) => sel.has(t.id));
  const toggleAll = () => setSel(allOn ? new Set() : new Set(titulos.map((t) => t.id)));

  const selecionados = titulos.filter((t) => sel.has(t.id));
  const protestaveis = selecionados.filter((t) => !jaProtestado(t));
  const negativaveis = selecionados.filter((t) => !jaNegativado(t));
  const act = (a: AcaoTitulo, ts: Titulo[]) => {
    if (ts.length === 0) return;
    onAction(a, ts);
    setSel(new Set());
  };

  return (
    <div style={{ background: 'var(--paper)', padding: '8px 18px 14px', borderTop: '1px solid var(--line)' }}>
      {/* cabeçalho do detalhe (selecionar todos) */}
      <div style={{ display: 'grid', gridTemplateColumns: DETAIL_GRID, alignItems: 'center', gap: 12, padding: '4px 0 6px' }}>
        <CheckBox checked={allOn} onClick={toggleAll} />
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Título</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Vencimento</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Atraso</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Valor</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Status</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: 'right' }}>Situação</span>
      </div>

      {titulos.map((t) => {
        const on = sel.has(t.id);
        return (
          <div
            key={t.id}
            onClick={() => toggle(t.id)}
            style={{
              display: 'grid', gridTemplateColumns: DETAIL_GRID, alignItems: 'center', gap: 12,
              padding: '8px 18px', margin: '0 -18px', borderBottom: '1px dashed var(--line)', cursor: 'pointer',
              background: on ? 'var(--green-50)' : 'transparent',
            }}
          >
            <CheckBox checked={on} onClick={() => toggle(t.id)} />
            <span className="mono-id" style={{ fontSize: 12.5, fontWeight: 600 }}>
              <Icon name="doc" size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5, color: 'var(--ink-300)' }} />
              {t.id}
            </span>
            <span className="tnum" style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
              {t.vencimento ? `venc. ${fmtDate(t.vencimento)}` : '—'}
            </span>
            <span><AgePill dias={t.dias} /></span>
            <span className="tnum" style={{ fontSize: 13, fontWeight: 700 }} title={`Atualizado: ${fmtBRL(t.valorAtual)} (encargos ${fmtBRL(t.juros)})`}>{fmtBRL(t.valorOriginal)}</span>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {tituloEstados(t).map((st) => <Chip key={st} status={st} />)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-400)', textAlign: 'right' }}>{t.situacao ?? '—'}</span>
          </div>
        );
      })}

      {/* barra de ações */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 500 }}>
          {selecionados.length > 0
            ? `${selecionados.length} título(s) selecionado(s)`
            : 'Selecione títulos para protestar ou negativar'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-ghost btn-sm"
          disabled={protestaveis.length === 0}
          onClick={() => act('protestar', protestaveis)}
          title={selecionados.length > 0 && protestaveis.length === 0 ? 'Os títulos selecionados já estão protestados' : undefined}
          style={{ opacity: protestaveis.length === 0 ? 0.45 : 1, cursor: protestaveis.length === 0 ? 'not-allowed' : 'pointer', color: '#6D28D9', borderColor: protestaveis.length ? '#C4B5FD' : 'var(--line)' }}
        >
          <Icon name="gavel" size={14} />Protestar{selecionados.length > protestaveis.length && protestaveis.length > 0 ? ` (${protestaveis.length})` : ''}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={negativaveis.length === 0}
          onClick={() => act('negativar', negativaveis)}
          title={selecionados.length > 0 && negativaveis.length === 0 ? 'Os títulos selecionados já estão negativados' : undefined}
          style={{ opacity: negativaveis.length === 0 ? 0.45 : 1, cursor: negativaveis.length === 0 ? 'not-allowed' : 'pointer', color: 'var(--age-crit-fg)', borderColor: negativaveis.length ? '#FBC4C4' : 'var(--line)' }}
        >
          <Icon name="alert" size={14} />Negativar{selecionados.length > negativaveis.length && negativaveis.length > 0 ? ` (${negativaveis.length})` : ''}
        </button>
      </div>
    </div>
  );
}

function SacadoRow({ s, max, open, onToggle, onAction }: {
  s: Sacado; max: number; open: boolean; onToggle: () => void; onAction: (a: AcaoTitulo, ts: Titulo[]) => void;
}) {
  const b = sacadoBuckets(s);
  return (
    <div style={{ borderBottom: '1px solid var(--line-soft)' }}>
      <div
        onClick={onToggle}
        style={{
          display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 10,
          padding: '11px 18px', cursor: 'pointer', background: open ? 'var(--hover)' : 'transparent',
          transition: 'background .12s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
          <Icon name={open ? 'chevron' : 'chevronR'} size={14} style={{ color: 'var(--ink-400)' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.nome}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {s.tel ? (
                <>
                  <Icon name="phone" size={10} />
                  {s.tel}
                </>
              ) : (
                s.doc ?? '—'
              )}
            </div>
          </div>
        </div>
        {AGE_SCALE.map((a) => (
          <HeatCell key={a.key} value={b[a.key]} meta={a} max={max} />
        ))}
        <div className="tnum" style={{ textAlign: 'right', fontSize: 14, fontWeight: 700 }}>{fmtBRL(s.total)}</div>
      </div>
      {open && <TituloDetail titulos={s.titulos} onAction={onAction} />}
    </div>
  );
}

const headStyle: CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '.05em',
};

export interface AgingMatrixProps {
  sacados: Sacado[];
  max: number;
  openRow: number | null;
  onToggleRow: (i: number) => void;
  onAction: (a: AcaoTitulo, ts: Titulo[]) => void;
}

export function AgingMatrix({ sacados, max, openRow, onToggleRow, onAction }: AgingMatrixProps) {
  return (
    <div
      style={{
        margin: '0 26px 26px', background: 'var(--white)', border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)', overflow: 'hidden', boxShadow: 'var(--sh-sm)',
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
      }}
    >
      {/* scroll interno: vertical (lista) + horizontal (colunas em telas estreitas) */}
      <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <div style={{ minWidth: 900 }}>
          {/* cabeçalho — fixo no topo ao rolar */}
          <div
            style={{
              display: 'grid', gridTemplateColumns: GRID, gap: 10, padding: '11px 18px',
              alignItems: 'center', borderBottom: '1px solid var(--line)', background: 'var(--paper)',
              position: 'sticky', top: 0, zIndex: 2,
            }}
          >
            <div style={headStyle}>Sacado</div>
            {AGE_SCALE.map((a) => (
              <div key={a.key} style={{ ...headStyle, textAlign: 'center', color: a.fg }}>{a.label} dias</div>
            ))}
            <div style={{ ...headStyle, textAlign: 'right' }}>Total</div>
          </div>

          {sacados.length === 0 ? (
            <div style={{ padding: '34px 18px', textAlign: 'center', color: 'var(--ink-400)', fontSize: 13 }}>
              Nenhum sacado para os filtros aplicados.
            </div>
          ) : (
            sacados.map((s, i) => (
              <SacadoRow key={s.doc} s={s} max={max} open={openRow === i} onToggle={() => onToggleRow(i)} onAction={onAction} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
