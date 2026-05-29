"""Compara contagem de vencidos por carteira sob diferentes regras de join/filtro,
para isolar o que diverge entre o Power BI (join por CNPJ, sem M='C') e o backend
(join por NOME, com M='C')."""
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
    timeout=120,
)
cur = cn.cursor()

# filtros base idênticos à fonte do Power BI (fTitulosAbertos)
BASE = """
  t.TIPO IN ('ADC','CCB','CHQ','CTR','CPR','DES','DMR','NCO','NPP','DSR')
  AND t.HISTORICO NOT LIKE '%PAGO%'
  AND t.CPF_CNPJ_CEDENTE <> '05.673.133/0001-42'
  AND t.OP <> 7190
  AND DATEDIFF(DAY, t.VENCIMENTO, CAST(GETDATE() AS DATE)) > 0
"""

CED_NOME = """(SELECT NOME COL, MAX(RESPONSAVEL_COBRANCA) RESP FROM data_core.vw_cedentes
  WHERE RESPONSAVEL_COBRANCA IS NOT NULL AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA))<>'' GROUP BY NOME)"""
CED_CNPJ = """(SELECT CPF_CNPJ COL, MAX(RESPONSAVEL_COBRANCA) RESP FROM data_core.vw_cedentes
  WHERE RESPONSAVEL_COBRANCA IS NOT NULL AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA))<>'' GROUP BY CPF_CNPJ)"""


def total(join_sql, on, extra=""):
    cur.execute(f"""
      SELECT COUNT(*) FROM data_core.vw_titulos_abertos_espelho_bi t
      JOIN {join_sql} c ON {on}
      WHERE {BASE} {extra}
    """)
    return cur.fetchone()[0]

print("=== TOTAIS (todas as carteiras) ===")
n_nome      = total(CED_NOME, "c.COL = t.CEDENTE")
n_nome_m    = total(CED_NOME, "c.COL = t.CEDENTE", "AND t.M = 'C'")
n_cnpj      = total(CED_CNPJ, "c.COL = t.CPF_CNPJ_CEDENTE")
n_cnpj_m    = total(CED_CNPJ, "c.COL = t.CPF_CNPJ_CEDENTE", "AND t.M = 'C'")
print(f"  join NOME, sem M='C'  (≈ esperado p/ bater PBI): {n_nome:>7}")
print(f"  join NOME, COM M='C'  (BACKEND ATUAL):           {n_nome_m:>7}   -> perda por M='C': {n_nome - n_nome_m}")
print(f"  join CNPJ, sem M='C'  (≈ PBI real):              {n_cnpj:>7}")
print(f"  join CNPJ, COM M='C':                            {n_cnpj_m:>7}")
print(f"  DIFERENÇA join NOME vs CNPJ (sem M): {n_cnpj - n_nome}  (títulos atribuídos diferente/perdidos)")

# quantos títulos NÃO casam por NOME mas casariam por CNPJ
cur.execute(f"""
  SELECT COUNT(*) FROM data_core.vw_titulos_abertos_espelho_bi t
  WHERE {BASE}
    AND t.CPF_CNPJ_CEDENTE IN (SELECT CPF_CNPJ FROM data_core.vw_cedentes
        WHERE RESPONSAVEL_COBRANCA IS NOT NULL AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA))<>'')
    AND t.CEDENTE NOT IN (SELECT NOME FROM data_core.vw_cedentes
        WHERE RESPONSAVEL_COBRANCA IS NOT NULL AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA))<>'')
""")
print(f"\n  títulos com CNPJ-cedente conhecido mas NOME que NÃO casa (perdidos no join por NOME): {cur.fetchone()[0]}")

print("\n=== POR CARTEIRA (join CNPJ, sem M='C' — alvo PBI) top 12 ===")
cur.execute(f"""
  SELECT c.RESP, COUNT(*) q FROM data_core.vw_titulos_abertos_espelho_bi t
  JOIN {CED_CNPJ} c ON c.COL = t.CPF_CNPJ_CEDENTE
  WHERE {BASE} GROUP BY c.RESP ORDER BY q DESC
""")
cnpj_map = {r.RESP: r.q for r in cur.fetchall()}
cur.execute(f"""
  SELECT c.RESP, COUNT(*) q FROM data_core.vw_titulos_abertos_espelho_bi t
  JOIN {CED_NOME} c ON c.COL = t.CEDENTE
  WHERE {BASE} AND t.M='C' GROUP BY c.RESP ORDER BY q DESC
""")
backend_map = {r.RESP: r.q for r in cur.fetchall()}
print(f"  {'RESPONSAVEL':<38}{'PBI(cnpj)':>10}{'BACKEND':>9}{'dif':>7}")
for resp in sorted(cnpj_map, key=lambda k: -cnpj_map[k])[:12]:
    b = backend_map.get(resp, 0)
    print(f"  {str(resp):<38}{cnpj_map[resp]:>10}{b:>9}{cnpj_map[resp]-b:>7}")

cn.close()
print("\nOK")
