/* Configurações por usuário do AxCob (SQLite). Hoje guarda o webhook do Bitrix
   de cada usuário, p/ o "Criado por" dos cards sair com o nome certo. */
import * as fs from 'node:fs';
import * as path from 'node:path';

// node:sqlite é experimental — require evita depender da tipagem do @types/node.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');

export class UserConfigStore {
  private readonly db: any;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_config (
        user_id        INTEGER PRIMARY KEY,
        bitrix_webhook TEXT,
        atualizado_em  TEXT NOT NULL
      )`);
  }

  /** Webhook do Bitrix salvo p/ o usuário (ou null). */
  getWebhook(userId: number): string | null {
    const r = this.db.prepare('SELECT bitrix_webhook FROM user_config WHERE user_id = ?').get(userId);
    return r?.bitrix_webhook || null;
  }

  /** Salva/atualiza o webhook do Bitrix do usuário (string vazia/null limpa). */
  setWebhook(userId: number, webhook: string | null): void {
    const atualizadoEm = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO user_config (user_id, bitrix_webhook, atualizado_em) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET bitrix_webhook=excluded.bitrix_webhook, atualizado_em=excluded.atualizado_em`,
    ).run(userId, webhook || null, atualizadoEm);
  }
}
