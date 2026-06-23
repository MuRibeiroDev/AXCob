import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BitrixService, type NormalizedCard } from '../bitrix/bitrix.service';
import { PIPELINES, PIX_PIPELINE } from '../bitrix/bitrix.types';

export type PipelineKey = 'protesto' | 'negativacao';
type Status = 'quitado_pronto' | 'quitado_parcial' | 'nao_quitado';

// TIPOs de "encargo" que não bloqueiam o quitado (iguais ao serviço original).
const TIPOS_IGNORADOS = new Set(['ADC', 'MPT', 'TPT', 'TRA', 'TAR', 'OUT', 'JPT']);
const BITRIX_DETAIL = 'https://audaxcapitalsa.bitrix24.com.br/crm/type/1200/details';

interface QuitadoRow {
  NUMERO: string | null; CPF_CNPJ_SACADO: string | null;
  VALOR_FACE: number | null; LIQUIDADO: number | null;
  QUITACAO: Date | null; SITUACAO: string | null;
}
interface AbertoRow { DOCUMENTO: string | null; CPF_CNPJ_SACADO: string | null; TIPO: string | null; }

const key = (numero: string, cnpj: string | null) => `${numero}${cnpj ?? ''}`;

@Injectable()
export class KanbanService {
  private readonly logger = new Logger(KanbanService.name);
  private readonly cache = new Map<PipelineKey, unknown>();
  private pixCache: unknown = null;

  constructor(private readonly db: DatabaseService, private readonly bitrix: BitrixService) {}

  /** Resolve "criado_por" para uma lista de cards (1 chamada de nomes). */
  private async comCriadoPor(cards: any[]): Promise<any[]> {
    const userIds = [...new Set(cards.map((c) => c.created_by_id).filter((x): x is number | string => x != null))];
    const userNames = await this.bitrix.resolveUserNames(userIds);
    return cards.map((c) => ({
      ...c,
      criado_por: c.created_by_id != null ? (userNames.get(String(c.created_by_id)) ?? `ID ${c.created_by_id}`) : '—',
    }));
  }

  /** Kanban de PIX — pipeline COMPLETO da SPA Financeiro 1248 (todas as etapas,
   *  dinâmicas). Traz a 1ª página de cada etapa; o resto é lazy-loaded por coluna
   *  (ver pixStage). `total`/`next` por etapa permitem o "carregar mais". */
  async getPix(refresh = false) {
    if (!refresh && this.pixCache) {
      this.logger.log('kanban pix: cache hit');
      return this.pixCache;
    }
    const stages = await this.bitrix.listPixStages();
    const pages = await Promise.all(stages.map((s) => this.bitrix.listPixStageCards(s.id, 0)));
    const enriched = await this.comCriadoPor(pages.flatMap((p) => p.cards));

    // re-agrupa os cards enriquecidos por etapa, preservando a ordem
    let idx = 0;
    const outStages = stages.map((s, i) => {
      const n = pages[i].cards.length;
      const cards = enriched.slice(idx, idx + n);
      idx += n;
      return { id: s.id, nome: s.nome, cards, total: pages[i].total, next: pages[i].next };
    });

    const totalCards = pages.reduce((a, p) => a + p.total, 0);
    const totalValor = enriched.reduce((a, c) => a + (c.valor ?? 0), 0);
    const result = {
      label: 'PIX a Identificar',
      stages: outStages,
      totais: { total: totalCards, valor: totalValor },
    };
    this.pixCache = result;
    this.logger.log(`kanban pix: rebuild (${stages.length} etapas, ${totalCards} cards)`);
    return result;
  }

  /** Lazy load: 1 página de cards de uma etapa de PIX (a partir de `start`). */
  async pixStage(stageId: string, start = 0) {
    const pg = await this.bitrix.listPixStageCards(stageId, start);
    const cards = await this.comCriadoPor(pg.cards);
    return { cards, total: pg.total, next: pg.next };
  }

  /** Serve do cache; só rebusca no Bitrix se `refresh` ou se não houver cache. */
  async getKanban(pipeline: PipelineKey, refresh = false) {
    if (!refresh && this.cache.has(pipeline)) {
      this.logger.log(`kanban ${pipeline}: cache hit`);
      return this.cache.get(pipeline);
    }
    const result = await this.build(pipeline);
    this.cache.set(pipeline, result);
    this.logger.log(`kanban ${pipeline}: rebuild (${result.totais.total} cards)`);
    return result;
  }

  /** Move o card no Bitrix e, se houver, adiciona comentário no timeline. Limpa o cache.
   *  `webhook` (do usuário logado) → movimentação/comentário saem no nome dele. */
  async moverCard(cardId: number | string, stageId: string, comentario?: string, webhook?: string | null) {
    await this.bitrix.moverEtapa(cardId, stageId, webhook);
    if (comentario?.trim()) await this.bitrix.adicionarComentario(cardId, comentario.trim(), webhook);
    this.cache.clear();
    this.logger.log(`card ${cardId} movido p/ ${stageId}${comentario ? ' (+comentário)' : ''}${webhook ? ' (webhook do usuário)' : ''}`);
    return { ok: true };
  }

  /** Move um card de PIX (SPA Financeiro 1248) e, se houver, adiciona comentário
   *  no timeline COM anexos (fotos). Limpa o cache do PIX. */
  async moverCardPix(
    cardId: number | string,
    stageId: string,
    comentario?: string,
    anexos?: { nome: string; base64: string }[],
    webhook?: string | null,
  ) {
    const ent = PIX_PIPELINE.entityTypeId;
    await this.bitrix.moverEtapa(cardId, stageId, webhook, ent);
    const temComentario = !!comentario?.trim() || !!anexos?.length;
    if (temComentario) {
      await this.bitrix.adicionarComentario(cardId, (comentario ?? '').trim(), webhook, ent, anexos);
    }
    this.pixCache = null;
    this.logger.log(`pix ${cardId} movido p/ ${stageId}${comentario?.trim() ? ' (+comentário)' : ''}${anexos?.length ? ` (+${anexos.length} anexo)` : ''}`);
    return { ok: true };
  }

  /** Adiciona comentário + anexos (fotos) no timeline de um card de PIX SEM mover
   *  de etapa. Não invalida o cache (a posição/dados do card não mudam). */
  async comentarCardPix(
    cardId: number | string,
    comentario?: string,
    anexos?: { nome: string; base64: string }[],
    webhook?: string | null,
  ) {
    const ent = PIX_PIPELINE.entityTypeId;
    await this.bitrix.adicionarComentario(cardId, (comentario ?? '').trim(), webhook, ent, anexos);
    this.logger.log(`pix ${cardId} comentado${comentario?.trim() ? ' (+comentário)' : ''}${anexos?.length ? ` (+${anexos.length} anexo)` : ''}`);
    return { ok: true };
  }

  /** Enriquece cards (nome de quem abriu + classificação SQL quitado/parcial/aberto)
   *  no shape de saída do board. Reusado pelo build (1ª página) e pelo lazy load. */
  private async enriquecerCards(cards: NormalizedCard[]): Promise<any[]> {
    const userIds = [...new Set(cards.map((c) => c.created_by_id).filter((x): x is number | string => x != null))];
    const numeros = [...new Set(cards.map((c) => c.numero_titulo).filter((n): n is string => !!n))];
    const [userNames, quitados, abertos] = await Promise.all([
      this.bitrix.resolveUserNames(userIds),
      this.queryIn<QuitadoRow>('vw_titulos_quitados', 'NUMERO',
        'NUMERO, CPF_CNPJ_SACADO, VALOR_FACE, LIQUIDADO, QUITACAO, SITUACAO', numeros),
      this.queryIn<AbertoRow>('vw_titulos_abertos', 'DOCUMENTO',
        'DOCUMENTO, CPF_CNPJ_SACADO, TIPO', numeros),
    ]);

    const quitadosIdx = new Map<string, QuitadoRow>();
    for (const r of quitados) {
      if (r.NUMERO == null) continue;
      const k = key(String(r.NUMERO), r.CPF_CNPJ_SACADO ? String(r.CPF_CNPJ_SACADO) : null);
      if (!quitadosIdx.has(k)) quitadosIdx.set(k, r);
    }
    const abertosIdx = new Map<string, AbertoRow[]>();
    for (const r of abertos) {
      if (r.DOCUMENTO == null) continue;
      const k = key(String(r.DOCUMENTO), r.CPF_CNPJ_SACADO ? String(r.CPF_CNPJ_SACADO) : null);
      (abertosIdx.get(k) ?? abertosIdx.set(k, []).get(k)!).push(r);
    }

    return cards.map((c) => {
      const { status, quitado } = this.classificar(c, quitadosIdx, abertosIdx);
      return {
        id: c.id,
        titulo_card: c.titulo_card,
        stage_id: c.stage_id,
        plataforma: c.plataforma,
        razao_social_cedente: c.razao_social_cedente,
        numero_titulo: c.numero_titulo,
        razao_social_sacado: c.razao_social_sacado,
        cnpj_cpf_sacado: c.cnpj_cpf_sacado,
        criado_por: c.created_by_id != null ? (userNames.get(String(c.created_by_id)) ?? `ID ${c.created_by_id}`) : '—',
        status,
        valor_face: quitado ? this.toNum(quitado.VALOR_FACE) : c.valor_face,
        liquidado: quitado ? this.toNum(quitado.LIQUIDADO) : null,
        quitacao: quitado ? this.fmtDate(quitado.QUITACAO) : null,
        situacao_smart: quitado?.SITUACAO ?? null,
        card_link: `${BITRIX_DETAIL}/${c.id}/`,
      };
    });
  }

  /** Monta o board: TODAS as etapas, com a 1ª página de cada (lazy load do resto).
   *  `total`/`next` por etapa = contagem EXATA + cursor p/ "carregar mais". */
  private async build(pipeline: PipelineKey) {
    const stages = await this.bitrix.listStages(pipeline);
    const pages = await Promise.all(stages.map((s) => this.bitrix.listStageCards(pipeline, s.id, 0)));
    const enriched = await this.enriquecerCards(pages.flatMap((p) => p.cards));

    const totais = { total: 0, quitado_pronto: 0, quitado_parcial: 0, nao_quitado: 0 };
    let idx = 0;
    const outStages = stages.map((s, i) => {
      const n = pages[i].cards.length;
      const cards = enriched.slice(idx, idx + n);
      idx += n;
      for (const c of cards) (totais as Record<string, number>)[c.status] += 1;
      totais.total += pages[i].total; // contagem EXATA da etapa (não só a 1ª página)
      return { id: s.id, nome: s.nome, plataforma: s.plataforma, cards, total: pages[i].total, next: pages[i].next };
    });

    return { pipeline, label: PIPELINES[pipeline].label, stages: outStages, totais };
  }

  /** Lazy load: 1 página de cards (já enriquecidos) de uma etapa do board. */
  async kanbanStage(pipeline: PipelineKey, stageId: string, start = 0) {
    const pg = await this.bitrix.listStageCards(pipeline, stageId, start);
    const cards = await this.enriquecerCards(pg.cards);
    return { cards, total: pg.total, next: pg.next };
  }

  private classificar(
    card: { numero_titulo: string | null; cnpj_cpf_sacado: string | null },
    quitadosIdx: Map<string, QuitadoRow>,
    abertosIdx: Map<string, AbertoRow[]>,
  ): { status: Status; quitado: QuitadoRow | null } {
    const numero = card.numero_titulo;
    if (!numero) return { status: 'nao_quitado', quitado: null };
    const cnpjs = (card.cnpj_cpf_sacado ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const chaves: [string, string | null][] = cnpjs.length ? cnpjs.map((c) => [numero, c]) : [[numero, null]];

    let quitado: QuitadoRow | null = null;
    for (const [n, c] of chaves) {
      quitado = quitadosIdx.get(key(n, c)) ?? (c ? quitadosIdx.get(key(n, null)) : undefined) ?? null;
      if (quitado) break;
    }
    if (!quitado) return { status: 'nao_quitado', quitado: null };

    const relevantes = chaves.flatMap(([n, c]) => abertosIdx.get(key(n, c)) ?? []);
    const bloqueantes = relevantes.filter((r) => !TIPOS_IGNORADOS.has((r.TIPO ?? '').trim().toUpperCase()));
    return { status: bloqueantes.length ? 'quitado_parcial' : 'quitado_pronto', quitado };
  }

  /** SELECT ... WHERE col IN (...) em lotes (limite de parâmetros do SQL Server). */
  private async queryIn<T>(view: string, col: string, select: string, valores: string[]): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < valores.length; i += 900) {
      const chunk = valores.slice(i, i + 900);
      const params: Record<string, unknown> = {};
      const ph = chunk.map((v, j) => { params[`p${j}`] = v; return `@p${j}`; }).join(',');
      out.push(...await this.db.query<T>(`SELECT ${select} FROM data_core.${view} WHERE ${col} IN (${ph})`, params));
    }
    return out;
  }

  private toNum(v: unknown): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  private fmtDate(d: Date | null): string | null {
    if (!d) return null;
    try { return d.toLocaleDateString('pt-BR'); } catch { return String(d); }
  }
}
