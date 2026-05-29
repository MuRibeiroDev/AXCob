"""Verifica ADC vencidos: quantos existem, por carteira, e se algum filtro do backend os derruba."""
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
    "Encrypt=yes;TrustServerCertificate=yes;Connection Timeout=30;", timeout=120)
cur = cn.cursor()

print("=== ADC vencidos na view (sem filtros) ===")
cur.execute("""SELECT COUNT(*), SUM(VALOR) FROM data_core.vw_titulos_abertos_espelho_bi
  WHERE TIPO='ADC' AND DATEDIFF(DAY,VENCIMENTO,CAST(GETDATE() AS DATE))>0""")
r = cur.fetchone(); print(f"  qtd={r[0]}  valor={float(r[1] or 0):,.2f}")

print("\n=== ADC vencidos — efeito de cada filtro do backend ===")
checks = [
    ("base (Dias>0, TIPO=ADC)", "DATEDIFF(DAY,VENCIMENTO,CAST(GETDATE() AS DATE))>0"),
    ("+ HISTORICO NOT LIKE %PAGO%", "DATEDIFF(DAY,VENCIMENTO,CAST(GETDATE() AS DATE))>0 AND HISTORICO NOT LIKE '%PAGO%'"),
    ("+ cedente<>05.673.133/0001-42", "DATEDIFF(DAY,VENCIMENTO,CAST(GETDATE() AS DATE))>0 AND HISTORICO NOT LIKE '%PAGO%' AND CPF_CNPJ_CEDENTE<>'05.673.133/0001-42'"),
    ("+ OP<>7190", "DATEDIFF(DAY,VENCIMENTO,CAST(GETDATE() AS DATE))>0 AND HISTORICO NOT LIKE '%PAGO%' AND CPF_CNPJ_CEDENTE<>'05.673.133/0001-42' AND OP<>7190"),
]
for label, w in checks:
    cur.execute(f"SELECT COUNT(*) FROM data_core.vw_titulos_abertos_espelho_bi WHERE TIPO='ADC' AND {w}")
    print(f"  {label:<42} qtd={cur.fetchone()[0]}")

print("\n=== ADC vencidos por carteira (join CNPJ + filtros PBI) ===")
cur.execute("""
  SELECT c.RESP, COUNT(*) q, SUM(t.VALOR) v
  FROM data_core.vw_titulos_abertos_espelho_bi t
  JOIN (SELECT CPF_CNPJ, MAX(RESPONSAVEL_COBRANCA) RESP FROM data_core.vw_cedentes
        WHERE RESPONSAVEL_COBRANCA IS NOT NULL AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA))<>'' GROUP BY CPF_CNPJ) c
    ON c.CPF_CNPJ = t.CPF_CNPJ_CEDENTE
  WHERE t.TIPO='ADC' AND DATEDIFF(DAY,t.VENCIMENTO,CAST(GETDATE() AS DATE))>0
    AND t.HISTORICO NOT LIKE '%PAGO%' AND t.CPF_CNPJ_CEDENTE<>'05.673.133/0001-42' AND t.OP<>7190
  GROUP BY c.RESP ORDER BY v DESC""")
rows = cur.fetchall()
if rows:
    for r in rows: print(f"  {str(r.RESP):<38} qtd={r.q:<5} valor={float(r.v or 0):,.2f}")
else:
    print("  (nenhum ADC vencido atribuído a carteira)")
cn.close(); print("\nOK")
