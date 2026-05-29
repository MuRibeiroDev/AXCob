import type { AgingKey, Buckets } from './titulos-vencidos.types';

export const agingClass = (dias: number): AgingKey => {
  if (dias <= 30) return 'fresh';
  if (dias <= 60) return 'warn';
  if (dias <= 90) return 'hot';
  return 'crit';
};

export const agingLabel = (dias: number): string => {
  if (dias <= 30) return '1–30';
  if (dias <= 60) return '31–60';
  if (dias <= 90) return '61–90';
  return '90+';
};

export const emptyBuckets = (): Buckets => ({ fresh: 0, warn: 0, hot: 0, crit: 0 });
