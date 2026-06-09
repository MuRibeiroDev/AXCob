/* Card do kanban — clicável (abre no Bitrix). */
import { Icon } from '@/components/Icon';
import { fmtBRL } from '@/lib/format';
import { KANBAN_STATUS } from '../status';
import type { KanbanCard as Card } from '../types';

export function KanbanCard({ card, onDragStart }: { card: Card; onDragStart?: () => void }) {
  const meta = KANBAN_STATUS[card.status];
  const sacado = [card.razao_social_sacado, card.cnpj_cpf_sacado].filter(Boolean).join(' — ');

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onClick={() => window.open(card.card_link, '_blank', 'noopener')}
      title="Arraste para mover de etapa · clique para abrir no Bitrix"
      style={{
        textAlign: 'left', width: '100%', font: 'inherit', cursor: 'grab',
        background: 'var(--white)', border: '1px solid var(--line)',
        borderLeft: `4px solid ${meta.border}`, borderRadius: 10, padding: '10px 12px',
        boxShadow: 'var(--sh-sm)', transition: 'box-shadow .15s, transform .05s', display: 'block',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 6px 16px rgba(16,35,27,.10)')}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'var(--sh-sm)')}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <span className="mono-id" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {card.numero_titulo || card.titulo_card || '—'}
        </span>
        <span
          style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
            whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.03em',
            background: meta.badgeBg, color: meta.badgeFg,
          }}
        >
          {meta.label}
        </span>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-700)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {card.razao_social_cedente || '—'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-400)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {sacado || '—'}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
        <span className="tnum" style={{ fontWeight: 700, color: 'var(--ink-900)' }}>
          {card.valor_face != null ? fmtBRL(card.valor_face) : '—'}
        </span>
        <span style={{ color: 'var(--ink-400)' }}>
          {card.quitacao ? `Quitado em ${card.quitacao}` : ''}
        </span>
      </div>
      {card.criado_por && card.criado_por !== '—' && (
        <div style={{ marginTop: 5, fontSize: 10.5, color: 'var(--ink-400)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Icon name="user" size={10} />
          {card.criado_por}
        </div>
      )}
    </button>
  );
}
