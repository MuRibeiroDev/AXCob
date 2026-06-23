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

  /** Explora o nome do card na base de títulos em aberto: devolve os títulos em
   *  que o nome é sacado e os títulos em que é cedente (agrupados por sacado). */
  @Post('pix/titulos-relacionados')
  titulosRelacionados(@Body() body: { titulo?: string; ia?: boolean }) {
    if (!body?.titulo?.trim()) {
      throw new BadRequestException('titulo é obrigatório.');
    }
    return this.conciliacao.titulosRelacionados(body.titulo.trim(), { ia: body.ia === true });
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

  /** Move um card de PIX (SPA 1248) + comentário e anexos (fotos) no timeline.
   *  Usa o webhook do usuário logado (sai no nome dele). */
  @Post('pix/mover')
  async moverPix(
    @Req() req: any,
    @Body() body: { cardId?: number | string; stageId?: string; comentario?: string; anexos?: { nome: string; base64: string }[] },
  ) {
    if (!body?.cardId || !body?.stageId) {
      throw new BadRequestException('cardId e stageId são obrigatórios.');
    }
    if (!/^DT1248_146:[A-Z0-9_]+$/.test(body.stageId)) {
      throw new BadRequestException('stageId de PIX inválido.');
    }
    const anexos = (body.anexos ?? [])
      .filter((a) => a && a.nome && a.base64)
      .map((a) => ({ nome: String(a.nome), base64: String(a.base64) }));
    const userId = Number(req.user?.sub ?? req.user?.id);
    const webhook = Number.isFinite(userId) ? await this.cfg.webhookDoUsuario(userId) : null;
    return this.service.moverCardPix(body.cardId, body.stageId, body.comentario, anexos, webhook);
  }

  /** Adiciona comentário + anexos (fotos) no timeline de um card de PIX, SEM mover
   *  de etapa. Usa o webhook do usuário logado (sai no nome dele). */
  @Post('pix/comentar')
  async comentarPix(
    @Req() req: any,
    @Body() body: { cardId?: number | string; comentario?: string; anexos?: { nome: string; base64: string }[] },
  ) {
    if (!body?.cardId) {
      throw new BadRequestException('cardId é obrigatório.');
    }
    const anexos = (body.anexos ?? [])
      .filter((a) => a && a.nome && a.base64)
      .map((a) => ({ nome: String(a.nome), base64: String(a.base64) }));
    if (!body.comentario?.trim() && !anexos.length) {
      throw new BadRequestException('comentário ou anexo é obrigatório.');
    }
    const userId = Number(req.user?.sub ?? req.user?.id);
    const webhook = Number.isFinite(userId) ? await this.cfg.webhookDoUsuario(userId) : null;
    return this.service.comentarCardPix(body.cardId, body.comentario, anexos, webhook);
  }
}
