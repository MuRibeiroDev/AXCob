import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BitrixService } from '../bitrix/bitrix.service';
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

  /** Kanban de PIX (3 etapas da SPA Financeiro 1248) — display-only, com cache. */
  async getPix(refresh = false) {
    if (!refresh && this.pixCache) {
      this.logger.log('kanban pix: cache hit');
      return this.pixCache;
    }
    const cards = await this.bitrix.listPixCards();
    const userIds = [...new Set(cards.map((c) => c.created_by_id).filter((x): x is number | string => x != null))];
    const userNames = await this.bitrix.resolveUserNames(userIds);

    const byStage = new Map<string, any[]>(PIX_PIPELINE.stages.map((s) => [s.id, []]));
    let totalValor = 0;
    for (const c of cards) {
      if (c.valor != null) totalValor += c.valor;
      const out = {
        ...c,
        criado_por: c.created_by_id != null ? (userNames.get(String(c.created_by_id)) ?? `ID ${c.created_by_id}`) : '—',
      };
      (byStage.get(c.stage_id) ?? byStage.set(c.stage_id, []).get(c.stage_id)!).push(out);
    }

    const result = {
      label: 'PIX a Identificar',
      stages: PIX_PIPELINE.stages.map((s) => ({ id: s.id, nome: s.nome, cards: byStage.get(s.id) ?? [] })),
      totais: { total: cards.length, valor: totalValor },
    };
    this.pixCache = result;
    this.logger.log(`kanban pix: rebuild (${cards.length} cards)`);
    return result;
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

  /** Move o card no Bitrix e, se houver, adiciona comentário no timeline. Limpa o cache. */
  async moverCard(cardId: number | string, stageId: string, comentario?: string) {
    await this.bitrix.moverEtapa(cardId, stageId);
    if (comentario?.trim()) await this.bitrix.adicionarComentario(cardId, comentario.trim());
    this.cache.clear();
    this.logger.log(`card ${cardId} movido p/ ${stageId}${comentario ? ' (+comentário)' : ''}`);
    return { ok: true };
  }

  private async build(pipeline: PipelineKey) {
    const [cards, stages] = await Promise.all([
      this.bitrix.listAllCards(pipeline),
      this.bitrix.listStages(pipeline),
    ]);

    // nomes de quem abriu o card
    const userIds = [...new Set(cards.map((c) => c.created_by_id).filter((x): x is number | string => x != null))];
    const userNames = await this.bitrix.resolveUserNames(userIds);

    const numeros = [...new Set(cards.map((c) => c.numero_titulo).filter((n): n is string => !!n))];
    const [quitados, abertos] = await Promise.all([
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

    const totais = { total: cards.length, quitado_pronto: 0, quitado_parcial: 0, nao_quitado: 0 };
    const byStage = new Map<string, any[]>(stages.map((s) => [s.id, []]));

    for (const c of cards) {
      const { status, quitado } = this.classificar(c, quitadosIdx, abertosIdx);
      totais[status] += 1;
      const out = {
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
      (byStage.get(c.stage_id) ?? byStage.set(c.stage_id, []).get(c.stage_id)!).push(out);
    }

    return {
      pipeline,
      label: PIPELINES[pipeline].label,
      stages: stages.map((s) => ({ id: s.id, nome: s.nome, plataforma: s.plataforma, cards: byStage.get(s.id) ?? [] })),
      totais,
    };
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
