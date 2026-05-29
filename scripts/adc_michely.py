"""Rastreia os ADC da carteira da Michely e qual filtro do backend os remove."""
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
RESP = "MICHELY FERREIRA MENDES"

# CNPJs da carteira da Michely
JOIN = """JOIN (SELECT CPF_CNPJ, MAX(RESPONSAVEL_COBRANCA) RESP FROM data_core.vw_cedentes
  WHERE RESPONSAVEL_COBRANCA IS NOT NULL AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA))<>'' GROUP BY CPF_CNPJ) c
  ON c.CPF_CNPJ = t.CPF_CNPJ_CEDENTE AND c.RESP = ?"""

print("=== ADC da carteira Michely (todos os ADC, sem filtro de vencido) ===")
cur.execute(f"""SELECT t.DOCUMENTO, t.CEDENTE, t.VENCIMENTO, t.VALOR, t.OP, t.M, t.CR,
  DATEDIFF(DAY,t.VENCIMENTO,CAST(GETDATE() AS DATE)) DIAS,
  LEFT(ISNULL(CAST(t.HISTORICO AS varchar(200)),''),40) HIST
  FROM data_core.vw_titulos_abertos_espelho_bi t {JOIN}
  WHERE t.TIPO='ADC' ORDER BY t.VENCIMENTO""", RESP)
rows = cur.fetchall()
tot = 0.0
for r in rows:
    tot += float(r.VALOR or 0)
    print(f"  doc={r.DOCUMENTO} venc={r.VENCIMENTO} dias={r.DIAS} valor={float(r.VALOR or 0):,.2f} OP={r.OP} M={r.M} CR={r.CR} hist='{r.HIST}'")
print(f"  -> {len(rows)} ADC, soma VALOR = {tot:,.2f}")

print("\n=== efeito dos filtros (ADC Michely) ===")
for label, w in [
    ("Dias>0 (vencido)", "DATEDIFF(DAY,t.VENCIMENTO,CAST(GETDATE() AS DATE))>0"),
    ("+ HIST NOT LIKE %PAGO%", "DATEDIFF(DAY,t.VENCIMENTO,CAST(GETDATE() AS DATE))>0 AND t.HISTORICO NOT LIKE '%PAGO%'"),
    ("+ OP<>7190", "DATEDIFF(DAY,t.VENCIMENTO,CAST(GETDATE() AS DATE))>0 AND t.HISTORICO NOT LIKE '%PAGO%' AND t.OP<>7190"),
]:
    cur.execute(f"""SELECT COUNT(*), SUM(t.VALOR) FROM data_core.vw_titulos_abertos_espelho_bi t {JOIN}
      WHERE t.TIPO='ADC' AND {w}""", RESP)
    rr = cur.fetchone(); print(f"  {label:<32} qtd={rr[0]} valor={float(rr[1] or 0):,.2f}")
cn.close(); print("\nOK")
