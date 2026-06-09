import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';

/**
 * Pool único de conexão com o Azure SQL (mesma base do .env da raiz).
 * Conecta sob demanda (lazy) e reaproveita o pool.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: sql.ConnectionPool | null = null;
  private connecting: Promise<sql.ConnectionPool> | null = null;

  constructor(private readonly config: ConfigService) {}

  private buildConfig(): sql.config {
    const host = (this.config.get<string>('DB_HOST') ?? '').trim();
    const database = (this.config.get<string>('DB_NAME') ?? '').trim();
    const user = (this.config.get<string>('DB_USER') ?? '').trim();
    const password = (this.config.get<string>('DB_PASSWORD') ?? '').trim();
    const port = Number(this.config.get('DB_PORT') ?? 1433);
    if (!host || !database || !user) {
      throw new Error('DB_HOST / DB_NAME / DB_USER não configurados no .env');
    }
    return {
      server: host,
      port,
      database,
      user,
      password,
      // useUTC:false → datas (tipo `date`/`datetime`) são interpretadas no fuso
      // local (America/Sao_Paulo) em vez de UTC. Sem isso, uma `date` 30/05 volta
      // como 2026-05-30T00:00:00Z e, em UTC-3, getDate() local vira 29/05 — o que
      // deslocava todos os vencimentos em 1 dia (bug nos relatórios de atraso).
      options: { encrypt: true, trustServerCertificate: true, useUTC: false },
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
      connectionTimeout: 30000,
      requestTimeout: 90000,
    };
  }

  async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) return this.pool;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const pool = new sql.ConnectionPool(this.buildConfig());
      pool.on('error', (err) => this.logger.error(`pool error: ${err.message}`));
      await pool.connect();
      this.logger.log('conectado ao Azure SQL');
      this.pool = pool;
      this.connecting = null;
      return pool;
    })();

    return this.connecting;
  }

  /** Executa um SELECT parametrizado. `params` vira request.input(nome, valor). */
  async query<T = Record<string, unknown>>(
    text: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const pool = await this.getPool();
    const req = pool.request();
    for (const [k, v] of Object.entries(params)) req.input(k, v);
    const result = await req.query<T>(text);
    return result.recordset ?? [];
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.close().catch(() => undefined);
      this.pool = null;
    }
  }
}
