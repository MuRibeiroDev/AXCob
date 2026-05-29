/* Barra empilhada de distribuição por faixa de atraso. */
import { AGE_SCALE } from '@/lib/aging';
import type { Buckets } from '@/lib/types';

export interface AgingBarProps {
  buckets: Buckets;
  height?: number;
}

export function AgingBar({ buckets, height = 8 }: AgingBarProps) {
  const total = buckets.fresh + buckets.warn + buckets.hot + buckets.crit || 1;
  const segs = AGE_SCALE
    .map((a) => ({ key: a.key, color: a.fg, value: buckets[a.key] }))
    .filter((s) => s.value > 0);

  return (
    <div
      style={{
        display: 'flex', height, borderRadius: 999, overflow: 'hidden',
        background: 'var(--line-soft)', gap: 1.5,
      }}
    >
      {segs.map((s) => (
        <div
          key={s.key}
          title={s.key}
          style={{ width: (s.value / total) * 100 + '%', background: s.color, opacity: 0.9 }}
        />
      ))}
    </div>
  );
}
