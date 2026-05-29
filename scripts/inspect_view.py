"""Inspeciona data_core.vw_titulos_abertos: colunas, tipos, definição e amostra."""
import os
import pyodbc

# --- carrega .env simples ---
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
    f"DATABASE={env['DB_NAME']};"
    f"UID={env['DB_USER']};"
    f"PWD={env['DB_PASSWORD']};"
    "Encrypt=yes;TrustServerCertificate=yes;Connection Timeout=30;"
)

SCHEMA, VIEW = "data_core", "vw_titulos_abertos"

cn = pyodbc.connect(conn_str, timeout=30)
cur = cn.cursor()

print("=" * 70)
print("COLUNAS")
print("=" * 70)
cur.execute(
    """
    SELECT ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE,
           CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
    """,
    SCHEMA, VIEW,
)
cols = cur.fetchall()
for r in cols:
    typ = r.DATA_TYPE
    if r.CHARACTER_MAXIMUM_LENGTH:
        typ += f"({r.CHARACTER_MAXIMUM_LENGTH})"
    elif r.NUMERIC_PRECISION and r.DATA_TYPE in ("decimal", "numeric"):
        typ += f"({r.NUMERIC_PRECISION},{r.NUMERIC_SCALE})"
    print(f"{r.ORDINAL_POSITION:>3}. {r.COLUMN_NAME:<34} {typ:<18} null={r.IS_NULLABLE}")

print(f"\nTotal de colunas: {len(cols)}")

print("\n" + "=" * 70)
print("DEFINIÇÃO DA VIEW")
print("=" * 70)
try:
    cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID(?))", f"{SCHEMA}.{VIEW}")
    definition = cur.fetchone()[0]
    print(definition if definition else "(sem definição acessível)")
except Exception as e:
    print(f"(erro ao obter definição: {e})")

print("\n" + "=" * 70)
print("CONTAGEM DE LINHAS")
print("=" * 70)
try:
    cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.{VIEW}")
    print(f"Linhas: {cur.fetchone()[0]:,}")
except Exception as e:
    print(f"(erro: {e})")

print("\n" + "=" * 70)
print("AMOSTRA (TOP 5)")
print("=" * 70)
cur.execute(f"SELECT TOP 5 * FROM {SCHEMA}.{VIEW}")
colnames = [d[0] for d in cur.description]
rows = cur.fetchall()
for i, row in enumerate(rows, 1):
    print(f"\n--- linha {i} ---")
    for name, val in zip(colnames, row):
        s = str(val)
        if len(s) > 80:
            s = s[:80] + "…"
        print(f"  {name:<34} = {s}")

cn.close()
print("\nOK")
