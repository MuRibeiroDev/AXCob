/* Armazena os PNGs gerados dos relatórios em SQLite.
   Regra: guarda SOMENTE o dia corrente; gerar de novo SUBSTITUI as imagens do
   relatório. Evita acumular arquivos em scripts/. */
import * as fs from 'node:fs';
import * as path from 'node:path';

// node:sqlite é experimental — require evita depender da tipagem do @types/node.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');

export class RelatorioStore {
  private readonly db: any;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relatorio_png (
        id        TEXT    NOT NULL,
        parte     INTEGER NOT NULL,
        dia       TEXT    NOT NULL,
        png       BLOB    NOT NULL,
        criado_em TEXT    NOT NULL,
        PRIMARY KEY (id, parte)
      )`);
  }

  /** Substitui as imagens do relatório `id` pelas novas (partes 1..n) do `dia`.
      Mantém apenas o dia corrente em todo o banco. */
  salvar(id: string, dia: string, buffers: Buffer[]): string {
    const criadoEm = new Date().toISOString();
    this.db.prepare('DELETE FROM relatorio_png WHERE id = ?').run(id);
    const ins = this.db.prepare(
      'INSERT INTO relatorio_png (id, parte, dia, png, criado_em) VALUES (?, ?, ?, ?, ?)',
    );
    buffers.forEach((b, i) => ins.run(id, i + 1, dia, b, criadoEm));
    this.db.prepare('DELETE FROM relatorio_png WHERE dia <> ?').run(dia); // só o dia corrente
    return criadoEm;
  }

  /** Nº de partes do relatório `id` no `dia` (0 se não houver). */
  partes(id: string, dia: string): number {
    const r = this.db.prepare(
      'SELECT COUNT(*) AS n FROM relatorio_png WHERE id = ? AND dia = ?',
    ).get(id, dia);
    return Number(r?.n ?? 0);
  }

  /** Quando o relatório foi gerado (ISO) no `dia`, ou null. */
  geradoEm(id: string, dia: string): string | null {
    const r = this.db.prepare(
      'SELECT MAX(criado_em) AS at FROM relatorio_png WHERE id = ? AND dia = ?',
    ).get(id, dia);
    return r?.at ?? null;
  }

  /** Lê o PNG (Buffer) de uma parte, ou null. */
  ler(id: string, parte: number): Buffer | null {
    const r = this.db.prepare(
      'SELECT png FROM relatorio_png WHERE id = ? AND parte = ?',
    ).get(id, parte);
    return r ? Buffer.from(r.png) : null;
  }
}
