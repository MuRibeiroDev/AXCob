/* Catálogo de relatórios (espelha cobranca_print/cards do Ax_Expenses).
   `pronto=true` → tem geração implementada (TEXTO). Os demais são stubs (a implementar). */

export type RelatorioFormato = 'TEXTO' | 'PNG';

export interface RelatorioCard {
  id: string;
  label: string;
  descricao: string;
  formato: RelatorioFormato;
  grupo: string;
  pronto: boolean;
}

export const RELATORIOS: RelatorioCard[] = [
  {
    id: 'comissarias_em_atraso',
    label: 'Comissárias em atraso',
    descricao: 'Cedentes em atraso após interpretar a flexibilização do acordo (LLM + regras de dia útil).',
    formato: 'TEXTO',
    grupo: 'Comissárias',
    pronto: true,
  },
  {
    id: 'comissarias_sem_atraso',
    label: 'Comissárias sem atraso',
    descricao: 'Cedentes ainda no prazo da flexibilização (vencidos por data, mas dentro da carência).',
    formato: 'TEXTO',
    grupo: 'Comissárias',
    pronto: true,
  },
  // ---- Títulos Quitados (Power BI — captura via Playwright) ----
  {
    id: 'titulos_quitados_geral',
    label: 'Títulos quitados — Geral',
    descricao: 'Print do BI (Títulos Quitados) do último dia útil — período e Tipo Boleto C aplicados. Gerado via Power BI; pode levar alguns minutos.',
    formato: 'PNG',
    grupo: 'Títulos Quitados',
    pronto: true,
  },
  {
    id: 'titulos_quitados_agro',
    label: 'Títulos quitados — Agro',
    descricao: 'Print do BI (Títulos Quitados) filtrado por Categoria = AGRO, do último dia útil. Gerado via Power BI; pode levar alguns minutos.',
    formato: 'PNG', grupo: 'Títulos Quitados', pronto: true,
  },
  {
    id: 'titulos_quitados_industria',
    label: 'Títulos quitados — Indústria',
    descricao: 'Print do BI (Títulos Quitados) filtrado por Categoria = INDÚSTRIA, do último dia útil. Gerado via Power BI; pode levar alguns minutos.',
    formato: 'PNG', grupo: 'Títulos Quitados', pronto: true,
  },
  {
    id: 'titulos_quitados_estruturada',
    label: 'Títulos quitados — Estruturada',
    descricao: 'Print do BI (Títulos Quitados) filtrado por Categoria = ESTRUTURADA, do último dia útil. Gerado via Power BI; pode levar alguns minutos.',
    formato: 'PNG', grupo: 'Títulos Quitados', pronto: true,
  },
  // ---- Títulos Abertos (Power BI — captura via Playwright) ----
  {
    id: 'titulos_abertos_geral',
    label: 'Títulos abertos — Geral',
    descricao: 'Print do BI (Títulos Abertos) do último dia útil — Tipo de Título (todos menos ADC/CHQ/DES) e Tipo Boleto C. Gerado via Power BI; pode levar alguns minutos.',
    formato: 'PNG', grupo: 'Títulos Abertos', pronto: true,
  },
  {
    id: 'titulos_abertos_agro',
    label: 'Títulos abertos — Agro',
    descricao: 'Print do BI (Títulos Abertos) filtrado por Plataforma = AGRO, do último dia útil. Gerado via Power BI; pode levar alguns minutos.',
    formato: 'PNG', grupo: 'Títulos Abertos', pronto: true,
  },
  {
    id: 'titulos_abertos_industria',
    label: 'Títulos abertos — Indústria',
    descricao: 'Print do BI (Títulos Abertos) filtrado por Plataforma = INDÚSTRIA, do último dia útil. Gerado via Power BI; pode levar alguns minutos.',
    formato: 'PNG', grupo: 'Títulos Abertos', pronto: true,
  },
  {
    id: 'titulos_abertos_estruturada',
    label: 'Títulos abertos — Estruturada',
    descricao: 'Print do BI (Títulos Abertos) filtrado por Plataforma = ESTRUTURADA, do último dia útil. Gerado via Power BI; pode levar alguns minutos.',
    formato: 'PNG', grupo: 'Títulos Abertos', pronto: true,
  },
];
