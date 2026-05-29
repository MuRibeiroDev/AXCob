"""READ-ONLY: lista TODOS os campos uf do SPA 1200 (id, título, tipo, múltiplo, enum items)
e os estágios da categoria 116. Pra mapear o formulário de protesto."""
import json, os, urllib.request

wh = None
with open(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"), encoding="utf-8") as f:
    for line in f:
        if line.strip().startswith("BITRIX_WEBHOOK_URL="):
            wh = line.split("=", 1)[1].strip().rstrip("/")

def call(method, payload):
    req = urllib.request.Request(f"{wh}/{method}", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

fields = call("crm.item.fields", {"entityTypeId": 1200})["result"]["fields"]
print("=== CAMPOS (uf_*) ===")
for fid, f in sorted(fields.items()):
    if not fid.lower().startswith("ufcrm"):
        continue
    line = f"  {fid}  type={f.get('type'):<12} mult={str(f.get('isMultiple')):<5} req={str(f.get('isRequired')):<5} title='{f.get('title')}'"
    print(line)
    if f.get("type") == "enumeration":
        for i in (f.get("items") or []):
            print(f"        - {i.get('ID')}: {i.get('VALUE')}")

print("\n=== ESTÁGIOS categoria 116 ===")
for eid in ("DYNAMIC_1200_STAGE_116", "DYNAMIC_1200_STAGE_3_116"):
    try:
        st = call("crm.status.list", {"filter": {"ENTITY_ID": eid}})
        rows = st.get("result", [])
        if rows:
            print(f"  (ENTITY_ID={eid})")
            for s in rows:
                print(f"    {s.get('STATUS_ID')}  '{s.get('NAME')}'  sort={s.get('SORT')}")
            break
    except Exception as e:
        print(f"  erro {eid}: {e}")
else:
    # fallback: lista entity ids de status que contenham 1200
    allst = call("crm.status.entity.types", {})
    for t in allst.get("result", []):
        if "1200" in str(t.get("ID", "")):
            print("   entity:", t.get("ID"), t.get("NAME"))
print("\nOK")
