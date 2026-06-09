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
    dot: 'var(--age-crit-fg)',
    badgeBg: 'var(--age-crit-bg)',
    badgeFg: 'var(--age-crit-fg)',
    border: 'var(--age-crit-fg)',
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
