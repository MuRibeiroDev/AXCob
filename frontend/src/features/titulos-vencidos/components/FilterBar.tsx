/* Barra de filtros — busca, segmented de aging e dropdowns funcionais:
   Cedente, Status, TIPO, Vencimento (período) e Faixa de valor. */
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Popover } from '@/components/Popover';
import { AGE_SCALE, STATUS } from '@/lib/aging';
import type { AgingKey, StatusKey, TipoBoleto } from '@/lib/types';

export type AgingFilter = 'all' | AgingKey;

export interface ValorFaixa {
  key: string;
  label: string;
  min: number;
  max: number;
}

export const VALOR_FAIXAS: ValorFaixa[] = [
  { key: 'all', label: 'Qualquer valor', min: 0, max: Infinity },
  { key: 'lt1k', label: 'Até R$ 1 mil', min: 0, max: 1000 },
  { key: '1k10k', label: 'R$ 1 mil – 10 mil', min: 1000, max: 10000 },
  { key: '10k50k', label: 'R$ 10 mil – 50 mil', min: 10000, max: 50000 },
  { key: '50k100k', label: 'R$ 50 mil – 100 mil', min: 50000, max: 100000 },
  { key: 'gt100k', label: 'Acima de R$ 100 mil', min: 100000, max: Infinity },
];

export interface Filters {
  query: string;
  aging: AgingFilter;
  sacado: string[];
  status: StatusKey[];
  tipo: string[];
  valor: string; // key de VALOR_FAIXAS
  vencDe: string;
  vencAte: string;
}

export const EMPTY_FILTERS: Filters = {
  query: '', aging: 'all', sacado: [], status: [], tipo: [], valor: 'all', vencDe: '', vencAte: '',
};

interface FilterBarProps {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  sacadoOptions: string[];
  statusOptions: StatusKey[];
  tipoOptions: string[];
  tipoBoleto: TipoBoleto;            // Tipo de Boleto (coluna M) — filtro server-side
  onTipoBoleto: (t: TipoBoleto) => void;
  onReset: () => void;
}

/* ---- botão .field usado como trigger ---- */
function FieldButton({ icon, children, active, open, onClick }: {
  icon?: string; children: ReactNode; active?: boolean; open?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" className={'field' + (active ? ' active' : '')} onClick={onClick}>
      {icon && <Icon name={icon} size={14} />}
      <span style={{ whiteSpace: 'nowrap' }}>{children}</span>
      <Icon name="chevron" size={13} className={active ? undefined : 'cv'} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .12s' }} />
    </button>
  );
}

function CheckRow({ checked, label, onClick }: { checked: boolean; label: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
        border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit',
        padding: '7px 8px', borderRadius: 7, fontSize: 13, color: 'var(--ink-700)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span
        style={{
          width: 16, height: 16, borderRadius: 5, flex: '0 0 auto',
          border: `1.5px solid ${checked ? 'var(--green-500)' : 'var(--ink-300)'}`,
          background: checked ? 'var(--green-500)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        }}
      >
        {checked && <Icon name="check" size={11} stroke={2.6} />}
      </span>
      {label}
    </button>
  );
}

const panelTitle = (t: string) => (
  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '.05em', padding: '2px 8px 6px' }}>{t}</div>
);

export function FilterBar({
  filters, onChange, sacadoOptions, statusOptions, tipoOptions, tipoBoleto, onTipoBoleto, onReset,
}: FilterBarProps) {
  const segs: { key: AgingFilter; label: string }[] = [
    { key: 'all', label: 'Todos' },
    ...AGE_SCALE.map((a) => ({ key: a.key as AgingFilter, label: a.label })),
  ];

  const toggleArr = <T extends string>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const valorLabel = VALOR_FAIXAS.find((f) => f.key === filters.valor)?.label ?? 'Faixa de valor';
  const vencAtivo = !!(filters.vencDe || filters.vencAte);
  const hasAny =
    filters.sacado.length > 0 || filters.status.length > 0 || filters.tipo.length > 0 ||
    filters.valor !== 'all' || vencAtivo || filters.aging !== 'all' || filters.query !== '';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {/* busca */}
      <div className="field" style={{ width: 280, cursor: 'text' }}>
        <Icon name="search" size={15} style={{ color: 'var(--ink-400)' }} />
        <input
          value={filters.query}
          onChange={(e) => onChange({ query: e.target.value })}
          placeholder="Buscar cedente, sacado ou título…"
          style={{ border: 'none', outline: 'none', background: 'transparent', font: 'inherit', flex: 1, color: 'var(--ink-900)' }}
        />
      </div>

      {/* Tipo de Boleto (coluna M) — igual ao slicer do Power BI; recarrega a carteira */}
      <Popover
        minWidth={180}
        trigger={({ open, toggle }) => (
          <FieldButton icon="doc" active={tipoBoleto !== 'todos'} open={open} onClick={toggle}>
            {tipoBoleto === 'todos' ? 'Tipo de boleto' : `Boleto ${tipoBoleto}`}
          </FieldButton>
        )}
      >
        {(close) => (
          <div>
            {panelTitle('Tipo de Boleto')}
            {([
              { key: 'todos', label: 'Todos' },
              { key: 'C', label: 'Tipo C' },
              { key: 'T', label: 'Tipo T' },
            ] as { key: TipoBoleto; label: string }[]).map((b) => (
              <CheckRow
                key={b.key}
                checked={tipoBoleto === b.key}
                label={<span style={{ fontWeight: 600 }}>{b.label}</span>}
                onClick={() => { if (tipoBoleto !== b.key) onTipoBoleto(b.key); close(); }}
              />
            ))}
          </div>
        )}
      </Popover>

      {/* segmented de aging */}
      <div style={{ display: 'inline-flex', background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: 3, gap: 2 }}>
        {segs.map(({ key, label }) => {
          const on = filters.aging === key;
          const fg = key === 'all' ? 'var(--green-700)' : `var(--age-${key}-fg)`;
          const bg = key === 'all' ? 'var(--green-50)' : `var(--age-${key}-bg)`;
          return (
            <button
              key={key}
              onClick={() => onChange({ aging: key })}
              style={{
                border: 'none', cursor: 'pointer', font: 'inherit', fontWeight: 600, fontSize: 12.5,
                padding: '5px 11px', borderRadius: 5, transition: 'all .12s',
                background: on ? bg : 'transparent', color: on ? fg : 'var(--ink-500)',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Sacado (multi) — dentro do cedente selecionado */}
      <Popover
        minWidth={260}
        trigger={({ open, toggle }) => (
          <FieldButton icon="user" active={filters.sacado.length > 0} open={open} onClick={toggle}>
            Sacado{filters.sacado.length > 0 ? ` · ${filters.sacado.length}` : ''}
          </FieldButton>
        )}
      >
        {() => (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {panelTitle('Sacado')}
            {sacadoOptions.length === 0 && <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--ink-400)' }}>—</div>}
            {sacadoOptions.map((s) => (
              <CheckRow
                key={s}
                checked={filters.sacado.includes(s)}
                label={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</span>}
                onClick={() => onChange({ sacado: toggleArr(filters.sacado, s) })}
              />
            ))}
            {filters.sacado.length > 0 && (
              <button onClick={() => onChange({ sacado: [] })} className="btn btn-quiet btn-sm" style={{ width: '100%', marginTop: 4 }}>Limpar</button>
            )}
          </div>
        )}
      </Popover>

      {/* Status (multi) */}
      <Popover
        trigger={({ open, toggle }) => (
          <FieldButton active={filters.status.length > 0} open={open} onClick={toggle}>
            Status{filters.status.length > 0 ? ` · ${filters.status.length}` : ''}
          </FieldButton>
        )}
      >
        {() => (
          <div>
            {panelTitle('Status')}
            {statusOptions.length === 0 && <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--ink-400)' }}>—</div>}
            {statusOptions.map((s) => (
              <CheckRow
                key={s}
                checked={filters.status.includes(s)}
                label={<span className={'chip ' + STATUS[s].cls}><span className="dot" />{STATUS[s].label}</span>}
                onClick={() => onChange({ status: toggleArr(filters.status, s) })}
              />
            ))}
            {filters.status.length > 0 && (
              <button onClick={() => onChange({ status: [] })} className="btn btn-quiet btn-sm" style={{ width: '100%', marginTop: 4 }}>Limpar</button>
            )}
          </div>
        )}
      </Popover>

      {/* TIPO (multi) */}
      <Popover
        trigger={({ open, toggle }) => (
          <FieldButton icon="doc" active={filters.tipo.length > 0} open={open} onClick={toggle}>
            Tipo{filters.tipo.length > 0 ? ` · ${filters.tipo.length}` : ''}
          </FieldButton>
        )}
      >
        {() => (
          <div style={{ maxHeight: 300, overflowY: 'auto', minWidth: 160 }}>
            {panelTitle('Tipo do título')}
            {tipoOptions.length === 0 && <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--ink-400)' }}>—</div>}
            {tipoOptions.map((tp) => (
              <CheckRow
                key={tp}
                checked={filters.tipo.includes(tp)}
                label={<span className="mono-id" style={{ fontWeight: 600 }}>{tp}</span>}
                onClick={() => onChange({ tipo: toggleArr(filters.tipo, tp) })}
              />
            ))}
            {filters.tipo.length > 0 && (
              <button onClick={() => onChange({ tipo: [] })} className="btn btn-quiet btn-sm" style={{ width: '100%', marginTop: 4 }}>Limpar</button>
            )}
          </div>
        )}
      </Popover>

      {/* Vencimento (período) */}
      <Popover
        minWidth={250}
        trigger={({ open, toggle }) => (
          <FieldButton icon="calendar" active={vencAtivo} open={open} onClick={toggle}>
            Vencimento
          </FieldButton>
        )}
      >
        {() => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 4 }}>
            {panelTitle('Vencimento entre')}
            <label style={{ fontSize: 12, color: 'var(--ink-500)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              De
              <input type="date" value={filters.vencDe} onChange={(e) => onChange({ vencDe: e.target.value })}
                style={{ font: 'inherit', fontSize: 13, padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 7, color: 'var(--ink-900)' }} />
            </label>
            <label style={{ fontSize: 12, color: 'var(--ink-500)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              Até
              <input type="date" value={filters.vencAte} onChange={(e) => onChange({ vencAte: e.target.value })}
                style={{ font: 'inherit', fontSize: 13, padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 7, color: 'var(--ink-900)' }} />
            </label>
            {vencAtivo && (
              <button onClick={() => onChange({ vencDe: '', vencAte: '' })} className="btn btn-quiet btn-sm" style={{ width: '100%' }}>Limpar</button>
            )}
          </div>
        )}
      </Popover>

      {/* Faixa de valor (single) */}
      <Popover
        minWidth={210}
        trigger={({ open, toggle }) => (
          <FieldButton active={filters.valor !== 'all'} open={open} onClick={toggle}>
            {filters.valor === 'all' ? 'Faixa de valor' : valorLabel}
          </FieldButton>
        )}
      >
        {(close) => (
          <div>
            {panelTitle('Faixa de valor (atualizado)')}
            {VALOR_FAIXAS.map((f) => (
              <CheckRow
                key={f.key}
                checked={filters.valor === f.key}
                label={f.label}
                onClick={() => { onChange({ valor: f.key }); close(); }}
              />
            ))}
          </div>
        )}
      </Popover>

      <div style={{ flex: 1 }} />
      {hasAny && (
        <button className="btn btn-quiet btn-sm" onClick={onReset}>
          <Icon name="filter" size={14} />Limpar filtros
        </button>
      )}
    </div>
  );
}
