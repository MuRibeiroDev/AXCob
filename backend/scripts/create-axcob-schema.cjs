/* Cria o schema `axcob` e as tabelas que hoje vivem no SQLite local, no Azure SQL.
   Espelha relatorio_png (relatorios.db) e pix_conciliacao (pix-conciliacao.db).
   Uso:  node backend/scripts/create-axcob-schema.cjs
   Usa DB_USER/DB_PASSWORD do .env (precisa de permissão de DDL). */
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');

// ---- carrega o .env da raiz ----
function loadEnv() {
  const p = path.resolve(__dirname, '..', '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

const DDL = `
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'axcob')
    EXEC('CREATE SCHEMA axcob');

IF OBJECT_ID('axcob.relatorio_png', 'U') IS NULL
CREATE TABLE axcob.relatorio_png (
    id         NVARCHAR(64)   NOT NULL,
    parte      INT            NOT NULL,
    dia        CHAR(10)       NOT NULL,   -- yyyy-mm-dd
    png        VARBINARY(MAX) NOT NULL,
    criado_em  VARCHAR(40)    NOT NULL,   -- ISO 8601
    CONSTRAINT PK_axcob_relatorio_png PRIMARY KEY (id, parte)
);

IF OBJECT_ID('axcob.pix_conciliacao', 'U') IS NULL
CREATE TABLE axcob.pix_conciliacao (
    card_id    NVARCHAR(64)  NOT NULL,
    titulo     NVARCHAR(400) NOT NULL,
    resultado  NVARCHAR(MAX) NOT NULL,   -- JSON
    criado_em  VARCHAR(40)   NOT NULL,
    CONSTRAINT PK_axcob_pix_conciliacao PRIMARY KEY (card_id)
);
`;

function baseConfig() {
  return {
    server: (process.env.DB_HOST || '').trim(),
    port: Number(process.env.DB_PORT || 1433),
    database: (process.env.DB_NAME || '').trim(),
    options: { encrypt: true, trustServerCertificate: true, useUTC: false },
    pool: { max: 2, min: 0, idleTimeoutMillis: 15000 },
    connectionTimeout: 30000,
  };
}

async function tentar(user, password, rotulo) {
  if (!user) return false;
  const pool = new sql.ConnectionPool({ ...baseConfig(), user, password });
  try {
    console.log(`-> conectando como ${rotulo} (${user})…`);
    await pool.connect();
    await pool.request().batch(DDL);
    // confirma o que existe
    const r = await pool.request().query(`
      SELECT s.name AS schema_name, t.name AS table_name
      FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = 'axcob' ORDER BY t.name`);
    console.log(`   OK — schema/tabelas em axcob:`);
    for (const row of r.recordset) console.log(`      • ${row.schema_name}.${row.table_name}`);
    await pool.close();
    return true;
  } catch (e) {
    console.log(`   FALHOU (${rotulo}): ${e.message}`);
    await pool.close().catch(() => {});
    return false;
  }
}

(async () => {
  const ok = await tentar(process.env.DB_USER, process.env.DB_PASSWORD, 'DB_USER');
  if (!ok) {
    console.error('\nNão consegui criar o schema/tabelas. ' +
      'Verifique permissão de DDL (CREATE SCHEMA/CREATE TABLE) e o firewall do Azure SQL p/ este IP.');
    process.exit(1);
  }
  console.log('\nPronto.');
})();
