/** Status de cobrança derivado dos pipelines do Bitrix. */
export type StatusBitrix = 'protesto' | 'protestado' | 'negativado';

export interface BitrixStageDef {
  id: string;
  nome: string;
  plataforma: string;
}

export interface BitrixPipeline {
  categoryId: number;
  label: string;
  stages: BitrixStageDef[];
}

/** Campos custom do card (Smart Process 1200). */
export const BITRIX_FIELDS = {
  numero: 'ufCrm58_1760096145', // Número do Título
  cnpjSacado: 'ufCrm58_1759923144', // CNPJ/CPF Sacado
  razaoCedente: 'ufCrm58_1759253307',
  razaoSacado: 'ufCrm58_1759923007',
} as const;

export const ENTITY_TYPE_ID = 1200;

export const PIPELINES: Record<'protesto' | 'negativacao', BitrixPipeline> = {
  protesto: {
    categoryId: 116,
    label: 'Protestos',
    stages: [
      { id: 'DT1200_116:CLIENT', nome: 'Protesto - SEC', plataforma: 'SEC' },
      { id: 'DT1200_116:UC_1CUNSV', nome: 'Protesto - FIDC', plataforma: 'FIDC' },
      { id: 'DT1200_116:UC_TI73RL', nome: 'Protesto - LION', plataforma: 'LION' },
      { id: 'DT1200_116:SUCCESS', nome: 'Protestado', plataforma: '—' },
    ],
  },
  negativacao: {
    categoryId: 112,
    label: 'Negativações',
    stages: [
      { id: 'DT1200_112:NEW', nome: 'Solicitações de Negativação', plataforma: '—' },
      { id: 'DT1200_112:PREPARATION', nome: 'Negativação - SEC', plataforma: 'SEC' },
      { id: 'DT1200_112:CLIENT', nome: 'Negativação - FIDC', plataforma: 'FIDC' },
      { id: 'DT1200_112:UC_GEDVFD', nome: 'Negativação - LION', plataforma: 'LION' },
      { id: 'DT1200_112:UC_187XXU', nome: 'Negativação via Serasa', plataforma: 'SERASA' },
    ],
  },
};
