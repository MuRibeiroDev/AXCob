/* Armazena os PNGs gerados dos relatórios no SQL Server (schema axcob).
   Regra: guarda SOMENTE o dia corrente; gerar de novo SUBSTITUI as imagens do
   relatório. Tabela: axcob.relatorio_png (id, parte, dia, png VARBINARY(MAX), criado_em). */
import * as sql from 'mssql';
import { DatabaseService } from '../database/database.service';

export class RelatorioStore {
  constructor(private readonly db: DatabaseService) {}

  /** Substitui as imagens do relatório `id` pelas novas (partes 1..n) do `dia`.
      Mantém apenas o dia corrente em todo o banco. Transacional. */
  async salvar(id: string, dia: string, buffers: Buffer[]): Promise<string> {
    const criadoEm = new Date().toISOString();
    const pool = await this.db.getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).input('id', id)
        .query('DELETE FROM axcob.relatorio_png WHERE id = @id');
      for (let i = 0; i < buffers.length; i++) {
        await new sql.Request(tx)
          .input('id', id).input('parte', i + 1).input('dia', dia)
          .input('png', sql.VarBinary(sql.MAX), buffers[i])
          .input('criado', criadoEm)
          .query('INSERT INTO axcob.relatorio_png (id, parte, dia, png, criado_em) VALUES (@id, @parte, @dia, @png, @criado)');
      }
      // mantém só o dia corrente em todo o banco
      await new sql.Request(tx).input('dia', dia)
        .query('DELETE FROM axcob.relatorio_png WHERE dia <> @dia');
      await tx.commit();
    } catch (e) {
      await tx.rollback().catch(() => undefined);
      throw e;
    }
    return criadoEm;
  }

  /** Nº de partes do relatório `id` no `dia` (0 se não houver). */
  async partes(id: string, dia: string): Promise<number> {
    const r = await this.db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM axcob.relatorio_png WHERE id = @id AND dia = @dia', { id, dia });
    return Number(r[0]?.n ?? 0);
  }

  /** Quando o relatório foi gerado (ISO) no `dia`, ou null. */
  async geradoEm(id: string, dia: string): Promise<string | null> {
    const r = await this.db.query<{ at: string | null }>(
      'SELECT MAX(criado_em) AS at FROM axcob.relatorio_png WHERE id = @id AND dia = @dia', { id, dia });
    return r[0]?.at ?? null;
  }

  /** Lê o PNG (Buffer) de uma parte, ou null. */
  async ler(id: string, parte: number): Promise<Buffer | null> {
    const r = await this.db.query<{ png: Buffer }>(
      'SELECT png FROM axcob.relatorio_png WHERE id = @id AND parte = @parte', { id, parte });
    return r[0]?.png ? Buffer.from(r[0].png) : null;
  }
}
