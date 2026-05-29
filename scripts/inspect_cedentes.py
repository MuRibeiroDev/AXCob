"""Inspeciona data_core.vw_cedentes: colunas, amostra, RESPONSAVEL_COBRANCA e join com vencidos."""
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

print("=" * 70)
print("COLUNAS de data_core.vw_cedentes")
print("=" * 70)
cur.execute(
    """
    SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='data_core' AND TABLE_NAME='vw_cedentes'
    ORDER BY ORDINAL_POSITION
    """
)
for r in cur.fetchall():
    typ = r.DATA_TYPE + (f"({r.CHARACTER_MAXIMUM_LENGTH})" if r.CHARACTER_MAXIMUM_LENGTH else "")
    print(f"{r.ORDINAL_POSITION:>3}. {r.COLUMN_NAME:<34} {typ:<18} null={r.IS_NULLABLE}")

cur.execute("SELECT COUNT(*) FROM data_core.vw_cedentes")
print(f"\nLinhas: {cur.fetchone()[0]:,}")

print("\n" + "=" * 70)
print("AMOSTRA (TOP 3)")
print("=" * 70)
cur.execute("SELECT TOP 3 * FROM data_core.vw_cedentes")
names = [d[0] for d in cur.description]
for i, row in enumerate(cur.fetchall(), 1):
    print(f"\n--- linha {i} ---")
    for n, v in zip(names, row):
        s = str(v)
        if len(s) > 80:
            s = s[:80] + "…"
        print(f"  {n:<34} = {s}")

print("\n" + "=" * 70)
print("RESPONSAVEL_COBRANCA — distribuição (nº de cedentes por analista)")
print("=" * 70)
try:
    cur.execute(
        """
        SELECT TOP 40 RESPONSAVEL_COBRANCA, COUNT(*) c
        FROM data_core.vw_cedentes GROUP BY RESPONSAVEL_COBRANCA ORDER BY c DESC
        """
    )
    for r in cur.fetchall():
        print(f"  {str(r.RESPONSAVEL_COBRANCA):<40} {r.c:>6,}")
except Exception as e:
    print(f"(erro: {e})")

# qual coluna do cedente é o documento? descobrir por nome
print("\n" + "=" * 70)
print("JOIN: vencidos por RESPONSAVEL_COBRANCA (via doc do cedente)")
print("=" * 70)
try:
    cur.execute(
        """
        SELECT c.RESPONSAVEL_COBRANCA,
               COUNT(*) titulos,
               COUNT(DISTINCT t.CPF_CNPJ_CEDENTE) cedentes,
               SUM(t.TOTAL) valor
        FROM data_core.vw_titulos_abertos t
        JOIN data_core.vw_cedentes c
          ON c.CPF_CNPJ = t.CPF_CNPJ_CEDENTE
        WHERE t.VENCIMENTO < CAST(GETDATE() AS date)
        GROUP BY c.RESPONSAVEL_COBRANCA
        ORDER BY valor DESC
        """
    )
    print(f"  {'RESPONSAVEL':<32}{'titulos':>9}{'cedentes':>10}{'valor':>16}")
    for r in cur.fetchall():
        print(f"  {str(r.RESPONSAVEL_COBRANCA):<32}{r.titulos:>9,}{r.cedentes:>10,}{float(r.valor or 0):>16,.0f}")
except Exception as e:
    print(f"(join por CPF_CNPJ falhou: {e})")

cn.close()
print("\nOK")
