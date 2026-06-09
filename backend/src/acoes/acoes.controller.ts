import { BadRequestException, Body, Controller, Get, Post, Req } from '@nestjs/common';
import { BitrixService, type SolicitacaoItem } from '../bitrix/bitrix.service';
import { UserConfigService } from '../user-config/user-config.service';

interface CriarBody {
  itens: SolicitacaoItem[];
  analistaId?: number | string;
}

function parseItens(body: CriarBody): SolicitacaoItem[] {
  const itens = body?.itens;
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new BadRequestException('Informe ao menos um título em "itens".');
  }
  return itens.filter((i) => i && i.numeroTitulo);
}

function resumo(resultados: { ok: boolean }[]) {
  const ok = resultados.filter((r) => r.ok).length;
  return { total: resultados.length, ok, falhas: resultados.length - ok, resultados };
}

@Controller('acoes')
export class AcoesController {
  constructor(
    private readonly bitrix: BitrixService,
    private readonly cfg: UserConfigService,
  ) {}

  /** Analistas com webhook próprio (p/ escolher quem "abre" o card na criação). */
  @Get('analistas')
  analistas() {
    return this.bitrix.listarAnalistas();
  }

  /** Webhook do PRÓPRIO usuário logado (configurado em Configurações). */
  private webhookDoUsuario(req: any): string | null {
    const userId = Number(req.user?.sub ?? req.user?.id);
    return Number.isFinite(userId) ? this.cfg.webhookDoUsuario(userId) : null;
  }

  /** Cria solicitações de protesto (pipeline 116, etapa Solicitações de Protesto). */
  @Post('protestos')
  async protestos(@Req() req: any, @Body() body: CriarBody) {
    const resultados = await this.bitrix.criarSolicitacoes(
      'protesto', parseItens(body), body?.analistaId ?? null, this.webhookDoUsuario(req),
    );
    return resumo(resultados);
  }

  /** Cria solicitações de negativação (pipeline 112, etapa Solicitações de Negativação). */
  @Post('negativacoes')
  async negativacoes(@Req() req: any, @Body() body: CriarBody) {
    const resultados = await this.bitrix.criarSolicitacoes(
      'negativacao', parseItens(body), body?.analistaId ?? null, this.webhookDoUsuario(req),
    );
    return resumo(resultados);
  }
}
