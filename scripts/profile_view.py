"""Perfila domínios e distribuições de data_core.vw_titulos_abertos."""
import os
import pyodbc

env = {}
with open(os.path.join(os.path.dirname(__file__), "..", ".env"), encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()

conn_str = (
    f"DRIVER={{{env['DB_DRIVER']}}};"
    f"SERVER={env['DB_HOST']},{env['DB_PORT']};"
    f"DATABASE={env['DB_NAME']};UID={env['DB_USER']};PWD={env['DB_PASSWORD']};"
    "Encrypt=yes;TrustServerCertificate=yes;Connection Timeout=30;"
)
cn = pyodbc.connect(conn_str, timeout=60)
cur = cn.cursor()
V = "data_core.vw_titulos_abertos"


def dist(col, top=30, cast=False):
    expr = f"CAST({col} AS nvarchar(400))" if cast else col
    print(f"\n--- distribuição: {col} ---")
    cur.execute(
        f"SELECT TOP {top} {expr} AS v, COUNT(*) c FROM {V} GROUP BY {expr} ORDER BY c DESC"
    )
    for r in cur.fetchall():
        print(f"  {str(r.v):<46} {r.c:>8,}")


for c in ["SISTEMA", "SITUACAO", "ETAPA", "CONF", "CR", "M", "TIPO", "TIPO_OPERACAO"]:
    dist(c, cast=True)

dist("HISTORICO", top=25, cast=True)

print("\n--- vencidos vs a vencer (ref = GETDATE) ---")
cur.execute(
    f"""
    SELECT
      SUM(CASE WHEN VENCIMENTO < CAST(GETDATE() AS date) THEN 1 ELSE 0 END) AS vencidos,
      SUM(CASE WHEN VENCIMENTO >= CAST(GETDATE() AS date) THEN 1 ELSE 0 END) AS a_vencer,
      SUM(CASE WHEN VENCIMENTO IS NULL THEN 1 ELSE 0 END) AS sem_venc,
      COUNT(*) AS total
    FROM {V}
    """
)
r = cur.fetchone()
print(f"  vencidos={r.vencidos:,}  a_vencer={r.a_vencer:,}  sem_venc={r.sem_venc:,}  total={r.total:,}")

print("\n--- vencidos por SISTEMA + faixa de aging ---")
cur.execute(
    f"""
    SELECT SISTEMA,
      SUM(CASE WHEN d BETWEEN 1 AND 30 THEN 1 ELSE 0 END) f1,
      SUM(CASE WHEN d BETWEEN 31 AND 60 THEN 1 ELSE 0 END) f2,
      SUM(CASE WHEN d BETWEEN 61 AND 90 THEN 1 ELSE 0 END) f3,
      SUM(CASE WHEN d > 90 THEN 1 ELSE 0 END) f4,
      COUNT(*) tot, SUM(TOTAL) valor
    FROM (
      SELECT SISTEMA, DATEDIFF(day, VENCIMENTO, CAST(GETDATE() AS date)) d, TOTAL
      FROM {V} WHERE VENCIMENTO < CAST(GETDATE() AS date)
    ) x GROUP BY SISTEMA
    """
)
print(f"  {'SISTEMA':<16}{'1-30':>8}{'31-60':>8}{'61-90':>8}{'90+':>8}{'tot':>9}{'valor':>16}")
for r in cur.fetchall():
    print(f"  {r.SISTEMA:<16}{r.f1:>8,}{r.f2:>8,}{r.f3:>8,}{r.f4:>8,}{r.tot:>9,}{float(r.valor or 0):>16,.0f}")

print("\n--- cardinalidades (em vencidos) ---")
cur.execute(
    f"""
    SELECT COUNT(DISTINCT CPF_CNPJ_CEDENTE) ced, COUNT(DISTINCT CPF_CNPJ_SACADO) sac
    FROM {V} WHERE VENCIMENTO < CAST(GETDATE() AS date)
    """
)
r = cur.fetchone()
print(f"  cedentes distintos={r.ced:,}  sacados distintos={r.sac:,}")

print("\n--- amostra de DOCUMENTO / ID_TITULO_ORIGINAL / MOTIVO (não nulos) ---")
cur.execute(
    f"SELECT TOP 8 DOCUMENTO, ID_TITULO_ORIGINAL, MOTIVO FROM {V} WHERE MOTIVO IS NOT NULL"
)
for r in cur.fetchall():
    print(f"  doc={r.DOCUMENTO}  orig={r.ID_TITULO_ORIGINAL}  motivo={r.MOTIVO}")

cn.close()
print("\nOK")
