/* Persiste o resultado da conciliação de PIX por card (SQLite), para a tela
   manter a resposta salva e só rechamar a IA quando o usuário pedir. */
import * as fs from 'node:fs';
import * as path from 'node:path';

// node:sqlite é experimental — require evita depender da tipagem do @types/node.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');

export interface ConciliacaoSalva {
  cardId: string;
  titulo: string;
  resultado: unknown;
  criadoEm: string;
}

export class PixConciliacaoStore {
  private readonly db: any;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pix_conciliacao (
        card_id   TEXT PRIMARY KEY,
        titulo    TEXT NOT NULL,
        resultado TEXT NOT NULL,
        criado_em TEXT NOT NULL
      )`);
  }

  /** Salva/atualiza o resultado (JSON) de um card. */
  salvar(cardId: string, titulo: string, resultado: unknown): string {
    const criadoEm = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO pix_conciliacao (card_id, titulo, resultado, criado_em) VALUES (?, ?, ?, ?)
       ON CONFLICT(card_id) DO UPDATE SET titulo=excluded.titulo, resultado=excluded.resultado, criado_em=excluded.criado_em`,
    ).run(cardId, titulo, JSON.stringify(resultado), criadoEm);
    return criadoEm;
  }

  /** Resultado salvo de um card (ou null). */
  buscar(cardId: string): ConciliacaoSalva | null {
    const r = this.db.prepare('SELECT card_id, titulo, resultado, criado_em FROM pix_conciliacao WHERE card_id = ?').get(cardId);
    if (!r) return null;
    return { cardId: r.card_id, titulo: r.titulo, resultado: this.parse(r.resultado), criadoEm: r.criado_em };
  }

  /** Todos os resultados salvos (para a tela carregar de uma vez). */
  todos(): ConciliacaoSalva[] {
    const rows = this.db.prepare('SELECT card_id, titulo, resultado, criado_em FROM pix_conciliacao').all();
    return rows.map((r: any) => ({ cardId: r.card_id, titulo: r.titulo, resultado: this.parse(r.resultado), criadoEm: r.criado_em }));
  }

  private parse(s: string): unknown {
    try { return JSON.parse(s); } catch { return null; }
  }
}
