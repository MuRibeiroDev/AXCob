import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { BitrixModule } from './bitrix/bitrix.module';
import { TitulosVencidosModule } from './titulos-vencidos/titulos-vencidos.module';
import { AcoesModule } from './acoes/acoes.module';
import { KanbanModule } from './kanban/kanban.module';
import { RelatoriosModule } from './relatorios/relatorios.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AuthModule } from './auth/auth.module';
import { UserConfigModule } from './user-config/user-config.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // backend/.env primeiro; cai pro .env da raiz do projeto se faltar algo
      envFilePath: ['.env', '../.env'],
    }),
    AuthModule,
    UserConfigModule,
    AdminModule,
    DatabaseModule,
    BitrixModule,
    TitulosVencidosModule,
    AcoesModule,
    KanbanModule,
    RelatoriosModule,
    WhatsappModule,
  ],
})
export class AppModule {}
