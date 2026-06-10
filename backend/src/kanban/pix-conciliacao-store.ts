/* Persiste o resultado da conciliação de PIX por card no SQL Server (schema axcob),
   para a tela manter a resposta salva e só rechamar a IA quando o usuário pedir.
   Tabela: axcob.pix_conciliacao (card_id, titulo, resultado JSON, criado_em). */
import { DatabaseService } from '../database/database.service';

export interface ConciliacaoSalva {
  cardId: string;
  titulo: string;
  resultado: unknown;
  criadoEm: string;
}

export class PixConciliacaoStore {
  constructor(private readonly db: DatabaseService) {}

  /** Salva/atualiza o resultado (JSON) de um card (upsert por card_id). */
  async salvar(cardId: string, titulo: string, resultado: unknown): Promise<string> {
    const criadoEm = new Date().toISOString();
    await this.db.query(
      `MERGE axcob.pix_conciliacao AS t
       USING (SELECT @card AS card_id) AS s ON t.card_id = s.card_id
       WHEN MATCHED THEN UPDATE SET titulo = @titulo, resultado = @resultado, criado_em = @criado
       WHEN NOT MATCHED THEN INSERT (card_id, titulo, resultado, criado_em)
         VALUES (@card, @titulo, @resultado, @criado);`,
      { card: cardId, titulo, resultado: JSON.stringify(resultado), criado: criadoEm },
    );
    return criadoEm;
  }

  /** Resultado salvo de um card (ou null). */
  async buscar(cardId: string): Promise<ConciliacaoSalva | null> {
    const r = await this.db.query<{ card_id: string; titulo: string; resultado: string; criado_em: string }>(
      'SELECT card_id, titulo, resultado, criado_em FROM axcob.pix_conciliacao WHERE card_id = @card', { card: cardId });
    if (!r[0]) return null;
    return { cardId: r[0].card_id, titulo: r[0].titulo, resultado: this.parse(r[0].resultado), criadoEm: r[0].criado_em };
  }

  /** Todos os resultados salvos (para a tela carregar de uma vez). */
  async todos(): Promise<ConciliacaoSalva[]> {
    const rows = await this.db.query<{ card_id: string; titulo: string; resultado: string; criado_em: string }>(
      'SELECT card_id, titulo, resultado, criado_em FROM axcob.pix_conciliacao');
    return rows.map((r) => ({ cardId: r.card_id, titulo: r.titulo, resultado: this.parse(r.resultado), criadoEm: r.criado_em }));
  }

  private parse(s: string): unknown {
    try { return JSON.parse(s); } catch { return null; }
  }
}
