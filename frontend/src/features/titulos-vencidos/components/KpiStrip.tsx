/* Faixa de 5 KPIs da carteira. */
import type { CSSProperties, ReactNode } from 'react';
import { AgingBar } from '@/components/AgingBar';
import { AGE_SCALE } from '@/lib/aging';
import { fmtBRL, fmtBRLshort } from '@/lib/format';
import type { Kpis } from '@/lib/types';

const cardStyle = (grow: number, minWidth = 150, center = true): CSSProperties => ({
  flex: `${grow} 1 ${minWidth}px`, minWidth, background: 'var(--white)',
  border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 16, boxShadow: 'var(--sh-sm)',
  display: 'flex', flexDirection: 'column', justifyContent: 'center',
  ...(center ? { alignItems: 'center', textAlign: 'center' as const } : {}),
});

function Label({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11.5, color: 'var(--ink-400)', fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '.04em', marginBottom: 7,
      }}
    >
      {children}
    </div>
  );
}

export function KpiStrip({ kpis }: { kpis: Kpis }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      <div style={cardStyle(1.4)}>
        <Label>Total vencido</Label>
        <div className="tnum" style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1 }}>
          {fmtBRL(kpis.totalVencido)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--ink-500)', fontWeight: 500 }}>
          <span className="tnum" style={{ color: 'var(--age-crit-fg)', fontWeight: 600 }}>+{fmtBRL(kpis.juros)}</span>
          <span>de juros e multa acumulados</span>
        </div>
      </div>

      <div style={cardStyle(1)}>
        <Label>Títulos vencidos</Label>
        <div className="tnum" style={{ fontSize: 27, fontWeight: 700, lineHeight: 1 }}>{kpis.qtdTitulos}</div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-500)', fontWeight: 500 }}>
          <span className="tnum" style={{ fontWeight: 600, color: 'var(--ink-700)' }}>{kpis.qtdSacados}</span> sacados ·{' '}
          <span className="tnum" style={{ fontWeight: 600, color: 'var(--ink-700)' }}>{kpis.qtdCedentes}</span> cedentes
        </div>
      </div>

      <div style={cardStyle(1)}>
        <Label>Negativado</Label>
        <div className="tnum" style={{ fontSize: 27, fontWeight: 700, lineHeight: 1, color: 'var(--age-crit-fg)' }}>
          {fmtBRLshort(kpis.emNegativado)}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-500)', fontWeight: 500 }}>via Serasa / pipeline</div>
      </div>

      <div style={cardStyle(1)}>
        <Label>Em protesto</Label>
        <div className="tnum" style={{ fontSize: 27, fontWeight: 700, lineHeight: 1, color: 'var(--st-prot-fg)' }}>
          {fmtBRLshort(kpis.emProtesto)}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-500)', fontWeight: 500 }}>
          {kpis.bucketsQtd.crit} títulos críticos (90+)
        </div>
      </div>

      <div style={cardStyle(1.6, 210, false)}>
        <Label>Distribuição por atraso</Label>
        <AgingBar buckets={kpis.buckets} height={10} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12 }}>
          {AGE_SCALE.map((a) => (
            <div key={a.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-500)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: a.fg, flex: '0 0 auto' }} />
                {a.label} <span style={{ color: 'var(--ink-400)', fontWeight: 500 }}>dias</span>
              </span>
              <span className="tnum" style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                {fmtBRLshort(kpis.buckets[a.key])}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
