/* Tipos do Kanban de Protestos/Negativações.
   Espelham o shape de get_kanban_data() (serviço Python protesto_kanban_service),
   pra a troca pelo backend real (NestJS proxiando o Bitrix + SQL) ser direta. */

export type PipelineKey = 'protesto' | 'negativacao';

/** Status de quitação cruzado com vw_titulos_quitados / vw_titulos_abertos. */
export type KanbanStatus = 'quitado_pronto' | 'quitado_parcial' | 'nao_quitado';

export interface KanbanCard {
  id: number | string;
  titulo_card: string | null;
  stage_id: string;
  plataforma: string;
  razao_social_cedente: string | null;
  numero_titulo: string | null;
  razao_social_sacado: string | null;
  cnpj_cpf_sacado: string | null;
  criado_por: string;
  status: KanbanStatus;
  valor_face: number | null;
  liquidado: number | null;
  quitacao: string | null; // dd/mm/aaaa
  situacao_smart: string | null;
  card_link: string;
}

export interface KanbanStage {
  id: string;
  nome: string;
  plataforma: string;
  cards: KanbanCard[];
}

export interface KanbanTotais {
  total: number;
  quitado_pronto: number;
  quitado_parcial: number;
  nao_quitado: number;
}

export interface KanbanData {
  pipeline: PipelineKey;
  label: string;
  stages: KanbanStage[];
  totais: KanbanTotais;
}
