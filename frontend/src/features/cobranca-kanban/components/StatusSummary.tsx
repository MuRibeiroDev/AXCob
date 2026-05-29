/* Chips de resumo: total + por status de quitação. */
import { KANBAN_STATUS } from '../status';
import type { KanbanStatus, KanbanTotais } from '../types';

function Chip({ value, label, dot }: { value: number; label: string; dot?: string }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--white)',
        border: '1px solid var(--line)', borderRadius: 999, padding: '6px 12px',
        fontSize: 12, fontWeight: 600, color: 'var(--ink-500)',
      }}
    >
      {dot && <span style={{ width: 8, height: 8, borderRadius: 999, background: dot }} />}
      <strong className="tnum" style={{ color: 'var(--ink-900)' }}>{value}</strong> {label}
    </span>
  );
}

export function StatusSummary({ totais }: { totais: KanbanTotais }) {
  const order: { key: KanbanStatus; label: string }[] = [
    { key: 'quitado_pronto', label: 'quitados' },
    { key: 'quitado_parcial', label: 'parciais' },
    { key: 'nao_quitado', label: 'em aberto' },
  ];
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Chip value={totais.total} label="cards" />
      {order.map(({ key, label }) => (
        <Chip key={key} value={totais[key]} label={label} dot={KANBAN_STATUS[key].dot} />
      ))}
    </div>
  );
}
