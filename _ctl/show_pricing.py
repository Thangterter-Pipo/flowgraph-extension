"""Print the extracted model credit/capability matrix as a compact table."""
import json

d = json.load(open("e:/Flow_veo/_ctl/pricing.json", encoding="utf-8"))["data"]["value"]
rows = d["rows"]


def cm(v):
    """Flatten creditMapping into 'tier=cost' pairs."""
    if v is None:
        return "-"
    if isinstance(v, dict):
        parts = []
        for k, val in v.items():
            if isinstance(val, dict):
                inner = ",".join(f"{a}:{b}" for a, b in val.items())
                parts.append(f"{k}={{{inner}}}")
            else:
                parts.append(f"{k}={val}")
        return " ".join(parts)
    return str(v)


for kind in ("image", "video"):
    print(f"\n########## {kind.upper()} ##########")
    for r in rows:
        if r["kind"] != kind:
            continue
        print(f"- {r['key']}  [{r['familyId']}]")
        print(f"    credits      : {cm(r['creditMapping'])}")
        if r["videoLengthSeconds"] is not None:
            print(f"    lenSec       : {r['videoLengthSeconds']}  genSec: {r['generationTimeSeconds']}")
        else:
            print(f"    genSec       : {r['generationTimeSeconds']}")
        if r["supportedResolutions"]:
            print(f"    resolutions  : {r['supportedResolutions']}")
        if r["outputsAudio"] is not None:
            print(f"    audio        : {r['outputsAudio']}  maxImgIn: {r['maxImageInputs']}")
        if r["maxImageReferences"] is not None:
            print(f"    maxImgRefs   : {r['maxImageReferences']}")
        if r["inputSpec"]:
            print(f"    inputSpec    : {json.dumps(r['inputSpec'], ensure_ascii=False)[:220]}")
        if r["requirements"]:
            print(f"    requirements : {json.dumps(r['requirements'], ensure_ascii=False)[:220]}")
