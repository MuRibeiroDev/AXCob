/* Coluna (estágio) do kanban. */
import { KanbanCard } from './KanbanCard';
import type { KanbanStage } from '../types';

export function KanbanColumn({ stage }: { stage: KanbanStage }) {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', minHeight: 0,
        background: 'var(--paper)', border: '1px solid var(--line)',
        borderRadius: 12, padding: 10,
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 6px 8px', borderBottom: '1px dashed var(--line)', marginBottom: 8,
        }}
      >
        <h3
          style={{
            margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--ink-700)',
            textTransform: 'uppercase', letterSpacing: '.03em',
          }}
        >
          {stage.nome}
        </h3>
        <span
          style={{
            fontSize: 11, fontWeight: 700, color: 'var(--ink-500)', background: 'var(--white)',
            borderRadius: 999, padding: '2px 8px', border: '1px solid var(--line)',
          }}
        >
          {stage.cards.length}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stage.cards.length === 0 ? (
          <div style={{ color: 'var(--ink-300)', fontSize: 12, textAlign: 'center', padding: '24px 6px' }}>
            Nenhum card
          </div>
        ) : (
          stage.cards.map((c) => <KanbanCard key={c.id} card={c} />)
        )}
      </div>
    </div>
  );
}
