"""Diagnóstico de contagem da carteira Layne Lopes: join por NOME vs CNPJ, INADIPLENTES."""
import os, pyodbc

env = {}
with open(os.path.join(os.path.dirname(__file__), "..", ".env"), encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); env[k.strip()] = v.strip()

cn = pyodbc.connect(
    f"DRIVER={{{env['DB_DRIVER']}}};SERVER={env['DB_HOST']},{env['DB_PORT']};"
    f"DATABASE={env['DB_NAME']};UID={env['DB_USER']};PWD={env['DB_PASSWORD']};"
    "Encrypt=yes;TrustServerCertificate=yes;", timeout=60)
cur = cn.cursor()

RESP = 'LAYNE LOPES FERREIRA OLIVEIRA CAETANO'
WHERE_PBI = """
    DATEDIFF(DAY, t.VENCIMENTO, CAST(GETDATE() AS DATE)) > 0
    AND UPPER(LTRIM(RTRIM(ISNULL(t.TIPO,'')))) IN ('ADC','CCB','CHQ','CTR','CPR','DES','DMR','NCO','NPP','DSR')
    AND t.HISTORICO NOT LIKE '%PAGO%'
    AND t.CPF_CNPJ_CEDENTE <> '05.673.133/0001-42'
    AND t.OP <> 7190
"""

# A) join por NOME (backend atual)
cur.execute(f"""
  SELECT COUNT(*) q, COUNT(DISTINCT t.CEDENTE) ced, SUM(t.VALOR) face
  FROM data_core.vw_titulos_abertos_espelho_bi t
  INNER JOIN (SELECT NOME, MAX(RESPONSAVEL_COBRANCA) RESP FROM data_core.vw_cedentes
              WHERE RESPONSAVEL_COBRANCA IS NOT NULL AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA))<>'' GROUP BY NOME) c
    ON c.NOME = t.CEDENTE
  WHERE c.RESP = ? AND {WHERE_PBI}
""", RESP)
a = cur.fetchone()
print(f"A) JOIN por NOME (backend):   titulos={a.q:<5} cedentes={a.ced:<4} face={float(a.face or 0):,.2f}")

# B) join por CNPJ
cur.execute(f"""
  SELECT COUNT(*) q, COUNT(DISTINCT t.CPF_CNPJ_CEDENTE) ced, SUM(t.VALOR) face
  FROM data_core.vw_titulos_abertos_espelho_bi t
  INNER JOIN (SELECT CPF_CNPJ, MAX(RESPONSAVEL_COBRANCA) RESP FROM data_core.vw_cedentes
              WHERE RESPONSAVEL_COBRANCA IS NOT NULL AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA))<>'' GROUP BY CPF_CNPJ) c
    ON c.CPF_CNPJ = t.CPF_CNPJ_CEDENTE
  WHERE c.RESP = ? AND {WHERE_PBI}
""", RESP)
b = cur.fetchone()
print(f"B) JOIN por CNPJ:             titulos={b.q:<5} cedentes={b.ced:<4} face={float(b.face or 0):,.2f}")

# C) quantos da versão NOME têm HISTORICO INADIPLENTES (PBI exclui na contagem)
cur.execute(f"""
  SELECT COUNT(*) q
  FROM data_core.vw_titulos_abertos_espelho_bi t
  INNER JOIN (SELECT NOME, MAX(RESPONSAVEL_COBRANCA) RESP FROM data_core.vw_cedentes
              WHERE RESPONSAVEL_COBRANCA IS NOT NULL AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA))<>'' GROUP BY NOME) c
    ON c.NOME = t.CEDENTE
  WHERE c.RESP = ? AND {WHERE_PBI}
    AND UPPER(CAST(t.HISTORICO AS varchar(200))) LIKE '%INADIPL%'
""", RESP)
print(f"C) desses, HISTORICO ~INADIPLENTES: {cur.fetchone().q}")

# D) cedentes com NOME duplicado em vw_cedentes mas RESPONSAVEIS diferentes (risco do MAX)
cur.execute("""
  SELECT COUNT(*) FROM (
    SELECT NOME FROM data_core.vw_cedentes
    WHERE RESPONSAVEL_COBRANCA IS NOT NULL AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA))<>''
    GROUP BY NOME HAVING COUNT(DISTINCT RESPONSAVEL_COBRANCA) > 1
  ) x
""")
print(f"D) cedentes c/ mesmo NOME e responsaveis distintos: {cur.fetchone()[0]}")

cn.close()
