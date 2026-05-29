/* Seletor de carteira (responsável de cobrança) — dropdown custom. */
import { Icon } from '@/components/Icon';
import { Popover } from '@/components/Popover';

export interface CarteiraSelectProps {
  responsaveis: string[];
  value: string;
  onChange: (r: string) => void;
}

export function CarteiraSelect({ responsaveis, value, onChange }: CarteiraSelectProps) {
  return (
    <Popover
      minWidth={300}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, border: 'none',
            background: open ? 'var(--hover)' : 'transparent', cursor: 'pointer',
            font: 'inherit', padding: '6px 10px', borderRadius: 'var(--r-sm)',
            transition: 'background .12s', maxWidth: 420,
          }}
        >
          <Icon name="building" size={16} style={{ color: 'var(--green-600)', flex: '0 0 auto' }} />
          <div style={{ lineHeight: 1.15, minWidth: 0, textAlign: 'left' }}>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Carteira
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {value || '—'}
            </div>
          </div>
          <Icon
            name="chevron"
            size={15}
            style={{ color: 'var(--ink-400)', flex: '0 0 auto', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .12s' }}
          />
        </button>
      )}
    >
      {(close) => (
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: '.05em', padding: '2px 8px 6px' }}>
            Carteiras
          </div>
          {responsaveis.map((r) => {
            const on = r === value;
            return (
              <button
                key={r}
                type="button"
                onClick={() => { onChange(r); close(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                  border: 'none', cursor: 'pointer', font: 'inherit', padding: '8px 8px', borderRadius: 7,
                  background: on ? 'var(--green-50)' : 'transparent',
                  color: on ? 'var(--green-800)' : 'var(--ink-700)', fontWeight: on ? 700 : 500, fontSize: 13,
                }}
                onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = 'var(--hover)'; }}
                onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ width: 16, flex: '0 0 auto', color: 'var(--green-600)' }}>
                  {on && <Icon name="check" size={14} stroke={2.4} />}
                </span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r}</span>
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
