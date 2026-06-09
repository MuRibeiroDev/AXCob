/*
 * Lista as colunas de uma view/tabela (default: encargos.vw_carteira_csv) e
 * mostra 1 linha de amostra, p/ ver se já existe coluna de flexibilização.
 * Uso: node "<repo>/backend/listar-colunas.cjs" [schema.objeto]
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

function loadEnv() {
  const env = {};
  for (const file of [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')]) {
    if (!fs.existsSync(file)) continue;
    for (const linha of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in env)) env[m[1]] = v;
    }
  }
  return env;
}

async function main() {
  const alvo = (process.argv[2] || 'encargos.vw_carteira_csv').trim();
  const [schema, objeto] = alvo.includes('.') ? alvo.split('.') : ['dbo', alvo];
  const env = loadEnv();
  const pool = await sql.connect({
    server: (env.DB_HOST || '').trim(), port: Number(env.DB_PORT || 1433),
    database: (env.DB_NAME || '').trim(), user: (env.DB_USER || '').trim(),
    password: (env.DB_PASSWORD || '').trim(),
    options: { encrypt: true, trustServerCertificate: true, useUTC: false },
    connectionTimeout: 30000, requestTimeout: 60000,
  });

  const cols = await pool.request()
    .input('s', schema).input('o', objeto)
    .query(`SELECT ORDINAL_POSITION AS pos, COLUMN_NAME AS nome, DATA_TYPE AS tipo,
                   CHARACTER_MAXIMUM_LENGTH AS tam
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = @s AND TABLE_NAME = @o
            ORDER BY ORDINAL_POSITION`);

  console.log(`\n=== ${schema}.${objeto} — ${cols.recordset.length} colunas ===`);
  for (const c of cols.recordset) {
    const t = c.tam && c.tam > 0 ? `${c.tipo}(${c.tam})` : c.tipo;
    console.log(`  ${String(c.pos).padStart(2)}. ${c.nome}  [${t}]`);
  }

  // amostra de 1 linha (todas as colunas) p/ visualizar conteúdo
  try {
    const amostra = await pool.request().query(`SELECT TOP 1 * FROM ${schema}.${objeto}`);
    const row = amostra.recordset[0];
    if (row) {
      console.log(`\n=== amostra (1 linha) ===`);
      for (const [k, v] of Object.entries(row)) {
        const s = v == null ? '(null)' : String(v).replace(/\s+/g, ' ').slice(0, 80);
        console.log(`  ${k}: ${s}`);
      }
    }
  } catch (e) {
    console.log('  (não foi possível ler amostra:', e.message, ')');
  }

  await pool.close();
}

main().catch((err) => { console.error('ERRO:', err.message); process.exit(1); });
