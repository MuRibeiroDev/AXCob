import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { KanbanService, type PipelineKey } from './kanban.service';
import { ConciliacaoService } from './conciliacao.service';
import { UserConfigService } from '../user-config/user-config.service';

@Controller('kanban')
export class KanbanController {
  constructor(
    private readonly service: KanbanService,
    private readonly conciliacao: ConciliacaoService,
    private readonly cfg: UserConfigService,
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

  /** Lazy load de uma etapa de PIX: 1 página de cards a partir de `start`. */
  @Get('pix/stage/:stageId')
  pixStage(@Param('stageId') stageId: string, @Query('start') start?: string) {
    if (!/^DT1248_146:[A-Z0-9_]+$/.test(stageId)) {
      throw new BadRequestException('stageId inválido.');
    }
    return this.service.pixStage(stageId, Math.max(0, Number(start) || 0));
  }

  /** Lazy load de uma etapa do board (protesto/negativação): 1 página a partir de `start`. */
  @Get(':pipeline/stage/:stageId')
  boardStage(
    @Param('pipeline') pipeline: string,
    @Param('stageId') stageId: string,
    @Query('start') start?: string,
  ) {
    if (pipeline !== 'protesto' && pipeline !== 'negativacao') {
      throw new BadRequestException("pipeline deve ser 'protesto' ou 'negativacao'.");
    }
    if (!/^DT1200_\d+:[A-Z0-9_]+$/.test(stageId)) {
      throw new BadRequestException('stageId inválido.');
    }
    return this.service.kanbanStage(pipeline as PipelineKey, stageId, Math.max(0, Number(start) || 0));
  }

  /** Move um card de etapa no Bitrix (+ comentário opcional no timeline).
   *  Usa o webhook do PRÓPRIO usuário logado (webhook_bitrix_deal) → a
   *  movimentação e o comentário saem no nome dele, não da integração. */
  @Post('mover')
  async mover(@Req() req: any, @Body() body: { cardId?: number | string; stageId?: string; comentario?: string }) {
    if (!body?.cardId || !body?.stageId) {
      throw new BadRequestException('cardId e stageId são obrigatórios.');
    }
    const userId = Number(req.user?.sub ?? req.user?.id);
    const webhook = Number.isFinite(userId) ? await this.cfg.webhookDoUsuario(userId) : null;
    return this.service.moverCard(body.cardId, body.stageId, body.comentario, webhook);
  }
}
