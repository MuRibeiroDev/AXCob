import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseService } from '../database/database.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { RELATORIOS, type RelatorioCard } from './relatorios.catalog';
import { deadline, fmtIso, hojeEfetivo, hojeLocal, ultimoDiaUtil, vencsNoPrazo } from './dias-uteis';
import { RelatorioStore } from './relatorio-store';

// Mapeia cada relatório PNG ao script Python, aos argumentos e ao prefixo de saída.
// O nº de partes é adaptativo no script; descobrimos os arquivos por `outBase`_N.png.
const PNG_JOBS: Record<string, { script: string; args: string[]; outBase: string }> = {
  titulos_quitados_geral: {
    script: 'powerbi_quitados_expandido.py', args: ['--out', 'print_quitados.png'], outBase: 'print_quitados',
  },
  titulos_quitados_agro: {
    script: 'powerbi_quitados_expandido.py',
    args: ['--categoria', 'AGRO', '--out', 'print_quitados_agro.png'],
    outBase: 'print_quitados_agro',
  },
  titulos_quitados_industria: {
    script: 'powerbi_quitados_expandido.py',
    args: ['--categoria', 'INDUSTRIA', '--out', 'print_quitados_industria.png'],
    outBase: 'print_quitados_industria',
  },
  titulos_quitados_estruturada: {
    script: 'powerbi_quitados_expandido.py',
    args: ['--categoria', 'ESTRUTURADA', '--out', 'print_quitados_estruturada.png'],
    outBase: 'print_quitados_estruturada',
  },
  titulos_abertos_geral: {
    script: 'powerbi_abertos_expandido.py', args: ['--out', 'print_abertos.png', '--dump-cedentes'], outBase: 'print_abertos',
  },
  titulos_abertos_agro: {
    script: 'powerbi_abertos_expandido.py',
    args: ['--categoria', 'AGRO', '--out', 'print_abertos_agro.png', '--dump-cedentes'],
    outBase: 'print_abertos_agro',
  },
  titulos_abertos_industria: {
    script: 'powerbi_abertos_expandido.py',
    args: ['--categoria', 'INDUSTRIA', '--out', 'print_abertos_industria.png', '--dump-cedentes'],
    outBase: 'print_abertos_industria',
  },
  titulos_abertos_estruturada: {
    script: 'powerbi_abertos_expandido.py',
    args: ['--categoria', 'ESTRUTURADA', '--out', 'print_abertos_estruturada.png', '--dump-cedentes'],
    outBase: 'print_abertos_estruturada',
  },
};

type PngStatus = 'idle' | 'gerando' | 'pronto' | 'erro';
interface PngState { status: PngStatus; imagens: string[]; erro?: string; at?: string }

interface TituloRow {
  CEDENTE: string | null;
  VENCIMENTO: Date | string | null;
  VALOR: number | null;
  DIAS_VENCIDOS: number | null;
  CNPJ: string | null;
}
interface Titulo {
  cedente: string;
  vencimento: Date;
  diasVencidos: number;
  valor: number;
  cnpj: string; // só dígitos — chave p/ casar a flexibilização
}

const DATA_INICIAL = '2025-01-01';

@Injectable()
export class RelatoriosService {
  private readonly logger = new Logger(RelatoriosService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsappService,
  ) {}

  catalogo(): RelatorioCard[] {
    return RELATORIOS;
  }

  // ===================== Envio em sequência (WhatsApp) =====================

  /** Ordem fixa pedida pela operação: para cada plataforma, QUITADOS depois VENCIDOS
   *  (o PNG "abertos" leva a legenda "VENCIDOS"); por fim comissárias sem/ com atraso. */
  private static readonly SEQUENCIA: ({ tipo: 'png'; id: string; legenda: string } | { tipo: 'texto'; id: string })[] = [
    { tipo: 'png', id: 'titulos_quitados_geral', legenda: 'TÍTULOS QUITADOS - GERAL' },
    { tipo: 'png', id: 'titulos_abertos_geral', legenda: 'TÍTULOS VENCIDOS - GERAL' },
    { tipo: 'png', id: 'titulos_quitados_agro', legenda: 'TÍTULOS QUITADOS - AGRO' },
    { tipo: 'png', id: 'titulos_abertos_agro', legenda: 'TÍTULOS VENCIDOS - AGRO' },
    { tipo: 'png', id: 'titulos_quitados_estruturada', legenda: 'TÍTULOS QUITADOS - ESTRUTURADA' },
    { tipo: 'png', id: 'titulos_abertos_estruturada', legenda: 'TÍTULOS VENCIDOS - ESTRUTURADA' },
    { tipo: 'png', id: 'titulos_quitados_industria', legenda: 'TÍTULOS QUITADOS - INDÚSTRIA' },
    { tipo: 'png', id: 'titulos_abertos_industria', legenda: 'TÍTULOS VENCIDOS - INDÚSTRIA' },
    { tipo: 'texto', id: 'comissarias_sem_atraso' },
    { tipo: 'texto', id: 'comissarias_em_atraso' },
  ];

  /** Envia os relatórios na ordem fixa para um OU mais números (mesmo formato do
   *  envio de comissárias: 55DDD…, separados por vírgula). Texto antes, foto depois.
   *  Os PNGs precisam já estar gerados (do dia); comissárias são geradas aqui. */
  async enviarSequencia(numeros: string[]): Promise<{ ok: boolean; passos: { passo: string; ok: boolean; erro?: string }[]; faltando: string[] }> {
    const nums = (numeros ?? []).map((n) => this.whatsapp.normalizeNumber(n)).filter(Boolean);
    if (nums.length === 0) throw new BadRequestException('Informe ao menos um número de WhatsApp.');
    const dia = this.hoje();

    // monta as ações (texto/foto) na ordem, UMA vez (reusa entre números)
    type Acao = { kind: 'text'; label: string; text: string } | { kind: 'media'; label: string; base64: string; fileName: string };
    const acoes: Acao[] = [];
    const faltando: string[] = [];
    for (const item of RelatoriosService.SEQUENCIA) {
      if (item.tipo === 'png') {
        const n = await this.store().partes(item.id, dia);
        if (n === 0) { faltando.push(item.legenda); continue; }
        acoes.push({ kind: 'text', label: `${item.legenda} (texto)`, text: `*${item.legenda}*` });
        for (let parte = 1; parte <= n; parte++) {
          const buf = await this.store().ler(item.id, parte);
          if (buf) acoes.push({ kind: 'media', label: `${item.legenda} (img ${parte})`, base64: buf.toString('base64'), fileName: `${item.id}_${parte}.png` });
        }
      } else {
        const { texto } = await this.gerarTexto(item.id);
        acoes.push({ kind: 'text', label: item.id, text: texto });
      }
    }

    // por último: resumo dos pagamentos parciais (cedentes do Abertos — Geral)
    try {
      const t = await this.textoParciais();
      if (t) acoes.push({ kind: 'text', label: 'titulos_parciais', text: t });
    } catch (e) {
      this.logger.warn(`PARCIAIS (sequência): falhou ao montar mensagem: ${(e as Error).message}`);
    }

    // envia para cada número, na ordem
    const passos: { passo: string; ok: boolean; erro?: string }[] = [];
    for (const numero of nums) {
      for (const a of acoes) {
        const r = a.kind === 'text'
          ? await this.whatsapp.sendText(numero, a.text)
          : await this.whatsapp.sendMedia(numero, a.base64, a.fileName);
        passos.push({ passo: nums.length > 1 ? `${numero} · ${a.label}` : a.label, ok: r.ok, erro: r.erro });
      }
    }
    return { ok: passos.every((p) => p.ok) && faltando.length === 0, passos, faltando };
  }

  async gerarTexto(id: string): Promise<{ id: string; texto: string }> {
    const card = RELATORIOS.find((r) => r.id === id);
    if (!card) throw new BadRequestException(`Relatório desconhecido: ${id}`);
    if (!card.pronto || card.formato !== 'TEXTO') {
      throw new BadRequestException(`Relatório "${card.label}" ainda não está disponível.`);
    }
    if (id === 'comissarias_em_atraso') return { id, texto: await this.comissariasEmAtraso() };
    if (id === 'comissarias_sem_atraso') return { id, texto: await this.comissariasSemAtraso() };
    throw new BadRequestException(`Geração não implementada para ${id}`);
  }

  // ===================== Aging da carteira =====================

  /** Aging dos títulos EM ABERTO vencidos, por faixa de dias de atraso.
   *  Soma valor de face e total (com encargos). Base: data_core.vw_titulos_abertos. */
  async aging(): Promise<{
    posicao: string;
    faixas: { faixa: string; qtd: number; face: number; total: number }[];
    totais: { qtd: number; face: number; total: number };
  }> {
    const rows = await this.db.query<{ faixa: string; qtd: number; face: number; total: number }>(`
      WITH t AS (
        SELECT DATEDIFF(DAY, VENCIMENTO, CAST(GETDATE() AS DATE)) AS dias,
               CAST(VALOR AS float) AS valor, CAST(TOTAL AS float) AS total
        FROM data_core.vw_titulos_abertos
        WHERE VENCIMENTO < CAST(GETDATE() AS DATE)
      )
      SELECT faixa, COUNT(*) AS qtd, SUM(valor) AS face, SUM(total) AS total FROM (
        SELECT CASE
          WHEN dias BETWEEN 1 AND 30 THEN '1 a 30 dias'
          WHEN dias BETWEEN 31 AND 60 THEN '31 a 60 dias'
          WHEN dias BETWEEN 61 AND 90 THEN '61 a 90 dias'
          WHEN dias BETWEEN 91 AND 180 THEN '91 a 180 dias'
          ELSE '+180 dias' END AS faixa, valor, total
        FROM t
      ) b GROUP BY faixa`);

    const ordem = ['1 a 30 dias', '31 a 60 dias', '61 a 90 dias', '91 a 180 dias', '+180 dias'];
    const idx = new Map(rows.map((r) => [r.faixa, r]));
    const faixas = ordem.map((f) => {
      const r = idx.get(f);
      return { faixa: f, qtd: Number(r?.qtd ?? 0), face: Number(r?.face ?? 0), total: Number(r?.total ?? 0) };
    });
    const totais = faixas.reduce((a, f) => ({ qtd: a.qtd + f.qtd, face: a.face + f.face, total: a.total + f.total }), { qtd: 0, face: 0, total: 0 });
    return { posicao: fmtIso(hojeLocal()), faixas, totais };
  }

  /** Recebimentos (liquidado) por mês — últimos 12 meses. Base: vw_titulos_quitados. */
  async recebimentos(): Promise<{ meses: { mes: string; liquidado: number; qtd: number }[] }> {
    const rows = await this.db.query<{ mes: string; liquidado: number; qtd: number }>(`
      SELECT FORMAT(QUITACAO,'yyyy-MM') AS mes, SUM(CAST(LIQUIDADO AS float)) AS liquidado, COUNT(*) AS qtd
      FROM data_core.vw_titulos_quitados
      WHERE QUITACAO >= DATEADD(MONTH, -11, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
      GROUP BY FORMAT(QUITACAO,'yyyy-MM')
      ORDER BY mes`);
    return { meses: rows.map((r) => ({ mes: r.mes, liquidado: Number(r.liquidado ?? 0), qtd: Number(r.qtd ?? 0) })) };
  }

  /** Exposição em aberto por UF do cedente. Base: vw_titulos_abertos × vw_cedentes. */
  async exposicaoUf(): Promise<{ ufs: { uf: string; valor: number; qtd: number }[]; total: number }> {
    const digitos = (c: string) => `REPLACE(REPLACE(REPLACE(REPLACE(${c},'.',''),'/',''),'-',''),' ','')`;
    const rows = await this.db.query<{ uf: string; valor: number; qtd: number }>(`
      WITH ced AS (
        SELECT ${digitos('CPF_CNPJ')} AS doc, MAX(UF) AS UF
        FROM data_core.vw_cedentes GROUP BY ${digitos('CPF_CNPJ')}
      )
      SELECT ISNULL(ced.UF,'?') AS uf, SUM(CAST(t.VALOR AS float)) AS valor, COUNT(*) AS qtd
      FROM data_core.vw_titulos_abertos t
      LEFT JOIN ced ON ced.doc = ${digitos('t.CPF_CNPJ_CEDENTE')}
      GROUP BY ISNULL(ced.UF,'?')
      ORDER BY valor DESC`);
    const ufs = rows.map((r) => ({ uf: String(r.uf || '?'), valor: Number(r.valor ?? 0), qtd: Number(r.qtd ?? 0) }));
    return { ufs, total: ufs.reduce((a, u) => a + u.valor, 0) };
  }

  // ===================== Relatórios PNG (Power BI via Playwright) =====================

  private readonly pngState = new Map<string, PngState>();
  private store_?: RelatorioStore;
  // cedentes do último print do Abertos — Geral (p/ a msg de parciais na sequência).
  // Em memória porque no Docker o worker gera os PNGs sem filesystem compartilhado.
  private cedentesAbertosGeral: string[] | null = null;
  // Execução PARALELA com teto de concorrência. Os filtros do BI são por sessão/
  // contexto (cada captura abre seu próprio navegador isolado — validado), então
  // rodar em paralelo é seguro; o teto só evita sobrecarregar a máquina.
  private readonly maxConc = Math.max(1, Number(process.env.REL_MAX_CONCURRENT) || 4);
  private rodando = 0;
  private readonly pendentes: Array<() => Promise<void>> = [];

  /** Raiz do repositório (…/AXCob) — o backend roda em …/AXCob/backend. */
  private repoRoot(): string {
    // dist/relatorios → ../../.. = raiz; em dev (ts) cai pra ../../.. também via cwd.
    const guess = path.resolve(__dirname, '..', '..', '..');
    if (fs.existsSync(path.join(guess, 'scripts'))) return guess;
    return path.resolve(process.cwd(), '..'); // fallback: cwd = backend/
  }
  private scriptsDir(): string {
    return path.join(this.repoRoot(), 'scripts');
  }
  /** Store dos PNGs no SQL Server (schema axcob), lazy. */
  private store(): RelatorioStore {
    if (!this.store_) this.store_ = new RelatorioStore(this.db);
    return this.store_;
  }
  /** Dia corrente (local) yyyy-mm-dd — chave do "somente do dia". */
  private hoje(): string {
    return fmtIso(hojeLocal());
  }

  /** Dispara a geração do PNG (assíncrona, ENFILEIRADA). Idempotente enquanto "gerando". */
  iniciarPng(id: string): PngState {
    const card = RELATORIOS.find((r) => r.id === id);
    if (!card) throw new BadRequestException(`Relatório desconhecido: ${id}`);
    const job = PNG_JOBS[id];
    if (!card.pronto || card.formato !== 'PNG' || !job) {
      throw new BadRequestException(`Relatório "${card.label}" não é um PNG gerável.`);
    }
    const atual = this.pngState.get(id);
    if (atual?.status === 'gerando') return atual; // já na fila/rodando

    const estado: PngState = { status: 'gerando', imagens: [] };
    this.pngState.set(id, estado);
    // agenda — roda em paralelo até o teto (maxConc); excedente espera vaga
    this.agenda(() => this.runPng(id, job));
    return estado;
  }

  /** Pool de concorrência: enfileira e dispara respeitando o teto. */
  private agenda(task: () => Promise<void>): void {
    this.pendentes.push(task);
    this.bombear();
  }
  private bombear(): void {
    while (this.rodando < this.maxConc && this.pendentes.length > 0) {
      const task = this.pendentes.shift()!;
      this.rodando++;
      task().catch(() => undefined).finally(() => { this.rodando--; this.bombear(); });
    }
  }

  /** Roda UM relatório e atualiza o estado/SQLite. Resolve ao terminar.
   *  Com REPORT_WORKER_URL setado (Docker), delega ao container worker via HTTP;
   *  senão, executa o script Python localmente (dev na máquina). */
  private runPng(id: string, job: { script: string; args: string[]; outBase: string }): Promise<void> {
    const workerUrl = process.env.REPORT_WORKER_URL?.trim();
    return workerUrl ? this.runPngViaWorker(id, job, workerUrl) : this.runPngLocal(id, job);
  }

  /** Persiste os PNGs gerados (buffers) no SQL Server e marca o estado como pronto. */
  private async salvarResultado(id: string, buffers: Buffer[]): Promise<void> {
    const dia = this.hoje();
    const at = await this.store().salvar(id, dia, buffers);
    const imagens = buffers.map((_b, i) => String(i + 1));
    this.pngState.set(id, { status: 'pronto', imagens, at });
    this.logger.log(`PNG ${id} pronto: ${imagens.length} parte(s) no banco (dia ${dia})`);
  }

  /** Gera o PNG chamando o worker (Playwright) por HTTP; recebe as partes em base64. */
  private async runPngViaWorker(
    id: string,
    job: { script: string; args: string[]; outBase: string },
    workerUrl: string,
  ): Promise<void> {
    this.logger.log(`gerando PNG ${id} via worker: ${job.script} ${job.args.join(' ')}`);
    const timeoutMs = Number(process.env.REPORT_WORKER_TIMEOUT_MS) || 300_000;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${workerUrl.replace(/\/$/, '')}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: job.script, args: job.args, outBase: job.outBase }),
        signal: ctrl.signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean; images?: string[]; stderr?: string; error?: string; code?: number; cedentes?: string[];
      };
      if (!res.ok || !data.ok || !data.images?.length) {
        const motivo = data.error || (data.images && !data.images.length ? 'sem imagens' : `código ${data.code ?? res.status}`);
        this.logger.error(`PNG ${id} (worker) falhou: ${motivo} ${(data.stderr ?? '').slice(-500)}`);
        this.pngState.set(id, { status: 'erro', imagens: [], erro: `falha na geração (${motivo})` });
        return;
      }
      // cedentes do --dump-cedentes voltam na resposta (sem filesystem compartilhado)
      const cedentes = (data.cedentes ?? []).map((c) => String(c).trim()).filter(Boolean);
      this.logarCedentes(id, cedentes);
      if (id === 'titulos_abertos_geral' && cedentes.length) {
        this.cedentesAbertosGeral = cedentes;
        void this.analisarParciais(id, job.outBase, cedentes);
      }
      await this.salvarResultado(id, data.images.map((b64) => Buffer.from(b64, 'base64')));
    } catch (err) {
      const msg = (err as Error)?.name === 'AbortError' ? `timeout (${timeoutMs}ms)` : (err as Error)?.message ?? String(err);
      this.logger.error(`PNG ${id} (worker) erro: ${msg}`);
      this.pngState.set(id, { status: 'erro', imagens: [], erro: msg });
    } finally {
      clearTimeout(t);
    }
  }

  /** Extrai a lista de cedentes do stdout do script (bloco do --dump-cedentes). */
  private extrairCedentes(stdout: string): string[] {
    if (!stdout) return [];
    const linhas = stdout.split(/\r?\n/);
    const ini = linhas.findIndex((l) => /=+\s*CEDENTES\s*\(/i.test(l));
    if (ini < 0) return [];
    const nomes: string[] = [];
    for (let i = ini + 1; i < linhas.length; i++) {
      if (/^\s*=+\s*$/.test(linhas[i])) break; // linha de "====" fecha o bloco
      const m = linhas[i].match(/^\s*\d+\.\s+(.*\S)\s*$/);
      if (m) nomes.push(m[1]);
    }
    return nomes;
  }

  /** Se o script rodou com --dump-cedentes, loga a lista extraída do stdout. */
  private logarCedentes(id: string, nomes: string[]): void {
    if (nomes.length) {
      this.logger.log(`CEDENTES ${id} (${nomes.length}): ${nomes.join(' | ')}`);
    }
  }

  /** Pagamento PARCIAL: título vencido (vw_titulos_abertos) dos cedentes do
   *  relatório que TAMBÉM tem registro em vw_titulos_quitados (parte já paga).
   *  Mesma manha do kanban (quitado_parcial), no sentido inverso. Saída: log +
   *  scripts/<outBase>.parciais.txt. Nunca derruba a geração do PNG. */
  // Tipos de título considerados na análise de pagamento parcial (whitelist).
  private static readonly TIPOS_PARCIAL = "'CCB','CTR','DMR','DSR','NCO','NPP','CPR'";

  /** Cruza vencidos × quitados dos cedentes e devolve o resumo por cedente
   *  (vencido, quitado parcial e qtd de títulos parciais).
   *
   *  Regras (fechadas com a operação em 12/06/2026):
   *  - SÓ títulos com vencimento NO PERÍODO do relatório Geral (último dia útil
   *    + não-úteis órfãos anteriores) — não a carteira vencida histórica;
   *  - SEM filtro de flexibilização: em carência ou não, aparece;
   *  - match por número + CNPJ cedente + CNPJ sacado + sistema + OP;
   *  - recompra/repasse (SITUACAO Recomprado%/Repassado%) NÃO conta como
   *    pagamento — é o cedente cobrindo, não o sacado pagando;
   *  - só conta RECIBO PARCIAL (LIQUIDADO < 99% do VALOR_FACE) — baixa
   *    integral de parcela com o mesmo número não é pagamento parcial.
   *  Doc completa: docs/relatorio-pagamentos-parciais.md */
  private async calcularParciais(cedentes: string[]): Promise<{ cedente: string; vencido: number; quitado: number; qtd: number }[]> {
    if (!cedentes.length) return [];
    const digitos = (c: string) => `REPLACE(REPLACE(REPLACE(REPLACE(${c},'.',''),'/',''),'-',''),' ','')`;
    const tipos = RelatoriosService.TIPOS_PARCIAL;

    // período do relatório Geral: último dia útil + não-úteis órfãos anteriores
    const janela = vencsNoPrazo(hojeLocal());
    const ini = fmtIso(janela[0]);
    const fim = fmtIso(janela[janela.length - 1]);

    // 1) títulos abertos dos cedentes com vencimento NO período, em lotes
    interface Aberto { DOCUMENTO: string; CEDENTE: string; DOC_SACADO: string | null; DOC_CEDENTE: string | null; SISTEMA: string | null; OP: number | string | null; VALOR: number }
    const abertos: Aberto[] = [];
    for (let i = 0; i < cedentes.length; i += 200) {
      const lote = cedentes.slice(i, i + 200).map((n) => n.trim().toUpperCase());
      const params: Record<string, unknown> = { ini, fim };
      const marks = lote.map((n, j) => { params[`c${j}`] = n; return `@c${j}`; });
      abertos.push(...await this.db.query<Aberto>(`
        SELECT DOCUMENTO, CEDENTE, ${digitos('CPF_CNPJ_SACADO')} AS DOC_SACADO,
               ${digitos('CPF_CNPJ_CEDENTE')} AS DOC_CEDENTE, SISTEMA, OP,
               CAST(VALOR AS float) AS VALOR
        FROM data_core.vw_titulos_abertos
        WHERE VENCIMENTO BETWEEN @ini AND @fim
          AND M = 'C'
          AND TIPO IN (${tipos})
          AND UPPER(LTRIM(RTRIM(CEDENTE))) IN (${marks.join(',')})`, params));
    }
    this.logger.log(`PARCIAIS: período ${ini}..${fim} | títulos abertos no período: ${abertos.length}`);
    if (!abertos.length) return [];

    // 3) cruza com quitados (lotes de DOCUMENTO). Match ESTRITO por número +
    //    CNPJ do cedente + CNPJ do sacado + SISTEMA + OP:
    //    - números se repetem entre operações/sacados (falso parcial);
    //    - quitação em OUTRO veículo (FIDC→SEC) é rolagem, não parcial;
    //    - a OP amarra o título à MESMA operação — sem ela, números tipo
    //      CPF/parcela (IPM) casam quitações de safras passadas do mesmo sacado.
    interface Quitado { NUMERO: string; DOC_SACADO: string | null; DOC_CEDENTE: string | null; SISTEMA: string | null; OP: number | string | null; VALOR_FACE: number | null; LIQUIDADO: number | null }
    const op = (v: number | string | null | undefined) => String(v ?? '').replace(/\D/g, '');
    const chave = (numero: string, docCed: string | null | undefined, docSac: string | null | undefined, sistema: string | null | undefined, opVal: number | string | null | undefined) =>
      `${numero}|${docCed ?? ''}|${docSac ?? ''}|${(sistema ?? '').trim().toUpperCase()}|${op(opVal)}`;
    const docs = [...new Set(abertos.map((a) => (a.DOCUMENTO ?? '').trim()).filter(Boolean))];
    // chave → SOMA do LIQUIDADO: o mesmo número pode ter VÁRIAS quitações
    // (parcelas/reapresentações com vencimentos diferentes) — todas contam.
    const quitIdx = new Map<string, number>(); // chave: numero|cnpjCed|cnpjSac|sistema|op
    for (let i = 0; i < docs.length; i += 500) {
      const lote = docs.slice(i, i + 500);
      const params: Record<string, unknown> = {};
      const marks = lote.map((n, j) => { params[`n${j}`] = n; return `@n${j}`; });
      const rows = await this.db.query<Quitado>(`
        SELECT NUMERO, ${digitos('CPF_CNPJ_SACADO')} AS DOC_SACADO,
               ${digitos('CPF_CNPJ_CEDENTE')} AS DOC_CEDENTE, SISTEMA, OP,
               CAST(VALOR_FACE AS float) AS VALOR_FACE, CAST(LIQUIDADO AS float) AS LIQUIDADO
        FROM data_core.vw_titulos_quitados
        WHERE TIPO IN (${tipos})
          AND SITUACAO NOT LIKE 'Recomprado%'
          AND SITUACAO NOT LIKE 'Repassado%'
          AND NUMERO IN (${marks.join(',')})`, params);
      for (const r of rows) {
        const n = (r.NUMERO ?? '').trim();
        if (!n || !op(r.OP)) continue; // sem OP não há como amarrar à operação
        // regra do RECIBO PARCIAL: o próprio registro de quitação precisa ser
        // parcial (liquidado < 99% da face). Baixa integral = outra parcela
        // com o mesmo número, não pagamento parcial do título em aberto.
        const face = Number(r.VALOR_FACE) || 0;
        const liq = Number(r.LIQUIDADO) || 0;
        if (!(face > 0 && liq < face * 0.99)) continue;
        const k = chave(n, r.DOC_CEDENTE, r.DOC_SACADO, r.SISTEMA, r.OP);
        quitIdx.set(k, (quitIdx.get(k) ?? 0) + liq);
      }
    }

    // 3) agrega por cedente: TOTAL VENCIDO = soma da face em aberto; TOTAL
    //    QUITADO = soma do LIQUIDADO dos títulos com match (dedupe por chave —
    //    várias linhas em aberto não podem contar o mesmo liquidado 2x).
    const porCed = new Map<string, { vencido: number; quitado: number; chavesQuit: Set<string> }>();
    for (const a of abertos) {
      const ced = (a.CEDENTE ?? '').trim();
      const agg = porCed.get(ced) ?? { vencido: 0, quitado: 0, chavesQuit: new Set<string>() };
      agg.vencido += Number(a.VALOR) || 0;
      const k = chave((a.DOCUMENTO ?? '').trim(), a.DOC_CEDENTE, a.DOC_SACADO, a.SISTEMA, a.OP);
      if (quitIdx.has(k) && !agg.chavesQuit.has(k)) {
        agg.chavesQuit.add(k);
        agg.quitado += quitIdx.get(k) ?? 0;
      }
      porCed.set(ced, agg);
    }
    return [...porCed.entries()]
      .filter(([, v]) => v.quitado > 0)
      .sort((x, y) => y[1].vencido - x[1].vencido)
      .map(([cedente, v]) => ({ cedente, vencido: v.vencido, quitado: v.quitado, qtd: v.chavesQuit.size }));
  }

  private async analisarParciais(id: string, outBase: string, cedentes: string[]): Promise<void> {
    try {
      const parciais = await this.calcularParciais(cedentes);
      if (!parciais.length) {
        this.logger.log(`PARCIAIS ${id}: nenhum pagamento parcial detectado`);
        return;
      }
      const linhas = parciais.map((p) =>
        `${p.cedente} - TOTAL VENCIDO: ${this.fmtBRL(p.vencido)} - TOTAL QUITADO: ${this.fmtBRL(p.quitado)} - ${p.qtd} título(s)`);
      this.logger.log(`PARCIAIS ${id} (${parciais.length} cedente(s)):\n${linhas.join('\n')}`);
      try {
        const txt = path.join(this.scriptsDir(), `${outBase}.parciais.txt`);
        fs.writeFileSync(txt, linhas.join('\n'), 'utf8');
        this.logger.log(`PARCIAIS ${id}: detalhes salvos em ${txt}`);
      } catch (e) {
        this.logger.warn(`PARCIAIS ${id}: falha ao salvar txt: ${(e as Error).message}`);
      }
    } catch (e) {
      this.logger.warn(`PARCIAIS ${id}: análise falhou: ${(e as Error).message}`);
    }
  }

  /** Mensagem "Títulos Pagos Parcialmente" p/ o envio em sequência. Usa os
   *  cedentes do ÚLTIMO print do Títulos Abertos — Geral: do cache em memória
   *  (Docker/worker) ou do print_abertos.cedentes.txt (dev local, sobrevive a
   *  restart). Null se não houver lista. */
  private async textoParciais(): Promise<string | null> {
    let cedentes = this.cedentesAbertosGeral ?? [];
    if (!cedentes.length) {
      const arq = path.join(this.scriptsDir(), 'print_abertos.cedentes.txt');
      if (fs.existsSync(arq)) {
        cedentes = fs.readFileSync(arq, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      }
    }
    if (!cedentes.length) {
      this.logger.warn('PARCIAIS (sequência): sem lista de cedentes — gere o Títulos Abertos Geral antes');
      return null;
    }
    const parciais = await this.calcularParciais(cedentes);
    // formato fechado em 12/06/2026: sem cabeçalho, uma linha por cedente,
    // frase fixa. Sem nenhum parcial → não envia nada (retorna null).
    if (!parciais.length) return null;
    return parciais
      .map((p) => `*${p.cedente}* - Já estava na cobrança, houve abatimento parcial.`)
      .join('\n');
  }

  /** Gera o PNG executando o script Python localmente (fallback p/ dev). */
  private runPngLocal(id: string, job: { script: string; args: string[]; outBase: string }): Promise<void> {
    return new Promise<void>((resolve) => {
      const scriptPath = path.join(this.scriptsDir(), job.script);
      const py = process.env.PYTHON_BIN || 'python';
      this.logger.log(`gerando PNG ${id}: ${py} ${scriptPath}`);
      const proc = spawn(py, ['-u', scriptPath, ...job.args], {
        cwd: this.repoRoot(),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
      });
      let stderr = '';
      let stdout = '';
      proc.stderr?.on('data', (d) => { stderr += d.toString(); });
      proc.stdout?.on('data', (d) => { stdout += d.toString(); });
      proc.on('error', (err) => {
        this.logger.error(`PNG ${id} falhou ao iniciar: ${err.message}`);
        this.pngState.set(id, { status: 'erro', imagens: [], erro: err.message });
        resolve();
      });
      proc.on('close', async (code) => {
        const cedentes = this.extrairCedentes(stdout); // do --dump-cedentes (se houver)
        this.logarCedentes(id, cedentes);
        if (code === 0 && id === 'titulos_abertos_geral' && cedentes.length) {
          this.cedentesAbertosGeral = cedentes;
          // análise de pagamento parcial (fire-and-forget; não atrasa o salvar do PNG)
          void this.analisarParciais(id, job.outBase, cedentes);
        }
        if (code === 0) {
          // descobre as partes geradas: <outBase>_<N>.png (nº de partes é adaptativo)
          const re = new RegExp(`^${job.outBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)\\.png$`);
          const arquivos = fs.readdirSync(this.scriptsDir())
            .map((f) => { const m = f.match(re); return m ? { f, n: Number(m[1]) } : null; })
            .filter((x): x is { f: string; n: number } => !!x)
            .sort((a, b) => a.n - b.n)
            .map((x) => path.join(this.scriptsDir(), x.f));
          if (arquivos.length) {
            // guarda no banco (só do dia; substitui o anterior) e remove os arquivos
            const buffers = arquivos.map((p) => fs.readFileSync(p));
            for (const p of arquivos) { try { fs.unlinkSync(p); } catch { /* ignora */ } }
            try {
              await this.salvarResultado(id, buffers);
            } catch (e) {
              this.logger.error(`PNG ${id} falhou ao salvar no banco: ${(e as Error).message}`);
              this.pngState.set(id, { status: 'erro', imagens: [], erro: 'falha ao salvar no banco' });
            }
          } else {
            this.pngState.set(id, { status: 'erro', imagens: [], erro: 'script terminou sem gerar imagens' });
          }
        } else {
          this.logger.error(`PNG ${id} exit ${code}: ${stderr.slice(-500)}`);
          this.pngState.set(id, { status: 'erro', imagens: [], erro: `falha na geração (código ${code})` });
        }
        resolve();
      });
    });
  }

  async statusPng(id: string): Promise<PngState> {
    const mem = this.pngState.get(id);
    if (mem?.status === 'gerando') return mem;
    // reflete o banco (sobrevive a restart; só conta o dia corrente)
    const dia = this.hoje();
    const n = await this.store().partes(id, dia);
    if (n > 0) {
      return { status: 'pronto', imagens: Array.from({ length: n }, (_v, i) => String(i + 1)), at: (await this.store().geradoEm(id, dia)) ?? undefined };
    }
    return mem ?? { status: 'idle', imagens: [] };
  }

  /** PNG (Buffer) de uma parte de um relatório, lido do banco. */
  async imagemBlob(id: string, parte: number): Promise<Buffer> {
    if (!/^[a-z0-9_]+$/.test(id)) throw new BadRequestException('id inválido');
    if (!Number.isInteger(parte) || parte < 1) throw new BadRequestException('parte inválida');
    const buf = await this.store().ler(id, parte);
    if (!buf) throw new NotFoundException('imagem não encontrada');
    return buf;
  }

  // ---------- consultas ----------

  private mapRows(rows: TituloRow[]): Titulo[] {
    return rows.map((r) => ({
      cedente: r.CEDENTE ?? '',
      vencimento: r.VENCIMENTO instanceof Date ? r.VENCIMENTO : new Date(`${r.VENCIMENTO}T00:00:00`),
      diasVencidos: Number(r.DIAS_VENCIDOS ?? 0),
      valor: Number(r.VALOR ?? 0),
      cnpj: String(r.CNPJ ?? '').replace(/\D/g, ''),
    }));
  }

  private readonly SELECT = `
    SELECT t.CEDENTE, t.VENCIMENTO, t.VALOR,
      REPLACE(REPLACE(REPLACE(REPLACE(t.CPF_CNPJ_CEDENTE,'.',''),'/',''),'-',''),' ','') AS CNPJ,
      DATEDIFF(DAY, t.VENCIMENTO, CAST(GETDATE() AS DATE)) AS DIAS_VENCIDOS
    FROM data_core.vw_titulos_abertos_espelho_bi AS t
    WHERE t.CR IN ('C','CE') AND t.M = 'C'`;

  private async fetchEmAtraso(): Promise<Titulo[]> {
    const fim = fmtIso(ultimoDiaUtil(hojeLocal()));
    const rows = await this.db.query<TituloRow>(
      `${this.SELECT} AND t.VENCIMENTO BETWEEN @ini AND @fim ORDER BY t.CEDENTE, t.VENCIMENTO`,
      { ini: DATA_INICIAL, fim },
    );
    return this.mapRows(rows);
  }

  private async fetchSemAtraso(): Promise<Titulo[]> {
    const datas = vencsNoPrazo(hojeLocal()).map(fmtIso);
    const params: Record<string, unknown> = {};
    const ph = datas.map((d, i) => { params[`d${i}`] = d; return `@d${i}`; }).join(', ');
    const rows = await this.db.query<TituloRow>(
      `${this.SELECT} AND t.VENCIMENTO IN (${ph}) ORDER BY t.CEDENTE, t.VENCIMENTO`,
      params,
    );
    return this.mapRows(rows);
  }

  // ---------- flexibilização (carência) por CNPJ ----------

  /**
   * Flexibilização (dias de carência) por CNPJ, lida da coluna OFICIAL
   * `encargos.juros_multa.flexibilizacao_dias` (preenchida no cadastro).
   * Substitui a antiga interpretação por IA: 100% determinístico.
   * - casa por CNPJ (só dígitos);
   * - agrega por cedente (MAX entre as plataformas ativas);
   * - valor nulo / cedente sem registro → 0 (sem flexibilização).
   */
  private async buscarFlexibilizacoes(): Promise<Map<string, number>> {
    const rows = await this.db.query<{ CNPJ: string | null; DIAS: number | null }>(`
      SELECT REPLACE(REPLACE(REPLACE(REPLACE(c.cnpj,'.',''),'/',''),'-',''),' ','') AS CNPJ,
             MAX(jm.flexibilizacao_dias) AS DIAS
      FROM encargos.cedente c
      JOIN encargos.juros_multa jm ON jm.cedente_id = c.id
      WHERE jm.is_ativo = 1
      GROUP BY c.cnpj`);
    const out = new Map<string, number>();
    for (const r of rows) {
      const cnpj = String(r.CNPJ ?? '').replace(/\D/g, '');
      if (!cnpj) continue;
      const dias = Number(r.DIAS ?? 0);
      out.set(cnpj, Number.isFinite(dias) ? Math.max(0, Math.trunc(dias)) : 0);
    }
    return out;
  }

  // ---------- formatação ----------

  private fmtBRL(v: number): string {
    const s = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // 1,845,621.74
    return 'R$' + s.replace(/,/g, 'X').replace(/\./g, ',').replace(/X/g, '.');
  }
  private fmtDias(dmin: number, dmax: number): string {
    if (dmin === dmax) return dmin === 1 ? '(1 dia)' : `(${dmin} dias)`;
    return `(${dmin} a ${dmax} dias)`;
  }
  private limpaNome(c: string): string {
    return c.replace(/\s+(?:LTDA|S\.?\s*A\.?|S\/?A|EIRELI|ME|EPP|MEI)\.?$/i, '').replace(/[ .,]+$/, '');
  }

  // ---------- cards ----------

  private async comissariasEmAtraso(): Promise<string> {
    const titulos = await this.fetchEmAtraso();
    if (titulos.length === 0) return '*🚨🚨TODAS COMISSARIAS EM ATRASO:*\n\n(nenhum título em atraso)';

    const flex = await this.buscarFlexibilizacoes();

    const hoje = hojeEfetivo();
    const agreg = new Map<string, { valor: number; dmin: number; dmax: number }>();
    for (const t of titulos) {
      const d = deadline(t.vencimento, flex.get(t.cnpj) ?? 0);
      if (hoje.getTime() <= d.getTime()) continue;
      const a = agreg.get(t.cedente) ?? { valor: 0, dmin: 1e9, dmax: -1 };
      a.valor += t.valor; a.dmin = Math.min(a.dmin, t.diasVencidos); a.dmax = Math.max(a.dmax, t.diasVencidos);
      agreg.set(t.cedente, a);
    }
    if (agreg.size === 0) return '*🚨🚨TODAS COMISSARIAS EM ATRASO:*\n\n(nenhum cedente em atraso após aplicar flexibilização)';

    const linhas = ['*🚨🚨TODAS COMISSARIAS EM ATRASO:*', ''];
    for (const [ced, a] of [...agreg].sort((x, y) => y[1].valor - x[1].valor)) {
      linhas.push(`* ${ced} - ${this.fmtBRL(a.valor)} ${this.fmtDias(a.dmin, a.dmax)}`);
      linhas.push('');
    }
    return linhas.join('\n').replace(/\s+$/, '') + '\n';
  }

  private async comissariasSemAtraso(): Promise<string> {
    const HEADER = '⚠️Comissarias que NÃO estão em atraso, cedente possui D+1 para efetuar o repasse:';
    const titulos = await this.fetchSemAtraso();
    if (titulos.length === 0) return `${HEADER}\n\n(nenhum título)`;

    const flex = await this.buscarFlexibilizacoes();

    const hoje = hojeEfetivo();
    const agreg = new Map<string, { valor: number }>();
    for (const t of titulos) {
      const carencia = flex.get(t.cnpj) ?? 0;
      if (carencia <= 0) continue;
      const d = deadline(t.vencimento, carencia);
      if (hoje.getTime() > d.getTime()) continue;
      const a = agreg.get(t.cedente) ?? { valor: 0 };
      a.valor += t.valor;
      agreg.set(t.cedente, a);
    }
    if (agreg.size === 0) return `${HEADER}\n\n(nenhum cedente no prazo de flex hoje)`;

    const linhas = [HEADER, ''];
    for (const [ced, a] of [...agreg].sort((x, y) => y[1].valor - x[1].valor)) {
      linhas.push(`* ${this.limpaNome(ced)} - ${this.fmtBRL(a.valor)}`);
    }
    return linhas.join('\n') + '\n';
  }
}
