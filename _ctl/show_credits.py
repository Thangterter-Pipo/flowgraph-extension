"""Compact per-tier credit table for every video model usage key."""
import json

d = json.load(open("e:/Flow_veo/_ctl/pricing.json", encoding="utf-8"))["data"]["value"]


def cost(v):
    if not isinstance(v, dict):
        return "-"

    def g(t):
        x = v.get(t)
        if isinstance(x, dict):
            return x.get("cost")
        return x

    return f"E={g('SERVICE_TIER_ENTRY')} I={g('SERVICE_TIER_INTERMEDIATE')} A={g('SERVICE_TIER_ADVANCED')}"


for kind in ("video", "image"):
    print(f"===== {kind} =====")
    for r in d["rows"]:
        if r["kind"] != kind:
            continue
        extra = ""
        if r["videoLengthSeconds"] is not None:
            extra = f" len={r['videoLengthSeconds']}s audio={r['outputsAudio']} imgIn={r['maxImageInputs']}"
        print(f"{r['key']:<48}{cost(r['creditMapping']):<28}{extra}")
    print()
