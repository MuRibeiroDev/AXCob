"""Por carteira: compara face-sum de vencidos por VENCIMENTO (original, backend)
vs VENCIMENTO_ATUAL (prorrogado). Ajuda a explicar diferenças de VALOR vs PBI."""
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

# descobre se há coluna VENCIMENTO_ATUAL
cur.execute("""SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='data_core' AND TABLE_NAME='vw_titulos_abertos_espelho_bi'
    AND COLUMN_NAME IN ('VENCIMENTO','VENCIMENTO_ATUAL')""")
cols = [r[0] for r in cur.fetchall()]
print("colunas de venc disponíveis:", cols)
tem_atual = 'VENCIMENTO_ATUAL' in cols

BASE = """t.TIPO IN ('ADC','CCB','CHQ','CTR','CPR','DES','DMR','NCO','NPP','DSR')
  AND t.HISTORICO NOT LIKE '%PAGO%' AND t.CPF_CNPJ_CEDENTE <> '05.673.133/0001-42' AND t.OP <> 7190"""
CED = """(SELECT CPF_CNPJ, MAX(RESPONSAVEL_COBRANCA) RESP FROM data_core.vw_cedentes
  WHERE RESPONSAVEL_COBRANCA IS NOT NULL AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA))<>'' GROUP BY CPF_CNPJ)"""

venc_atual_expr = "t.VENCIMENTO_ATUAL" if tem_atual else "t.VENCIMENTO"
cur.execute(f"""
  SELECT c.RESP,
    SUM(CASE WHEN DATEDIFF(DAY,t.VENCIMENTO,CAST(GETDATE() AS DATE))>0 THEN t.VALOR ELSE 0 END) face_orig,
    SUM(CASE WHEN DATEDIFF(DAY,{venc_atual_expr},CAST(GETDATE() AS DATE))>0 THEN t.VALOR ELSE 0 END) face_atual,
    SUM(CASE WHEN DATEDIFF(DAY,t.VENCIMENTO,CAST(GETDATE() AS DATE))>0 THEN 1 ELSE 0 END) cnt_orig,
    SUM(CASE WHEN DATEDIFF(DAY,{venc_atual_expr},CAST(GETDATE() AS DATE))>0 THEN 1 ELSE 0 END) cnt_atual
  FROM data_core.vw_titulos_abertos_espelho_bi t
  JOIN {CED} c ON c.CPF_CNPJ = t.CPF_CNPJ_CEDENTE
  WHERE {BASE}
  GROUP BY c.RESP ORDER BY face_orig DESC
""")
print(f"\n{'RESPONSAVEL':<38}{'face_ORIG':>15}{'face_ATUAL':>15}{'difVALOR':>13}{'cntO':>6}{'cntA':>6}")
for r in cur.fetchall():
    fo, fa = float(r.face_orig or 0), float(r.face_atual or 0)
    print(f"{str(r.RESP):<38}{fo:>15,.2f}{fa:>15,.2f}{fo-fa:>13,.2f}{r.cnt_orig:>6}{r.cnt_atual:>6}")

cn.close(); print("\nOK")
