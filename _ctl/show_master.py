"""Print schemas from the merged master file, filtered."""
import json
import sys

d = json.load(open("e:/Flow_veo/_ctl/schemas_master.json", encoding="utf-8"))
pats = [p.lower() for p in sys.argv[1:]] or [""]

for k in sorted(d):
    if k.startswith("OPTIONS"):
        continue
    if not any(p in k.lower() for p in pats):
        continue
    v = d[k]
    print("=" * 4, k, "->", v.get("status"))
    if v.get("req") is not None:
        print("  req:", json.dumps(v["req"], ensure_ascii=False)[:1200])
    if v.get("res") is not None:
        print("  res:", json.dumps(v["res"], ensure_ascii=False)[:1800])
    print()
