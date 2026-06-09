import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { BitrixService, type StatusIndex } from '../bitrix/bitrix.service';
import { agingClass, agingLabel, emptyBuckets } from './aging';
import type {
  Buckets, CarteiraData, Cedente, Kpis, Sacado, StatusKey, Titulo,
} from './titulos-vencidos.types';

// Whitelist de TIPO — idêntica à fonte do Power BI (fTitulosAbertos).
const TIPOS_PERMITIDOS = ['ADC', 'CCB', 'CHQ', 'CTR', 'CPR', 'DES', 'DMR', 'NCO', 'NPP', 'DSR'];
// Cedente interno excluído no Power BI.
const CEDENTE_EXCLUIDO = '05.673.133/0001-42';
// Operação excluída no Power BI.
const OP_EXCLUIDA = 7190;

type TipoBoleto = 'todos' | 'C' | 'T'; // tipo de boleto (coluna M); 'todos' = sem filtro

interface Row {
  CEDENTE: string | null;
  CPF_CNPJ_CEDENTE: string | null;
  SACADO: string | null;
  CPF_CNPJ_SACADO: string | null;
  DOCUMENTO: string | null;
  ID_TITULO: number | null;
  VENCIMENTO: Date | null;
  VALOR: number | null;
  MULTA: number | null;
  JUROS: number | null;
  TARIFAS: number | null;
  TOTAL: number | null;
  DIAS: number | null;
  SITUACAO: string | null;
  TIPO: string | null;
  CR: string | null;
  M: string | null;
  SISTEMA: string | null;
}

@Injectable()
export class TitulosVencidosService {
  private readonly logger = new Logger(TitulosVencidosService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly bitrix: BitrixService,
    private readonly config: ConfigService,
  ) {}

  /** Distintos RESPONSAVEL_COBRANCA (carteiras), sem vazios. */
  async listarResponsaveis(): Promise<string[]> {
    const rows = await this.db.query<{ RESPONSAVEL_COBRANCA: string }>(`
      SELECT DISTINCT RESPONSAVEL_COBRANCA
      FROM data_core.vw_cedentes
      WHERE RESPONSAVEL_COBRANCA IS NOT NULL
        AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA)) <> ''
      ORDER BY RESPONSAVEL_COBRANCA
    `);
    return rows.map((r) => r.RESPONSAVEL_COBRANCA.trim()).filter(Boolean);
  }

  private toIso(d: Date | null): string | null {
    if (!d) return null;
    // VENCIMENTO é DATE; normaliza pra yyyy-mm-dd sem fuso
    return d.toISOString().slice(0, 10);
  }

  /** Hierarquia cedentes → sacados → títulos vencidos da carteira do responsável.
   *  tipoBoleto = filtro da coluna M (C/T), igual ao slicer "Tipo de Boleto" do BI. */
  async porResponsavel(responsavel: string, tipoBoleto: TipoBoleto): Promise<CarteiraData> {
    if (!responsavel?.trim()) throw new BadRequestException('Responsável é obrigatório.');
    if (tipoBoleto !== 'todos' && tipoBoleto !== 'C' && tipoBoleto !== 'T') {
      throw new BadRequestException(`Tipo de boleto inválido: ${tipoBoleto}`);
    }

    const tipoList = TIPOS_PERMITIDOS.map((t) => `'${t}'`).join(', ');
    const boletoWhere = tipoBoleto === 'todos' ? '' : 'AND t.M = @tipoBoleto';

    // Mesmos filtros da fonte do Power BI (fTitulosAbertos / vw_titulos_abertos_espelho_bi),
    // filtrando pelo Tipo de Boleto (coluna M = C ou T).
    const sql = `
      SELECT
        t.CEDENTE, t.CPF_CNPJ_CEDENTE, t.SACADO, t.CPF_CNPJ_SACADO,
        t.DOCUMENTO, t.ID_TITULO, t.VENCIMENTO,
        t.VALOR, t.MULTA, t.JUROS, t.TARIFAS, t.TOTAL,
        DATEDIFF(DAY, t.VENCIMENTO, CAST(GETDATE() AS DATE)) AS DIAS,
        t.SITUACAO, t.TIPO, t.CR, t.M, t.SISTEMA
      FROM data_core.vw_titulos_abertos_espelho_bi AS t
      INNER JOIN (
        SELECT CPF_CNPJ, MAX(RESPONSAVEL_COBRANCA) AS RESP
        FROM data_core.vw_cedentes
        WHERE RESPONSAVEL_COBRANCA IS NOT NULL
          AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA)) <> ''
        GROUP BY CPF_CNPJ
      ) AS c ON c.CPF_CNPJ = t.CPF_CNPJ_CEDENTE
      WHERE c.RESP = @resp
        AND DATEDIFF(DAY, t.VENCIMENTO, CAST(GETDATE() AS DATE)) > 0
        ${boletoWhere}
        AND UPPER(LTRIM(RTRIM(ISNULL(t.TIPO, '')))) IN (${tipoList})
        AND t.HISTORICO NOT LIKE '%PAGO%'
        AND t.CPF_CNPJ_CEDENTE <> '${CEDENTE_EXCLUIDO}'
        AND (t.OP IS NULL OR t.OP <> ${OP_EXCLUIDA})
      ORDER BY t.CEDENTE, t.SACADO, t.VENCIMENTO, t.DOCUMENTO
    `;

    const params: Record<string, unknown> = { resp: responsavel.trim() };
    if (tipoBoleto !== 'todos') params.tipoBoleto = tipoBoleto;

    const t0 = Date.now();
    const rows = await this.db.query<Row>(sql, params);
    this.logger.log(`[vencidos] ${responsavel} (boleto ${tipoBoleto}): ${rows.length} linhas em ${Date.now() - t0}ms`);

    const statusIdx = await this.bitrix.getStatusIndex();

    return this.montar(rows, responsavel.trim(), tipoBoleto, statusIdx);
  }

  private montar(rows: Row[], responsavel: string, tipoBoleto: string, idx: StatusIndex): CarteiraData {
    const hoje = new Date().toISOString().slice(0, 10);
    const cedentesMap = new Map<string, Cedente>();
    const sacadoKeyMap = new Map<string, Map<string, Sacado>>();

    for (const r of rows) {
      const cedNome = r.CEDENTE ?? '(sem cedente)';
      const dias = r.DIAS ?? 0;
      const aging = agingClass(dias);
      const valorAtual = Number(r.TOTAL ?? 0);
      const valorOriginal = Number(r.VALOR ?? 0);
      const juros = Number(r.MULTA ?? 0) + Number(r.JUROS ?? 0) + Number(r.TARIFAS ?? 0);

      let ced = cedentesMap.get(cedNome);
      if (!ced) {
        ced = {
          id: r.CPF_CNPJ_CEDENTE ?? cedNome,
          nome: cedNome,
          cnpj: r.CPF_CNPJ_CEDENTE ?? null,
          sacados: [],
          total: 0, qtd: 0, sacadoQtd: 0, maxDias: 0,
          aging: 'fresh', buckets: emptyBuckets(),
        };
        cedentesMap.set(cedNome, ced);
        sacadoKeyMap.set(cedNome, new Map());
      }

      const sacMap = sacadoKeyMap.get(cedNome)!;
      const sacNome = r.SACADO ?? '(sem sacado)';
      let sac = sacMap.get(sacNome);
      if (!sac) {
        sac = {
          nome: sacNome,
          doc: r.CPF_CNPJ_SACADO ?? null,
          tel: null,
          titulos: [],
          total: 0, qtd: 0, maxDias: 0, aging: 'fresh',
        };
        sacMap.set(sacNome, sac);
        ced.sacados.push(sac);
      }

      // protesto (Bitrix 116) + negativação (Bitrix 112 OU SITUACAO 'Aberto com Negativação')
      const cob = idx.lookup(r.DOCUMENTO, r.CPF_CNPJ_SACADO);
      const negativado = cob.negativado || (r.SITUACAO ?? '').toLowerCase().includes('negativ');
      const protesto = cob.protesto;
      const status: StatusKey =
        protesto === 'protestado' ? 'protestado'
          : protesto === 'protesto' ? 'protesto'
            : negativado ? 'negativado'
              : 'open';

      const titulo: Titulo = {
        id: r.DOCUMENTO ?? String(r.ID_TITULO ?? ''),
        idTitulo: r.ID_TITULO ?? null,
        vencimento: this.toIso(r.VENCIMENTO),
        valorOriginal,
        valorAtual,
        juros: +juros.toFixed(2),
        dias,
        aging,
        agingLabel: agingLabel(dias),
        status,
        protesto,
        negativado,
        situacao: r.SITUACAO ?? null,
        tipo: r.TIPO ?? null,
        sistema: r.SISTEMA ?? null,
      };
      sac.titulos.push(titulo);

      // Agregações por Valor Face (VALOR) — mesma base do Power BI.
      sac.total += valorOriginal;
      sac.qtd += 1;
      sac.maxDias = Math.max(sac.maxDias, dias);
      ced.total += valorOriginal;
      ced.qtd += 1;
      ced.maxDias = Math.max(ced.maxDias, dias);
      ced.buckets[aging] += valorOriginal;
    }

    // finaliza cedentes/sacados (ordenação por exposição)
    const cedentes = [...cedentesMap.values()];
    for (const ced of cedentes) {
      ced.sacadoQtd = ced.sacados.length;
      ced.aging = agingClass(ced.maxDias);
      for (const s of ced.sacados) s.aging = agingClass(s.maxDias);
      ced.sacados.sort((a, b) => b.total - a.total);
    }
    cedentes.sort((a, b) => b.total - a.total);

    const kpis = this.kpis(cedentes);

    return {
      hoje,
      responsavel,
      tipo: tipoBoleto,
      carteira: {
        nome: `Carteira de ${responsavel}`,
        codigo: tipoBoleto === 'todos' ? 'Todos os boletos' : `Boleto tipo ${tipoBoleto}`,
      },
      cedentes,
      kpis,
    };
  }

  private kpis(cedentes: Cedente[]): Kpis {
    const buckets: Buckets = emptyBuckets();
    const bucketsQtd: Record<string, number> = { fresh: 0, warn: 0, hot: 0, crit: 0 };
    let totalVencido = 0; // soma Valor Face (VALOR) — base do Power BI
    let encargos = 0; // soma MULTA + JUROS + TARIFAS
    let qtdTitulos = 0;
    let qtdSacados = 0;
    let emProtesto = 0;
    let emNego = 0;
    let emNegativado = 0;

    for (const ced of cedentes) {
      qtdSacados += ced.sacadoQtd;
      for (const s of ced.sacados) {
        for (const t of s.titulos) {
          totalVencido += t.valorOriginal;
          encargos += t.juros;
          qtdTitulos += 1;
          buckets[t.aging] += t.valorOriginal;
          bucketsQtd[t.aging] += 1;
          if (t.protesto) emProtesto += t.valorOriginal;
          if (t.negativado) emNegativado += t.valorOriginal;
          if (t.status === 'nego') emNego += t.valorOriginal;
        }
      }
    }

    return {
      totalVencido,
      totalOriginal: totalVencido,
      juros: encargos,
      qtdTitulos,
      qtdSacados,
      qtdCedentes: cedentes.length,
      buckets,
      bucketsQtd: bucketsQtd as Record<'fresh' | 'warn' | 'hot' | 'crit', number>,
      emProtesto,
      emNego,
      emNegativado,
    };
  }
}
