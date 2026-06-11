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
  foto: string | null; // profile_photo (base64/data-URI) ou null
  permissoes: string[] | null; // telas liberadas; null = todas (default)
  isAdmin: boolean; // admin DO AxCob (lista própria) — NÃO confiar no role (compartilhado)
}

// Coluna (NVARCHAR) na users_qitech com as permissões do AxCob.
// Conteúdo: "admin" → admin do AxCob (vê tudo); OU JSON com a lista de telas.
// Leitura/escrita tolerante (não quebra se a coluna não existir).
const COL_PERMISSOES = 'permissions_cobranca';

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

  /** Normaliza a coluna profile_photo → data-URI pronta p/ <img src>, ou null.
   *  Aceita já como data-URI (data:image/...;base64,...) ou base64 cru. Qualquer
   *  outra coisa (texto, URL não-imagem, vazio) vira null → mantém as iniciais. */
  private normalizarFoto(raw: unknown): string | null {
    if (raw == null) return null;
    const s = (typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)).trim();
    if (!s) return null;
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(s)) return s;
    // base64 cru (sem prefixo): valida charset/comprimento e assume PNG
    const compact = s.replace(/\s+/g, '');
    if (compact.length >= 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact) && compact.length % 4 === 0) {
      return `data:image/png;base64,${compact}`;
    }
    return null;
  }

  /** Interpreta a coluna permissions_cobranca:
   *  - "admin" (ou ["admin"]) → admin do AxCob (vê tudo);
   *  - lista de telas (JSON) → NÃO-admin, acesso só a essas telas;
   *  - vazio/null → não-admin, sem restrição (vê todas por padrão). */
  private interpretarPermissao(raw: unknown): { isAdmin: boolean; permissoes: string[] | null } {
    if (raw == null) return { isAdmin: false, permissoes: null };
    const s = String(raw).trim();
    if (!s) return { isAdmin: false, permissoes: null };
    if (s.toLowerCase() === 'admin') return { isAdmin: true, permissoes: null };
    try {
      const a = JSON.parse(s);
      if (typeof a === 'string') {
        return a.toLowerCase() === 'admin' ? { isAdmin: true, permissoes: null } : { isAdmin: false, permissoes: [a] };
      }
      if (Array.isArray(a)) {
        const keys = a.map((x) => String(x));
        if (keys.some((k) => k.toLowerCase() === 'admin')) return { isAdmin: true, permissoes: null };
        return { isAdmin: false, permissoes: keys };
      }
    } catch { /* texto não-JSON e != 'admin' → trata como sem restrição */ }
    return { isAdmin: false, permissoes: null };
  }

  /** Valida login (username OU email) + senha. Retorna o usuário ou null. */
  async validar(login: string, senha: string): Promise<AuthUser | null> {
    if (!login?.trim() || !senha) return null;
    const pool = await this.getPool();
    const cols = 'id, username, email, full_name, role, hashed_password, contact_phone, profile_photo';
    const where = 'WHERE is_active = 1 AND (username = @l OR email = @l)';
    // tenta com a coluna de permissões; se ainda não existe, cai p/ o select básico
    let u: any;
    try {
      const r = await pool.request().input('l', login.trim())
        .query(`SELECT TOP 1 ${cols}, ${COL_PERMISSOES} FROM Ax_Caixa.users_qitech ${where}`);
      u = r.recordset[0];
    } catch {
      const r = await pool.request().input('l', login.trim())
        .query(`SELECT TOP 1 ${cols} FROM Ax_Caixa.users_qitech ${where}`);
      u = r.recordset[0];
    }
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
      foto: this.normalizarFoto(u.profile_photo),
      ...this.interpretarPermissao(u[COL_PERMISSOES]),
    };
  }

  /** Dados ATUAIS do usuário (lê do banco, não do token) — usado no /auth/me p/
   *  revalidar isAdmin/permissões/foto sem precisar relogar. */
  async usuarioAtual(id: number): Promise<AuthUser | null> {
    if (!Number.isFinite(id)) return null;
    const pool = await this.getPool();
    const cols = 'id, username, email, full_name, role, contact_phone, profile_photo';
    let u: any;
    try {
      const r = await pool.request().input('id', id).query(`SELECT TOP 1 ${cols}, ${COL_PERMISSOES} FROM Ax_Caixa.users_qitech WHERE id = @id`);
      u = r.recordset[0];
    } catch {
      const r = await pool.request().input('id', id).query(`SELECT TOP 1 ${cols} FROM Ax_Caixa.users_qitech WHERE id = @id`);
      u = r.recordset[0];
    }
    if (!u) return null;
    const phone = String(u.contact_phone ?? '').replace(/\D/g, '');
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      nome: (u.full_name as string) || u.username,
      role: u.role,
      phone: phone || null,
      foto: this.normalizarFoto(u.profile_photo),
      ...this.interpretarPermissao(u[COL_PERMISSOES]),
    };
  }

  /** [Admin] Lista os usuários (p/ a tela de permissões). Tolerante à coluna ausente. */
  async listarUsuariosAdmin(): Promise<
    { id: number; username: string; nome: string; role: string; ativo: boolean; isAdmin: boolean; permissoes: string[] | null }[]
  > {
    const pool = await this.getPool();
    const cols = 'id, username, email, full_name, role, is_active';
    // só perfis do AxCob e ativos (a tabela é compartilhada e pode ter muitas linhas)
    const where = "WHERE is_active = 1 AND role IN ('admin','analista','visualizador')";
    let rows: any[];
    try {
      const r = await pool.request().query(`SELECT ${cols}, ${COL_PERMISSOES} FROM Ax_Caixa.users_qitech ${where} ORDER BY full_name`);
      rows = r.recordset;
    } catch {
      const r = await pool.request().query(`SELECT ${cols} FROM Ax_Caixa.users_qitech ${where} ORDER BY full_name`);
      rows = r.recordset;
    }
    return rows.map((u) => ({
      id: u.id,
      username: u.username,
      nome: (u.full_name as string) || u.username,
      role: u.role,
      ativo: !!u.is_active,
      ...this.interpretarPermissao(u[COL_PERMISSOES]),
    }));
  }

  /** [Admin] Grava as telas liberadas de um usuário. `perms = null` → vê todas.
   *  Lança se a coluna ainda não existir (o controller traduz numa mensagem clara). */
  async salvarPermissoesTela(userId: number, perms: string[] | null): Promise<void> {
    if (!Number.isFinite(userId)) return;
    const pool = await this.getPool();
    const val = perms == null ? null : JSON.stringify([...new Set(perms.map((p) => String(p)))]);
    await pool.request().input('id', userId).input('p', val)
      .query(`UPDATE Ax_Caixa.users_qitech SET ${COL_PERMISSOES} = @p WHERE id = @id`);
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
