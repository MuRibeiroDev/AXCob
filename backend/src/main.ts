import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  const origins = (config.get<string>('CORS_ORIGIN') ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  // CORS_ORIGIN="*" reflete qualquer origem (útil p/ acesso na rede local)
  app.enableCors({ origin: origins.includes('*') ? true : origins, credentials: true });

  const port = Number(config.get('PORT') ?? 3000);
  await app.listen(port, '0.0.0.0'); // escuta em todas as interfaces
  new Logger('Bootstrap').log(`AxCob API on http://0.0.0.0:${port}/api`);
}

bootstrap();
