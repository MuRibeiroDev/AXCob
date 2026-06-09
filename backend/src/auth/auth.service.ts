import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  nome: string;
  role: string;
  phone: string | null;
}

/** Autenticação contra a tabela COMPARTILHADA Ax_Caixa.users_qitech (banco SMART).
 *  Senha em bcrypt. Escreve APENAS nas colunas próprias do AxCob desta tabela
 *  (contact_phone e webhook_bitrix_deal) — nunca toca no restante. */
@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private pool: sql.ConnectionPool | null = null;
  private connecting: Promise<sql.ConnectionPool> | null = null;

  constructor(private readonly config: ConfigService) {}

  private buildConfig(): sql.config {
    return {
      server: (this.config.get<string>('SMART_HOST') ?? '').trim(),
      port: Number(this.config.get('SMART_PORT') ?? 1433),
      database: (this.config.get<string>('SMART_DATABASE') ?? '').trim(),
      user: (this.config.get<string>('SMART_USER') ?? '').trim(),
      password: (this.config.get<string>('SMART_PASSWORD') ?? '').trim(),
      options: { encrypt: true, trustServerCertificate: true, useUTC: false },
      pool: { max: 3, min: 0, idleTimeoutMillis: 30000 },
      connectionTimeout: 30000,
      requestTimeout: 30000,
    };
  }

  private async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) return this.pool;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const pool = new sql.ConnectionPool(this.buildConfig());
      pool.on('error', (e) => this.logger.error(`SMART pool error: ${e.message}`));
      await pool.connect();
      this.logger.log('conectado ao SMART (users_qitech)');
      this.pool = pool;
      this.connecting = null;
      return pool;
    })();
    return this.connecting;
  }

  /** Verifica a senha do MESMO jeito que o sistema que gerou o hash:
   *  1) bcrypt sobre a senha pura (até 72 bytes) — hashes antigos;
   *  2) bcrypt sobre o sha256(senha) em bytes crus — hashes novos (get_password_hash). */
  private async verificarSenha(senha: string, hash: string): Promise<boolean> {
    if (!hash) return false;
    try {
      const plain = Buffer.from(senha, 'utf8');
      const trunc = plain.length > 72 ? plain.subarray(0, 72) : plain;
      if (await bcrypt.compare(trunc, hash)) return true;
    } catch { /* tenta o digest abaixo */ }
    try {
      const digest = crypto.createHash('sha256').update(senha, 'utf8').digest();
      return await bcrypt.compare(digest, hash);
    } catch {
      return false;
    }
  }

  /** Valida login (username OU email) + senha. Retorna o usuário ou null. */
  async validar(login: string, senha: string): Promise<AuthUser | null> {
    if (!login?.trim() || !senha) return null;
    const pool = await this.getPool();
    const r = await pool.request().input('l', login.trim()).query(`
      SELECT TOP 1 id, username, email, full_name, role, hashed_password, contact_phone
      FROM Ax_Caixa.users_qitech
      WHERE is_active = 1 AND (username = @l OR email = @l)`);
    const u = r.recordset[0];
    if (!u) return null;
    const ok = await this.verificarSenha(senha, String(u.hashed_password ?? ''));
    if (!ok) return null;
    const phone = String(u.contact_phone ?? '').replace(/\D/g, '');
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      nome: (u.full_name as string) || u.username,
      role: u.role,
      phone: phone || null,
    };
  }

  /** Webhook do Bitrix do usuário (coluna webhook_bitrix_deal), ou null. */
  async webhookDoUsuario(userId: number): Promise<string | null> {
    if (!Number.isFinite(userId)) return null;
    const pool = await this.getPool();
    const r = await pool.request().input('id', userId)
      .query('SELECT webhook_bitrix_deal FROM Ax_Caixa.users_qitech WHERE id = @id');
    const w = r.recordset[0]?.webhook_bitrix_deal;
    return (w && String(w).trim()) || null;
  }

  /** Grava (ou limpa, com null) o webhook do Bitrix do usuário. */
  async salvarWebhook(userId: number, webhook: string | null): Promise<void> {
    if (!Number.isFinite(userId)) return;
    const pool = await this.getPool();
    await pool.request().input('id', userId).input('w', webhook || null)
      .query('UPDATE Ax_Caixa.users_qitech SET webhook_bitrix_deal = @w WHERE id = @id');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) { await this.pool.close().catch(() => undefined); this.pool = null; }
  }
}
