import { Module } from '@nestjs/common';
import { TitulosVencidosController } from './titulos-vencidos.controller';
import { TitulosVencidosService } from './titulos-vencidos.service';

@Module({
  controllers: [TitulosVencidosController],
  providers: [TitulosVencidosService],
})
export class TitulosVencidosModule {}
