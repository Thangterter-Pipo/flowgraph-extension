"""Print captured route schemas, filtered. Usage: python show.py <substr> [<substr> ...]"""
import json
import sys

PATH = "e:/Flow_veo/_ctl/schemas.json"
d = json.load(open(PATH, encoding="utf-8"))
pats = [p.lower() for p in sys.argv[1:]] or [""]

for k in sorted(d):
    if k.startswith("OPTIONS"):
        continue
    if not any(p in k.lower() for p in pats):
        continue
    v = d[k]
    print("=" * 4, k)
    print("   status:", v.get("status"), "| ctype:", (v.get("ctype") or "")[:40],
          "| hits:", v.get("hits"))
    if v.get("req") is not None:
        print("   req :", json.dumps(v["req"], ensure_ascii=False)[:1800])
    if v.get("res") is not None:
        print("   res :", json.dumps(v["res"], ensure_ascii=False)[:2600])
    print()
