"""Monta o JSON que seria enviado ao crm.item.add (protesto), com dados REAIS de
um título vencido. NÃO envia nada — só imprime o payload."""
import json, os, urllib.request, pyodbc

root = os.path.join(os.path.dirname(__file__), "..")
env = {}
with open(os.path.join(root, ".env"), encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); env[k.strip()] = v.strip()
wh = None
with open(os.path.join(root, "backend", ".env"), encoding="utf-8") as f:
    for line in f:
        if line.strip().startswith("BITRIX_WEBHOOK_URL="):
            wh = line.split("=", 1)[1].strip().rstrip("/")

# 1) itens do enum Plataforma (read-only)
def call(method, payload):
    req = urllib.request.Request(f"{wh}/{method}", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

fields = call("crm.item.fields", {"entityTypeId": 1200})["result"]["fields"]
plat = fields.get("ufCrm58_1759926553", {})
plat_items = {i.get("VALUE"): i.get("ID") for i in (plat.get("items") or [])}
print("Plataforma (enum) itens:", plat_items)

# 2) um título vencido real (Michely), não-encargo
cn = pyodbc.connect(
    f"DRIVER={{{env['DB_DRIVER']}}};SERVER={env['DB_HOST']},{env['DB_PORT']};"
    f"DATABASE={env['DB_NAME']};UID={env['DB_USER']};PWD={env['DB_PASSWORD']};"
    "Encrypt=yes;TrustServerCertificate=yes;Connection Timeout=30;", timeout=60)
cur = cn.cursor()
cur.execute("""
  SELECT TOP 1 t.DOCUMENTO, t.SACADO, t.CPF_CNPJ_SACADO, t.CEDENTE, t.CPF_CNPJ_CEDENTE,
         t.SISTEMA, t.VENCIMENTO, t.VALOR, t.TOTAL, t.TIPO,
         DATEDIFF(DAY,t.VENCIMENTO,CAST(GETDATE() AS DATE)) DIAS
  FROM data_core.vw_titulos_abertos_espelho_bi t
  JOIN (SELECT CPF_CNPJ, MAX(RESPONSAVEL_COBRANCA) RESP FROM data_core.vw_cedentes
        WHERE RESPONSAVEL_COBRANCA IS NOT NULL AND LTRIM(RTRIM(RESPONSAVEL_COBRANCA))<>'' GROUP BY CPF_CNPJ) c
    ON c.CPF_CNPJ = t.CPF_CNPJ_CEDENTE AND c.RESP = 'MICHELY FERREIRA MENDES'
  WHERE t.TIPO IN ('CCB','CHQ','CTR','CPR','DES','DMR','NCO','NPP','DSR')
    AND DATEDIFF(DAY,t.VENCIMENTO,CAST(GETDATE() AS DATE)) > 90
    AND t.HISTORICO NOT LIKE '%PAGO%'
  ORDER BY t.TOTAL DESC""")
r = cur.fetchone()
cn.close()

sacado_limpo = (r.SACADO or "").rsplit("-", 1)[0].strip()  # tira sufixo -Sacado
sistema = (r.SISTEMA or "").upper()
# roteamento de estágio por plataforma
if "SEC" in sistema or "SECUR" in sistema:
    stage, plat_label = "DT1200_116:CLIENT", "SEC"
elif "AGRO" in sistema or "LION" in sistema:
    stage, plat_label = "DT1200_116:UC_TI73RL", "LION"
else:
    stage, plat_label = "DT1200_116:UC_1CUNSV", "FIDC"

fields_payload = {
    "categoryId": 116,
    "stageId": stage,
    "title": f"{r.CEDENTE} · {r.DOCUMENTO}",
    "ufCrm58_1760096145": r.DOCUMENTO,                 # Número do Título
    "ufCrm58_1759923144": [r.CPF_CNPJ_SACADO],         # CNPJ/CPF Sacado (múltiplo)
    "ufCrm58_1759923007": [sacado_limpo],              # Razão Sacado (múltiplo)
    "ufCrm58_1759253307": r.CEDENTE,                   # Razão Cedente
}
if plat_label in plat_items:
    fields_payload["ufCrm58_1759926553"] = plat_items[plat_label]  # Plataforma (id do enum)

payload = {"entityTypeId": 1200, "fields": fields_payload}

print("\n--- contexto do título real ---")
print(f"  doc={r.DOCUMENTO} sacado='{sacado_limpo}' cnpj={r.CPF_CNPJ_SACADO}")
print(f"  cedente='{r.CEDENTE}' sistema={r.SISTEMA} dias={r.DIAS} valorFace={float(r.VALOR or 0):,.2f} tipo={r.TIPO}")
print("\n=== PAYLOAD crm.item.add ===")
print(json.dumps(payload, ensure_ascii=False, indent=2))
