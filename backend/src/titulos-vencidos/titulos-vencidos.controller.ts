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

  /** Carteira do responsável: cedentes → sacados → títulos vencidos + KPIs. */
  @Get()
  carteira(
    @Query('responsavel') responsavel: string,
    @Query('tipo') tipo?: string,
  ) {
    const def = (this.config.get<string>('VENCIDOS_TIPO_DEFAULT') ?? 'comissarias') as
      | 'comissarias'
      | 'todos';
    const t = tipo === 'todos' || tipo === 'comissarias' ? tipo : def;
    return this.service.porResponsavel(responsavel, t);
  }
}
