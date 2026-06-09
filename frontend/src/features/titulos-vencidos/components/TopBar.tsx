/* Top bar contextual: seletor de carteira (responsável) + posição + ações. */
import { Icon } from '@/components/Icon';
import { fmtDate } from '@/lib/format';
import { CarteiraSelect } from './CarteiraSelect';

export interface TopBarProps {
  hoje: string;
  responsaveis: string[];
  responsavel: string;
  onResponsavel: (r: string) => void;
}

export function TopBar({ hoje, responsaveis, responsavel, onResponsavel }: TopBarProps) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 26px', height: 60, background: 'var(--white)',
        borderBottom: '1px solid var(--line)', flex: '0 0 auto', gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <CarteiraSelect responsaveis={responsaveis} value={responsavel} onChange={onResponsavel} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '0 0 auto' }}>
        <div style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 500, whiteSpace: 'nowrap' }}>
          Posição em <b style={{ color: 'var(--ink-700)' }} className="tnum">{fmtDate(hoje)}</b>
        </div>
        <button className="btn btn-ghost btn-sm"><Icon name="download" size={14} />Exportar</button>
        <div
          style={{
            width: 34, height: 34, borderRadius: '50%', background: 'var(--green-50)',
            color: 'var(--green-700)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontWeight: 700, fontSize: 13, flex: '0 0 auto',
          }}
        >
          RS
        </div>
      </div>
    </div>
  );
}
