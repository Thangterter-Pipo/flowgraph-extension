"""
Flow controller — keeps a visible Camoufox browser alive and accepts file-based commands.

Why this exists: camoufox-cli's Node daemon fails on Windows (Unix socket), and the
"connect + exit" model kills the browser context when the client disconnects. So we
hold one long-lived process that owns the context and executes commands from a file.

Privacy posture (matches the FLOW_* documentation protocol):
  - Never dumps cookies, storage, Authorization headers or request/response bodies.
  - Network log keeps method + status + content-type + REDACTED url (UUIDs masked,
    query values stripped, only key names kept).
  - Console log is captured as-is but is only surfaced on request.
"""

import json
import os
import re
import sys
import time
import traceback

BASE = os.path.dirname(os.path.abspath(__file__))
CMD = os.path.join(BASE, "cmd.json")
RES = os.path.join(BASE, "result.json")
STATUS = os.path.join(BASE, "status.json")
PROFILE = os.path.join(BASE, "profile")

START_URL = os.environ.get("FLOW_START_URL", "https://labs.google/fx/vi/tools/flow")

UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
LONGTOK_RE = re.compile(r"\b[A-Za-z0-9_\-]{40,}\b")


def redact(url: str) -> str:
    """Mask private identifiers and drop query values, keeping only key names."""
    if not url:
        return url
    if url.startswith("data:"):
        return "data:<inline>"
    base, _, query = url.partition("?")
    base = UUID_RE.sub("<id>", base)
    base = LONGTOK_RE.sub("<tok>", base)
    if query:
        keys = []
        for part in query.split("&"):
            k = part.split("=", 1)[0]
            if k:
                keys.append(k)
        return f"{base}?<{','.join(keys)}>"
    return base


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)
    # On Windows the replace fails if a reader has the target open, which happens
    # whenever a client polls this file. Retry briefly instead of losing the result.
    for attempt in range(40):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.05 * (attempt + 1))
    os.replace(tmp, path)


def skeleton(obj, depth=0, max_depth=6):
    """Reduce a JSON value to field names + value TYPES only. Never keeps values.

    This is what the documentation protocol allows for R4 evidence: response/request
    field names and types, with no user, project or media identifiers.
    """
    if depth > max_depth:
        return "..."
    if isinstance(obj, dict):
        out = {}
        for k in list(obj.keys())[:60]:
            out[k] = skeleton(obj[k], depth + 1, max_depth)
        return out
    if isinstance(obj, list):
        if not obj:
            return ["<empty>"]
        return [skeleton(obj[0], depth + 1, max_depth), f"<list len={len(obj)}>"]
    if isinstance(obj, bool):
        return "bool"
    if isinstance(obj, int):
        return "int"
    if isinstance(obj, float):
        return "float"
    if obj is None:
        return "null"
    if isinstance(obj, str):
        # Classify shape without revealing content.
        if UUID_RE.fullmatch(obj):
            return "str<uuid>"
        if obj.startswith("http"):
            return "str<url>"
        return f"str<len={len(obj)}>"
    return type(obj).__name__


class Ctl:
    def __init__(self, context, page):
        self.ctx = context
        self.page = page
        self.net = []      # redacted network log
        self.console = []  # console messages
        self.refs = {}     # @eN -> selector info
        self.schemas = {}  # "METHOD redacted_url" -> {req:.., res:.., status:..}
        self.sse = []      # server-sent-event / stream frame shapes
        self.capture_schema = True

    # ---------- listeners ----------
    def attach(self, page):
        page.on("console", self._on_console)
        page.on("response", self._on_response)
        page.on("requestfailed", self._on_failed)

    def _on_console(self, msg):
        try:
            self.console.append({"type": msg.type, "text": msg.text[:500]})
            if len(self.console) > 800:
                del self.console[:400]
        except Exception:
            pass

    def _on_response(self, resp):
        try:
            req = resp.request
            ctype = (resp.headers or {}).get("content-type", "")[:60]
            rurl = redact(resp.url)
            self.net.append({
                "method": req.method,
                "status": resp.status,
                "ctype": ctype,
                "url": rurl,
            })
            if len(self.net) > 4000:
                del self.net[:2000]
            if self.capture_schema:
                self._capture_schema(req, resp, ctype, rurl)
        except Exception:
            pass

    def _capture_schema(self, req, resp, ctype, rurl):
        """Record request/response FIELD NAMES + TYPES for app/API routes only."""
        url = resp.url
        interesting = ("/api/trpc/" in url or "/api/auth/" in url
                       or "aisandbox-pa.googleapis.com" in url)
        if not interesting:
            return
        key = f"{req.method} {rurl}"
        entry = self.schemas.get(key) or {"status": resp.status, "ctype": ctype,
                                          "req": None, "res": None, "hits": 0}
        entry["hits"] += 1
        entry["status"] = resp.status

        # Request payload: field names only.
        if entry["req"] is None:
            try:
                pd = req.post_data
                if pd:
                    try:
                        entry["req"] = skeleton(json.loads(pd))
                    except Exception:
                        entry["req"] = f"<non-json len={len(pd)}>"
            except Exception:
                pass

        # Response payload: field names + types only.
        if entry["res"] is None:
            low = (ctype or "").lower()
            try:
                if "application/json" in low:
                    entry["res"] = skeleton(resp.json())
                elif "text/event-stream" in low:
                    entry["res"] = "<sse stream>"
                    entry["stream"] = True
            except Exception as e:
                entry["res"] = f"<unreadable: {type(e).__name__}>"

        self.schemas[key] = entry

    def _on_failed(self, req):
        try:
            self.net.append({
                "method": req.method,
                "status": "FAILED",
                "ctype": "",
                "url": redact(req.url),
            })
        except Exception:
            pass

    # ---------- helpers ----------
    def active(self):
        pages = [p for p in self.ctx.pages if not p.is_closed()]
        if not pages:
            raise RuntimeError("no open page")
        if self.page.is_closed():
            self.page = pages[-1]
            self.attach(self.page)
        return self.page

    def resolve(self, ref):
        if isinstance(ref, str) and ref.startswith("@"):
            info = self.refs.get(ref)
            if not info:
                raise RuntimeError(f"ref {ref} not found; re-run snapshot")
            return info["sel"]
        return ref

    # ---------- actions ----------
    def do(self, action, a):
        p = self.active()

        if action == "ping":
            return {"pong": True}

        if action == "url":
            return {"url": p.url}

        if action == "title":
            return {"title": p.title()}

        if action == "goto":
            p.goto(a["url"], wait_until=a.get("wait_until", "domcontentloaded"),
                   timeout=a.get("timeout", 60000))
            return {"url": p.url, "title": p.title()}

        if action == "reload":
            p.reload(wait_until="domcontentloaded", timeout=a.get("timeout", 60000))
            return {"url": p.url}

        if action == "wait":
            if "ms" in a:
                p.wait_for_timeout(a["ms"])
                return {"waited_ms": a["ms"]}
            if "selector" in a:
                p.wait_for_selector(a["selector"], timeout=a.get("timeout", 30000))
                return {"found": a["selector"]}
            if "url" in a:
                p.wait_for_url(a["url"], timeout=a.get("timeout", 60000))
                return {"url": p.url}
            return {"noop": True}

        if action == "text":
            sel = a.get("selector", "body")
            return {"text": p.inner_text(sel)[: a.get("limit", 20000)]}

        if action == "eval":
            return {"value": p.evaluate(a["expr"])}

        # Passes a structured argument to a page function instead of splicing
        # values into a JS string, so prompts containing quotes or newlines
        # survive intact.
        if action == "eval_fn":
            return {"value": p.evaluate(a["fn"], a.get("arg"))}

        if action == "screenshot":
            path = a.get("path") or os.path.join(BASE, "shot.png")
            p.screenshot(path=path, full_page=a.get("full", False))
            return {"path": path}

        if action == "click":
            p.click(self.resolve(a["ref"]), timeout=a.get("timeout", 15000))
            return {"clicked": a["ref"]}

        if action == "fill":
            p.fill(self.resolve(a["ref"]), a["value"], timeout=a.get("timeout", 15000))
            return {"filled": a["ref"]}

        if action == "press":
            p.keyboard.press(a["key"])
            return {"pressed": a["key"]}

        if action == "tabs":
            return {"tabs": [{"i": i, "url": redact(pg.url), "title": pg.title()}
                             for i, pg in enumerate(self.ctx.pages) if not pg.is_closed()]}

        if action == "switch":
            pages = [pg for pg in self.ctx.pages if not pg.is_closed()]
            self.page = pages[a["index"]]
            self.attach(self.page)
            return {"url": redact(self.page.url)}

        if action == "snapshot":
            return self.snapshot(p, a)

        if action == "net":
            n = a.get("last", 150)
            uniq = a.get("unique", False)
            rows = self.net[-n:]
            if uniq:
                seen, out = set(), []
                for r in self.net:
                    k = (r["method"], r["url"])
                    if k not in seen:
                        seen.add(k)
                        out.append(r)
                rows = out[-n:]
            return {"count": len(self.net), "rows": rows}

        if action == "net_clear":
            self.net.clear()
            return {"cleared": True}

        if action == "schemas":
            filt = a.get("filter", "")
            keys = sorted(k for k in self.schemas if filt.lower() in k.lower())
            if a.get("keys_only"):
                return {"count": len(keys), "keys": keys}
            out = {}
            for k in keys[: a.get("limit", 40)]:
                out[k] = self.schemas[k]
            return {"count": len(keys), "schemas": out}

        if action == "schema_dump":
            path = a.get("path") or os.path.join(BASE, "schemas.json")
            write_json(path, self.schemas)
            return {"path": path, "count": len(self.schemas)}

        if action == "schema_clear":
            self.schemas.clear()
            return {"cleared": True}

        if action == "console":
            return {"rows": self.console[-a.get("last", 80):]}

        if action == "viewport":
            p.set_viewport_size({"width": a["width"], "height": a["height"]})
            return {"viewport": [a["width"], a["height"]]}

        if action == "upload":
            # Attach local fixture file(s) to a file input.
            files = a["files"] if isinstance(a["files"], list) else [a["files"]]
            sel = a.get("selector", "input[type=file]")
            p.set_input_files(sel, files, timeout=a.get("timeout", 20000))
            return {"uploaded": files, "selector": sel}

        if action == "upload_chooser":
            # For inputs that only exist after a click opens a file chooser.
            files = a["files"] if isinstance(a["files"], list) else [a["files"]]
            with p.expect_file_chooser(timeout=a.get("timeout", 20000)) as fc:
                p.click(a["ref"])
            fc.value.set_files(files)
            return {"uploaded": files, "via": a["ref"]}

        if action == "mouse_click":
            # Real mouse click at the element centre; bypasses the stability
            # check that blocks page.click on animated Radix controls.
            sel = self.resolve(a["ref"])
            box = p.locator(sel).first.bounding_box()
            if not box:
                raise RuntimeError(f"no bounding box for {sel}")
            p.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            p.mouse.down()
            p.mouse.up()
            return {"clicked": sel, "at": [round(box["x"]), round(box["y"])]}

        raise RuntimeError(f"unknown action: {action}")

    def snapshot(self, p, a):
        """Interactive-element snapshot with stable @eN refs (nth-based selectors)."""
        js = """
        () => {
          const SEL = 'a[href],button,input,select,textarea,[role=button],[role=link],'
            + '[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=radio],'
            + '[role=combobox],[role=option],[role=textbox],[contenteditable=true],[tabindex]';
          const out = [];
          const seen = new Set();
          document.querySelectorAll(SEL).forEach(el => {
            if (seen.has(el)) return; seen.add(el);
            const r = el.getBoundingClientRect();
            const styl = getComputedStyle(el);
            if (styl.visibility === 'hidden' || styl.display === 'none') return;
            if (r.width === 0 && r.height === 0) return;
            let label = (el.getAttribute('aria-label') || el.innerText || el.value
              || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim();
            label = label.replace(/\\s+/g, ' ').slice(0, 90);
            out.push({
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute('role') || '',
              label: label,
              disabled: el.getAttribute('aria-disabled') === 'true' || el.disabled === true,
              expanded: el.getAttribute('aria-expanded') || '',
              checked: el.getAttribute('aria-checked') || '',
              vis: r.top < innerHeight && r.bottom > 0
            });
          });
          return out;
        }
        """
        items = p.evaluate(js)
        # Build nth-of-match selectors so refs survive until the DOM changes.
        self.refs = {}
        rows = []
        for i, it in enumerate(items, 1):
            ref = f"@e{i}"
            self.refs[ref] = {"sel": f":nth-match({it['tag']}, {i})", "label": it["label"]}
            if a.get("only_visible", True) and not it["vis"]:
                continue
            rows.append({
                "ref": ref, "tag": it["tag"], "role": it["role"], "label": it["label"],
                "disabled": it["disabled"], "expanded": it["expanded"], "checked": it["checked"],
            })
        return {"url": redact(p.url), "count": len(rows), "items": rows[: a.get("limit", 300)]}


def main():
    from camoufox.sync_api import Camoufox

    opts = dict(
        headless=False,
        humanize=True,
        os="windows",
        locale="vi-VN",
        window=(1440, 940),
        enable_cache=True,
        persistent_context=True,
        user_data_dir=PROFILE,
    )

    write_json(STATUS, {"state": "launching", "ts": time.time()})

    try:
        launcher = Camoufox(geoip=True, **opts)
        ctx = launcher.__enter__()
    except Exception as e:
        write_json(STATUS, {"state": "geoip_failed_retry", "err": str(e)[:300]})
        launcher = Camoufox(**opts)
        ctx = launcher.__enter__()

    pages = [p for p in ctx.pages if not p.is_closed()]
    page = pages[0] if pages else ctx.new_page()

    ctl = Ctl(ctx, page)
    ctl.attach(page)

    try:
        page.goto(START_URL, wait_until="domcontentloaded", timeout=90000)
    except Exception as e:
        write_json(STATUS, {"state": "nav_warn", "err": str(e)[:300]})

    write_json(STATUS, {
        "state": "ready", "ts": time.time(), "url": redact(page.url),
        "profile": PROFILE, "start_url": START_URL,
    })
    print("READY", flush=True)
    print("url:", redact(page.url), flush=True)

    # Ignore any command left over from a previous run (e.g. a stale "quit"),
    # otherwise the controller would execute it immediately on boot.
    last_id = None
    try:
        if os.path.exists(CMD):
            with open(CMD, "r", encoding="utf-8") as fh:
                last_id = json.load(fh).get("id")
            print(f"ignoring stale command id={last_id}", flush=True)
    except Exception:
        pass

    while True:
        try:
            if os.path.exists(CMD):
                with open(CMD, "r", encoding="utf-8") as fh:
                    cmd = json.load(fh)
                if cmd.get("id") != last_id:
                    last_id = cmd.get("id")
                    action = cmd.get("action", "")
                    args = cmd.get("args", {}) or {}
                    if action == "quit":
                        write_json(RES, {"id": last_id, "ok": True, "data": {"bye": True}})
                        break
                    try:
                        data = ctl.do(action, args)
                        write_json(RES, {"id": last_id, "ok": True, "action": action, "data": data})
                    except Exception as e:
                        write_json(RES, {"id": last_id, "ok": False, "action": action,
                                         "error": f"{type(e).__name__}: {e}"[:600],
                                         "trace": traceback.format_exc()[-800:]})
                    print(f"cmd {last_id} {action} done", flush=True)
        except json.JSONDecodeError:
            pass
        except Exception as e:
            print("loop error:", e, flush=True)
        time.sleep(0.25)

    try:
        launcher.__exit__(None, None, None)
    except Exception:
        pass


if __name__ == "__main__":
    main()
