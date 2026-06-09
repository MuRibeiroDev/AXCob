/*
 * Diagnóstico de login (users_qitech) — NÃO mostra a senha nem o hash.
 * Diz se o usuário foi encontrado, se está ativo, por qual campo casou e se a
 * senha confere no bcrypt. Uso (no seu terminal):
 *   node backend/scripts/check-login.cjs
 * Ele pergunta o login e a senha (a senha fica oculta).
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const sql = require('mssql');
const bcrypt = require('bcryptjs');

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

function pergunta(q, oculto) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (oculto) {
      rl._writeToOutput = (s) => { if (rl._oculto && s.trim()) process.stdout.write('*'); else process.stdout.write(s); };
    }
    rl.question(q, (a) => { rl.close(); if (oculto) process.stdout.write('\n'); res(a); });
    if (oculto) rl._oculto = true;
  });
}

(async () => {
  const env = loadEnv();
  const login = (await pergunta('Login (username ou email): ', false)).trim();
  const senha = await pergunta('Senha: ', true);

  const p = await sql.connect({
    server: (env.SMART_HOST || '').trim(), port: Number(env.SMART_PORT || 1433),
    database: (env.SMART_DATABASE || '').trim(), user: (env.SMART_USER || '').trim(),
    password: (env.SMART_PASSWORD || '').trim(),
    options: { encrypt: true, trustServerCertificate: true, useUTC: false }, connectionTimeout: 20000,
  });
  console.log(`\n(banco SMART: ${env.SMART_DATABASE})`);

  const r = await p.request().input('l', login).query(`
    SELECT TOP 5 id, username, email, is_active, role, LEFT(hashed_password,4) AS hpfx, LEN(hashed_password) AS hlen
    FROM Ax_Caixa.users_qitech WHERE username = @l OR email = @l`);

  if (!r.recordset.length) {
    console.log('❌ Nenhum usuário com esse username/email nesse banco.');
    await p.close(); return;
  }
  for (const u of r.recordset) {
    const ativo = u.is_active === true || u.is_active === 1;
    const campo = u.username === login ? 'username' : (u.email === login ? 'email' : 'outro');
    const full = await p.request().input('id', u.id).query('SELECT hashed_password FROM Ax_Caixa.users_qitech WHERE id=@id');
    const hash = String(full.recordset[0].hashed_password || '');
    const confere = await bcrypt.compare(senha, hash);
    console.log(`\nid ${u.id} | casou por: ${campo} | is_active: ${ativo} | hash: ${u.hpfx}…(${u.hlen} chars)`);
    console.log(`  bcrypt.compare(senha digitada) => ${confere ? '✅ CONFERE' : '❌ NÃO confere'}`);
  }
  await p.close();
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
