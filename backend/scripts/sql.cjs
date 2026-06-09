/* Roda uma query SQL passada como argumento e imprime o resultado (JSON).
   Uso: node "<repo>/backend/sql.cjs" "SELECT TOP 5 * FROM encargos.juros_multa" */
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
  const query = process.argv[2];
  if (!query) throw new Error('passe a query como argumento');
  const env = loadEnv();
  const pool = await sql.connect({
    server: (env.DB_HOST || '').trim(), port: Number(env.DB_PORT || 1433),
    database: (env.DB_NAME || '').trim(), user: (env.DB_USER || '').trim(),
    password: (env.DB_PASSWORD || '').trim(),
    options: { encrypt: true, trustServerCertificate: true, useUTC: false },
    connectionTimeout: 30000, requestTimeout: 60000,
  });
  const r = await pool.request().query(query);
  await pool.close();
  console.log(JSON.stringify(r.recordset, null, 2));
}

main().catch((err) => { console.error('ERRO:', err.message); process.exit(1); });
