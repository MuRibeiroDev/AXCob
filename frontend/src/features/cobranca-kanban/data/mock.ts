/* MOCK do Kanban — substituir por fetch do backend (NestJS proxiando Bitrix 116/112 + SQL).
   Estágios idênticos ao bitrix_service.py (entityTypeId 1200). */

import type { KanbanCard, KanbanData, KanbanStatus, PipelineKey, KanbanStage } from '../types';

const BITRIX = 'https://audaxcapitalsa.bitrix24.com.br/crm/type/1200/details';

interface StageDef {
  id: string;
  nome: string;
  plataforma: string;
}

const PIPELINES: Record<PipelineKey, { label: string; stages: StageDef[] }> = {
  protesto: {
    label: 'Protestos',
    stages: [
      { id: 'DT1200_116:CLIENT', nome: 'Protesto - SEC', plataforma: 'SEC' },
      { id: 'DT1200_116:UC_1CUNSV', nome: 'Protesto - FIDC', plataforma: 'FIDC' },
      { id: 'DT1200_116:UC_TI73RL', nome: 'Protesto - LION', plataforma: 'LION' },
      { id: 'DT1200_116:SUCCESS', nome: 'Protestado', plataforma: '—' },
    ],
  },
  negativacao: {
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

interface Seed {
  numero: string;
  cedente: string;
  sacado: string;
  cnpj: string;
  status: KanbanStatus;
  valor: number | null;
  quitacao: string | null;
}

// distribuição de seeds por estágio (índice do estágio → cards)
const PROTESTO_SEEDS: Record<number, Seed[]> = {
  0: [
    { numero: '39558-002', cedente: 'NUTRATTA NUTRIÇÃO ANIMAL SA', sacado: 'BENEDITO JOCEMAR COSTA JUNQUEIRA', cnpj: '554.616.626-68', status: 'nao_quitado', valor: 7169.6, quitacao: null },
    { numero: '18728-001', cedente: 'VALORIZA AGRONEGOCIOS S.A.', sacado: 'FABIANO MORSOLETO DE PONTES', cnpj: '35.280.369/0013-13', status: 'quitado_parcial', valor: 122400.0, quitacao: '14/05/2026' },
  ],
  1: [
    { numero: '39560-003', cedente: 'NUTRATTA NUTRIÇÃO ANIMAL SA', sacado: 'ADILSON RODRIGUES FERREIRA', cnpj: '678.553.936-68', status: 'nao_quitado', valor: 4682.01, quitacao: null },
    { numero: '40122-001', cedente: 'METALÚRGICA VALE AÇO LTDA', sacado: 'CONSTRUTORA HORIZONTE ENGENHARIA', cnpj: '04.221.880/0001-12', status: 'quitado_pronto', valor: 48500.0, quitacao: '22/05/2026' },
    { numero: '40130-002', cedente: 'DISTRIBUIDORA NORTE SUL S.A.', sacado: 'MERCANTIL BOA PRAÇA LTDA', cnpj: '11.203.998/0001-55', status: 'nao_quitado', valor: 15600.0, quitacao: null },
  ],
  2: [
    { numero: '51002-004', cedente: 'AGROPLENA COMÉRCIO DE INSUMOS', sacado: 'FAZENDA SANTA LÚCIA AGROPECUÁRIA', cnpj: '40.118.776/0001-09', status: 'nao_quitado', valor: 88400.0, quitacao: null },
    { numero: '51010-001', cedente: 'TECNOFIX COMPONENTES ELETRÔNICOS', sacado: 'ELETRO CENTER MAGAZINE', cnpj: '70.882.140/0001-03', status: 'quitado_parcial', valor: 44300.0, quitacao: '18/03/2026' },
  ],
  3: [
    { numero: '38800-007', cedente: 'SERQUIMICA IND COM IMP E EXP', sacado: 'AGRO DISTRIBUIDORA CENTRO OESTE', cnpj: '09.114.552/0001-30', status: 'quitado_pronto', valor: 26750.0, quitacao: '02/04/2026' },
    { numero: '38802-001', cedente: 'UNIGGEL SEMENTES INDUSTRIA', sacado: 'COOPERATIVA GRÃOS DO CERRADO', cnpj: '55.901.334/0001-18', status: 'quitado_pronto', valor: 19750.0, quitacao: '29/04/2026' },
    { numero: '38810-003', cedente: 'RADAN INDUSTRIA DE PRODUTOS', sacado: 'SUPERMERCADOS UNIÃO REDE', cnpj: '08.770.121/0001-77', status: 'nao_quitado', valor: 41880.5, quitacao: null },
  ],
};

const NEGATIVACAO_SEEDS: Record<number, Seed[]> = {
  0: [
    { numero: '60011-001', cedente: 'NUTRATTA NUTRIÇÃO ANIMAL SA', sacado: 'MARCOS ANTONIO GUEDES DE ALBUQUERQUE', cnpj: '212.956.204-30', status: 'nao_quitado', valor: 6402.9, quitacao: null },
    { numero: '60015-002', cedente: 'AGROPLENA COMÉRCIO DE INSUMOS', sacado: 'ATACADÃO VIANNA COMÉRCIO', cnpj: '27.665.001/0001-30', status: 'nao_quitado', valor: 53900.0, quitacao: null },
  ],
  1: [
    { numero: '60120-001', cedente: 'SERQUIMICA IND COM IMP E EXP', sacado: 'ESQUADRIAS PREMIUM COMÉRCIO', cnpj: '19.554.302/0001-44', status: 'quitado_pronto', valor: 18900.0, quitacao: '30/04/2026' },
  ],
  2: [
    { numero: '60210-003', cedente: 'DISTRIBUIDORA NORTE SUL S.A.', sacado: 'INFOSTORE VAREJO DIGITAL', cnpj: '62.004.551/0001-72', status: 'nao_quitado', valor: 28900.0, quitacao: null },
    { numero: '60212-001', cedente: 'METALÚRGICA VALE AÇO LTDA', sacado: 'CONSTRUTORA HORIZONTE ENGENHARIA', cnpj: '04.221.880/0001-12', status: 'quitado_parcial', valor: 71200.0, quitacao: '20/05/2026' },
  ],
  3: [
    { numero: '60330-002', cedente: 'VALORIZA AGRONEGOCIOS S.A.', sacado: 'FAZENDA SANTA LÚCIA AGROPECUÁRIA', cnpj: '40.118.776/0001-09', status: 'nao_quitado', valor: 35200.0, quitacao: null },
  ],
  4: [
    { numero: '60440-001', cedente: 'UNIGGEL SEMENTES INDUSTRIA', sacado: 'MERCANTIL BOA PRAÇA LTDA', cnpj: '11.203.998/0001-55', status: 'quitado_pronto', valor: 22150.0, quitacao: '10/04/2026' },
    { numero: '60441-005', cedente: 'TECNOFIX COMPONENTES ELETRÔNICOS', sacado: 'ELETRO CENTER MAGAZINE', cnpj: '70.882.140/0001-03', status: 'nao_quitado', valor: 16550.0, quitacao: null },
  ],
};

let SEQ = 7100;

function buildCard(stage: StageDef, s: Seed): KanbanCard {
  const id = SEQ++;
  return {
    id,
    titulo_card: `${s.cedente} · ${s.numero}`,
    stage_id: stage.id,
    plataforma: stage.plataforma,
    razao_social_cedente: s.cedente,
    numero_titulo: s.numero,
    razao_social_sacado: s.sacado,
    cnpj_cpf_sacado: s.cnpj,
    status: s.status,
    valor_face: s.valor,
    liquidado: s.status === 'quitado_pronto' ? s.valor : s.status === 'quitado_parcial' ? (s.valor ?? 0) * 0.6 : null,
    quitacao: s.quitacao,
    situacao_smart: s.status === 'nao_quitado' ? 'Aberto' : 'Quitado',
    card_link: `${BITRIX}/${id}/`,
  };
}

export function getKanbanData(pipeline: PipelineKey): KanbanData {
  const cfg = PIPELINES[pipeline];
  const seeds = pipeline === 'protesto' ? PROTESTO_SEEDS : NEGATIVACAO_SEEDS;

  const stages: KanbanStage[] = cfg.stages.map((stage, i) => ({
    id: stage.id,
    nome: stage.nome,
    plataforma: stage.plataforma,
    cards: (seeds[i] ?? []).map((s) => buildCard(stage, s)),
  }));

  const totais = { total: 0, quitado_pronto: 0, quitado_parcial: 0, nao_quitado: 0 };
  stages.forEach((st) =>
    st.cards.forEach((c) => {
      totais.total += 1;
      totais[c.status] += 1;
    }),
  );

  return { pipeline, label: cfg.label, stages, totais };
}
