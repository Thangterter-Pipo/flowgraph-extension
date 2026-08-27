"""Generate docs/06-models-pricing.md straight from the captured modelConfig.

Writing the 82-row credit matrix by hand invites transcription errors, so the
table is emitted from pricing.json (the extracted modelConfig) instead.
"""
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "pricing.json")
MODELS = os.path.join(BASE, "models.json")
OUT = os.path.join(os.path.dirname(BASE), "docs", "06-models-pricing.md")

TIERS = ("SERVICE_TIER_ENTRY", "SERVICE_TIER_INTERMEDIATE", "SERVICE_TIER_ADVANCED")


def cost(mapping, tier):
    if not isinstance(mapping, dict):
        return "-"
    v = mapping.get(tier)
    if not isinstance(v, dict):
        return "-"
    c = v.get("cost")
    if c == "UNAVAILABLE":
        return "n/a"
    return str(c)


def ar_short(vals):
    if not vals:
        return "-"
    seen = []
    for v in vals:
        s = {"LANDSCAPE": "L", "PORTRAIT": "P", "SQUARE": "1:1",
             "PORTRAIT_3_4": "3:4", "LANDSCAPE_4_3": "4:3"}.get(v, v)
        if s not in seen:
            seen.append(s)
    return "/".join(seen)


def mode_of(key):
    """Classify a usage key into a generation mode, based on its name segments."""
    k = key.lower()
    if "upsample" in k or "upsampler" in k:
        return "upsample"
    if "interpolation" in k or k.endswith("_fl") or "_fl_" in k:
        return "start+end image"
    if "extend" in k or "extension" in k:
        return "extend"
    if "edit" in k:
        return "edit"
    if "r2v" in k:
        return "reference-to-video"
    if "i2v" in k:
        return "image-to-video"
    if "t2v" in k:
        return "text-to-video"
    return "image"


def main():
    d = json.load(open(SRC, encoding="utf-8"))["data"]["value"]
    rows = d["rows"]
    dep = json.load(open(MODELS, encoding="utf-8"))["data"]["value"]["deprecatedModelKeys"]

    L = []
    w = L.append
    w("# 6. Danh mục model và bảng giá credit")
    w("")
    w("Nguồn: `modelConfig` trong `GET /fx/api/trpc/flow.projectInitialData`.")
    w("File này được sinh tự động từ dữ liệu bắt được (`_ctl/gen_pricing_doc.py`),")
    w("không gõ tay.")
    w("")
    w(f"Tổng: **{len(rows)} usage key** đang hiệu lực "
      f"({sum(1 for r in rows if r['kind'] == 'image')} ảnh, "
      f"{sum(1 for r in rows if r['kind'] == 'video')} video) "
      f"và **{len(dep)} model key đã deprecated**.")
    w("")
    w("## 6.1 Cách đọc bảng")
    w("")
    w("- Cột ENTRY / INTERMEDIATE / ADVANCED là chi phí credit theo `serviceTier` của")
    w("  tài khoản (đọc từ `GET /v1/credits`). `n/a` = `UNAVAILABLE`, không dùng được")
    w("  ở tier đó.")
    w("- `len` là độ dài video (giây). `gen` là thời gian sinh ước tính (giây).")
    w("- `AR` là aspect ratio cho phép: L = LANDSCAPE, P = PORTRAIT.")
    w("- `usage key` là giá trị truyền vào `videoModelKey` (video) hoặc")
    w("  `imageModelName` (ảnh).")
    w("")
    w("## 6.2 Mặc định theo tier")
    w("")
    w("| serviceTier | Họ model ảnh | Họ model video |")
    w("|-------------|--------------|----------------|")
    for t in TIERS:
        td = (d.get("tierDefaults") or {}).get(t) or {}
        w(f"| `{t}` | `{td.get('defaultImageModelFamily', '-')}` | "
          f"`{td.get('defaultVideoModelFamily', '-')}` |")
    w("")
    w(f"Model âm thanh dùng chung: `{d.get('audioModelKey')}`.")
    w("")
    w("## 6.3 Các họ model")
    w("")
    w("| Tên hiển thị | familyId | Loại | Số usage key |")
    w("|--------------|----------|------|--------------|")
    order, seen = [], set()
    for r in rows:
        k = (r["kind"], r["family"], r["familyId"])
        if k not in seen:
            seen.add(k)
            order.append(k)
    for kind, family, fid in order:
        n = sum(1 for r in rows if r["familyId"] == fid)
        w(f"| {family} | `{fid}` | {kind} | {n} |")
    w("")
    w("## 6.4 Model ảnh")
    w("")
    w("| usage key | familyId | ENTRY | INTERMEDIATE | ADVANCED | gen | AR | maxRefs |")
    w("|-----------|----------|-------|--------------|----------|-----|----|---------|")
    for r in rows:
        if r["kind"] != "image":
            continue
        w(f"| `{r['key']}` | `{r['familyId']}` | {cost(r['creditMapping'], TIERS[0])} | "
          f"{cost(r['creditMapping'], TIERS[1])} | {cost(r['creditMapping'], TIERS[2])} | "
          f"{r['generationTimeSeconds']} | {ar_short(r['supportedAspectRatios'])} | "
          f"{r['maxImageReferences'] if r['maxImageReferences'] is not None else '-'} |")
    w("")
    w("## 6.5 Model video")
    w("")
    for kind, family, fid in order:
        if kind != "video":
            continue
        w(f"### {family} (`{fid}`)")
        w("")
        w("| usage key | Chế độ | ENTRY | INTERMEDIATE | ADVANCED | len | gen | AR | audio | maxImgIn |")
        w("|-----------|--------|-------|--------------|----------|-----|-----|----|-------|----------|")
        for r in rows:
            if r["familyId"] != fid:
                continue
            w(f"| `{r['key']}` | {mode_of(r['key'])} | "
              f"{cost(r['creditMapping'], TIERS[0])} | "
              f"{cost(r['creditMapping'], TIERS[1])} | "
              f"{cost(r['creditMapping'], TIERS[2])} | "
              f"{r['videoLengthSeconds'] if r['videoLengthSeconds'] is not None else '-'} | "
              f"{r['generationTimeSeconds']} | {ar_short(r['supportedAspectRatios'])} | "
              f"{'có' if r['outputsAudio'] else 'không'} | "
              f"{r['maxImageInputs'] if r['maxImageInputs'] is not None else '-'} |")
        w("")
        res = next((r["supportedResolutions"] for r in rows
                    if r["familyId"] == fid and r["supportedResolutions"]), None)
        if res:
            w(f"Độ phân giải hỗ trợ: {', '.join('`' + x + '`' for x in res)}.")
            w("")
    w("## 6.6 Giới hạn input theo model")
    w("")
    w("| usage key | maxCharacters | maxAudioRefs | maxInputV2vDuration | requirements |")
    w("|-----------|---------------|--------------|---------------------|--------------|")
    seen_sig = set()
    for r in rows:
        spec = r.get("inputSpec") or {}
        req = r.get("requirements") or []
        sig = json.dumps([spec, req], sort_keys=True)
        if sig in seen_sig:
            continue
        seen_sig.add(sig)
        combos = " ; ".join(
            "+".join(x.replace("VIDEO_REQUIREMENT_", "").replace("IMAGE_REQUIREMENT_", "")
                     for x in combo)
            for combo in req) or "-"
        w(f"| `{r['key']}` | {spec.get('maxCharacters') if spec.get('maxCharacters') is not None else '-'} | "
          f"{spec.get('maxAudioReferences') if spec.get('maxAudioReferences') is not None else '-'} | "
          f"{spec.get('maxInputV2vVideoDuration') if spec.get('maxInputV2vVideoDuration') is not None else '-'} | "
          f"{combos} |")
    w("")
    w("Các usage key không liệt kê ở đây dùng chung một tổ hợp input với một dòng phía")
    w("trên (bảng chỉ giữ các tổ hợp khác nhau).")
    w("")
    w("## 6.7 Model key đã deprecated")
    w("")
    w(f"{len(dep)} key dưới đây còn xuất hiện trong `deprecatedModelKeys`. Không dùng")
    w("cho tích hợp mới; chúng chỉ để đọc lại media cũ.")
    w("")
    w("```text")
    for i in range(0, len(dep), 2):
        w("  ".join(dep[i:i + 2]))
    w("```")
    w("")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(L))
    print(f"written {OUT} ({len(L)} lines)")


if __name__ == "__main__":
    main()
