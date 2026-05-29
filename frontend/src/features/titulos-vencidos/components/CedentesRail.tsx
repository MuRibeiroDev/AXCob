/* Rail esquerdo: total da carteira + lista de cedentes ranqueada por exposição. */
import { useMemo } from 'react';
import { AgingBar } from '@/components/AgingBar';
import { ageMeta } from '@/lib/aging';
import { fmtBRL } from '@/lib/format';
import type { Cedente, Kpis } from '@/lib/types';

export interface CedentesRailProps {
  cedentes: Cedente[];
  kpis: Kpis;
  sel: string;
  onSelect: (id: string) => void;
}

export function CedentesRail({ cedentes, kpis, sel, onSelect }: CedentesRailProps) {
  const ordenados = useMemo(
    () => [...cedentes].sort((a, b) => b.total - a.total),
    [cedentes],
  );

  return (
    <div
      style={{
        width: 290, flex: '0 0 auto', background: 'var(--white)',
        borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ---- Topo: total da carteira ---- */}
      <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--line)', flex: '0 0 auto' }}>
        <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          Total da carteira
        </div>
        <div className="tnum" style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-.02em', margin: '4px 0 10px' }}>
          {fmtBRL(kpis.totalVencido)}
        </div>
        <AgingBar buckets={kpis.buckets} height={8} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10.5, color: 'var(--ink-400)', fontWeight: 600 }}>
          <span className="tnum">{kpis.qtdTitulos} títulos</span>
          <span className="tnum">{kpis.qtdSacados} sacados</span>
        </div>
      </div>

      {/* ---- Lista de cedentes ---- */}
      <div style={{ padding: 12, flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: 10.5, color: 'var(--ink-400)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', padding: '0 6px 8px' }}>
          Cedentes
        </div>
        {ordenados.map((ced) => {
          const on = sel === ced.id;
          const m = ageMeta(ced.aging);
          return (
            <button
              key={ced.id}
              onClick={() => onSelect(ced.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                background: on ? 'var(--green-50)' : 'transparent', borderRadius: 9,
                padding: '11px 12px', marginBottom: 3,
                boxShadow: on ? 'inset 0 0 0 1px var(--green-200)' : 'none',
                transition: 'background .12s', font: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.fg, flex: '0 0 auto' }} />
                <span
                  style={{
                    fontSize: 12.5, fontWeight: 600,
                    color: on ? 'var(--green-800)' : 'var(--ink-900)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
                  }}
                >
                  {ced.nome}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5, paddingLeft: 17 }}>
                <span className="tnum" style={{ fontSize: 13, fontWeight: 700, color: on ? 'var(--green-700)' : 'var(--ink-700)', whiteSpace: 'nowrap' }}>
                  {fmtBRL(ced.total)}
                </span>
                <span className="tnum" style={{ fontSize: 10.5, color: 'var(--ink-400)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  {ced.qtd} tít. · {ced.maxDias}d
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
