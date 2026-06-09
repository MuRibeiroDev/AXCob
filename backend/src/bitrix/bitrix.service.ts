import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BITRIX_FIELDS,
  ENTITY_TYPE_ID,
  PIPELINES,
  PIX_PIPELINE,
  type BitrixPipeline,
} from './bitrix.types';

interface RawCard {
  id: number | string;
  title?: string;
  stageId?: string;
  [k: string]: unknown;
}

export interface NormalizedCard {
  id: number | string;
  titulo_card: string | null;
  stage_id: string;
  plataforma: string;
  razao_social_cedente: string | null;
  numero_titulo: string | null;
  razao_social_sacado: string | null;
  cnpj_cpf_sacado: string | null;
  valor_face: number | null;
  created_by_id: number | string | null;
}

export interface BitrixStage {
  id: string;
  nome: string;
  plataforma: string;
}

/** Estado combinado de cobrança de um título (pode estar nos dois pipelines). */
export interface CobrancaStatus {
  protesto: 'protesto' | 'protestado' | null;
  negativado: boolean;
}

interface Entry {
  protesto?: 'protesto' | 'protestado';
  negativado?: boolean;
}

/** Índice por número de título (+CNPJ do sacado), guardando protesto E negativação. */
export class StatusIndex {
  private readonly map = new Map<string, Entry>();

  addProtesto(numero: string, cnpj: string | null, kind: 'protesto' | 'protestado'): void {
    this.merge(numero, kind, undefined);
    if (cnpj) this.merge(`${numero}|${cnpj}`, kind, undefined);
  }

  addNegativado(numero: string, cnpj: string | null): void {
    this.merge(numero, undefined, true);
    if (cnpj) this.merge(`${numero}|${cnpj}`, undefined, true);
  }

  private merge(key: string, protesto?: 'protesto' | 'protestado', negativado?: boolean): void {
    const cur = this.map.get(key) ?? {};
    if (protesto && (protesto === 'protestado' || !cur.protesto)) cur.protesto = protesto;
    if (negativado) cur.negativado = true;
    this.map.set(key, cur);
  }

  /** Combina a entrada por (numero) e por (numero|cnpj); protestado vence protesto. */
  lookup(numero: string | null, cnpj: string | null): CobrancaStatus {
    const r: CobrancaStatus = { protesto: null, negativado: false };
    if (!numero) return r;
    const entries = [this.map.get(numero), cnpj ? this.map.get(`${numero}|${cnpj}`) : undefined];
    for (const e of entries) {
      if (!e) continue;
      if (e.protesto === 'protestado') r.protesto = 'protestado';
      else if (e.protesto === 'protesto' && r.protesto == null) r.protesto = 'protesto';
      if (e.negativado) r.negativado = true;
    }
    return r;
  }
}

@Injectable()
export class BitrixService {
  private readonly logger = new Logger(BitrixService.name);
  private cache: { idx: StatusIndex; at: number } | null = null;
  private static readonly TTL_MS = 5 * 60 * 1000;

  constructor(private readonly config: ConfigService) {}

  private webhookBase(): string | null {
    const base = (this.config.get<string>('BITRIX_WEBHOOK_URL') ?? '').trim().replace(/\/$/, '');
    return base || null;
  }

  private async post(method: string, payload: Record<string, unknown>, base?: string | null): Promise<any> {
    const b = base ? base.replace(/\/$/, '') : this.webhookBase();
    if (!b) throw new Error('BITRIX_WEBHOOK_URL ausente');
    const res = await fetch(`${b}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Bitrix ${method} HTTP ${res.status}`);
    return res.json();
  }

  // ---- Analistas com webhook próprio (p/ "Criado por" sair com o nome real) ----
  // .env: BITRIX_ANALISTA_1_NOME / BITRIX_ANALISTA_1_WEBHOOK, _2_, _3_ ...
  private analistasConfig(): { id: string; nome: string; webhook: string }[] {
    const out: { id: string; nome: string; webhook: string }[] = [];
    for (let i = 1; i <= 20; i++) {
      const nome = (this.config.get<string>(`BITRIX_ANALISTA_${i}_NOME`) ?? '').trim();
      const webhook = (this.config.get<string>(`BITRIX_ANALISTA_${i}_WEBHOOK`) ?? '').trim().replace(/\/$/, '');
      if (nome && webhook) out.push({ id: String(i), nome, webhook });
    }
    return out;
  }

  /** Lista de analistas (id + nome) — sem expor os webhooks ao frontend. */
  listarAnalistas(): { id: string; nome: string }[] {
    return this.analistasConfig().map(({ id, nome }) => ({ id, nome }));
  }

  private webhookDoAnalista(id: string | number | null | undefined): string | null {
    if (id == null) return null;
    return this.analistasConfig().find((a) => a.id === String(id))?.webhook ?? null;
  }

  private join(v: unknown): string | null {
    if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(', ') : null;
    return v != null && v !== '' ? String(v) : null;
  }

  private parseValor(v: unknown): number | null {
    // campo money múltiplo: ["1234.56|BRL"] ou "1234.56|BRL"
    const raw = Array.isArray(v) ? v[0] : v;
    if (raw == null || raw === '') return null;
    const n = parseFloat(String(raw).split('|')[0]);
    return Number.isFinite(n) ? n : null;
  }

  normalize(card: RawCard, pl: BitrixPipeline): NormalizedCard {
    const stageId = String(card.stageId ?? '');
    const stage = pl.stages.find((s) => s.id === stageId);
    const numero = ((card[BITRIX_FIELDS.numero] as string) ?? '').trim() || null;
    return {
      id: card.id,
      titulo_card: (card.title as string) ?? null,
      stage_id: stageId,
      plataforma: stage?.plataforma ?? '—',
      razao_social_cedente: this.join(card[BITRIX_FIELDS.razaoCedente]),
      numero_titulo: numero,
      razao_social_sacado: this.join(card[BITRIX_FIELDS.razaoSacado]),
      cnpj_cpf_sacado: this.join(card[BITRIX_FIELDS.cnpjSacado]),
      valor_face: this.parseValor(card[BITRIX_FIELDS.valorSacado]),
      created_by_id: (card.createdBy as number | string) ?? null,
    };
  }

  // ---- Usuários (cache em memória) ----
  private readonly userCache = new Map<string, string>();

  /** Resolve nomes de usuários (createdBy) via user.get, com cache. Os IDs ainda
   *  não cacheados são buscados EM PARALELO (lotes) — antes era 1 a 1 (lento). */
  async resolveUserNames(ids: (number | string)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.map(String).filter(Boolean))];
    const pendentes = uniq.filter((id) => !this.userCache.has(id));
    const CONC = 10;
    for (let i = 0; i < pendentes.length; i += CONC) {
      await Promise.all(pendentes.slice(i, i + CONC).map(async (id) => {
        try {
          const data = await this.post('user.get', { ID: id });
          const u = (data?.result ?? [])[0];
          this.userCache.set(id, u
            ? [u.NAME, u.LAST_NAME].filter(Boolean).join(' ').trim() || u.EMAIL || `ID ${id}`
            : `ID ${id}`);
        } catch {
          this.userCache.set(id, `ID ${id}`);
        }
      }));
    }
    return new Map(uniq.map((id) => [id, this.userCache.get(id) ?? `ID ${id}`]));
  }

  /** Lista as etapas reais da categoria (crm.status.list), ordenadas. */
  async listStages(pipelineKey: 'protesto' | 'negativacao'): Promise<BitrixStage[]> {
    const cat = PIPELINES[pipelineKey].categoryId;
    const data = await this.post('crm.status.list', {
      filter: { ENTITY_ID: `DYNAMIC_1200_STAGE_${cat}` },
      order: { SORT: 'ASC' },
    });
    const rows: any[] = data?.result ?? [];
    const plat = (nome: string) => {
      const n = nome.toUpperCase();
      if (n.includes('SEC')) return 'SEC';
      if (n.includes('FIDC')) return 'FIDC';
      if (n.includes('LION')) return 'LION';
      return '—';
    };
    return rows
      .sort((a, b) => Number(a.SORT) - Number(b.SORT))
      .map((s) => ({ id: String(s.STATUS_ID), nome: String(s.NAME), plataforma: plat(String(s.NAME)) }));
  }

  /** Lista TODOS os cards da categoria (todas as etapas).
   *  Busca a 1ª página, lê o `total` e baixa as demais páginas EM PARALELO
   *  (antes era página a página, sequencial — lento com muitos cards). */
  async listAllCards(pipelineKey: 'protesto' | 'negativacao'): Promise<NormalizedCard[]> {
    const pl = PIPELINES[pipelineKey];
    const select = ['id', 'title', 'stageId', 'createdBy', BITRIX_FIELDS.numero, BITRIX_FIELDS.cnpjSacado, BITRIX_FIELDS.razaoCedente, BITRIX_FIELDS.razaoSacado, BITRIX_FIELDS.valorSacado];
    const PAGE = 50; // tamanho de página do crm.item.list
    const CONC = 6;  // páginas simultâneas

    const fetchPage = async (start: number) => {
      const data = await this.post('crm.item.list', {
        entityTypeId: ENTITY_TYPE_ID,
        filter: { categoryId: pl.categoryId },
        order: { id: 'desc' }, // mesma ordem do kanban do Bitrix (mais recentes no topo)
        select, start,
      });
      return { items: (data?.result?.items ?? []) as RawCard[], total: Number(data?.total ?? 0), next: data?.next };
    };

    const first = await fetchPage(0);
    const paginas: RawCard[][] = [first.items];

    if (first.total && first.total > PAGE) {
      // sabe o total → baixa as páginas restantes em paralelo (lotes), preservando a ordem
      const starts: number[] = [];
      for (let s = PAGE; s < first.total; s += PAGE) starts.push(s);
      for (let i = 0; i < starts.length; i += CONC) {
        const res = await Promise.all(starts.slice(i, i + CONC).map((s) => fetchPage(s).then((r) => r.items)));
        paginas.push(...res);
      }
    } else if (!first.total && first.next != null) {
      // fallback: API não retornou total → segue sequencial pelo `next`
      let start = first.next as number;
      for (;;) {
        const p = await fetchPage(start);
        paginas.push(p.items);
        if (p.next == null) break;
        start = p.next as number;
      }
    }

    return paginas.flat().map((c) => this.normalize(c, pl));
  }

  /** Lista (paginado) os cards de um pipeline, já normalizados. */
  async listCards(pipelineKey: 'protesto' | 'negativacao'): Promise<NormalizedCard[]> {
    const pl = PIPELINES[pipelineKey];
    const cards: NormalizedCard[] = [];
    let start = 0;
    for (;;) {
      const data = await this.post('crm.item.list', {
        entityTypeId: ENTITY_TYPE_ID,
        filter: { categoryId: pl.categoryId, '@stageId': pl.stages.map((s) => s.id) },
        select: ['id', 'title', 'stageId', BITRIX_FIELDS.numero, BITRIX_FIELDS.cnpjSacado, BITRIX_FIELDS.razaoCedente, BITRIX_FIELDS.razaoSacado],
        start,
      });
      const items: RawCard[] = data?.result?.items ?? [];
      cards.push(...items.map((c) => this.normalize(c, pl)));
      const next = data?.next;
      if (next == null) break;
      start = next;
    }
    return cards;
  }

  private mapPixCard(c: RawCard): PixCard {
    return {
      id: c.id,
      titulo_card: (c.title as string) ?? null,
      stage_id: String(c.stageId ?? ''),
      nome: this.join(c[PIX_PIPELINE.fields.nome]),
      valor: this.parseValor(c[PIX_PIPELINE.fields.valor]),
      created_by_id: (c.createdBy as number | string) ?? null,
      data: c.createdTime ? String(c.createdTime).slice(0, 10) : null,
      card_link: `${PIX_PIPELINE.detailBase}/${c.id}/`,
    };
  }

  /** Lista os cards das etapas de PIX (SPA 1248, categoria 146).
   *  Etapas sem `limite` vêm completas (paginado); etapas com `limite` (ex.:
   *  "Atividade Concluído", 651 cards) trazem só os N mais recentes. */
  async listPixCards(): Promise<PixCard[]> {
    const select = ['id', 'title', 'stageId', 'createdBy', 'createdTime', PIX_PIPELINE.fields.nome, PIX_PIPELINE.fields.valor];
    const out: PixCard[] = [];

    // 1) etapas ativas (sem limite) — todas, paginado
    const ativas = PIX_PIPELINE.stages.filter((s) => !s.limite).map((s) => s.id);
    if (ativas.length) {
      let start = 0;
      for (;;) {
        const data = await this.post('crm.item.list', {
          entityTypeId: PIX_PIPELINE.entityTypeId,
          filter: { categoryId: PIX_PIPELINE.categoryId, '@stageId': ativas },
          order: { id: 'desc' }, select, start,
        });
        const items: RawCard[] = data?.result?.items ?? [];
        out.push(...items.map((c) => this.mapPixCard(c)));
        if (data?.next == null) break;
        start = data.next;
      }
    }

    // 2) etapas com limite — só os N mais recentes (1 página, id desc)
    for (const st of PIX_PIPELINE.stages.filter((s) => s.limite)) {
      const data = await this.post('crm.item.list', {
        entityTypeId: PIX_PIPELINE.entityTypeId,
        filter: { categoryId: PIX_PIPELINE.categoryId, stageId: st.id },
        order: { id: 'desc' }, select, start: 0,
      });
      const items: RawCard[] = (data?.result?.items ?? []).slice(0, st.limite);
      out.push(...items.map((c) => this.mapPixCard(c)));
    }

    return out;
  }

  /** Índice combinado de protesto/negativação (com cache TTL). */
  async getStatusIndex(): Promise<StatusIndex> {
    if (this.cache && Date.now() - this.cache.at < BitrixService.TTL_MS) {
      return this.cache.idx;
    }
    const idx = new StatusIndex();
    if (!this.webhookBase()) {
      this.logger.warn('BITRIX_WEBHOOK_URL ausente — status de protesto/negativação ficará vazio');
      this.cache = { idx, at: Date.now() };
      return idx;
    }
    try {
      const [protesto, negativacao] = await Promise.all([
        this.listCards('protesto'),
        this.listCards('negativacao'),
      ]);
      for (const c of negativacao) {
        if (c.numero_titulo) this.eachKey(c, (n, cp) => idx.addNegativado(n, cp));
      }
      for (const c of protesto) {
        if (!c.numero_titulo) continue;
        const kind: 'protesto' | 'protestado' = c.stage_id.endsWith(':SUCCESS') ? 'protestado' : 'protesto';
        this.eachKey(c, (n, cp) => idx.addProtesto(n, cp, kind));
      }
      this.logger.log(`Bitrix: ${protesto.length} protesto + ${negativacao.length} negativação`);
    } catch (e) {
      this.logger.error(`falha lendo Bitrix: ${(e as Error).message}`);
    }
    this.cache = { idx, at: Date.now() };
    return idx;
  }

  /** Um card pode ter múltiplos CNPJs (campo multi). Aplica fn pra cada (numero, cnpj). */
  private eachKey(c: NormalizedCard, fn: (numero: string, cnpj: string | null) => void): void {
    const numero = c.numero_titulo as string;
    const cnpjs = (c.cnpj_cpf_sacado ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (cnpjs.length === 0) fn(numero, null);
    else for (const cp of cnpjs) fn(numero, cp);
  }

  hasWebhook(): boolean {
    return this.webhookBase() != null;
  }

  /** Lista usuários ATIVOS do Bitrix (id + nome), p/ escolher o responsável na criação. */
  async listarUsuarios(): Promise<{ id: string; nome: string }[]> {
    if (!this.webhookBase()) return [];
    const out: { id: string; nome: string }[] = [];
    let start = 0;
    for (;;) {
      const data = await this.post('user.get', { FILTER: { ACTIVE: true }, start });
      const rows: any[] = data?.result ?? [];
      for (const u of rows) {
        const nome = [u.NAME, u.LAST_NAME].filter(Boolean).join(' ').trim() || u.EMAIL || `ID ${u.ID}`;
        out.push({ id: String(u.ID), nome });
      }
      const next = data?.next;
      if (next == null) break;
      start = next;
    }
    return out.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  /** Move o card para outra etapa (crm.item.update). */
  async moverEtapa(cardId: number | string, stageId: string): Promise<void> {
    const res = await this.post('crm.item.update', {
      entityTypeId: ENTITY_TYPE_ID,
      id: cardId,
      fields: { stageId },
    });
    if (!res?.result?.item) {
      throw new Error(res?.error_description || 'falha ao mover etapa no Bitrix');
    }
  }

  /** Adiciona comentário no timeline do card (crm.timeline.comment.add). */
  async adicionarComentario(cardId: number | string, comentario: string): Promise<void> {
    const res = await this.post('crm.timeline.comment.add', {
      fields: { ENTITY_ID: cardId, ENTITY_TYPE: 'dynamic_1200', COMMENT: comentario },
    });
    if (!res?.result) {
      throw new Error(res?.error_description || 'falha ao adicionar comentário no Bitrix');
    }
  }

  // ---- Criação de solicitação (protesto/negativação) ----
  // Estrutura espelhada de cards reais: title "{PRIORIDADE} - {SACADO}", PRIORIDADE,
  // Plataforma (Cedente p/ protesto, Sacado p/ negativação), e campos do sacado.

  private static readonly STAGE_INICIAL: Record<'protesto' | 'negativacao', string> = {
    protesto: 'DT1200_116:NEW',
    negativacao: 'DT1200_112:NEW',
  };
  private static readonly PRIORIDADE = { PADRAO: { id: 115532, label: 'PADRÃO' }, URGENTE: { id: 115534, label: 'URGENTE ✅' } };
  private static readonly PLAT_CEDENTE: Record<string, number> = { SEC: 115416, FIDC: 115418, LION: 115420 };
  private static readonly PLAT_SACADO: Record<string, number> = { SEC: 115526, FIDC: 115528, LION: 115530 };

  private platKey(sistema: string | null): 'SEC' | 'FIDC' | 'LION' {
    const s = (sistema ?? '').toUpperCase();
    if (s.includes('SECUR') || s === 'SEC') return 'SEC';
    if (s.includes('AGRO') || s.includes('LION')) return 'LION';
    return 'FIDC';
  }

  /** Cria 1 card na 1ª etapa (Solicitações) do pipeline.
   *  `webhook` (do analista escolhido) faz o "Criado por" sair com o nome dele. */
  async criarSolicitacao(
    pipeline: 'protesto' | 'negativacao',
    item: SolicitacaoItem,
    opts: { webhook?: string | null } = {},
  ): Promise<CriacaoResultado> {
    if (!this.webhookBase()) return { numeroTitulo: item.numeroTitulo, ok: false, erro: 'webhook ausente' };

    const prio = BitrixService.PRIORIDADE[item.prioridade === 'URGENTE' ? 'URGENTE' : 'PADRAO'];
    const sacado = item.razaoSacado ?? '';
    const plat = this.platKey(item.sistema);

    const fields: Record<string, unknown> = {
      categoryId: PIPELINES[pipeline].categoryId,
      stageId: BitrixService.STAGE_INICIAL[pipeline],
      title: `${prio.label} - ${sacado}`.trim(),
      ufCrm58_1759926640: prio.id,                                    // PRIORIDADE
      ufCrm58_1760096145: item.numeroTitulo,                          // Número Título - Sacado
      ufCrm58_1759923007: sacado ? [sacado] : [],                     // Razão Sacado (múltiplo)
      ufCrm58_1759923144: item.cnpjSacado ? [item.cnpjSacado] : [],   // CNPJ Sacado (múltiplo)
    };
    // Plataforma: protesto usa Plataforma-Cedente; negativação usa Plataforma-Sacado
    if (pipeline === 'protesto') fields.ufCrm58_1759253476 = BitrixService.PLAT_CEDENTE[plat];
    else fields.ufCrm58_1759926553 = BitrixService.PLAT_SACADO[plat];
    if (item.valor != null) {
      const v = Number.isInteger(item.valor) ? String(item.valor) : item.valor.toFixed(2);
      fields.ufCrm58_1759923224 = [`${v}|BRL`];                       // Valor - Sacado (money múltiplo)
    }

    try {
      // usa o webhook do analista escolhido (se houver) → "Criado por" = ele
      const res = await this.post('crm.item.add', { entityTypeId: ENTITY_TYPE_ID, fields }, opts.webhook);
      const id = res?.result?.item?.id;
      if (!id) {
        return { numeroTitulo: item.numeroTitulo, ok: false, erro: res?.error_description || 'sem id no retorno' };
      }
      return { numeroTitulo: item.numeroTitulo, ok: true, id };
    } catch (e) {
      return { numeroTitulo: item.numeroTitulo, ok: false, erro: (e as Error).message };
    }
  }

  /** Cria várias solicitações; invalida o cache de status ao final.
   *  `analistaId` → usa o webhook próprio do analista p/ gravar o "Criado por". */
  async criarSolicitacoes(
    pipeline: 'protesto' | 'negativacao',
    itens: SolicitacaoItem[],
    analistaId?: number | string | null,
  ): Promise<CriacaoResultado[]> {
    const webhook = this.webhookDoAnalista(analistaId);
    const resultados: CriacaoResultado[] = [];
    for (const item of itens) {
      resultados.push(await this.criarSolicitacao(pipeline, item, { webhook }));
    }
    this.cache = null; // força releitura do Bitrix na próxima consulta
    return resultados;
  }
}

export interface SolicitacaoItem {
  numeroTitulo: string;
  valor: number | null;
  cnpjSacado: string | null;
  razaoSacado: string | null;
  sistema: string | null; // define a Plataforma (SEC/FIDC/LION)
  prioridade?: 'PADRAO' | 'URGENTE';
}

export interface CriacaoResultado {
  numeroTitulo: string;
  ok: boolean;
  id?: number | string;
  erro?: string;
}

/** Card de PIX (3 etapas da SPA 1248), já normalizado. */
export interface PixCard {
  id: number | string;
  titulo_card: string | null;
  stage_id: string;
  nome: string | null;
  valor: number | null;
  created_by_id: number | string | null;
  data: string | null; // YYYY-MM-DD (createdTime)
  card_link: string;
}
