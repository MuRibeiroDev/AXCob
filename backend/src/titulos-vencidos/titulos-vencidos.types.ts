export type AgingKey = 'fresh' | 'warn' | 'hot' | 'crit';
export type StatusKey = 'open' | 'nego' | 'acordo' | 'protesto' | 'protestado' | 'negativado';
export type Buckets = Record<AgingKey, number>;

export interface Titulo {
  id: string; // DOCUMENTO
  idTitulo: number | null;
  vencimento: string | null;
  valorOriginal: number; // VALOR
  valorAtual: number; // TOTAL
  juros: number; // MULTA + JUROS + TARIFAS
  dias: number;
  aging: AgingKey;
  agingLabel: string;
  status: StatusKey; // estado principal (rank: protestado > protesto > negativado > open)
  protesto: 'protesto' | 'protestado' | null;
  negativado: boolean;
  situacao: string | null;
  tipo: string | null;
}

export interface Sacado {
  nome: string;
  doc: string | null; // CNPJ/CPF
  tel: string | null;
  titulos: Titulo[];
  total: number; // soma TOTAL
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
  carteira: { nome: string; codigo: string };
  cedentes: Cedente[];
  kpis: Kpis;
}
