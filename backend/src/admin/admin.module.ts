import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';

// AuthService é @Global (exportado pelo AuthModule), então fica injetável aqui.
@Module({
  controllers: [AdminController],
})
export class AdminModule {}
