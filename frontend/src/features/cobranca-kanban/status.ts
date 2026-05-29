/* Metadados visuais do status de quitação — usando os tokens do AxCob. */
import type { KanbanStatus } from './types';

export interface KanbanStatusMeta {
  label: string;
  dot: string;      // cor do ponto/realce
  badgeBg: string;
  badgeFg: string;
  border: string;   // borda lateral do card
}

export const KANBAN_STATUS: Record<KanbanStatus, KanbanStatusMeta> = {
  quitado_pronto: {
    label: 'Quitado',
    dot: 'var(--green-500)',
    badgeBg: 'var(--green-50)',
    badgeFg: 'var(--green-700)',
    border: 'var(--green-400)',
  },
  quitado_parcial: {
    label: 'Parcial',
    dot: 'var(--age-warn-fg)',
    badgeBg: 'var(--age-warn-bg)',
    badgeFg: 'var(--age-warn-fg)',
    border: 'var(--age-warn-fg)',
  },
  nao_quitado: {
    label: 'Em aberto',
    dot: 'var(--ink-300)',
    badgeBg: 'var(--st-open-bg)',
    badgeFg: 'var(--st-open-fg)',
    border: 'var(--line)',
  },
};
