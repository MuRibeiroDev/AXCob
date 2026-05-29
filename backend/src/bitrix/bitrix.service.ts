import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BITRIX_FIELDS,
  ENTITY_TYPE_ID,
  PIPELINES,
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

  private async post(method: string, payload: Record<string, unknown>): Promise<any> {
    const base = this.webhookBase();
    if (!base) throw new Error('BITRIX_WEBHOOK_URL ausente');
    const res = await fetch(`${base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Bitrix ${method} HTTP ${res.status}`);
    return res.json();
  }

  private join(v: unknown): string | null {
    if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(', ') : null;
    return v != null && v !== '' ? String(v) : null;
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
    };
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
}
