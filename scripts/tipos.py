"""Distintos TIPO na view usada pela tela de vencidos (espelho_bi) e na de abertos."""
import os
import pyodbc

env = {}
with open(os.path.join(os.path.dirname(__file__), "..", ".env"), encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()

cn = pyodbc.connect(
    f"DRIVER={{{env['DB_DRIVER']}}};SERVER={env['DB_HOST']},{env['DB_PORT']};"
    f"DATABASE={env['DB_NAME']};UID={env['DB_USER']};PWD={env['DB_PASSWORD']};"
    "Encrypt=yes;TrustServerCertificate=yes;Connection Timeout=30;",
    timeout=60,
)
cur = cn.cursor()
IGN = {"ADC", "MPT", "TPT", "TRA", "TAR", "OUT", "JPT"}

for view in ("vw_titulos_abertos_espelho_bi", "vw_titulos_abertos"):
    print(f"\n=== TIPO em data_core.{view} ===")
    try:
        cur.execute(f"SELECT TIPO, COUNT(*) c FROM data_core.{view} GROUP BY TIPO ORDER BY c DESC")
        rows = cur.fetchall()
        print(f"  {len(rows)} tipos distintos:")
        for r in rows:
            tp = (r.TIPO or "(null)").strip()
            flag = "  [ENCARGO — excluído]" if tp.upper() in IGN else ""
            print(f"    {tp:<8} {r.c:>8,}{flag}")
    except Exception as e:
        print("  erro:", e)

# Tipos que de fato aparecem nos VENCIDOS (após exclusão de encargos)
print("\n=== TIPO em VENCIDOS (espelho_bi, DATEDIFF>0, sem encargos) — carteira inteira ===")
ign_sql = ", ".join(f"'{t}'" for t in sorted(IGN))
cur.execute(f"""
  SELECT TIPO, COUNT(*) c
  FROM data_core.vw_titulos_abertos_espelho_bi
  WHERE DATEDIFF(DAY, VENCIMENTO, CAST(GETDATE() AS DATE)) > 0
    AND UPPER(LTRIM(RTRIM(ISNULL(TIPO,'')))) NOT IN ({ign_sql})
  GROUP BY TIPO ORDER BY c DESC
""")
for r in cur.fetchall():
    print(f"    {(r.TIPO or '(null)').strip():<8} {r.c:>8,}")

cn.close()
