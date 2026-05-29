import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { BitrixModule } from './bitrix/bitrix.module';
import { TitulosVencidosModule } from './titulos-vencidos/titulos-vencidos.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // backend/.env primeiro; cai pro .env da raiz do projeto se faltar algo
      envFilePath: ['.env', '../.env'],
    }),
    DatabaseModule,
    BitrixModule,
    TitulosVencidosModule,
  ],
})
export class AppModule {}
