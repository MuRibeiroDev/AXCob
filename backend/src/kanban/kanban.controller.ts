import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { KanbanService, type PipelineKey } from './kanban.service';
import { ConciliacaoService } from './conciliacao.service';

@Controller('kanban')
export class KanbanController {
  constructor(
    private readonly service: KanbanService,
    private readonly conciliacao: ConciliacaoService,
  ) {}

  /** Espelho do pipeline do Bitrix (todas as etapas + cards reais).
   *  refresh=1 força rebuscar no Bitrix; senão serve do cache. */
  @Get()
  kanban(@Query('pipeline') pipeline?: string, @Query('refresh') refresh?: string) {
    if (pipeline !== 'protesto' && pipeline !== 'negativacao') {
      throw new BadRequestException("pipeline deve ser 'protesto' ou 'negativacao'.");
    }
    const force = refresh === '1' || refresh === 'true';
    return this.service.getKanban(pipeline as PipelineKey, force);
  }

  /** Kanban de PIX (3 etapas da SPA Financeiro 1248) — somente leitura.
   *  refresh=1 força rebuscar no Bitrix; senão serve do cache. */
  @Get('pix')
  pix(@Query('refresh') refresh?: string) {
    const force = refresh === '1' || refresh === 'true';
    return this.service.getPix(force);
  }

  /** Concilia um PIX (título do card "PLATAFORMA: R$ valor - NOME") com os títulos
   *  em aberto e devolve as sugestões da IA + cobrador. Resultado fica salvo por
   *  card; só rechama a IA com refresh=1. */
  @Post('pix/identificar')
  identificarPix(@Body() body: { titulo?: string; doc?: string; cardId?: string | number; refresh?: boolean }) {
    if (!body?.titulo?.trim()) {
      throw new BadRequestException('titulo é obrigatório.');
    }
    return this.conciliacao.identificar(body.titulo.trim(), body.doc?.trim() || null, {
      cardId: body.cardId != null ? String(body.cardId) : undefined,
      refresh: body.refresh === true,
    });
  }

  /** Resultados de identificação já salvos (para a tela carregar tudo de uma vez). */
  @Get('pix/conciliacoes')
  conciliacoesPix() {
    return this.conciliacao.salvas();
  }

  /** Move um card de etapa no Bitrix (+ comentário opcional no timeline). */
  @Post('mover')
  mover(@Body() body: { cardId?: number | string; stageId?: string; comentario?: string }) {
    if (!body?.cardId || !body?.stageId) {
      throw new BadRequestException('cardId e stageId são obrigatórios.');
    }
    return this.service.moverCard(body.cardId, body.stageId, body.comentario);
  }
}
