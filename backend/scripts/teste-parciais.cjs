/* TESTE (não altera nada): regra do relatório de pagamentos parciais.
 *
 * Regras (fechadas com a operação em 12/06/2026):
 *  1) Cedentes = os do último print "Títulos Abertos — Geral" (print_abertos.cedentes.txt).
 *  2) Período  = o MESMO do relatório (vencimentos no último dia útil + não-úteis
 *     órfãos imediatamente anteriores) — não a carteira vencida inteira.
 *  3) SEM filtro de flexibilização (em carência ou não, aparece).
 *  4) Match aberto×quitado por: número + CNPJ cedente + CNPJ sacado + sistema + OP.
 *  5) Recompra/repasse (SITUACAO Recomprado%/Repassado%) NÃO conta como
 *     pagamento — é o cedente cobrindo, não o sacado pagando.
 *  6) Só conta RECIBO PARCIAL: LIQUIDADO < 99% do VALOR_FACE — baixa integral
 *     de parcela (mesmo número, outro vencimento) não é pagamento parcial.
 *     Doc: docs/relatorio-pagamentos-parciais.md
 *
 * Uso:  node backend/scripts/teste-parciais.cjs [--inicio DD/MM/AAAA --fim DD/MM/AAAA]
 */
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const Holidays = require('date-holidays');

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

// ---------- dias úteis (espelha backend/src/relatorios/dias-uteis.ts) ----------
const hd = new Holidays('BR');
const isHoliday = (d) => {
  const r = hd.isHoliday(d);
  if (!r) return false;
  return (Array.isArray(r) ? r : [r]).some((h) => h.type === 'public' || h.type === 'optional');
};
const isNaoUtil = (d) => d.getDay() === 0 || d.getDay() === 6 || isHoliday(d);
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const hojeLocal = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const ultimoDiaUtil = (ref) => { let d = addDays(ref, -1); while (isNaoUtil(d)) d = addDays(d, -1); return d; };
// janela do relatório Geral: último dia útil + não-úteis órfãos antes dele
const janelaAbertos = (hoje) => {
  const fim = ultimoDiaUtil(hoje);
  let ini = fim;
  let d = addDays(fim, -1);
  while (isNaoUtil(d)) { ini = d; d = addDays(d, -1); }
  return [ini, fim];
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const brData = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const parseBr = (s) => { const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
const brl = (v) => { const s = (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return 'R$' + s.replace(/,/g, 'X').replace(/\./g, ',').replace(/X/g, '.'); };

// ---------- regra ----------
const TIPOS = "'CCB','CTR','DMR','DSR','NCO','NPP','CPR'";
const dig = (c) => `REPLACE(REPLACE(REPLACE(REPLACE(${c},'.',''),'/',''),'-',''),' ','')`;
const opn = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const chave = (numero, docCed, docSac, sys, op) => `${numero}|${docCed ?? ''}|${docSac ?? ''}|${String(sys ?? '').trim().toUpperCase()}|${opn(op)}`;

(async () => {
  // período: argv ou janela do relatório
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  let [ini, fim] = janelaAbertos(hojeLocal());
  if (arg('--inicio') && arg('--fim')) { ini = parseBr(arg('--inicio')); fim = parseBr(arg('--fim')); }
  console.log(`período do relatório: ${brData(ini)} .. ${brData(fim)}\n`);

  const cedentes = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'print_abertos.cedentes.txt'), 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  console.log(`cedentes do print Geral: ${cedentes.length}`);

  const env = loadEnv();
  const pool = await new sql.ConnectionPool({
    server: env.DB_HOST.trim(), port: Number(env.DB_PORT || 1433), database: env.DB_NAME.trim(),
    user: env.DB_USER.trim(), password: env.DB_PASSWORD.trim(),
    options: { encrypt: true, trustServerCertificate: true, useUTC: false },
    connectionTimeout: 30000, requestTimeout: 120000,
  }).connect();

  // 1) títulos ABERTOS dos cedentes, vencimento DENTRO do período do relatório
  const abertos = [];
  for (let i = 0; i < cedentes.length; i += 200) {
    const lote = cedentes.slice(i, i + 200).map((n) => n.trim().toUpperCase());
    const req = pool.request().input('ini', iso(ini)).input('fim', iso(fim));
    const mk = lote.map((n, j) => { req.input(`c${j}`, n); return `@c${j}`; });
    abertos.push(...(await req.query(`
      SELECT DOCUMENTO, CEDENTE, SACADO, SISTEMA, OP, VENCIMENTO,
             ${dig('CPF_CNPJ_SACADO')} AS DOC_SACADO, ${dig('CPF_CNPJ_CEDENTE')} AS DOC_CEDENTE,
             CAST(VALOR AS float) AS VALOR
      FROM data_core.vw_titulos_abertos
      WHERE VENCIMENTO BETWEEN @ini AND @fim
        AND M = 'C'
        AND TIPO IN (${TIPOS})
        AND UPPER(LTRIM(RTRIM(CEDENTE))) IN (${mk.join(',')})`)).recordset);
  }
  console.log(`títulos abertos no período: ${abertos.length}`);
  if (!abertos.length) { console.log('\nNENHUM título no período.'); await pool.close(); return; }

  // 2) quitados: match numero+cnpjCedente+cnpjSacado+sistema+OP (recompra CONTA)
  const docs = [...new Set(abertos.map((a) => (a.DOCUMENTO ?? '').trim()).filter(Boolean))];
  const pagoIdx = new Map(); // chave -> { liq, sits }
  for (let i = 0; i < docs.length; i += 500) {
    const lote = docs.slice(i, i + 500);
    const req = pool.request();
    const mk = lote.map((n, j) => { req.input(`n${j}`, n); return `@n${j}`; });
    const rows = (await req.query(`
      SELECT NUMERO, OP, SISTEMA, SITUACAO, ${dig('CPF_CNPJ_SACADO')} AS DOC_SACADO,
             ${dig('CPF_CNPJ_CEDENTE')} AS DOC_CEDENTE,
             CAST(VALOR_FACE AS float) AS VALOR_FACE, CAST(LIQUIDADO AS float) AS LIQUIDADO
      FROM data_core.vw_titulos_quitados
      WHERE TIPO IN (${TIPOS})
        AND SITUACAO NOT LIKE 'Recomprado%'
        AND SITUACAO NOT LIKE 'Repassado%'
        AND NUMERO IN (${mk.join(',')})`)).recordset;
    for (const r of rows) {
      const n = (r.NUMERO ?? '').trim();
      if (!n || !opn(r.OP)) continue;
      // regra 6: só RECIBO PARCIAL (liquidado < 99% da face) — baixa integral
      // de parcela com o mesmo número não é pagamento parcial do título aberto
      const face = Number(r.VALOR_FACE) || 0;
      const liq = Number(r.LIQUIDADO) || 0;
      if (!(face > 0 && liq < face * 0.99)) continue;
      const k = chave(n, r.DOC_CEDENTE, r.DOC_SACADO, r.SISTEMA, r.OP);
      const cur = pagoIdx.get(k) ?? { liq: 0, sits: new Set() };
      cur.liq += liq;
      cur.sits.add(String(r.SITUACAO ?? '').trim());
      pagoIdx.set(k, cur);
    }
  }

  // 3) agrega por cedente
  const porCed = new Map();
  const detalhe = [];
  for (const a of abertos) {
    const ced = (a.CEDENTE ?? '').trim();
    const agg = porCed.get(ced) ?? { vencido: 0, quitado: 0, chaves: new Set() };
    agg.vencido += Number(a.VALOR) || 0;
    const k = chave((a.DOCUMENTO ?? '').trim(), a.DOC_CEDENTE, a.DOC_SACADO, a.SISTEMA, a.OP);
    if (pagoIdx.has(k) && !agg.chaves.has(k)) {
      const p = pagoIdx.get(k);
      agg.chaves.add(k);
      agg.quitado += p.liq;
      detalhe.push({ ced, doc: a.DOCUMENTO, op: a.OP, sacado: a.SACADO, venc: brData(new Date(a.VENCIMENTO)), face: a.VALOR, pago: p.liq, sits: [...p.sits].join(', ') });
    }
    porCed.set(ced, agg);
  }
  await pool.close();

  // 4) saída
  console.log('\n---------- DETALHE (títulos parciais do período) ----------');
  for (const d of detalhe.sort((x, y) => y.pago - x.pago)) {
    console.log(` ${d.ced.slice(0, 30).padEnd(30)} | ${String(d.doc).padEnd(18)} OP ${String(d.op).padEnd(6)} venc ${d.venc} | face ${brl(d.face)} | pago ${brl(d.pago)} [${d.sits}] | ${(d.sacado || '').slice(0, 28)}`);
  }

  const parciais = [...porCed.entries()].filter(([, v]) => v.quitado > 0).sort((x, y) => y[1].vencido - x[1].vencido);
  console.log('\n================== MENSAGEM ==================\n');
  if (!parciais.length) {
    console.log('(nenhum parcial — mensagem NÃO é enviada)');
  } else {
    console.log(parciais.map(([c]) => `*${c}* - Já estava na cobrança, houve abatimento parcial.`).join('\n'));
  }
  console.log('\n==============================================');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
