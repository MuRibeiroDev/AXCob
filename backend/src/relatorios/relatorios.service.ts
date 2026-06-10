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
    script: 'powerbi_quitados.py', args: [], outBase: 'print_quitados',
  },
  titulos_quitados_agro: {
    script: 'powerbi_quitados.py',
    args: ['--categoria', 'AGRO', '--out', 'print_quitados_agro.png'],
    outBase: 'print_quitados_agro',
  },
  titulos_quitados_industria: {
    script: 'powerbi_quitados.py',
    args: ['--categoria', 'INDUSTRIA', '--out', 'print_quitados_industria.png'],
    outBase: 'print_quitados_industria',
  },
  titulos_quitados_estruturada: {
    script: 'powerbi_quitados.py',
    args: ['--categoria', 'ESTRUTURADA', '--out', 'print_quitados_estruturada.png'],
    outBase: 'print_quitados_estruturada',
  },
  titulos_abertos_geral: {
    script: 'powerbi_abertos.py', args: [], outBase: 'print_abertos',
  },
  titulos_abertos_agro: {
    script: 'powerbi_abertos.py',
    args: ['--categoria', 'AGRO', '--out', 'print_abertos_agro.png'],
    outBase: 'print_abertos_agro',
  },
  titulos_abertos_industria: {
    script: 'powerbi_abertos.py',
    args: ['--categoria', 'INDUSTRIA', '--out', 'print_abertos_industria.png'],
    outBase: 'print_abertos_industria',
  },
  titulos_abertos_estruturada: {
    script: 'powerbi_abertos.py',
    args: ['--categoria', 'ESTRUTURADA', '--out', 'print_abertos_estruturada.png'],
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
        ok?: boolean; images?: string[]; stderr?: string; error?: string; code?: number;
      };
      if (!res.ok || !data.ok || !data.images?.length) {
        const motivo = data.error || (data.images && !data.images.length ? 'sem imagens' : `código ${data.code ?? res.status}`);
        this.logger.error(`PNG ${id} (worker) falhou: ${motivo} ${(data.stderr ?? '').slice(-500)}`);
        this.pngState.set(id, { status: 'erro', imagens: [], erro: `falha na geração (${motivo})` });
        return;
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
      proc.stderr?.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', (err) => {
        this.logger.error(`PNG ${id} falhou ao iniciar: ${err.message}`);
        this.pngState.set(id, { status: 'erro', imagens: [], erro: err.message });
        resolve();
      });
      proc.on('close', async (code) => {
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
