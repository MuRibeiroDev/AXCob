import { Module } from '@nestjs/common';
import { KanbanController } from './kanban.controller';
import { KanbanService } from './kanban.service';
import { ConciliacaoService } from './conciliacao.service';

@Module({
  controllers: [KanbanController],
  providers: [KanbanService, ConciliacaoService],
  exports: [KanbanService, ConciliacaoService],
})
export class KanbanModule {}
