/* Lógica de aging (faixas de atraso) e status — fonte única de verdade visual.
   No backend real, `dias`/`aging`/`valorAtual` virão calculados da API com a
   data de referência ("hoje") do servidor. */

import type { AgingKey, StatusKey, Titulo } from './types';

/** Estados que um título exibe — pode ter mais de um (protestado + negativado). */
export function tituloEstados(t: Pick<Titulo, 'status' | 'protesto' | 'negativado'>): StatusKey[] {
  const r: StatusKey[] = [];
  if (t.protesto === 'protestado') r.push('protestado');
  else if (t.protesto === 'protesto') r.push('protesto');
  if (t.negativado) r.push('negativado');
  if (r.length === 0) r.push(t.status); // open / nego / acordo
  return r;
}

export interface AgeMeta {
  key: AgingKey;
  label: string;       // "1–30"
  fg: string;          // var(--age-*-fg)
  bg: string;          // var(--age-*-bg)
  rgb: string;         // canal rgb para o heatmap
  risk: string;        // rótulo de risco do cedente
}

export const AGE_SCALE: AgeMeta[] = [
  { key: 'fresh', label: '1–30',  fg: 'var(--age-fresh-fg)', bg: 'var(--age-fresh-bg)', rgb: '11,138,95',  risk: 'Saudável' },
  { key: 'warn',  label: '31–60', fg: 'var(--age-warn-fg)',  bg: 'var(--age-warn-bg)',  rgb: '183,121,31', risk: 'Atenção' },
  { key: 'hot',   label: '61–90', fg: 'var(--age-hot-fg)',   bg: 'var(--age-hot-bg)',   rgb: '194,65,12',  risk: 'Risco alto' },
  { key: 'crit',  label: '90+',   fg: 'var(--age-crit-fg)',  bg: 'var(--age-crit-bg)',  rgb: '185,28,28',  risk: 'Crítico' },
];

export const ageMeta = (key: AgingKey): AgeMeta =>
  AGE_SCALE.find((a) => a.key === key) ?? AGE_SCALE[0];

export const agingClass = (dias: number): AgingKey => {
  if (dias <= 30) return 'fresh';
  if (dias <= 60) return 'warn';
  if (dias <= 90) return 'hot';
  return 'crit';
};

export const agingLabel = (dias: number): string => ageMeta(agingClass(dias)).label;

export const diasVencidos = (iso: string, hoje: string): number => {
  const d = new Date(iso + 'T00:00:00');
  const ref = new Date(hoje + 'T00:00:00');
  return Math.round((ref.getTime() - d.getTime()) / 86400000);
};

export interface StatusMeta {
  key: StatusKey;
  label: string;
  cls: string;
}

export const STATUS: Record<StatusKey, StatusMeta> = {
  open:       { key: 'open',       label: 'Em aberto',     cls: 'open' },
  nego:       { key: 'nego',       label: 'Em negociação', cls: 'nego' },
  acordo:     { key: 'acordo',     label: 'Acordo',        cls: 'acordo' },
  protesto:   { key: 'protesto',   label: 'Em protesto',   cls: 'protesto' },
  protestado: { key: 'protestado', label: 'Protestado',    cls: 'protestado' },
  negativado: { key: 'negativado', label: 'Negativado',    cls: 'negativado' },
};
