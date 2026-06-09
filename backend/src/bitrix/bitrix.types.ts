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
  valorSacado: 'ufCrm58_1759923224', // Valor do Título - Sacado (money)
} as const;

export const ENTITY_TYPE_ID = 1200;

/** Etapa de PIX. `limite` = nº máx. de cards (mais recentes) a buscar — usado em
 *  etapas grandes como "Atividade Concluído" (651 cards) p/ não travar. */
export interface PixStage {
  id: string;
  nome: string;
  limite?: number;
}

/** Pipeline de PIX (SPA Financeiro, entityTypeId 1248, categoria "Recebimentos"). */
export const PIX_PIPELINE: {
  entityTypeId: number;
  categoryId: number;
  detailBase: string;
  fields: { nome: string; valor: string };
  stages: PixStage[];
} = {
  entityTypeId: 1248,
  categoryId: 146,
  detailBase: 'https://audaxcapitalsa.bitrix24.com.br/crm/type/1248/details',
  fields: {
    nome: 'ufCrm76_1765212038', // Nome / cedente
    valor: 'ufCrm76_1765212056', // Valor (money "1234.56|BRL")
  },
  stages: [
    { id: 'DT1248_146:NEW', nome: 'Financeiro: PIX à Identificar' },
    { id: 'DT1248_146:PREPARATION', nome: 'Cobrança: Identificação do PIX' },
    { id: 'DT1248_146:UC_90OA0T', nome: 'PIX não Identificado' },
    { id: 'DT1248_146:SUCCESS', nome: 'Atividade Concluído', limite: 25 },
  ],
};

export const PIPELINES: Record<'protesto' | 'negativacao', BitrixPipeline> = {
  protesto: {
    categoryId: 116,
    label: 'Protestos',
    stages: [
      { id: 'DT1200_116:NEW', nome: 'Solicitações de Protesto', plataforma: '—' },
      { id: 'DT1200_116:PREPARATION', nome: 'Standby - Aguardando', plataforma: '—' },
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
