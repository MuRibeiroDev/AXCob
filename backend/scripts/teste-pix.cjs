/* TESTE (não altera nada): replica a conciliação de PIX do conciliacao.service.ts
 * para um PIX específico, com DIAGNÓSTICO (candidatos, scores, combinações, IA).
 *
 * Uso:
 *   node backend/scripts/teste-pix.cjs --titulo "RAYQUIMICA R$ 870.000,00"
 *   node backend/scripts/teste-pix.cjs --titulo "FIDC: R$ 870.000,00 - RAYQUIMICA" --doc 12345678000199
 *   node backend/scripts/teste-pix.cjs --titulo "RAYQUIMICA R$ 870.000,00" --alvo 6623776-8
 *      (--alvo = nº de título/NOSSO_N que você suspeita ser o certo, p/ conferir)
 *   ... --sem-ia   (pula a chamada OpenAI; só mostra o diagnóstico)
 */
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');

// ---------- .env ----------
function loadEnv() {
  const env = {};
  for (const f of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
    if (!fs.existsSync(f)) continue;
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in env)) env[m[1]] = v;
    }
  }
  return env;
}

// ---------- helpers (cópia fiel do conciliacao.service.ts) ----------
const SEED = 7;
const STOP = new Set(['LTDA','LTD','SA','S','A','ME','MEI','EPP','EIRELI','EI','CIA','COMERCIO','COM','IND','INDUSTRIA','INDL','SERVICOS','SERV','E','DE','DA','DO','DAS','DOS','SACADO','CEDENTE','JR','JUNIOR']);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter((t) => t.length >= 2);
const tokensSignif = (s) => tokens(s).filter((t) => !STOP.has(t) && t.length >= 3);
const soDigitos = (s) => String(s ?? '').replace(/\D+/g, '');
const chaveDoc = (s) => { const d = soDigitos(s); return d.length >= 14 ? d.slice(0, 8) : d; };
function simNome(pixToks, alvo) {
  if (!pixToks.length) return 0;
  const setAlvo = new Set(tokensSignif(alvo));
  if (!setAlvo.size) return 0;
  let hit = 0; for (const t of pixToks) if (setAlvo.has(t)) hit++;
  return hit / pixToks.length;
}
function parseValorBR(s) {
  if (s == null) return null;
  let t = String(s).replace(/[^0-9.,]/g, ''); if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t); return Number.isFinite(n) ? n : null;
}
function parseCard(titulo) {
  const m = titulo.match(/^\s*(.*?):\s*R\$?\s*([\d.,]+)\s*-\s*(.+?)\s*$/i);
  if (m) return { plataforma: m[1].trim(), valor: parseValorBR(m[2]), nome: m[3].trim() };
  const mv = titulo.match(/R\$?\s*([\d.,]+)/i);
  const valor = mv ? parseValorBR(mv[1]) : null;
  const nome = titulo.replace(/^.*?:/, '').replace(/R\$?\s*[\d.,]+/i, '').replace(/[-–]/g, ' ').trim();
  return { plataforma: titulo.includes(':') ? titulo.split(':')[0].trim() : '', valor, nome };
}
function mapSistema(plataforma) {
  const p = norm(plataforma);
  if (/SECUR/.test(p)) return 'Securitizadora';
  if (/AGRO/.test(p)) return 'FIDC Agro';
  if (/FIDC/.test(p)) return 'FIDC';
  return null;
}
function combinar(grupo, alvo, tol, hojeMs, max = 5, limite = 20) {
  if (grupo.length < 2 || grupo.length > limite) return [];
  const combos = []; const idx = grupo.map((_, i) => i);
  const vencido = (i) => grupo[i].VENCIMENTO && new Date(grupo[i].VENCIMENTO).getTime() <= hojeMs;
  function rec(start, escolhidos) {
    if (escolhidos.length >= 2) {
      const docs = escolhidos.map((i) => grupo[i].DOCUMENTO);
      const vencs = escolhidos.map((i) => (grupo[i].VENCIMENTO ? new Date(grupo[i].VENCIMENTO).toISOString().slice(0, 10) : null));
      const somaF = escolhidos.reduce((s, i) => s + (Number(grupo[i].VALOR) || 0), 0);
      const somaT = escolhidos.reduce((s, i) => s + (Number(grupo[i].TOTAL) || 0), 0);
      let exato = false;
      for (const campo of ['VALOR', 'TOTAL']) {
        const soma = campo === 'VALOR' ? somaF : somaT;
        if (Math.abs(soma - alvo) <= tol) {
          exato = true;
          combos.push({ titulos: docs, campo, soma: +soma.toFixed(2), dif: +(soma - alvo).toFixed(2),
            vals: escolhidos.map((i) => +(Number(grupo[i][campo]) || 0).toFixed(2)), vencs });
        }
      }
      // NEGOCIADO: PIX entre soma-face e soma-total (pagou faces + parte dos encargos).
      // Só vale se TODOS os títulos do conjunto já VENCERAM — não se paga com juros
      // um título que ainda nem venceu (isso seria antecipação, e bateria a face exata).
      if (!exato && somaT > somaF && alvo >= somaF - tol && alvo <= somaT + tol && escolhidos.every(vencido)) {
        combos.push({ titulos: docs, campo: 'NEGOCIADO', soma: +somaF.toFixed(2), dif: 0,
          vals: escolhidos.map((i) => +(Number(grupo[i].VALOR) || 0).toFixed(2)), vencs,
          entre_face_total: true, soma_face: +somaF.toFixed(2), soma_total: +somaT.toFixed(2),
          pct_encargo_pago: +((alvo - somaF) / (somaT - somaF)).toFixed(2) });
      }
    }
    if (escolhidos.length >= max) return;
    for (let i = start; i < idx.length; i++) rec(i + 1, [...escolhidos, idx[i]]);
  }
  rec(0, []); return combos;
}

const REGRAS = fs.readFileSync(path.join(__dirname, '..', 'src', 'kanban', 'conciliacao.service.ts'), 'utf8')
  .match(/const REGRAS = `([\s\S]*?)`;/)[1];

// Reforço em teste: objetivo é SUGERIR + combinações negociadas (PIX entre soma-face e soma-total)
const REGRAS_EXTRA = `
REFORÇO IMPORTANTE — SEU OBJETIVO É SUGERIR (não exigir prova):
Você é uma FERRAMENTA DE APOIO ao cobrador. Sempre que houver uma hipótese RAZOÁVEL, ENTREGUE-A (com a confiança adequada). Raramente devolva lista vazia: só faça isso se realmente NADA for plausível. O cobrador confere depois — seu papel é apontar o caminho mais provável.

RACIOCÍNIO DE NEGÓCIO (use sempre):
- Um PIX recebido logo APÓS o vencimento, de valor PRÓXIMO de título(s) do mesmo cedente/sacado, é quase certamente o pagamento desses títulos. Use o campo "hoje" e o "vencimento": título que venceu ontem/há poucos dias + PIX hoje = forte indício.
- Se o PIX é MAIOR que a soma das faces mas fica ATÉ a soma dos totais (face + juros/multa), é PAGAMENTO COM ENCARGOS (negociado) — NÃO descarte por "não bater exato"; sugira como pagamento da face + parte/todos os encargos.

COMBINAÇÕES "entre_face_total"=true (NOVO): em "combinacoes" pode vir um item com "entre_face_total": true, "soma_face", "soma_total" e "pct_encargo_pago". Significa que o PIX cai ENTRE a soma das FACES e a soma dos TOTAIS daquele conjunto de títulos → pagamento negociado de VÁRIOS títulos (face + parte dos encargos). Trate como tipo_match "pagamento_parcial" (ou "soma_titulos"): se o nome casar (sim>=0.6) e os títulos estiverem vencidos/recém-vencidos, confiança "media" a "alta". Cite na justificativa: o PIX (R$X) está entre a face somada (R$soma_face) e o total somado (R$soma_total), pagando ~pct_encargo_pago% dos encargos — possivelmente o pagamento desses títulos com juros/multa.`;

const brl = (v) => (v == null ? '—' : 'R$' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const titulo = arg('--titulo', 'RAYQUIMICA R$ 870.000,00');
  const docInformado = arg('--doc', null);
  const alvo = arg('--alvo', '6623776-8'); // nº de título/NOSSO_N que se suspeita ser o certo
  const semIa = argv.includes('--sem-ia');

  const parsed = parseCard(titulo);
  const pix = { plataforma: parsed.plataforma, sistema: mapSistema(parsed.plataforma), valor: parsed.valor, nome: parsed.nome, doc: docInformado ? soDigitos(docInformado) : null };
  console.log('===== PIX =====');
  console.log(`título card : "${titulo}"`);
  console.log(`→ nome      : "${pix.nome}"  | valor: ${brl(pix.valor)}  | plataforma: "${pix.plataforma}" (sistema ${pix.sistema || '—'})  | doc: ${pix.doc || '—'}`);
  const pixToks = [...new Set(tokensSignif(pix.nome))];
  console.log(`→ tokens significativos do nome: [${pixToks.join(', ')}]`);

  const env = loadEnv();
  const pool = await new sql.ConnectionPool({
    server: env.DB_HOST.trim(), port: Number(env.DB_PORT || 1433), database: env.DB_NAME.trim(),
    user: env.DB_USER.trim(), password: env.DB_PASSWORD.trim(),
    options: { encrypt: true, trustServerCertificate: true, useUTC: false }, connectionTimeout: 30000, requestTimeout: 120000,
  }).connect();

  const cols = `ID_TITULO, DOCUMENTO, NOSSO_N, TIPO, CPF_CNPJ_SACADO, SACADO, CPF_CNPJ_CEDENTE, CEDENTE, DATA_EMISSAO, VENCIMENTO, SITUACAO, CAST(VALOR AS float) VALOR, CAST(MULTA AS float) MULTA, CAST(JUROS AS float) JUROS, CAST(TARIFAS AS float) TARIFAS, CAST(TOTAL AS float) TOTAL, SISTEMA`;

  // ---- 0) o título-alvo informado existe em aberto? (diagnóstico) ----
  if (alvo) {
    const a = (await pool.request().input('a', `%${alvo}%`).input('a2', `%${soDigitos(alvo)}%`)
      .query(`SELECT TOP 20 ${cols} FROM data_core.vw_titulos_abertos WHERE DOCUMENTO LIKE @a OR NOSSO_N LIKE @a OR NOSSO_N LIKE @a2`)).recordset;
    console.log(`\n===== TÍTULO-ALVO "${alvo}" (em vw_titulos_abertos) =====`);
    if (!a.length) console.log('  ⚠️ NÃO encontrado em aberto por DOCUMENTO/NOSSO_N (pode estar quitado, ou nº diferente).');
    a.forEach((c) => console.log(`  doc ${String(c.DOCUMENTO).padEnd(14)} nossoN ${String(c.NOSSO_N||'').padEnd(14)} [${c.SISTEMA}] face ${brl(c.VALOR)} total ${brl(c.TOTAL)} venc ${c.VENCIMENTO ? new Date(c.VENCIMENTO).toISOString().slice(0,10) : '—'} | SAC ${(c.SACADO||'').slice(0,28)} | CED ${(c.CEDENTE||'').slice(0,28)}`));
  }

  // ---- 1) busca de candidatos (idêntica ao service) ----
  const params = {}; const conds = [];
  if (pix.doc) { params.doc = pix.doc; const limpa = (c) => `REPLACE(REPLACE(REPLACE(REPLACE(${c},'.',''),'-',''),'/',''),' ','')`; conds.push(`${limpa('CPF_CNPJ_SACADO')} = @doc OR ${limpa('CPF_CNPJ_CEDENTE')} = @doc`); }
  const signif = [...new Set(tokensSignif(pix.nome))].sort((a, b) => b.length - a.length).slice(0, 2);
  signif.forEach((tok, i) => { params[`t${i}`] = `%${tok}%`; conds.push(`UPPER(SACADO) LIKE @t${i} OR UPPER(CEDENTE) LIKE @t${i}`); });
  console.log(`\n===== BUSCA DE CANDIDATOS =====`);
  console.log(`  termos LIKE no SACADO/CEDENTE: [${signif.join(', ')}]${pix.doc ? ' + doc' : ''}`);
  let todos = [];
  if (conds.length) {
    const where = conds.map((c) => `(${c})`).join(' OR ');
    const req = pool.request(); for (const [k, v] of Object.entries(params)) req.input(k, v);
    todos = (await req.query(`SELECT TOP 800 ${cols} FROM data_core.vw_titulos_abertos WHERE ${where}`)).recordset;
  }
  console.log(`  candidatos retornados: ${todos.length}`);

  // ---- 2) scoring (idêntico) ----
  const scored = todos.map((c) => {
    const sSac = simNome(pixToks, c.SACADO), sCed = simNome(pixToks, c.CEDENTE);
    const docSac = !!pix.doc && soDigitos(c.CPF_CNPJ_SACADO) === pix.doc;
    const docCed = !!pix.doc && soDigitos(c.CPF_CNPJ_CEDENTE) === pix.doc;
    const docHit = docSac || docCed;
    const valor = Number(c.VALOR) || 0, total = Number(c.TOTAL) || 0;
    const dv = pix.valor != null ? Math.min(Math.abs(valor - pix.valor), Math.abs(total - pix.valor)) : Infinity;
    const valExato = pix.valor != null && dv <= Math.max(0.01, pix.valor * 0.001);
    const entreFaceTotal = pix.valor != null && total > valor && pix.valor >= valor - 0.01 && pix.valor <= total + 0.01;
    const sistOk = !!pix.sistema && c.SISTEMA === pix.sistema;
    const score = (docHit ? 100 : 0) + Math.max(sSac, sCed) * 40 + (valExato ? 30 : 0) + (entreFaceTotal ? 15 : 0)
      + (dv === Infinity ? 0 : Math.max(0, 10 - (dv / Math.max(1, pix.valor)) * 10)) + (sistOk ? 5 : 0);
    return { c, sSac, sCed, docSac, docCed, docHit, dv, valExato, entreFaceTotal, sistOk, score };
  }).filter((x) => x.docHit || x.sSac > 0 || x.sCed > 0 || x.valExato || x.entreFaceTotal)
    .sort((a, b) => b.score - a.score);

  console.log(`  candidatos RELEVANTES (passaram no filtro): ${scored.length}`);
  console.log('\n  TOP candidatos:');
  scored.slice(0, 15).forEach((x) => console.log(`   score ${String(x.score.toFixed(1)).padStart(6)} | doc ${String(x.c.DOCUMENTO).padEnd(14)} [${x.c.SISTEMA}] face ${brl(x.c.VALOR)} total ${brl(x.c.TOTAL)} | simSac ${x.sSac.toFixed(2)} simCed ${x.sCed.toFixed(2)} | difMin ${x.dv===Infinity?'—':brl(x.dv)} ${x.valExato?'EXATO ':''}${x.entreFaceTotal?'ENTRE_FT ':''} | SAC ${(x.c.SACADO||'').slice(0,22)} CED ${(x.c.CEDENTE||'').slice(0,22)}`));

  const candidatosScored = scored.slice(0, 40);

  // ---- 3) combinações (soma) ----
  let combinacoes = [];
  if (pix.valor != null) {
    const tol = Math.max(0.5, pix.valor * 0.0005);
    const grupos = new Map();
    const add = (k, c) => { if (!k) return; (grupos.get(k) ?? grupos.set(k, []).get(k)).push(c); };
    for (const { c } of candidatosScored) { add('S:' + (chaveDoc(c.CPF_CNPJ_SACADO) || norm(c.SACADO)), c); add('C:' + (chaveDoc(c.CPF_CNPJ_CEDENTE) || norm(c.CEDENTE)), c); }
    const hojeMs = new Date(new Date().toISOString().slice(0, 10)).getTime();
    const brutos = []; for (const g of grupos.values()) brutos.push(...combinar(g, pix.valor, tol, hojeMs));
    const vistos = new Set(); const unicos = brutos.filter((c) => { const k = [...c.titulos].sort().join('+'); if (vistos.has(k)) return false; vistos.add(k); return true; });
    const porValor = new Map();
    for (const c of unicos) { const vk = c.campo + '|' + [...c.vals].sort((a,b)=>a-b).join(','); const vt = c.vencs.filter(Boolean).map((d)=>Date.parse(d)).reduce((a,b)=>a+b,0); const cur = porValor.get(vk); if (!cur) porValor.set(vk,{rep:c,alt:0,vt}); else { cur.alt+=1; if (vt<cur.vt){cur.rep=c;cur.vt=vt;} } }
    combinacoes = [...porValor.values()].map(({rep,alt})=>({...rep,alternativas_equivalentes:alt})).sort((a,b)=>Math.abs(a.dif)-Math.abs(b.dif)).slice(0,12);
  }
  console.log(`\n  COMBINAÇÕES (soma de títulos p/ ${brl(pix.valor)}): ${combinacoes.length}`);
  combinacoes.slice(0, 10).forEach((c) => {
    if (c.entre_face_total) console.log(`   NEGOCIADO faixa [face ${brl(c.soma_face)} .. total ${brl(c.soma_total)}] (PIX paga ${(c.pct_encargo_pago*100).toFixed(0)}% dos encargos) → ${c.titulos.join(' + ')}`);
    else console.log(`   ${c.campo} soma ${brl(c.soma)} (dif ${brl(c.dif)}) ${c.alternativas_equivalentes?`[+${c.alternativas_equivalentes} equiv]`:''} → ${c.titulos.join(' + ')}`);
  });

  // ---- 4) IA ----
  if (semIa) { console.log('\n(--sem-ia: pulando OpenAI)'); await pool.close(); return; }
  const apiKey = (env.OPENAI_API_KEY || '').trim();
  const model = (env.COBRANCA_LLM_MODEL || 'gpt-4o-mini').trim();
  if (!apiKey) { console.log('\n⚠️ OPENAI_API_KEY ausente — pulei a IA.'); await pool.close(); return; }
  const round2 = (n) => Math.round(n * 100) / 100;
  const tolExato = pix.valor != null ? Math.max(0.02, pix.valor * 0.0005) : 0;
  const tolAprox = pix.valor != null ? Math.max(5, pix.valor * 0.01) : 0;
  const payload = {
    hoje: new Date().toISOString().slice(0, 10),
    pix: { plataforma: pix.plataforma, sistema_esperado: pix.sistema, valor: pix.valor, nome: pix.nome, documento: pix.doc },
    titulos: candidatosScored.map(({ c, sSac, sCed, docHit }) => {
      const valor = Number(c.VALOR) || 0, total = Number(c.TOTAL) || 0;
      return { documento: c.DOCUMENTO, tipo: c.TIPO, sistema: c.SISTEMA, sacado: c.SACADO, cpf_cnpj_sacado: c.CPF_CNPJ_SACADO, cedente: c.CEDENTE, cpf_cnpj_cedente: c.CPF_CNPJ_CEDENTE,
        vencimento: c.VENCIMENTO ? new Date(c.VENCIMENTO).toISOString().slice(0,10) : null, valor, total,
        dif_valor: pix.valor != null ? round2(valor - pix.valor) : null, dif_total: pix.valor != null ? round2(total - pix.valor) : null,
        bate_valor: pix.valor != null && Math.abs(valor - pix.valor) <= tolExato, bate_total: pix.valor != null && Math.abs(total - pix.valor) <= tolExato,
        aprox_valor: pix.valor != null && Math.abs(valor - pix.valor) > tolExato && Math.abs(valor - pix.valor) <= tolAprox,
        aprox_total: pix.valor != null && Math.abs(total - pix.valor) > tolExato && Math.abs(total - pix.valor) <= tolAprox,
        entre_face_total: pix.valor != null && total > valor && pix.valor >= valor - 0.01 && pix.valor <= total + 0.01,
        pct_encargo_pago: pix.valor != null && total > valor && pix.valor >= valor && pix.valor <= total ? round2((pix.valor - valor) / (total - valor)) : null,
        sim_sacado: round2(sSac), sim_cedente: round2(sCed), doc_bate: !!docHit };
    }),
    combinacoes,
  };
  console.log(`\n===== IA (${model}) =====`);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0, seed: SEED, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: REGRAS + '\n' + REGRAS_EXTRA }, { role: 'user', content: JSON.stringify(payload) }] }),
  });
  if (!res.ok) { console.log('OpenAI HTTP', res.status, (await res.text()).slice(0, 200)); await pool.close(); return; }
  const data = await res.json();
  let out = {}; try { out = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}'); } catch {}
  console.log('RESUMO:', out.resumo || '—');
  console.log('SUGESTÕES:', (out.sugestoes || []).length);
  (out.sugestoes || []).forEach((s, i) => console.log(`  ${i+1}. [${s.confianca}/${s.score}] ${s.tipo_match} pagador=${s.pagador} → ${(Array.isArray(s.titulos)?s.titulos:[s.titulos]).join(', ')}\n     ${s.justificativa}`));
  await pool.close();
}
main().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
