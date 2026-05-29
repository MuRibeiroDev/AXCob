"""Sondagem READ-ONLY do Smart Process 1200 (Protestos cat 116):
lista campos (incl. obrigatórios) e estágios. NÃO cria nada."""
import json, urllib.request, os

# webhook do backend/.env (não imprime o segredo)
wh = None
with open(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"), encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line.startswith("BITRIX_WEBHOOK_URL="):
            wh = line.split("=", 1)[1].strip().rstrip("/")
assert wh, "BITRIX_WEBHOOK_URL não encontrado"

def call(method, payload):
    req = urllib.request.Request(f"{wh}/{method}", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

print("=== crm.item.fields (entityTypeId=1200) ===")
data = call("crm.item.fields", {"entityTypeId": 1200})
fields = data.get("result", {}).get("fields", {})
print(f"total de campos: {len(fields)}\n")
# foca nos campos que interessam + obrigatórios
alvo = {
    "ufCrm58_1760096145": "Número do Título",
    "ufCrm58_1759923144": "CNPJ/CPF Sacado",
    "ufCrm58_1759253307": "Razão Cedente",
    "ufCrm58_1759923007": "Razão Sacado",
    "ufCrm58_1759926553": "Plataforma",
}
print("--- campos custom que usamos ---")
for fid, nome in alvo.items():
    f = fields.get(fid)
    if f:
        print(f"  {fid} [{nome}] type={f.get('type')} required={f.get('isRequired')} multiple={f.get('isMultiple')} title='{f.get('title')}'")
    else:
        print(f"  {fid} [{nome}] -> NÃO ENCONTRADO")

print("\n--- todos os campos OBRIGATÓRIOS ---")
for fid, f in fields.items():
    if f.get("isRequired"):
        print(f"  {fid}  title='{f.get('title')}' type={f.get('type')}")

print("\n=== estágios da categoria 116 (crm.status.list / item) ===")
try:
    cats = call("crm.category.list", {"entityTypeId": 1200})
    for c in cats.get("result", {}).get("categories", []):
        print(f"  category id={c.get('id')} name='{c.get('name')}'")
except Exception as e:
    print("  (erro categorias:", e, ")")

print("\nOK")
