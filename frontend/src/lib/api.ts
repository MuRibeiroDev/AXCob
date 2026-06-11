/* Cliente HTTP da API do AxCob. */
import type { CarteiraData, TipoBoleto } from './types';
import { getToken, clearAuth, type SessaoUser } from './auth';

// Sem VITE_API_URL, usa o MESMO host que serve o frontend (ex.: 192.168.1.25) na porta 3000.
const BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ??
  `http://${window.location.hostname}:3000/api`;

export const API_BASE = BASE;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { credentials: 'omit', ...init, headers });
  if (res.status === 401) {
    // sessão expirada/ausente → volta pra tela de login
    clearAuth();
    window.dispatchEvent(new Event('axcob:unauthorized'));
    throw new Error('Sessão expirada. Faça login novamente.');
  }
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
  razaoCedente?: string | null;
  sistema: string | null;
  prioridade?: 'PADRAO' | 'URGENTE';
}

export interface CriacaoResumo {
  total: number;
  ok: number;
  falhas: number;
  resultados: { numeroTitulo: string; ok: boolean; id?: number | string; erro?: string }[];
}

export interface AdminUser {
  id: number;
  username: string;
  nome: string;
  role: string;
  ativo: boolean;
  isAdmin: boolean;            // admin DO AxCob (lista própria)
  permissoes: string[] | null; // telas liberadas; null = todas
}

export const api = {
  login: (login: string, senha: string) =>
    post<{ token: string; user: SessaoUser }>('/auth/login', { login, senha }),
  me: () => req<SessaoUser>('/auth/me'),
  responsaveis: () => req<string[]>('/titulos-vencidos/responsaveis'),
  carteira: (responsavel: string, tipoBoleto: TipoBoleto = 'C') =>
    req<CarteiraData>(`/titulos-vencidos?responsavel=${encodeURIComponent(responsavel)}&tipoBoleto=${tipoBoleto}`),
  analistas: () => req<{ id: string; nome: string }[]>('/acoes/analistas'),
  minhaConfig: () => req<ConfigUsuario>('/config'),
  salvarBitrixWebhook: (webhook: string) =>
    req<ConfigUsuario>('/config/bitrix-webhook', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ webhook }),
    }),
  protestar: (itens: SolicitacaoItem[], analistaId?: string | number) =>
    post<CriacaoResumo>('/acoes/protestos', { itens, analistaId }),
  negativar: (itens: SolicitacaoItem[], analistaId?: string | number) =>
    post<CriacaoResumo>('/acoes/negativacoes', { itens, analistaId }),
  kanban: <T>(pipeline: 'protesto' | 'negativacao', refresh = false) =>
    req<T>(`/kanban?pipeline=${pipeline}${refresh ? '&refresh=1' : ''}`),
  kanbanStageMore: <C>(pipeline: 'protesto' | 'negativacao', stageId: string, start: number) =>
    req<{ cards: C[]; total: number; next: number | null }>(
      `/kanban/${pipeline}/stage/${encodeURIComponent(stageId)}?start=${start}`),
  moverCard: (cardId: number | string, stageId: string, comentario?: string) =>
    post<{ ok: boolean }>('/kanban/mover', { cardId, stageId, comentario }),
  pixKanban: (refresh = false) =>
    req<PixKanbanData>(`/kanban/pix${refresh ? '?refresh=1' : ''}`),
  pixStageMore: (stageId: string, start: number) =>
    req<{ cards: PixCard[]; total: number; next: number | null }>(
      `/kanban/pix/stage/${encodeURIComponent(stageId)}?start=${start}`),
  identificarPix: (titulo: string, opts?: { cardId?: string | number; doc?: string; refresh?: boolean }) =>
    post<ConciliacaoResultado>('/kanban/pix/identificar', { titulo, ...opts }),
  listConciliacoesPix: () => req<ConciliacaoSalva[]>('/kanban/pix/conciliacoes'),
  enviarSequenciaRelatorios: () =>
    post<{ ok: boolean; passos: { passo: string; ok: boolean; erro?: string }[]; faltando: string[] }>('/relatorios/enviar-sequencia', {}),
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
    // <img>/download não enviam header → token vai na query (?access_token=)
    const tk = getToken();
    const qs = [opts?.download ? 'download=1' : '', opts?.v ? `v=${encodeURIComponent(opts.v)}` : '', tk ? `access_token=${encodeURIComponent(tk)}` : '']
      .filter(Boolean).join('&');
    return `${BASE}/relatorios/imagem/${encodeURIComponent(id)}/${encodeURIComponent(String(parte))}${qs ? `?${qs}` : ''}`;
  },
  // ---- Admin: permissões de tela por usuário ----
  adminUsers: () => req<AdminUser[]>('/admin/users'),
  adminSetPermissoes: (id: number, permissoes: string[] | null) =>
    req<{ ok: boolean; permissoes: string[] | null }>(`/admin/users/${id}/permissoes`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissoes }),
    }),
  enviarWhatsapp: (numbers: string[], texto: string) =>
    post<{ total: number; ok: number; falhas: number; resultados: { number: string; ok: boolean; erro?: string }[] }>(
      '/whatsapp/enviar-texto',
      { numbers, texto },
    ),
};

export interface ConfigUsuario {
  bitrixWebhook: string | null;
  bitrixNome: string | null; // de quem é o webhook (confirmado via user.current)
}

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

export interface PixStageData {
  id: string;
  nome: string;
  cards: PixCard[];
  total: number;          // total real de cards na etapa (Bitrix)
  next: number | null;    // cursor p/ lazy load (null = acabou)
}

export interface PixKanbanData {
  label: string;
  stages: PixStageData[];
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
