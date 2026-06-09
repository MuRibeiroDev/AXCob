/* Coluna (estágio) do kanban — drop target do drag-and-drop. */
import { useState } from 'react';
import { KanbanCard } from './KanbanCard';
import type { KanbanCard as CardType, KanbanStage } from '../types';

export interface KanbanColumnProps {
  stage: KanbanStage;
  onCardDragStart: (card: CardType, fromStageId: string) => void;
  onDropCard: (toStageId: string) => void;
}

export function KanbanColumn({ stage, onCardDragStart, onDropCard }: KanbanColumnProps) {
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDropCard(stage.id); }}
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
            {over ? 'Solte aqui' : 'Nenhum card'}
          </div>
        ) : (
          stage.cards.map((c) => (
            <KanbanCard key={c.id} card={c} onDragStart={() => onCardDragStart(c, stage.id)} />
          ))
        )}
      </div>
    </div>
  );
}
