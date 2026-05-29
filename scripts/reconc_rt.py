"""Reconciliação: títulos da RT LEILOES (filtros do PBI) com Dias ao vivo."""
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

# Mesmos filtros do PBI/backend, MAS mostrando todos (inclusive dias<=0) p/ achar boundary
cur.execute("""
  SELECT DOCUMENTO, VALOR,
         DATEDIFF(DAY, VENCIMENTO, CAST(GETDATE() AS DATE)) AS DIAS,
         VENCIMENTO, TIPO, CAST(HISTORICO AS varchar(80)) AS HIST
  FROM data_core.vw_titulos_abertos_espelho_bi
  WHERE CEDENTE = 'RT LEILOES E EVENTOS LTDA'
    AND UPPER(LTRIM(RTRIM(ISNULL(TIPO,'')))) IN ('ADC','CCB','CHQ','CTR','CPR','DES','DMR','NCO','NPP','DSR')
    AND HISTORICO NOT LIKE '%PAGO%'
    AND CPF_CNPJ_CEDENTE <> '05.673.133/0001-42'
    AND OP <> 7190
  ORDER BY DIAS
""")
rows = cur.fetchall()
venc = [r for r in rows if r.DIAS > 0]
naovenc = [r for r in rows if r.DIAS <= 0]
print("hoje (servidor):", end=" ")
cur2 = cn.cursor(); cur2.execute("SELECT CAST(GETDATE() AS DATE)"); print(cur2.fetchone()[0])
print(f"\nVENCIDOS (Dias>0): {len(venc)} títulos | soma face = {sum(float(r.VALOR) for r in venc):,.2f}")
print(f"NÃO vencidos (Dias<=0): {len(naovenc)}")
print("\n--- títulos na borda (Dias entre -3 e 3) ---")
for r in rows:
    if -3 <= r.DIAS <= 3:
        print(f"  doc={r.DOCUMENTO:<14} venc={r.VENCIMENTO}  dias={r.DIAS:>3}  face={float(r.VALOR):>12,.2f}  tipo={r.TIPO}  hist={r.HIST}")
cn.close()
