import { Module } from '@nestjs/common';
import { AcoesController } from './acoes.controller';

@Module({
  controllers: [AcoesController],
})
export class AcoesModule {}
