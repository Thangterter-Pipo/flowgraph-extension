"""Merge all schema captures into one master evidence file.

Entries are keyed by "METHOD redacted_url". When the same key shows up in several
captures, the one carrying request/response shapes wins, since that is the evidence
the documentation depends on.
"""
import glob
import json
import os

BASE = "e:/Flow_veo/_ctl"
merged = {}

# Probe runs can leave entries whose URL still holds a non-UUID id; they are noise.
def is_noise(key):
    return "achernar" in key


for path in sorted(glob.glob(os.path.join(BASE, "schemas*.json"))):
    if path.endswith("schemas_master.json"):
        continue
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        print(f"skip {os.path.basename(path)}: {e}")
        continue
    for k, v in d.items():
        if is_noise(k):
            continue
        cur = merged.get(k)
        if cur is None:
            merged[k] = v
            continue
        # Prefer the entry that actually captured request/response shapes.
        score = lambda x: (x.get("req") is not None) + (x.get("res") is not None)
        if score(v) > score(cur):
            merged[k] = v

# Fold in whatever the current master already proved, so re-running a narrow
# capture never drops evidence collected in an earlier session.
master_path = os.path.join(BASE, "schemas_master.json")
if os.path.exists(master_path):
    try:
        prev = json.load(open(master_path, encoding="utf-8"))
    except Exception as e:
        prev = {}
        print(f"skip existing master: {e}")
    for k, v in prev.items():
        if is_noise(k):
            continue
        cur = merged.get(k)
        score = lambda x: (x.get("req") is not None) + (x.get("res") is not None)
        if cur is None or score(v) > score(cur):
            merged[k] = v

out = master_path
with open(out, "w", encoding="utf-8") as fh:
    json.dump(merged, fh, ensure_ascii=False, indent=1)

non_options = [k for k in merged if not k.startswith("OPTIONS")]
with_shape = [k for k in non_options
              if merged[k].get("req") is not None or merged[k].get("res") is not None]

print(f"merged total : {len(merged)}")
print(f"non-OPTIONS  : {len(non_options)}")
print(f"with req/res : {len(with_shape)}")
print(f"written      : {out}")
print()
for k in sorted(non_options):
    m = merged[k]
    flag = "R4" if (m.get("req") is not None or m.get("res") is not None) else "R1"
    print(f"[{flag}] {m.get('status')} {k}")
