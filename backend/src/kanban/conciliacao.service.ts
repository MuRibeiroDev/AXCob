import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { PixConciliacaoStore, type ConciliacaoSalva } from './pix-conciliacao-store';

const SEED = 7;

// ---------- tipos ----------
interface TituloRow {
  ID_TITULO: number; DOCUMENTO: string; TIPO: string | null;
  CPF_CNPJ_SACADO: string | null; SACADO: string | null;
  CPF_CNPJ_CEDENTE: string | null; CEDENTE: string | null;
  DATA_EMISSAO: Date | null; VENCIMENTO: Date | null; SITUACAO: string | null;
  VALOR: number | null; MULTA: number | null; JUROS: number | null;
  TARIFAS: number | null; TOTAL: number | null; SISTEMA: string | null;
}
export interface PixInput { plataforma: string; sistema: string | null; valor: number | null; nome: string; doc: string | null; }
export interface SugestaoTitulo {
  documento: string; sacado: string | null; cedente: string | null;
  valor: number | null; total: number | null; vencimento: string | null; sistema: string | null;
}
export interface Sugestao {
  titulos: SugestaoTitulo[]; tipo_match: string; pagador: string;
  confianca: string; score: number | null; justificativa: string; cobrador: string | null;
}
export interface ConciliacaoResultado {
  pix: PixInput; total_titulos: number; relevantes: number;
  sugestoes: Sugestao[]; resumo: string;
  criado_em?: string; cacheado?: boolean;
}

// ---------- títulos relacionados (explorar por nome) ----------
export interface TituloRel {
  documento: string; tipo: string | null; sistema: string | null; situacao: string | null;
  sacado: string | null; cpf_cnpj_sacado: string | null;
  cedente: string | null; cpf_cnpj_cedente: string | null;
  vencimento: string | null; valor: number | null; total: number | null;
}
export interface GrupoSacado {
  sacado: string | null; cpf_cnpj_sacado: string | null;
  cedente: string | null; cpf_cnpj_cedente: string | null;
  sim: number; qtd: number; totalValor: number; totalTotal: number;
  titulos: TituloRel[];
}
export interface LadoRel {
  grupos: GrupoSacado[]; qtdSacados: number; qtdTitulos: number;
  totalValor: number; totalTotal: number;
}
export interface TitulosRelacionados {
  nome: string; comoSacado: LadoRel; comoCedente: LadoRel;
  truncado: boolean; modo: 'heuristica' | 'ia';
}

// ---------- helpers de texto/valor ----------
const STOP = new Set([
  'LTDA', 'LTD', 'SA', 'S', 'A', 'ME', 'MEI', 'EPP', 'EIRELI', 'EI', 'CIA',
  'COMERCIO', 'COM', 'IND', 'INDUSTRIA', 'INDL', 'SERVICOS', 'SERV', 'E',
  'DE', 'DA', 'DO', 'DAS', 'DOS', 'SACADO', 'CEDENTE', 'JR', 'JUNIOR',
]);
function norm(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const tokens = (s: unknown) => norm(s).split(' ').filter((t) => t.length >= 2);
const tokensSignif = (s: unknown) => tokens(s).filter((t) => !STOP.has(t) && t.length >= 3);
// como tokensSignif, mas MANTÉM tokens curtos (>=2) tipo "PX"/"JM" — costumam ser o
// termo DISTINTIVO da razão social — descartando só os stopwords. Usado na exploração
// por nome (títulos relacionados), onde o idf neutraliza os termos genéricos.
const tokensRel = (s: unknown) => tokens(s).filter((t) => !STOP.has(t));
const soDigitos = (s: unknown) => String(s ?? '').replace(/\D+/g, '');
function chaveDoc(s: unknown): string { const d = soDigitos(s); return d.length >= 14 ? d.slice(0, 8) : d; }
function simNome(pixToks: string[], alvo: unknown): number {
  if (!pixToks.length) return 0;
  const setAlvo = new Set(tokensSignif(alvo));
  if (!setAlvo.size) return 0;
  let hit = 0;
  for (const t of pixToks) if (setAlvo.has(t)) hit++;
  return hit / pixToks.length;
}
function parseValorBR(s: string | null | undefined): number | null {
  if (s == null) return null;
  let t = String(s).replace(/[^0-9.,]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}
function parseCard(titulo: string): { plataforma: string; valor: number | null; nome: string } {
  const m = titulo.match(/^\s*(.*?):\s*R\$?\s*([\d.,]+)\s*-\s*(.+?)\s*$/i);
  if (m) return { plataforma: m[1].trim(), valor: parseValorBR(m[2]), nome: m[3].trim() };
  const mv = titulo.match(/R\$?\s*([\d.,]+)/i);
  const valor = mv ? parseValorBR(mv[1]) : null;
  const nome = titulo.replace(/^.*?:/, '').replace(/R\$?\s*[\d.,]+/i, '').replace(/[-–]/g, ' ').trim();
  return { plataforma: titulo.includes(':') ? titulo.split(':')[0].trim() : '', valor, nome };
}
function mapSistema(plataforma: string): string | null {
  const p = norm(plataforma);
  if (/SECUR/.test(p)) return 'Securitizadora';
  if (/AGRO/.test(p)) return 'FIDC Agro';
  if (/FIDC/.test(p)) return 'FIDC';
  return null;
}

// subset-sum (2..max) sobre VALOR e TOTAL dentro de um grupo de pagador
interface Combo { titulos: string[]; campo: string; soma: number; dif: number; vals: number[]; vencs: (string | null)[]; alternativas_equivalentes?: number; }
function combinar(grupo: TituloRow[], alvo: number, tol: number, max = 5, limite = 20): Combo[] {
  if (grupo.length < 2 || grupo.length > limite) return [];
  const combos: Combo[] = [];
  const idx = grupo.map((_, i) => i);
  function rec(start: number, escolhidos: number[]): void {
    if (escolhidos.length >= 2) {
      for (const campo of ['VALOR', 'TOTAL'] as const) {
        const soma = escolhidos.reduce((s, i) => s + (Number(grupo[i][campo]) || 0), 0);
        if (Math.abs(soma - alvo) <= tol) {
          combos.push({
            titulos: escolhidos.map((i) => grupo[i].DOCUMENTO),
            campo, soma: +soma.toFixed(2), dif: +(soma - alvo).toFixed(2),
            vals: escolhidos.map((i) => +(Number(grupo[i][campo]) || 0).toFixed(2)),
            vencs: escolhidos.map((i) => (grupo[i].VENCIMENTO ? new Date(grupo[i].VENCIMENTO as Date).toISOString().slice(0, 10) : null)),
          });
        }
      }
    }
    if (escolhidos.length >= max) return;
    for (let i = start; i < idx.length; i++) rec(i + 1, [...escolhidos, idx[i]]);
  }
  rec(0, []);
  return combos;
}

const REGRAS = `Você é um analista de conciliação de recebíveis de um FIDC. Recebe um PIX (valor + nome de quem pagou, às vezes documento e plataforma) e uma lista de TÍTULOS EM ABERTO. Sua tarefa é avaliar a PROBABILIDADE de cada título (ou combinação de títulos) ser o que originou aquele PIX.

REGRA DE NEGÓCIO: o nome do card é SEMPRE o de quem pagou — e quem paga pode ser o CEDENTE (recompra/comissária) OU o SACADO (devedor pagando direto). Por isso compare o nome do PIX com AS DUAS colunas: sacado (sim_sacado) E cedente (sim_cedente). O lado que casar indica quem pagou — defina "pagador" por ele (o de maior similaridade; se o documento bater, ele manda).

PRIORIDADE DE SINAIS (do mais forte ao mais fraco):
1. CPF/CNPJ do pagador batendo com o do sacado/cedente do título → quase determinístico.
2. Valor (ou soma) + nome combinados.
3. Valor sozinho (colide muito).
4. Nome sozinho (homônimos, grafia).

NÃO FAÇA CONTAS. Cada título já vem com sinais pré-calculados — USE-OS, não recalcule:
- "bate_valor"/"bate_total": true SÓ quando o PIX é IGUAL à face/ao total a menos de centavos (match EXATO). Só aqui você pode dizer "bate exatamente".
- "aprox_valor"/"aprox_total": true quando o PIX é PRÓXIMO da face/total mas NÃO igual (diferença de alguns reais). NUNCA diga "exatamente" aqui — diga "valor próximo, com diferença de R$X" e cite "dif_valor"/"dif_total".
- "entre_face_total": true se o PIX fica ENTRE a face e o total do título → pagamento NEGOCIADO (face + parte dos encargos). É um match plausível mesmo sem bater exato. "pct_encargo_pago" diz a fração dos encargos paga.
- "dif_valor"/"dif_total": diferença em R$ (título − PIX); positivo = título maior que o PIX. SEMPRE confira esse número antes de afirmar que "bate" — se não for ~0, NÃO é exato.
- "sim_sacado"/"sim_cedente": 0 a 1, fração do nome do PIX presente no sacado/cedente (1 = nome idêntico). Use o MAIOR dos dois como força do nome, e ele indica quem pagou.
- "doc_bate": true se o documento informado é igual ao do sacado ou cedente.
Combinações de títulos (soma) que batem já vêm em "combinacoes".

A AUSÊNCIA DE DOCUMENTO É O CENÁRIO NORMAL (o financeiro quase nunca informa o CPF/CNPJ). NÃO rebaixe a confiança só porque falta documento — avalie por VALOR + NOME. O documento, quando existe e bate, apenas eleva ao máximo.

SOBRE "combinacoes" (soma de títulos): cada uma já bate no valor do PIX (campo VALOR ou TOTAL). "dif" é o quanto a soma difere do PIX (≈0 = soma EXATA ao centavo — sinal fortíssimo). "alternativas_equivalentes">0 significa que existem OUTROS conjuntos de títulos que somam o mesmo valor: o valor é certo, mas QUAIS títulos exatos é ambíguo — então sugira o conjunto enviado (o de vencimento mais antigo, FIFO) e DEIXE CLARO na justificativa que há N conjuntos equivalentes e que a escolha seguiu o vencimento mais antigo.

REGRAS RÍGIDAS DE ROTULAGEM (não viole) — "sim" abaixo = MAIOR entre sim_sacado e sim_cedente:
- tipo_match "valor_exato" SÓ se bate_valor=true. "valor_total_com_encargos" SÓ se bate_total=true. "soma_titulos" SÓ se vier de "combinacoes". "pagamento_parcial" quando entre_face_total=true (pagou face + parte dos encargos) ou PIX < face. "aproximado" quando só aprox_valor/aprox_total=true (valor perto, não exato).
- confianca "alta": doc_bate=true; OU (bate_valor/bate_total=true [EXATO] E sim>=0.85); OU soma de "combinacoes" com dif≈0 (|dif|<=1) E sim>=0.6. Valor EXATO + nome forte = ALTA, mesmo sem documento.
- confianca "media": (bate_valor/bate_total=true E 0.5<=sim<0.85); OU soma de "combinacoes" com sim>=0.5; OU entre_face_total=true E sim>=0.6; OU aprox_valor/aprox_total=true E sim>=0.85 (valor próximo + nome idêntico).
- confianca "baixa": quando nenhum valor/soma/faixa bate (por mais parecido que seja o nome), ou o nome é fraco (sim<0.5).
- VALOR APENAS APROXIMADO (aprox_*), PAGAMENTO NEGOCIADO (entre_face_total) ou SOMA não-exata, SEM documento, NUNCA é "alta" — é no MÁXIMO "media" (score 55-70): é só uma POSSIBILIDADE, pois o valor não bate exatamente. Só valor EXATO ou documento permitem "alta".
- score coerente com a confiança: alta 80-100, media 55-79, baixa < 55.
- Nome PARECIDO não é nome IGUAL: "JOSE CARLOS BERGAMASCO" ≠ "LUIS CARLOS BERGAMASCHI" (sim<1, sobrenome diferente) → não é alta.

TOM DO PARECER: toda sugestão é uma POSSIBILIDADE, NUNCA uma certeza — sobretudo sem documento e sem valor exato. Use linguagem de probabilidade ("possivelmente", "provável", "pode ser", "indício de"). NÃO afirme categoricamente.
Para PAGAMENTO NEGOCIADO (entre_face_total=true), a justificativa DEVE explicar: que o PIX (R$X) está entre a face (R$valor) e o total com encargos (R$total), ou seja, possivelmente pagou a face + PARTE dos encargos — citando quanto (R$ pago de encargos = PIX − face, de R$ total−face de juros/multa, ~pct_encargo_pago em %). Deixe claro que é uma hipótese a confirmar.

A plataforma do card (SISTEMA) é um reforço, não um critério eliminatório.
"pagador" = o lado (sacado ou cedente) em que o nome casou (maior sim); se o documento bater, ele decide.
NUNCA invente títulos que não estão na lista. Se nada for plausível, devolva "sugestoes": [] e explique em "resumo".

FORMATO DE SAÍDA: JSON puro (sem markdown):
{
  "sugestoes": [
    { "titulos": ["<DOCUMENTO>", ...], "tipo_match": "valor_exato" | "valor_total_com_encargos" | "soma_titulos" | "pagamento_parcial" | "aproximado",
      "pagador": "sacado" | "cedente", "confianca": "alta" | "media" | "baixa", "score": <0-100>, "justificativa": "<curta, citando os números>" }
  ],
  "resumo": "<1-2 frases>"
}
Liste no máximo 5 sugestões, da mais provável para a menos provável.`;

@Injectable()
export class ConciliacaoService {
  private readonly logger = new Logger(ConciliacaoService.name);
  private store_?: PixConciliacaoStore;
  constructor(private readonly db: DatabaseService, private readonly config: ConfigService) {}

  private store(): PixConciliacaoStore {
    if (!this.store_) this.store_ = new PixConciliacaoStore(this.db);
    return this.store_;
  }

  /** Todos os resultados salvos (para a tela carregar de uma vez). */
  salvas(): Promise<ConciliacaoSalva[]> {
    return this.store().todos();
  }

  /** Explora o nome do card na base de títulos em aberto, casando pelo nome contra
   *  AS DUAS colunas (sacado E cedente). Devolve dois lados:
   *  - comoSacado: títulos em que o nome é o SACADO (1 grupo, normalmente);
   *  - comoCedente: títulos em que o nome é o CEDENTE, agrupados por SACADO
   *    (lista os sacados daquele cedente e os títulos de cada um).
   *  Cada título aparece UMA vez (dedup por DOCUMENTO, mantendo o de maior TOTAL).
   *
   *  Por padrão usa heurística PONDERADA POR RARIDADE: termos do nome que aparecem
   *  em muitos candidatos (ex.: "PNEUS") pesam pouco; o que identifica é o termo raro
   *  (ex.: "VISA"). Com `opts.ia`, manda as razões sociais candidatas pro LLM
   *  escolher quais são a MESMA entidade do pagador (robusto a grafia/abreviação). */
  async titulosRelacionados(termo: string, opts: { ia?: boolean } = {}): Promise<TitulosRelacionados> {
    const nome = parseCard(termo).nome || termo.trim();
    const pixToks = [...new Set(tokensRel(nome))];
    const vazio = (): LadoRel => ({ grupos: [], qtdSacados: 0, qtdTitulos: 0, totalValor: 0, totalTotal: 0 });
    const semNada = (modo: 'heuristica' | 'ia'): TitulosRelacionados =>
      ({ nome, comoSacado: vazio(), comoCedente: vazio(), truncado: false, modo });
    if (!pixToks.length) return semNada(opts.ia ? 'ia' : 'heuristica');

    const LIMITE = 2000;
    const bruto = await this.buscarPorNomeAmbos(pixToks, LIMITE);

    // dedup por DOCUMENTO (a view tem 1 linha por encargo) — fica o de maior TOTAL
    const porDoc = new Map<string, TituloRow>();
    for (const r of bruto) {
      const k = String(r.DOCUMENTO);
      const cur = porDoc.get(k);
      if (!cur || (Number(r.TOTAL) || 0) > (Number(cur.TOTAL) || 0)) porDoc.set(k, r);
    }
    const rows = [...porDoc.values()];

    const sac: { r: TituloRow; sim: number }[] = [];
    const ced: { r: TituloRow; sim: number }[] = [];

    if (opts.ia) {
      // ----- modo IA: o LLM seleciona as entidades que são o mesmo pagador -----
      const sel = await this.selecionarEntidadesIA(nome, rows);
      const keySac = (r: TituloRow) => soDigitos(r.CPF_CNPJ_SACADO) || norm(r.SACADO);
      const keyCed = (r: TituloRow) => soDigitos(r.CPF_CNPJ_CEDENTE) || norm(r.CEDENTE);
      for (const r of rows) {
        if (sel.has(keySac(r))) sac.push({ r, sim: 1 });
        if (sel.has(keyCed(r))) ced.push({ r, sim: 1 });
      }
      this.logger.log(`pix relacionados (IA) "${nome}": ${sel.size} entidades, ${sac.length} como sacado, ${ced.length} como cedente`);
    } else {
      // ----- heurística ponderada por raridade (idf) sobre o pool de candidatos -----
      const tokRows = rows.map((r) => ({ r, sac: new Set(tokensRel(r.SACADO)), ced: new Set(tokensRel(r.CEDENTE)) }));
      const N = tokRows.length;
      const df = new Map<string, number>();
      for (const t of pixToks) {
        let c = 0;
        for (const x of tokRows) if (x.sac.has(t) || x.ced.has(t)) c++;
        df.set(t, c);
      }
      // idf suavizado: termo presente em ~todos pesa quase 0; termo raro domina
      const idf = (t: string) => Math.log((N + 1) / ((df.get(t) ?? 0) + 1)) + 0.1;
      const totalIdf = pixToks.reduce((s, t) => s + idf(t), 0) || 1;
      const simW = (toks: Set<string>) => pixToks.reduce((s, t) => s + (toks.has(t) ? idf(t) : 0), 0) / totalIdf;

      const MIN = 0.6; // exige cobrir o(s) termo(s) DISTINTIVO(s) do nome, não só um genérico
      for (const x of tokRows) {
        const sSac = simW(x.sac);
        const sCed = simW(x.ced);
        if (sSac >= MIN && sSac >= sCed) sac.push({ r: x.r, sim: +sSac.toFixed(3) });
        else if (sCed >= MIN && sCed > sSac) ced.push({ r: x.r, sim: +sCed.toFixed(3) });
      }
      this.logger.log(`pix relacionados "${nome}": ${sac.length} como sacado, ${ced.length} como cedente (de ${N} candidatos)`);
    }

    return {
      nome,
      comoSacado: this.agruparPorSacado(sac),
      comoCedente: this.agruparPorSacado(ced),
      truncado: bruto.length >= LIMITE,
      modo: opts.ia ? 'ia' : 'heuristica',
    };
  }

  /** Pergunta ao LLM quais das razões sociais candidatas são A MESMA entidade do
   *  nome do pagador (admite grafia/abreviação; rejeita só-palavras-genéricas).
   *  Devolve o conjunto de chaves (CNPJ/CPF ou nome normalizado) selecionadas. */
  private async selecionarEntidadesIA(nome: string, rows: TituloRow[]): Promise<Set<string>> {
    const apiKey = (this.config.get<string>('OPENAI_API_KEY') ?? '').trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY não configurada no .env');
    const model = (this.config.get<string>('COBRANCA_LLM_MODEL') ?? 'gpt-4o-mini').trim();

    const ents = new Map<string, { key: string; nome: string }>();
    const add = (n: string | null, doc: string | null) => {
      if (!n) return;
      const key = soDigitos(doc) || norm(n);
      if (key && !ents.has(key)) ents.set(key, { key, nome: n });
    };
    for (const r of rows) { add(r.SACADO, r.CPF_CNPJ_SACADO); add(r.CEDENTE, r.CPF_CNPJ_CEDENTE); }
    const lista = [...ents.values()].slice(0, 250);
    if (!lista.length) return new Set();

    const system = `Você recebe o NOME de um pagador (de um PIX) e uma lista de RAZÕES SOCIAIS (empresas/pessoas). Selecione APENAS as que são A MESMA entidade do pagador, admitindo diferenças de grafia, abreviações, sufixos societários (LTDA, ME, EPP, EIRELI, S/A, CIA) e ordem das palavras. NÃO selecione empresas que apenas COMPARTILHAM palavras genéricas do ramo (ex.: "PNEUS", "COMERCIO", "AUTO", "VEICULOS") mas têm núcleo de nome diferente — "PNEUS VISA" é diferente de "RENAP PNEUS" e de "KIRST COMERCIO DE PNEUS". Na dúvida, NÃO selecione. Responda JSON puro: {"ids": [<índices selecionados>]}.`;
    const payload = { nome_pagador: nome, empresas: lista.map((e, i) => ({ id: i, razao: e.nome })) };
    const out = await this.chatJson(apiKey, model, system, payload);
    const ids: unknown[] = Array.isArray(out?.ids) ? out.ids : [];
    const sel = new Set<string>();
    for (const i of ids) { const e = lista[Number(i)]; if (e) sel.add(e.key); }
    return sel;
  }

  /** Chamada genérica ao chat da OpenAI com resposta em JSON. */
  private async chatJson(apiKey: string, model: string, system: string, user: unknown): Promise<any> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, temperature: 0, seed: SEED, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(user) }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    try { return JSON.parse(data?.choices?.[0]?.message?.content ?? '{}'); } catch { return {}; }
  }

  /** Busca em vw_titulos_abertos os títulos cujo SACADO OU CEDENTE contenha algum
   *  dos tokens do nome (até os 4 mais longos, p/ recall sem explodir a query). */
  private async buscarPorNomeAmbos(toks: string[], limite: number): Promise<TituloRow[]> {
    const cols = `ID_TITULO, DOCUMENTO, TIPO, CPF_CNPJ_SACADO, SACADO, CPF_CNPJ_CEDENTE,
      CEDENTE, DATA_EMISSAO, VENCIMENTO, SITUACAO, VALOR, MULTA, JUROS, TARIFAS, TOTAL, SISTEMA`;
    const top = [...toks].sort((a, b) => b.length - a.length).slice(0, 4);
    const params: Record<string, unknown> = {};
    const conds = top.map((tok, i) => {
      params[`t${i}`] = `%${tok}%`;
      return `UPPER(SACADO) LIKE @t${i} OR UPPER(CEDENTE) LIKE @t${i}`;
    });
    const where = conds.map((c) => `(${c})`).join(' OR ');
    return this.db.query<TituloRow>(`SELECT TOP ${limite} ${cols} FROM data_core.vw_titulos_abertos WHERE ${where}`, params);
  }

  /** Agrupa títulos por SACADO (CNPJ/CPF, ou nome quando falta documento). */
  private agruparPorSacado(itens: { r: TituloRow; sim: number }[]): LadoRel {
    const m = new Map<string, GrupoSacado>();
    for (const { r, sim } of itens) {
      const k = soDigitos(r.CPF_CNPJ_SACADO) || norm(r.SACADO) || '?';
      let g = m.get(k);
      if (!g) {
        g = {
          sacado: r.SACADO, cpf_cnpj_sacado: r.CPF_CNPJ_SACADO,
          cedente: r.CEDENTE, cpf_cnpj_cedente: r.CPF_CNPJ_CEDENTE,
          sim, qtd: 0, totalValor: 0, totalTotal: 0, titulos: [],
        };
        m.set(k, g);
      }
      g.sim = Math.max(g.sim, sim);
      g.titulos.push(this.toRel(r));
      g.qtd += 1;
      g.totalValor += Number(r.VALOR) || 0;
      g.totalTotal += Number(r.TOTAL) || 0;
    }
    const grupos = [...m.values()];
    for (const g of grupos) {
      g.titulos.sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? ''));
      g.totalValor = +g.totalValor.toFixed(2);
      g.totalTotal = +g.totalTotal.toFixed(2);
    }
    grupos.sort((a, b) => b.sim - a.sim || b.qtd - a.qtd);
    return {
      grupos,
      qtdSacados: grupos.length,
      qtdTitulos: grupos.reduce((s, g) => s + g.qtd, 0),
      totalValor: +grupos.reduce((s, g) => s + g.totalValor, 0).toFixed(2),
      totalTotal: +grupos.reduce((s, g) => s + g.totalTotal, 0).toFixed(2),
    };
  }

  private toRel(c: TituloRow): TituloRel {
    return {
      documento: c.DOCUMENTO, tipo: c.TIPO, sistema: c.SISTEMA, situacao: c.SITUACAO,
      sacado: c.SACADO, cpf_cnpj_sacado: c.CPF_CNPJ_SACADO,
      cedente: c.CEDENTE, cpf_cnpj_cedente: c.CPF_CNPJ_CEDENTE,
      vencimento: c.VENCIMENTO ? new Date(c.VENCIMENTO).toISOString().slice(0, 10) : null,
      valor: c.VALOR != null ? Number(c.VALOR) : null,
      total: c.TOTAL != null ? Number(c.TOTAL) : null,
    };
  }

  /** Concilia um PIX. Serve do cache (por cardId) salvo; só rechama a IA se
   *  `refresh` ou se não houver resultado salvo para o card. */
  async identificar(
    titulo: string,
    docInformado?: string | null,
    opts: { cardId?: string; refresh?: boolean } = {},
  ): Promise<ConciliacaoResultado> {
    const { cardId, refresh } = opts;
    if (cardId && !refresh) {
      const salvo = await this.store().buscar(cardId);
      if (salvo) {
        this.logger.log(`pix ${cardId}: cache hit`);
        return { ...(salvo.resultado as ConciliacaoResultado), criado_em: salvo.criadoEm, cacheado: true };
      }
    }
    const resultado = await this.analisarPix(titulo, docInformado);
    if (cardId) resultado.criado_em = await this.store().salvar(cardId, titulo, resultado);
    return resultado;
  }

  /** Roda a conciliação de fato (busca + IA), sem cache. */
  private async analisarPix(titulo: string, docInformado?: string | null): Promise<ConciliacaoResultado> {
    const apiKey = (this.config.get<string>('OPENAI_API_KEY') ?? '').trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY não configurada no .env');
    const model = (this.config.get<string>('COBRANCA_LLM_MODEL') ?? 'gpt-4o-mini').trim();

    const parsed = parseCard(titulo);
    const pix: PixInput = {
      plataforma: parsed.plataforma, sistema: mapSistema(parsed.plataforma),
      valor: parsed.valor, nome: parsed.nome,
      doc: docInformado ? soDigitos(docInformado) : null,
    };

    const todos = await this.buscarCandidatos(pix);
    const pixToks = [...new Set(tokensSignif(pix.nome))];
    const scored = todos.map((c) => {
      const sSac = simNome(pixToks, c.SACADO);
      const sCed = simNome(pixToks, c.CEDENTE);
      const docSac = !!pix.doc && soDigitos(c.CPF_CNPJ_SACADO) === pix.doc;
      const docCed = !!pix.doc && soDigitos(c.CPF_CNPJ_CEDENTE) === pix.doc;
      const docHit = docSac || docCed;
      const valor = Number(c.VALOR) || 0, total = Number(c.TOTAL) || 0;
      const dv = pix.valor != null ? Math.min(Math.abs(valor - pix.valor), Math.abs(total - pix.valor)) : Infinity;
      const valExato = pix.valor != null && dv <= Math.max(0.01, pix.valor * 0.001);
      // PIX entre a face e o total = pagamento negociado (face + parte dos encargos)
      const entreFaceTotal = pix.valor != null && total > valor && pix.valor >= valor - 0.01 && pix.valor <= total + 0.01;
      const sistOk = !!pix.sistema && c.SISTEMA === pix.sistema;
      const score = (docHit ? 100 : 0) + Math.max(sSac, sCed) * 40 + (valExato ? 30 : 0)
        + (entreFaceTotal ? 15 : 0)
        + (dv === Infinity ? 0 : Math.max(0, 10 - (dv / Math.max(1, pix.valor!)) * 10)) + (sistOk ? 5 : 0);
      return { c, sSac, sCed, docSac, docCed, docHit, dv, valExato, entreFaceTotal, sistOk, score };
    })
      .filter((x) => x.docHit || x.sSac > 0 || x.sCed > 0 || x.valExato || x.entreFaceTotal)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      return { pix, total_titulos: todos.length, relevantes: 0, sugestoes: [], resumo: 'Nenhum título em aberto compatível com o nome/documento do pagador.' };
    }

    const candidatosScored = scored.slice(0, 40);

    // combinações (soma) — agrupa por raiz de CNPJ do sacado E do cedente
    let combinacoes: Combo[] = [];
    if (pix.valor != null) {
      const tol = Math.max(0.5, pix.valor * 0.0005);
      const grupos = new Map<string, TituloRow[]>();
      const add = (k: string, c: TituloRow) => { if (!k) return; (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(c); };
      for (const { c } of candidatosScored) {
        add('S:' + (chaveDoc(c.CPF_CNPJ_SACADO) || norm(c.SACADO)), c);
        add('C:' + (chaveDoc(c.CPF_CNPJ_CEDENTE) || norm(c.CEDENTE)), c);
      }
      const brutos: Combo[] = [];
      for (const g of grupos.values()) brutos.push(...combinar(g, pix.valor, tol));
      const vistosDoc = new Set<string>();
      const unicos = brutos.filter((c) => { const k = [...c.titulos].sort().join('+'); if (vistosDoc.has(k)) return false; vistosDoc.add(k); return true; });
      const porValor = new Map<string, { rep: Combo; alt: number; vt: number }>();
      for (const c of unicos) {
        const vk = c.campo + '|' + [...c.vals].sort((a, b) => a - b).join(',');
        const vt = c.vencs.filter(Boolean).map((d) => Date.parse(d!)).reduce((a, b) => a + b, 0);
        const cur = porValor.get(vk);
        if (!cur) porValor.set(vk, { rep: c, alt: 0, vt });
        else { cur.alt += 1; if (vt < cur.vt) { cur.rep = c; cur.vt = vt; } }
      }
      combinacoes = [...porValor.values()]
        .map(({ rep, alt }) => ({ ...rep, alternativas_equivalentes: alt }))
        .sort((a, b) => Math.abs(a.dif) - Math.abs(b.dif)).slice(0, 12);
    }

    const out = await this.analisar(apiKey, model, pix, candidatosScored, combinacoes);

    // monta resposta enriquecida (títulos completos + cobrador + pagador determinístico)
    const idx = new Map(todos.map((c) => [String(c.DOCUMENTO), c]));
    const infoByDoc = new Map(scored.map((x) => [String(x.c.DOCUMENTO), x]));
    const sugestoesRaw: any[] = Array.isArray(out?.sugestoes) ? out.sugestoes : [];

    const cnpjsCedentes = sugestoesRaw
      .flatMap((s) => (Array.isArray(s.titulos) ? s.titulos : [s.titulos]))
      .map((d) => idx.get(String(d))?.CPF_CNPJ_CEDENTE).filter(Boolean) as string[];
    const cobradores = await this.buscarCobradores(cnpjsCedentes);

    const definirPagador = (docs: string[]): string => {
      let sac = 0, ced = 0, dSac = false, dCed = false;
      for (const d of docs) {
        const x = infoByDoc.get(String(d));
        if (!x) continue;
        sac = Math.max(sac, x.sSac); ced = Math.max(ced, x.sCed);
        dSac = dSac || x.docSac; dCed = dCed || x.docCed;
      }
      if (dSac && !dCed) return 'sacado';
      if (dCed && !dSac) return 'cedente';
      return ced >= sac ? 'cedente' : 'sacado';
    };

    const sugestoes: Sugestao[] = sugestoesRaw.map((s) => {
      const docs: string[] = (Array.isArray(s.titulos) ? s.titulos : [s.titulos]).filter(Boolean).map(String);
      const titulos: SugestaoTitulo[] = docs.map((d) => {
        const c = idx.get(d);
        return {
          documento: d, sacado: c?.SACADO ?? null, cedente: c?.CEDENTE ?? null,
          valor: c ? Number(c.VALOR) : null, total: c ? Number(c.TOTAL) : null,
          vencimento: c?.VENCIMENTO ? new Date(c.VENCIMENTO).toISOString().slice(0, 10) : null,
          sistema: c?.SISTEMA ?? null,
        };
      });
      const cobrador = docs.map((d) => cobradores.get(soDigitos(idx.get(d)?.CPF_CNPJ_CEDENTE)))
        .find(Boolean)?.resp ?? null;
      return {
        titulos, tipo_match: s.tipo_match ?? '', pagador: definirPagador(docs),
        confianca: s.confianca ?? '?', score: typeof s.score === 'number' ? s.score : null,
        justificativa: s.justificativa ?? '', cobrador,
      };
    });

    return { pix, total_titulos: todos.length, relevantes: scored.length, sugestoes, resumo: out?.resumo ?? '' };
  }

  // ---------- banco ----------
  private async buscarCandidatos(pix: PixInput): Promise<TituloRow[]> {
    const cols = `ID_TITULO, DOCUMENTO, TIPO, CPF_CNPJ_SACADO, SACADO, CPF_CNPJ_CEDENTE,
      CEDENTE, DATA_EMISSAO, VENCIMENTO, SITUACAO, VALOR, MULTA, JUROS, TARIFAS, TOTAL, SISTEMA`;
    const params: Record<string, unknown> = {};
    const conds: string[] = [];
    if (pix.doc) {
      params.doc = pix.doc;
      const limpa = (c: string) => `REPLACE(REPLACE(REPLACE(REPLACE(${c},'.',''),'-',''),'/',''),' ','')`;
      conds.push(`${limpa('CPF_CNPJ_SACADO')} = @doc OR ${limpa('CPF_CNPJ_CEDENTE')} = @doc`);
    }
    const signif = [...new Set(tokensSignif(pix.nome))].sort((a, b) => b.length - a.length).slice(0, 2);
    signif.forEach((tok, i) => { params[`t${i}`] = `%${tok}%`; conds.push(`UPPER(SACADO) LIKE @t${i} OR UPPER(CEDENTE) LIKE @t${i}`); });
    if (!conds.length) return [];
    const where = conds.map((c) => `(${c})`).join(' OR ');
    return this.db.query<TituloRow>(`SELECT TOP 800 ${cols} FROM data_core.vw_titulos_abertos WHERE ${where}`, params);
  }

  private async buscarCobradores(cnpjs: string[]): Promise<Map<string, { nome: string; resp: string }>> {
    const uniq = [...new Set(cnpjs.map(soDigitos).filter(Boolean))];
    const m = new Map<string, { nome: string; resp: string }>();
    if (!uniq.length) return m;
    const limpa = `REPLACE(REPLACE(REPLACE(REPLACE(CPF_CNPJ,'.',''),'-',''),'/',''),' ','')`;
    const params: Record<string, unknown> = {};
    const ph = uniq.map((d, i) => { params[`c${i}`] = d; return `@c${i}`; }).join(',');
    const rows = await this.db.query<{ NOME: string; DOC: string; RESPONSAVEL_COBRANCA: string }>(
      `SELECT NOME, ${limpa} AS DOC, RESPONSAVEL_COBRANCA FROM data_core.vw_cedentes WHERE ${limpa} IN (${ph})`, params);
    for (const x of rows) {
      const resp = (x.RESPONSAVEL_COBRANCA ?? '').toString().trim();
      if (resp && !m.has(x.DOC)) m.set(x.DOC, { nome: x.NOME, resp });
    }
    return m;
  }

  // ---------- IA ----------
  private async analisar(apiKey: string, model: string, pix: PixInput, scored: any[], combinacoes: Combo[]): Promise<any> {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    // "bate" = EXATO (centavos). "aprox" = perto, mas NÃO exato (até ~1% ou R$5).
    const tolExato = pix.valor != null ? Math.max(0.02, pix.valor * 0.0005) : 0;
    const tolAprox = pix.valor != null ? Math.max(5, pix.valor * 0.01) : 0;
    const payload = {
      pix: { plataforma: pix.plataforma, sistema_esperado: pix.sistema, valor: pix.valor, nome: pix.nome, documento: pix.doc },
      titulos: scored.map(({ c, sSac, sCed, docHit }) => {
        const valor = Number(c.VALOR) || 0, total = Number(c.TOTAL) || 0;
        return {
          documento: c.DOCUMENTO, tipo: c.TIPO, sistema: c.SISTEMA,
          sacado: c.SACADO, cpf_cnpj_sacado: c.CPF_CNPJ_SACADO,
          cedente: c.CEDENTE, cpf_cnpj_cedente: c.CPF_CNPJ_CEDENTE,
          vencimento: c.VENCIMENTO ? new Date(c.VENCIMENTO).toISOString().slice(0, 10) : null,
          valor, total,
          dif_valor: pix.valor != null ? round2(valor - pix.valor) : null,
          dif_total: pix.valor != null ? round2(total - pix.valor) : null,
          // EXATO (centavos) vs APROXIMADO (perto, mas não bate)
          bate_valor: pix.valor != null && Math.abs(valor - pix.valor) <= tolExato,
          bate_total: pix.valor != null && Math.abs(total - pix.valor) <= tolExato,
          aprox_valor: pix.valor != null && Math.abs(valor - pix.valor) > tolExato && Math.abs(valor - pix.valor) <= tolAprox,
          aprox_total: pix.valor != null && Math.abs(total - pix.valor) > tolExato && Math.abs(total - pix.valor) <= tolAprox,
          // PIX entre face e total → pagamento negociado (face + parte dos encargos)
          entre_face_total: pix.valor != null && total > valor && pix.valor >= valor - 0.01 && pix.valor <= total + 0.01,
          pct_encargo_pago: pix.valor != null && total > valor && pix.valor >= valor && pix.valor <= total
            ? round2((pix.valor - valor) / (total - valor)) : null,
          sim_sacado: round2(sSac), sim_cedente: round2(sCed), doc_bate: !!docHit,
        };
      }),
      combinacoes,
    };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, temperature: 0, seed: SEED, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: REGRAS }, { role: 'user', content: JSON.stringify(payload) }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    try { return JSON.parse(data?.choices?.[0]?.message?.content ?? '{}'); } catch { return {}; }
  }
}
