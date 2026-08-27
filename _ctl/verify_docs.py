"""Check the documentation against the captured evidence files.

Every endpoint marked [VERIFIED] in docs/ must exist in schemas_master.json, and
every enum value quoted in docs/07-enums.md must appear in the downloaded frontend
bundles or in modelConfig. Anything that fails here is a documentation bug.
"""
import glob
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(os.path.dirname(BASE), "docs")
MASTER = os.path.join(BASE, "schemas_master.json")
PRICING = os.path.join(BASE, "pricing.json")
JS_DIR = os.path.join(BASE, "js")

# `v1/place` is a Google Maps embed URL that appears in the bundle but is not part
# of the Flow API surface.
ROUTE_IGNORE = {"v1/place"}

UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def norm(path):
    """Reduce an endpoint path to a comparable shape: drop ids and query strings."""
    p = path.split("?", 1)[0]
    p = UUID_RE.sub("<id>", p)
    for ph in ("<projectId>", "<workflowId>", "<mediaId>", "<sceneId>",
               "<agentSessionId>", "<id>"):
        p = p.replace(ph, "<id>")
    return p.rstrip("/")


def load_master():
    d = json.load(open(MASTER, encoding="utf-8"))
    out = {}
    for key, val in d.items():
        method, _, url = key.partition(" ")
        if method == "OPTIONS":
            continue
        url = url.replace("https://aisandbox-pa.googleapis.com", "")
        url = url.replace("https://labs.google", "")
        out.setdefault((method, norm(url)), []).append(val)
    return out


def doc_endpoints():
    """Find `METHOD /path` claims tagged with an evidence marker in the docs."""
    pat = re.compile(
        r"`(GET|POST|PATCH|PUT|DELETE)\s+(/[^`]+)`[^\n]*?\[(VERIFIED|OBSERVED|BUNDLE)\]")
    # The video table names endpoints as `video:batchAsyncGenerateVideoX` without a
    # method or leading slash, so it needs its own pattern or those claims go unchecked.
    verb_pat = re.compile(
        r"`((?:video|flow|flowMedia|flowAppletAgent):[A-Za-z]+)`[^\n]*?\[(VERIFIED|OBSERVED|BUNDLE)\]")
    found = []
    for f in sorted(glob.glob(os.path.join(DOCS, "*.md"))):
        for i, line in enumerate(open(f, encoding="utf-8"), 1):
            for m in pat.finditer(line):
                found.append((os.path.basename(f), i, m.group(1),
                              m.group(2).strip(), m.group(3)))
            for m in verb_pat.finditer(line):
                found.append((os.path.basename(f), i, "POST",
                              "/v1/" + m.group(1), m.group(2)))
    return found


def bundle_text():
    parts = []
    for f in glob.glob(os.path.join(JS_DIR, "*.js")):
        parts.append(open(f, encoding="utf-8", errors="ignore").read())
    return "\n".join(parts)


def docs_text():
    parts = []
    for f in glob.glob(os.path.join(DOCS, "*.md")):
        parts.append(open(f, encoding="utf-8").read())
    return "\n".join(parts)


def check_coverage(js, docs, master, fails):
    """Every route we have evidence for must be mentioned somewhere in the docs."""
    routes = set(re.findall(r"v1/[a-zA-Z0-9/:._\-]+", js))
    routes |= set(re.findall(r"v1:[a-zA-Z]+", js))
    routes |= {"video:" + m for m in
               re.findall(r"batchAsyncGenerateVideo[A-Za-z]+", js)}
    for r in sorted(routes):
        if r in ROUTE_IGNORE:
            continue
        tail = r.rstrip("/").split("/")[-1]
        if r not in docs and tail not in docs:
            fails.append(f"route tu bundle chua duoc tai lieu hoa: {r}")

    for method, path in master:
        tail = path.rstrip("/").split("/")[-1]
        if path not in docs and tail not in docs:
            fails.append(f"endpoint da bat nhung chua co trong docs: {method} {path}")


def main():
    fails, warns, checks = [], [], 0

    master = load_master()
    eps = doc_endpoints()
    if not eps:
        fails.append("khong tim thay endpoint nao co nhan bang chung trong docs/")

    for fname, line, method, path, tag in eps:
        checks += 1
        key = (method, norm(path))
        if tag == "VERIFIED" and key not in master:
            fails.append(f"{fname}:{line} [VERIFIED] nhung khong co trong "
                         f"schemas_master.json: {method} {path}")
        elif tag == "OBSERVED" and key not in master:
            warns.append(f"{fname}:{line} [OBSERVED] chua co ban ghi: {method} {path}")

    js = bundle_text()
    pricing_blob = ""
    if os.path.exists(PRICING):
        pricing_blob = open(PRICING, encoding="utf-8").read()

    if js:
        checks += 1
        check_coverage(js, docs_text(), master, fails)

    enum_doc = os.path.join(DOCS, "07-enums.md")
    if os.path.exists(enum_doc) and js:
        text = open(enum_doc, encoding="utf-8").read()
        vals = set(re.findall(r"^([A-Z][A-Z0-9_]{6,})\s*(?://.*)?$",
                              text, re.MULTILINE))
        for v in sorted(vals):
            checks += 1
            if v not in js and v not in pricing_blob:
                fails.append(f"07-enums.md: enum khong co trong bundle/modelConfig: {v}")

    price_doc = os.path.join(DOCS, "06-models-pricing.md")
    if os.path.exists(price_doc) and pricing_blob:
        rows = json.loads(pricing_blob)["data"]["value"]["rows"]
        keys = {r["key"] for r in rows}
        text = open(price_doc, encoding="utf-8").read()
        # Only the model tables name usage keys; the tier-defaults table also starts
        # with a backticked cell, so skip SERVICE_TIER_* rows.
        table_keys = {k for k in re.findall(r"^\| `([a-zA-Z0-9_]+)` \|", text,
                                            re.MULTILINE)
                      if not k.startswith("SERVICE_TIER_")}
        checks += 1
        extra = {k for k in table_keys if k not in keys}
        if extra:
            fails.append("06-models-pricing.md: usage key khong co trong modelConfig: "
                         f"{sorted(extra)[:5]}")
        checks += 1
        if keys - table_keys:
            fails.append("06-models-pricing.md: thieu usage key: "
                         f"{sorted(keys - table_keys)[:5]}")

    for f in sorted(glob.glob(os.path.join(DOCS, "*.md"))):
        body = open(f, encoding="utf-8").read()
        checks += 1
        for m in UUID_RE.finditer(body):
            fails.append(f"{os.path.basename(f)}: lo UUID that: {m.group(0)[:8]}...")
        # A real token has a long opaque tail; `ya29...` / `ya29.<access_token>`
        # are placeholders and must not trip the check.
        if re.search(r"ya29\.[A-Za-z0-9_\-]{10,}", body):
            fails.append(f"{os.path.basename(f)}: co the lo access token that")

    print(f"checks : {checks}")
    print(f"docs   : {len(eps)} endpoint co nhan bang chung")
    print(f"master : {len(master)} endpoint da bat duoc")
    for w in warns:
        print(f"WARN   : {w}")
    for f in fails:
        print(f"FAIL   : {f}")
    print("OK" if not fails else f"{len(fails)} FAIL")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
