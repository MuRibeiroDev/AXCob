/* Cliente HTTP da API do AxCob. */
import type { CarteiraData, TipoBoleto } from './types';

// Sem VITE_API_URL, usa o MESMO host que serve o frontend (ex.: 192.168.1.25) na porta 3000.
const BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ??
  `http://${window.location.hostname}:3000/api`;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'omit', ...init });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) detail = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) =>
  req<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export interface SolicitacaoItem {
  numeroTitulo: string;
  valor: number | null;
  cnpjSacado: string | null;
  razaoSacado: string | null;
  sistema: string | null;
  prioridade?: 'PADRAO' | 'URGENTE';
}

export interface CriacaoResumo {
  total: number;
  ok: number;
  falhas: number;
  resultados: { numeroTitulo: string; ok: boolean; id?: number | string; erro?: string }[];
}

export const api = {
  responsaveis: () => req<string[]>('/titulos-vencidos/responsaveis'),
  carteira: (responsavel: string, tipoBoleto: TipoBoleto = 'C') =>
    req<CarteiraData>(`/titulos-vencidos?responsavel=${encodeURIComponent(responsavel)}&tipoBoleto=${tipoBoleto}`),
  analistas: () => req<{ id: string; nome: string }[]>('/acoes/analistas'),
  protestar: (itens: SolicitacaoItem[], analistaId?: string | number) =>
    post<CriacaoResumo>('/acoes/protestos', { itens, analistaId }),
  negativar: (itens: SolicitacaoItem[], analistaId?: string | number) =>
    post<CriacaoResumo>('/acoes/negativacoes', { itens, analistaId }),
  kanban: <T>(pipeline: 'protesto' | 'negativacao', refresh = false) =>
    req<T>(`/kanban?pipeline=${pipeline}${refresh ? '&refresh=1' : ''}`),
  moverCard: (cardId: number | string, stageId: string, comentario?: string) =>
    post<{ ok: boolean }>('/kanban/mover', { cardId, stageId, comentario }),
  pixKanban: (refresh = false) =>
    req<PixKanbanData>(`/kanban/pix${refresh ? '?refresh=1' : ''}`),
  identificarPix: (titulo: string, opts?: { cardId?: string | number; doc?: string; refresh?: boolean }) =>
    post<ConciliacaoResultado>('/kanban/pix/identificar', { titulo, ...opts }),
  listConciliacoesPix: () => req<ConciliacaoSalva[]>('/kanban/pix/conciliacoes'),
  enviarSequenciaRelatorios: (numeros: string[]) =>
    post<{ ok: boolean; passos: { passo: string; ok: boolean; erro?: string }[]; faltando: string[] }>('/relatorios/enviar-sequencia', { numeros }),
  agingCarteira: () => req<AgingData>('/relatorios/aging'),
  recebimentos: () => req<{ meses: { mes: string; liquidado: number; qtd: number }[] }>('/relatorios/recebimentos'),
  exposicaoUf: () => req<{ ufs: { uf: string; valor: number; qtd: number }[]; total: number }>('/relatorios/exposicao-uf'),
  relatorios: () => req<RelatorioCard[]>('/relatorios'),
  relatorioTexto: (id: string) => req<{ id: string; texto: string }>(`/relatorios/${encodeURIComponent(id)}/texto`),
  // PNG (Power BI): dispara geração, consulta status e monta URLs das imagens
  gerarRelatorioPng: (id: string) =>
    post<RelatorioPngStatus>(`/relatorios/${encodeURIComponent(id)}/gerar-png`, {}),
  statusRelatorioPng: (id: string) =>
    req<RelatorioPngStatus>(`/relatorios/${encodeURIComponent(id)}/status-png`),
  imagemRelatorioUrl: (id: string, parte: string | number, opts?: { download?: boolean; v?: string }) => {
    const qs = [opts?.download ? 'download=1' : '', opts?.v ? `v=${encodeURIComponent(opts.v)}` : '']
      .filter(Boolean).join('&');
    return `${BASE}/relatorios/imagem/${encodeURIComponent(id)}/${encodeURIComponent(String(parte))}${qs ? `?${qs}` : ''}`;
  },
  enviarWhatsapp: (numbers: string[], texto: string) =>
    post<{ total: number; ok: number; falhas: number; resultados: { number: string; ok: boolean; erro?: string }[] }>(
      '/whatsapp/enviar-texto',
      { numbers, texto },
    ),
};

export interface RelatorioCard {
  id: string;
  label: string;
  descricao: string;
  formato: 'TEXTO' | 'PNG';
  grupo: string;
  pronto: boolean;
}

export interface AgingFaixa {
  faixa: string;
  qtd: number;
  face: number;
  total: number;
}

export interface AgingData {
  posicao: string;
  faixas: AgingFaixa[];
  totais: { qtd: number; face: number; total: number };
}

export interface RelatorioPngStatus {
  status: 'idle' | 'gerando' | 'pronto' | 'erro';
  imagens: string[];
  erro?: string;
  at?: string;
}

export interface PixCard {
  id: number | string;
  titulo_card: string | null;
  stage_id: string;
  nome: string | null;
  valor: number | null;
  criado_por: string;
  data: string | null;
  card_link: string;
}

export interface PixKanbanData {
  label: string;
  stages: { id: string; nome: string; cards: PixCard[] }[];
  totais: { total: number; valor: number };
}

export interface PixSugestaoTitulo {
  documento: string;
  sacado: string | null;
  cedente: string | null;
  valor: number | null;
  total: number | null;
  vencimento: string | null;
  sistema: string | null;
}

export interface PixSugestao {
  titulos: PixSugestaoTitulo[];
  tipo_match: string;
  pagador: string;
  confianca: 'alta' | 'media' | 'baixa' | string;
  score: number | null;
  justificativa: string;
  cobrador: string | null;
}

export interface ConciliacaoResultado {
  pix: { plataforma: string; sistema: string | null; valor: number | null; nome: string; doc: string | null };
  total_titulos: number;
  relevantes: number;
  sugestoes: PixSugestao[];
  resumo: string;
  criado_em?: string;
  cacheado?: boolean;
}

export interface ConciliacaoSalva {
  cardId: string;
  titulo: string;
  resultado: ConciliacaoResultado;
  criadoEm: string;
}
