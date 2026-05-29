"""Lista views/tabelas do schema data_core (e afins) para achar fontes de status/acordo/protesto."""
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

print("=== SCHEMAS ===")
cur.execute("SELECT DISTINCT TABLE_SCHEMA FROM INFORMATION_SCHEMA.TABLES ORDER BY 1")
print(", ".join(r[0] for r in cur.fetchall()))

print("\n=== OBJETOS em data_core (view/base table) ===")
cur.execute(
    """
    SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA='data_core' ORDER BY TABLE_TYPE, TABLE_NAME
    """
)
for r in cur.fetchall():
    print(f"  [{r.TABLE_TYPE:<10}] {r.TABLE_NAME}")

print("\n=== objetos cujo nome sugere cobrança/acordo/protesto/negoc/ocorrencia (qualquer schema) ===")
cur.execute(
    """
    SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES
    WHERE LOWER(TABLE_NAME) LIKE '%acordo%' OR LOWER(TABLE_NAME) LIKE '%protest%'
       OR LOWER(TABLE_NAME) LIKE '%negoc%'  OR LOWER(TABLE_NAME) LIKE '%cobran%'
       OR LOWER(TABLE_NAME) LIKE '%ocorrenc%' OR LOWER(TABLE_NAME) LIKE '%status%'
       OR LOWER(TABLE_NAME) LIKE '%acomp%' OR LOWER(TABLE_NAME) LIKE '%contato%'
       OR LOWER(TABLE_NAME) LIKE '%historic%' OR LOWER(TABLE_NAME) LIKE '%fase%'
       OR LOWER(TABLE_NAME) LIKE '%regua%'  OR LOWER(TABLE_NAME) LIKE '%acao%'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
    """
)
rows = cur.fetchall()
if rows:
    for r in rows:
        print(f"  {r.TABLE_SCHEMA}.{r.TABLE_NAME}  [{r.TABLE_TYPE}]")
else:
    print("  (nenhum)")

cn.close()
print("\nOK")
