/* Tela: Negativação / Protestos — espelho read-only dos pipelines do Bitrix.
   Abas internas (Protestos | Negativações) trocam o pipeline.
   Dados via mock (getKanbanData) no mesmo shape do backend futuro. */
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { KanbanColumn } from './components/KanbanColumn';
import { StatusSummary } from './components/StatusSummary';
import { getKanbanData } from './data/mock';
import type { KanbanData, PipelineKey } from './types';

const TABS: { key: PipelineKey; label: string }[] = [
  { key: 'protesto', label: 'Protestos' },
  { key: 'negativacao', label: 'Negativações' },
];

export function KanbanPage() {
  const [pipeline, setPipeline] = useState<PipelineKey>('protesto');
  const [data, setData] = useState<KanbanData>(() => getKanbanData('protesto'));
  const [updatedAt, setUpdatedAt] = useState<string>('');

  const load = useCallback((pk: PipelineKey) => {
    setData(getKanbanData(pk));
    setUpdatedAt(new Date().toLocaleTimeString('pt-BR'));
  }, []);

  useEffect(() => {
    load(pipeline);
  }, [pipeline, load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--paper)' }}>
      {/* ---- Top bar da página ---- */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 26px', height: 60, background: 'var(--white)',
          borderBottom: '1px solid var(--line)', flex: '0 0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="gavel" size={17} style={{ color: 'var(--green-600)' }} />
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.01em' }}>
              Negativação / Protestos
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 500 }}>
              Espelho read-only dos pipelines do Bitrix
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {updatedAt && (
            <span style={{ fontSize: 11, color: 'var(--ink-400)' }} className="tnum">
              Atualizado em {updatedAt}
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => load(pipeline)}>
            <Icon name="history" size={14} />
            Atualizar
          </button>
        </div>
      </div>

      {/* ---- Conteúdo ---- */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '16px 26px 0' }}>
        {/* abas */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 14 }}>
          {TABS.map((t) => {
            const on = pipeline === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setPipeline(t.key)}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit',
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, marginBottom: -1,
                  color: on ? 'var(--green-800)' : 'var(--ink-400)',
                  borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                  transition: 'color .15s, border-color .15s',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* resumo + legenda */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
          <StatusSummary totais={data.totais} />
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-400)', maxWidth: 460 }}>
            Cards classificados pelo cruzamento com o Smart:{' '}
            <strong style={{ color: 'var(--green-700)' }}>verde</strong> quitado,{' '}
            <strong style={{ color: 'var(--age-warn-fg)' }}>amarelo</strong> parcial (ainda há títulos em aberto),{' '}
            <strong style={{ color: 'var(--ink-500)' }}>cinza</strong> em aberto.
          </p>
        </div>

        {/* board */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${data.stages.length}, minmax(260px, 1fr))`,
            gap: 12, marginTop: 12, paddingBottom: 26,
            flex: 1, minHeight: 360, overflowX: 'auto', overflowY: 'hidden',
          }}
        >
          {data.stages.map((stage) => (
            <KanbanColumn key={stage.id} stage={stage} />
          ))}
        </div>
      </div>
    </div>
  );
}
