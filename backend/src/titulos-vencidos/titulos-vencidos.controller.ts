import { Controller, Get, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TitulosVencidosService } from './titulos-vencidos.service';

@Controller('titulos-vencidos')
export class TitulosVencidosController {
  constructor(
    private readonly service: TitulosVencidosService,
    private readonly config: ConfigService,
  ) {}

  /** Lista de carteiras (responsáveis de cobrança). */
  @Get('responsaveis')
  responsaveis(): Promise<string[]> {
    return this.service.listarResponsaveis();
  }

  /** Carteira do responsável: cedentes → sacados → títulos vencidos + KPIs.
   *  tipoBoleto = filtro do Tipo de Boleto (coluna M): 'C' (padrão) ou 'T'. */
  @Get()
  carteira(
    @Query('responsavel') responsavel: string,
    @Query('tipoBoleto') tipoBoleto?: string,
  ) {
    const def = (this.config.get<string>('VENCIDOS_BOLETO_DEFAULT') ?? 'C') as 'todos' | 'C' | 'T';
    const t = tipoBoleto === 'C' || tipoBoleto === 'T' || tipoBoleto === 'todos' ? tipoBoleto : def;
    return this.service.porResponsavel(responsavel, t);
  }
}
