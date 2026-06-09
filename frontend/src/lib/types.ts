/* Modelo de domínio (espelha a resposta do backend /api/titulos-vencidos).
   Hierarquia: Carteira (responsável) → Cedente → Sacado → Título. */

export type AgingKey = 'fresh' | 'warn' | 'hot' | 'crit';
export type StatusKey = 'open' | 'nego' | 'acordo' | 'protesto' | 'protestado' | 'negativado';

/** Soma de valores por faixa de atraso. */
export type Buckets = Record<AgingKey, number>;

export type TipoBoleto = 'todos' | 'C' | 'T'; // filtro "Tipo de Boleto" (coluna M); 'todos' = sem filtro

export interface Titulo {
  id: string; // DOCUMENTO
  idTitulo: number | null;
  vencimento: string | null; // ISO yyyy-mm-dd
  valorOriginal: number;
  valorAtual: number;
  juros: number; // multa + juros + tarifas
  dias: number;
  aging: AgingKey;
  agingLabel: string;
  status: StatusKey; // estado principal (rank: protestado > protesto > negativado > open)
  protesto: 'protesto' | 'protestado' | null;
  negativado: boolean;
  situacao: string | null;
  tipo: string | null;
  sistema: string | null;
}

export interface Sacado {
  nome: string;
  doc: string | null;
  tel: string | null;
  titulos: Titulo[];
  total: number;
  qtd: number;
  maxDias: number;
  aging: AgingKey;
}

export interface Cedente {
  id: string;
  nome: string;
  cnpj: string | null;
  sacados: Sacado[];
  total: number;
  qtd: number;
  sacadoQtd: number;
  maxDias: number;
  aging: AgingKey;
  buckets: Buckets;
}

export interface Carteira {
  nome: string;
  codigo: string;
}

export interface Kpis {
  totalVencido: number;
  totalOriginal: number;
  juros: number;
  qtdTitulos: number;
  qtdSacados: number;
  qtdCedentes: number;
  buckets: Buckets;
  bucketsQtd: Record<AgingKey, number>;
  emProtesto: number;
  emNego: number;
  emNegativado: number;
}

export interface CarteiraData {
  hoje: string;
  responsavel: string;
  tipo: string;
  carteira: Carteira;
  cedentes: Cedente[];
  kpis: Kpis;
}
