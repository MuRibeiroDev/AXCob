import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { BitrixService, type SolicitacaoItem } from '../bitrix/bitrix.service';

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
  constructor(private readonly bitrix: BitrixService) {}

  /** Analistas com webhook próprio (p/ escolher quem "abre" o card na criação). */
  @Get('analistas')
  analistas() {
    return this.bitrix.listarAnalistas();
  }

  /** Cria solicitações de protesto (pipeline 116, etapa Solicitações de Protesto). */
  @Post('protestos')
  async protestos(@Body() body: CriarBody) {
    const resultados = await this.bitrix.criarSolicitacoes('protesto', parseItens(body), body?.analistaId ?? null);
    return resumo(resultados);
  }

  /** Cria solicitações de negativação (pipeline 112, etapa Solicitações de Negativação). */
  @Post('negativacoes')
  async negativacoes(@Body() body: CriarBody) {
    const resultados = await this.bitrix.criarSolicitacoes('negativacao', parseItens(body), body?.analistaId ?? null);
    return resumo(resultados);
  }
}
