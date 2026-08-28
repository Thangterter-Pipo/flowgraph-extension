from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path
from typing import Any

import websocket


class BrowserLiveUnavailable(RuntimeError):
    pass


class BrowserLiveClient:
    """Authorized Google Flow browser-session helper.

    Secrets stay inside the page/browser process. Public methods only return
    sanitized booleans, status codes, schema keys, media ids, or content types.
    """

    def __init__(self, port: int = 9222):
        self.port = int(port)

    def _page(self) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/list", timeout=3) as r:
                pages = json.load(r)
        except Exception as exc:  # pragma: no cover - machine/runtime dependent
            raise BrowserLiveUnavailable(f"Chrome CDP unavailable on :{self.port}: {exc}") from exc
        page = next((p for p in pages if p.get("type") == "page" and "labs.google/fx" in p.get("url", "")), None)
        if not page:
            raise BrowserLiveUnavailable("No authorized Google Flow page found on Chrome CDP")
        return page

    def _eval(self, expression: str, *, await_promise: bool = True, timeout: int = 90) -> Any:
        page = self._page()
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=timeout, suppress_origin=True)
        try:
            ws.send(json.dumps({
                "id": 1,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": expression,
                    "returnByValue": True,
                    "awaitPromise": await_promise,
                },
            }))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") != 1:
                    continue
                result = msg.get("result", {}).get("result", {})
                if result.get("subtype") == "error":
                    raise RuntimeError(result.get("description") or "Browser evaluate failed")
                return result.get("value")
        finally:
            ws.close()

    def project_id(self) -> str | None:
        value = self._eval("location.href")
        if not isinstance(value, str) or "/project/" not in value:
            return None
        return value.split("/project/", 1)[1].split("/", 1)[0].split("?", 1)[0]

    def auth_probe(self) -> dict[str, Any]:
        return self._eval("""
        (async()=>{
          const r=await fetch('/fx/api/auth/session',{credentials:'include'});
          let d={}; try{d=await r.json()}catch(e){}
          return {
            status:r.status,
            ok:r.ok,
            hasAccessToken:!!d.access_token,
            hasUser:!!d.user,
            hasExpires:!!d.expires
          };
        })()
        """)

    def credits_probe(self) -> dict[str, Any]:
        return self._eval("""
        (async()=>{
          const s=await fetch('/fx/api/auth/session',{credentials:'include'});
          if(!s.ok) return {status:s.status,sessionOk:false,jsonKeys:[]};
          const sd=await s.json();
          const r=await fetch('https://aisandbox-pa.googleapis.com/v1/credits',{
            headers:{'Authorization':'Bearer '+sd.access_token,'Origin':'https://labs.google'}
          });
          let d={}; try{d=await r.json()}catch(e){}
          return {status:r.status,sessionOk:true,jsonKeys:Object.keys(d).sort()};
        })()
        """)

    def invalid_recaptcha_probe(self, model_key: str) -> dict[str, Any]:
        model_json = json.dumps(model_key)
        return self._eval(f"""
        (async()=>{{
          const s=await fetch('/fx/api/auth/session',{{credentials:'include'}});
          if(!s.ok) return {{status:s.status,errorStatus:'SESSION_FAILED'}};
          const sd=await s.json();
          const projectId=(location.href.split('/project/')[1]||'').split('/')[0].split('?')[0];
          const payload={{
            mediaGenerationContext:{{batchId:crypto.randomUUID(),audioFailurePreference:'AUDIO_FAILURE_PREFERENCE_UNSPECIFIED'}},
            clientContext:{{
              projectId,tool:'PINHOLE',sessionId:String(Date.now()),
              recaptchaContext:{{token:'INVALID_NEGATIVE_CONTROL_TOKEN',applicationType:'RECAPTCHA_APPLICATION_TYPE_WEB'}}
            }},
            requests:[{{
              aspectRatio:'VIDEO_ASPECT_RATIO_LANDSCAPE',
              textInput:{{structuredPrompt:{{parts:[{{text:'negative control'}}]}}}},
              videoModelKey:{model_json},metadata:{{}}
            }}],
            useV2ModelConfig:true
          }};
          const r=await fetch('https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText',{{
            method:'POST',headers:{{'Authorization':'Bearer '+sd.access_token,'Content-Type':'application/json','Origin':'https://labs.google'}},
            body:JSON.stringify(payload)
          }});
          let d={{}}; try{{d=await r.json()}}catch(e){{}}
          return {{status:r.status,errorStatus:d?.error?.status||null,errorCode:d?.error?.code||null,message:d?.error?.message||null}};
        }})()
        """, timeout=60)

    def upload_image(self, path: Path, timeout: int = 45) -> dict[str, Any]:
        """Upload a local non-sensitive test image through the normal Flow file input."""
        path = Path(path).resolve()
        if not path.is_file():
            raise FileNotFoundError(path)
        page = self._page()
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=3, suppress_origin=True)
        seq = 0
        pending: list[dict[str, Any]] = []

        def call(method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
            nonlocal seq
            seq += 1
            ident = seq
            ws.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == ident:
                    return msg
                pending.append(msg)

        try:
            call("Network.enable")
            root = call("DOM.getDocument", {"depth": 1})["result"]["root"]["nodeId"]
            q = call("DOM.querySelector", {"nodeId": root, "selector": "input[type=file]"})
            node_id = q.get("result", {}).get("nodeId")
            if not node_id:
                raise BrowserLiveUnavailable("Flow file input not found")
            call("DOM.setFileInputFiles", {"nodeId": node_id, "files": [str(path)]})

            target_ids: set[str] = set()
            deadline = time.time() + timeout
            ws.settimeout(1)
            while time.time() < deadline:
                if pending:
                    ev = pending.pop(0)
                else:
                    try:
                        ev = json.loads(ws.recv())
                    except Exception:
                        continue
                method = ev.get("method")
                params = ev.get("params", {})
                if method == "Network.requestWillBeSent":
                    req = params.get("request", {})
                    if "/v1/flow/uploadImage" in req.get("url", ""):
                        target_ids.add(params.get("requestId"))
                elif method == "Network.loadingFinished" and params.get("requestId") in target_ids:
                    rid = params.get("requestId")
                    body = call("Network.getResponseBody", {"requestId": rid}).get("result", {}).get("body", "")
                    try:
                        data = json.loads(body)
                    except Exception:
                        data = {}
                    media = data.get("media") if isinstance(data, dict) else None
                    media_id = None
                    if isinstance(media, dict):
                        media_id = media.get("name")
                    if not media_id and isinstance(data, dict):
                        media_id = data.get("workflow", {}).get("metadata", {}).get("primaryMediaId")
                    if media_id:
                        return {"status": 200, "media_id": media_id, "has_media": True}
            raise TimeoutError("No successful uploadImage response captured")
        finally:
            ws.close()


    # ------------------------------------------------------------------
    # Browser/UI mutation helpers. The browser creates any reCAPTCHA
    # context through the normal Google Flow UI. No token is exported.
    # ------------------------------------------------------------------

    def _navigate(self, url: str, wait: float = 2.5) -> None:
        page = self._page()
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
        try:
            ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": url}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == 1:
                    break
        finally:
            ws.close()
        time.sleep(wait)

    def project_url(self) -> str:
        pid = self.project_id()
        if not pid:
            # If currently on an edit/trash page, derive project id from URL.
            href = self._eval("location.href")
            if isinstance(href, str) and "/project/" in href:
                pid = href.split("/project/", 1)[1].split("/", 1)[0].split("?", 1)[0]
        if not pid:
            raise BrowserLiveUnavailable("Unable to derive Flow project id")
        return f"https://labs.google/fx/vi/tools/flow/project/{pid}"

    def ensure_project_page(self) -> str:
        href = self._eval("location.href")
        if not isinstance(href, str) or "/project/" not in href:
            raise BrowserLiveUnavailable("No Flow project URL available")
        pid = href.split("/project/", 1)[1].split("/", 1)[0].split("?", 1)[0]
        base = f"https://labs.google/fx/vi/tools/flow/project/{pid}"
        if href.rstrip("/") != base.rstrip("/"):
            self._navigate(base)
        return base

    def _physical_click_expression(self, expression: str) -> dict[str, Any]:
        """Resolve an element with JS, then dispatch a real CDP mouse click."""
        page = self._page()
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
        seq = 0

        def call(method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
            nonlocal seq
            seq += 1
            ident = seq
            ws.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == ident:
                    return msg

        try:
            result = call("Runtime.evaluate", {"expression": expression, "returnByValue": True})
            value = result.get("result", {}).get("result", {}).get("value")
            if not isinstance(value, dict) or "x" not in value or "y" not in value:
                raise BrowserLiveUnavailable(f"Clickable Flow control not found: {value!r}")
            for event_type in ("mouseMoved", "mousePressed", "mouseReleased"):
                params = {
                    "type": event_type,
                    "x": value["x"],
                    "y": value["y"],
                    "button": "left",
                    "clickCount": 1,
                }
                if event_type == "mousePressed":
                    params["buttons"] = 1
                call("Input.dispatchMouseEvent", params)
            return value
        finally:
            ws.close()

    def ensure_video_mode(self, mode: str = "components", *, count: str = "x1", duration: str | None = None) -> dict[str, Any]:
        """Set direct Video composer mode through visible Flow controls.

        mode='components' selects reference/ingredients mode; mode='frames'
        selects start/end frame mode. This uses real UI clicks only.
        """
        base = self.ensure_project_page()
        # Reload the project to clear transient dialogs and any attachments left
        # by a prior browser-live case. This keeps each mutation independent.
        self._navigate(base)
        # Disable Agent mode if enabled.
        self._eval("""
        (()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='Tác nhân');
        if(b?.getAttribute('aria-pressed')==='true') b.click(); return b?.getAttribute('aria-pressed')||null;})()
        """)
        time.sleep(1)
        # Wait/recover if the direct composer has not rendered yet. Media-heavy
        # projects can take several seconds after navigation before this control
        # mounts, so retry a full reload once before failing.
        found = False
        for attempt in range(2):
            for _ in range(24):
                found = bool(self._eval("[...document.querySelectorAll('button')].some(x=>(x.innerText||'').trim().startsWith('Video ·'))"))
                if found:
                    break
                time.sleep(.5)
            if found:
                break
            self._navigate(base)
        if not found:
            raise BrowserLiveUnavailable("Flow direct Video composer did not render")
        # Open Video settings through the control's own React/Radix handlers.
        # Coordinate hit-testing is intentionally avoided because the Flow
        # layout can shift while media cards finish rendering.
        if not self._synthetic_click(
            "[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim().startsWith('Video ·'))"
        ):
            raise BrowserLiveUnavailable("Flow Video settings control not found")
        label = "Khung hình" if mode == "frames" else "Thành phần"
        label_json = json.dumps(label, ensure_ascii=False)
        for _ in range(12):
            if self._eval(f"[...document.querySelectorAll('button[role=tab]')].some(x=>(x.innerText||'').includes({label_json}))"):
                break
            time.sleep(.25)
        if not self._synthetic_click(
            f"[...document.querySelectorAll('button[role=tab]')].find(x=>(x.innerText||'').includes({label_json}))"
        ):
            raise BrowserLiveUnavailable(f"Flow Video mode tab not found: {label}")
        time.sleep(.3)
        if duration:
            duration_json = json.dumps(duration)
            if not self._synthetic_click(
                f"[...document.querySelectorAll('button[role=tab]')].find(x=>(x.innerText||'').trim()==={duration_json})"
            ):
                raise BrowserLiveUnavailable(f"Flow duration tab not found: {duration}")
            time.sleep(.2)
        if count:
            count_json = json.dumps(count)
            if not self._synthetic_click(
                f"[...document.querySelectorAll('button[role=tab]')].find(x=>(x.innerText||'').trim()==={count_json})"
            ):
                raise BrowserLiveUnavailable(f"Flow count tab not found: {count}")
            time.sleep(.2)
        # Close settings popover with the same DOM-targeted event path.
        self._synthetic_click(
            "[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim().startsWith('Video ·'))"
        )
        time.sleep(.4)
        state = self._eval("""
        (()=>({
          agent:[...document.querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='Tác nhân')?.getAttribute('aria-pressed')||null,
          settings:[...document.querySelectorAll('button')].map(b=>(b.innerText||'').trim()).find(t=>t.startsWith('Video ·'))||null
        }))()
        """)
        return {"mode": mode, **(state or {})}

    def ensure_image_mode(self, *, count: str = "x1") -> dict[str, Any]:
        """Set the direct Image composer mode through visible Flow controls."""
        base = self.ensure_project_page()
        self._navigate(base)
        self._eval("""
        (()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='Tác nhân');
        if(b?.getAttribute('aria-pressed')==='true') b.click(); return b?.getAttribute('aria-pressed')||null;})()
        """)
        time.sleep(1)
        settings = None
        for attempt in range(2):
            for _ in range(24):
                settings = self._eval("""
                (()=>[...document.querySelectorAll('button')].map(b=>(b.innerText||'').trim())
                  .find(t=>t.startsWith('Video ·')||t.startsWith('Hình ảnh ·')||t.includes('Nano Banana'))||null)()
                """)
                if settings:
                    break
                time.sleep(.5)
            if settings:
                break
            self._navigate(base)
        if not settings:
            raise BrowserLiveUnavailable("Flow direct Image/Video composer did not render")
        if not self._synthetic_click(
            "[...document.querySelectorAll('button')].find(x=>{const t=(x.innerText||'').trim();return t.startsWith('Video ·')||t.startsWith('Hình ảnh ·')||t.includes('Nano Banana')})"
        ):
            raise BrowserLiveUnavailable("Flow generation settings control not found")
        for _ in range(12):
            if self._eval("[...document.querySelectorAll('button[role=tab]')].some(x=>(x.innerText||'').includes('Hình ảnh'))"):
                break
            time.sleep(.25)
        if not self._synthetic_click(
            "[...document.querySelectorAll('button[role=tab]')].find(x=>(x.innerText||'').includes('Hình ảnh'))"
        ):
            raise BrowserLiveUnavailable("Flow Image mode tab not found")
        time.sleep(.5)
        if count:
            count_json = json.dumps(count)
            # Image mode currently exposes x1..x4 in the same settings surface.
            self._synthetic_click(
                f"[...document.querySelectorAll('button[role=tab]')].find(x=>(x.innerText||'').trim()==={count_json})"
            )
            time.sleep(.2)
        self._synthetic_click(
            "[...document.querySelectorAll('button')].find(x=>{const t=(x.innerText||'').trim();return t.startsWith('Hình ảnh ·')||t.startsWith('Video ·')||t.includes('Nano Banana')})"
        )
        time.sleep(.4)
        state = self._eval("""
        (()=>({
          agent:[...document.querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='Tác nhân')?.getAttribute('aria-pressed')||null,
          settings:[...document.querySelectorAll('button')].map(b=>(b.innerText||'').trim()).find(t=>t.startsWith('Hình ảnh ·')||t.startsWith('Video ·')||t.includes('Nano Banana'))||null
        }))()
        """)
        return {"mode": "image", **(state or {})}

    def _submit_current_image_ui(self, prompt: str, timeout: int = 120) -> dict[str, Any]:
        """Submit one Image generation and capture a sanitized direct API pair."""
        page = self._page()
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=5, suppress_origin=True)
        seq = 0
        pending: list[dict[str, Any]] = []

        def call(method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
            nonlocal seq
            seq += 1
            ident = seq
            ws.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == ident:
                    return msg
                pending.append(msg)

        def evalv(expression: str) -> Any:
            r = call("Runtime.evaluate", {"expression": expression, "returnByValue": True})
            return r.get("result", {}).get("result", {}).get("value")

        def sanitize(value: Any, key: str = "") -> Any:
            lowered = key.lower()
            if any(mark in lowered for mark in ("token", "authorization", "cookie", "signature")):
                return "<REDACTED>"
            if lowered == "fifeurl":
                return "<REDACTED_URL>"
            if isinstance(value, dict):
                return {k: sanitize(v, k) for k, v in value.items()}
            if isinstance(value, list):
                return [sanitize(v, key) for v in value]
            if isinstance(value, str) and ("Signature=" in value or "flow-content.google" in value):
                return "<REDACTED_URL>"
            return value

        try:
            call("Network.enable")
            # Clear an existing Slate draft through Flow's own UI control. Direct
            # DOM mutation (execCommand/delete) can corrupt Slate's DOM mapping.
            cleared = evalv("""
            (()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('Xoá câu lệnh'));
            if(!b)return false;b.click();return true;})()
            """)
            if cleared:
                time.sleep(.4)
            focused = evalv("""
            (()=>{const es=[...document.querySelectorAll('[contenteditable=true]')];const e=es.find(x=>x.offsetParent!==null)||es.at(-1);
            if(!e)return false;e.focus();return true;})()
            """)
            if not focused:
                raise BrowserLiveUnavailable("Flow image prompt editor not found")
            call("Input.insertText", {"text": prompt})
            time.sleep(.5)
            # Image generation requires a trusted user gesture before its
            # reCAPTCHA/generation handler runs. Validate the hit-test target,
            # then dispatch a real CDP mouse click. This avoids coordinate drift
            # by refusing to click unless elementFromPoint resolves to Generate.
            click_target = evalv("""
            (()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('arrow_forward')&&(x.innerText||'').includes('Tạo'));
            if(!b||b.getAttribute('aria-disabled')==='true')return null;const r=b.getBoundingClientRect();
            const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y)?.closest('button');
            return {x,y,ok:!!hit&&(hit.innerText||'').includes('arrow_forward')&&(hit.innerText||'').includes('Tạo')};})()
            """)
            if not isinstance(click_target, dict) or not click_target.get("ok"):
                raise BrowserLiveUnavailable(f"Flow Image Generate trusted-click target unsafe: {click_target!r}")
            x, y = float(click_target["x"]), float(click_target["y"])
            call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "none"})
            call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1})
            call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": 1})

            target_ids: set[str] = set()
            endpoint_by_id: dict[str, str] = {}
            status_by_id: dict[str, int] = {}
            request_by_id: dict[str, Any] = {}
            response_by_id: dict[str, Any] = {}
            raw_artifact_url = None
            media_id = None
            deadline = time.time() + timeout
            ws.settimeout(1)
            while time.time() < deadline:
                try:
                    event = pending.pop(0) if pending else json.loads(ws.recv())
                except Exception:
                    continue
                method = event.get("method")
                params = event.get("params", {})
                if method == "Network.requestWillBeSent":
                    req = params.get("request", {})
                    url = req.get("url", "")
                    if "aisandbox-pa.googleapis.com" in url and req.get("method") == "POST" and "flowMedia:batchGenerateImages" in url:
                        rid = params.get("requestId")
                        target_ids.add(rid)
                        endpoint_by_id[rid] = url.split("?", 1)[0]
                        post_data = req.get("postData")
                        if isinstance(post_data, str) and post_data:
                            try:
                                request_by_id[rid] = sanitize(json.loads(post_data))
                            except Exception:
                                request_by_id[rid] = {"capture": "unparsed"}
                elif method == "Network.responseReceived" and params.get("requestId") in target_ids:
                    status_by_id[params.get("requestId")] = int(params.get("response", {}).get("status", 0))
                elif method == "Network.loadingFinished" and params.get("requestId") in target_ids:
                    rid = params.get("requestId")
                    try:
                        body = call("Network.getResponseBody", {"requestId": rid}).get("result", {}).get("body", "")
                        data = json.loads(body) if body else {}
                    except Exception:
                        data = {}
                    if isinstance(data, dict):
                        response_by_id[rid] = sanitize(data)
                        media = data.get("media") or []
                        if isinstance(media, list) and media:
                            first = media[0] if isinstance(media[0], dict) else {}
                            media_id = first.get("name") or first.get("mediaId")
                            generated = (first.get("image") or {}).get("generatedImage") or {}
                            raw_artifact_url = generated.get("fifeUrl")
                    if media_id:
                        break
            if not target_ids:
                raise TimeoutError("No batchGenerateImages request captured")
            first_rid = next(iter(target_ids))
            if not media_id:
                raise TimeoutError(f"No image media id captured; endpoint={endpoint_by_id.get(first_rid)} status={status_by_id.get(first_rid)}")
            return {
                "endpoint": endpoint_by_id.get(first_rid, ""),
                "http_status": status_by_id.get(first_rid, 0),
                "media_id": media_id,
                "request_capture": request_by_id.get(first_rid),
                "response_capture": response_by_id.get(first_rid),
                "artifact_url": raw_artifact_url,
            }
        finally:
            ws.close()

    def generate_t2i(self, prompt: str) -> dict[str, Any]:
        self.ensure_image_mode(count="x1")
        return self._submit_current_image_ui(prompt)

    def credit_balance(self) -> dict[str, int]:
        # Runtime currently reports credits == subscriptionCredits for this
        # account/tier, so these are not additive balances. Treat `credits` as
        # the remaining balance used by the UI/evidence chain.
        for _ in range(5):
            data = self._eval("""
            (async()=>{
              const s=await fetch('/fx/api/auth/session',{credentials:'include'}); if(!s.ok)return null;
              const sd=await s.json();
              const r=await fetch('https://aisandbox-pa.googleapis.com/v1/credits',{headers:{Authorization:'Bearer '+sd.access_token,Origin:'https://labs.google'}});
              const d=await r.json();
              return {status:r.status,credits:d.credits,subscriptionCredits:d.subscriptionCredits};
            })()
            """)
            if isinstance(data, dict) and data.get("status") == 200 and isinstance(data.get("credits"), (int, float)):
                c = int(data["credits"])
                sc = int(data.get("subscriptionCredits", 0) or 0)
                return {"credits": c, "subscriptionCredits": sc, "total": c}
            time.sleep(.5)
        raise BrowserLiveUnavailable("Unable to read Flow credit balance")

    def _select_picker_media(self, name: str) -> str | None:
        name_json = json.dumps(name, ensure_ascii=False)
        # The media picker is virtualized; older items may not exist in the DOM.
        # Use the picker's own search box first so the requested asset is rendered.
        self._eval(f"""
        (()=>{{
          const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'')==='Tìm kiếm thành phần');
          if(!i)return false;
          const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
          set.call(i,{name_json});
          i.dispatchEvent(new Event('input',{{bubbles:true}}));
          i.dispatchEvent(new Event('change',{{bubbles:true}}));
          return true;
        }})()
        """)
        data = None
        for _ in range(12):
            data = self._eval(f"""
            (()=>{{
              const opts=[...document.querySelectorAll('[role=option]')].filter(x=>(x.innerText||'').trim().startsWith({name_json}));
              const o=opts.at(-1); if(!o)return null; o.click();
              const src=o.querySelector('img')?.getAttribute('src')||'';
              const m=src.match(/[?&]name=([^&]+)/); return m?decodeURIComponent(m[1]):null;
            }})()
            """)
            if isinstance(data, str) and data:
                break
            time.sleep(.35)
        time.sleep(.5)
        return data if isinstance(data, str) else None

    def _select_picker_media_id(self, media_id: str, search_name: str | None = None) -> bool:
        """Select an exact picker item by media id, optionally filtering by file name first."""
        if search_name:
            search_json = json.dumps(search_name, ensure_ascii=False)
            self._eval(f"""
            (()=>{{
              const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'')==='Tìm kiếm thành phần');
              if(!i)return false;
              const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
              set.call(i,{search_json});
              i.dispatchEvent(new Event('input',{{bubbles:true}}));
              i.dispatchEvent(new Event('change',{{bubbles:true}}));
              return true;
            }})()
            """)
        mid_json = json.dumps(media_id)
        for _ in range(16):
            ok = self._eval(f"""
            (()=>{{
              const imgs=[...document.querySelectorAll('[role=dialog] img')];
              const img=imgs.find(x=>{{const s=x.getAttribute('src')||'';return s.includes('name='+encodeURIComponent({mid_json}))||s.includes({mid_json});}});
              if(!img)return false;
              const target=img.closest('[role=option]')||img.closest('button')||img.closest('[role=button]')||img.parentElement;
              if(!target)return false;target.click();return true;
            }})()
            """)
            if ok:
                time.sleep(.4)
                return True
            time.sleep(.35)
        return False

    def _click_add_to_prompt(self) -> None:
        ok = self._eval("""
        (()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='Thêm vào câu lệnh');
        if(!b)return false;b.click();return true;})()
        """)
        if not ok:
            raise BrowserLiveUnavailable("Flow 'Thêm vào câu lệnh' button not found")
        time.sleep(.8)

    def _synthetic_click(self, selector_js: str) -> bool:
        """Dispatch pointer/mouse events directly on a known DOM element.

        This avoids coordinate hit-test drift while still exercising the same
        React/Radix event handlers used by normal pointer interaction.
        """
        return bool(self._eval(f"""
        (()=>{{const e=({selector_js});if(!e)return false;
        for(const t of ['pointerdown','mousedown','pointerup','mouseup','click']){{
          const C=t.startsWith('pointer')?PointerEvent:MouseEvent;
          e.dispatchEvent(new C(t,{{bubbles:true,cancelable:true,view:window,button:0,
            buttons:t.includes('down')?1:0,pointerId:1,pointerType:'mouse',isPrimary:true}}));
        }}return true;}})()
        """))

    def _upload_picker_file(self, path: Path, reopen_selector_js: str | None = None) -> str:
        path = Path(path).resolve()
        if not path.is_file():
            raise FileNotFoundError(path)
        clicked = self._synthetic_click(
            "[...document.querySelectorAll('[role=dialog] button')].find(x=>(x.innerText||'').includes('Tải nội dung nghe nhìn lên'))"
        )
        if not clicked:
            raise BrowserLiveUnavailable("Flow picker upload button not found")
        time.sleep(.2)
        uploaded = self.upload_image(path)
        media_id = uploaded.get("media_id")
        if not media_id:
            raise BrowserLiveUnavailable(f"Picker upload produced no media id: {path}")
        # Some Flow builds keep the picker open and preselect the uploaded media;
        # others close it immediately. Handle both without coordinate clicks.
        time.sleep(.5)
        try:
            self._click_add_to_prompt()
            return str(media_id)
        except BrowserLiveUnavailable:
            if not reopen_selector_js:
                raise
        if not self._synthetic_click(reopen_selector_js):
            raise BrowserLiveUnavailable("Flow picker could not be reopened after upload")
        time.sleep(.8)
        if not self._select_picker_media_id(str(media_id), path.name):
            raise BrowserLiveUnavailable(f"Uploaded media id not found after picker reopen: {media_id}")
        self._click_add_to_prompt()
        return str(media_id)

    def attach_reference(self, media_name: str | Path) -> str | None:
        self.ensure_video_mode("components")
        reopen_selector = "[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('add_2')&&(x.innerText||'').includes('Tạo'))"
        opened = self._synthetic_click(reopen_selector)
        if not opened:
            raise BrowserLiveUnavailable("Reference media picker could not be opened")
        time.sleep(.8)
        local = Path(media_name)
        if local.is_file():
            return self._upload_picker_file(local, reopen_selector)
        media_id = self._select_picker_media(str(media_name))
        if not media_id:
            raise BrowserLiveUnavailable(f"Reference media not found in picker: {media_name}")
        self._click_add_to_prompt()
        return media_id

    def attach_frame(self, slot: str, media_name: str | Path) -> str | None:
        if slot not in {"Bắt đầu", "Kết thúc"}:
            raise ValueError("slot must be 'Bắt đầu' or 'Kết thúc'")
        slot_json = json.dumps(slot, ensure_ascii=False)
        reopen_selector = f"[...document.querySelectorAll('div[type=button][aria-haspopup=dialog]')].find(x=>(x.innerText||'').trim()==={slot_json})"
        opened = self._synthetic_click(reopen_selector)
        if not opened:
            raise BrowserLiveUnavailable(f"Frame picker could not be opened: {slot}")
        time.sleep(.8)
        local = Path(media_name)
        if local.is_file():
            return self._upload_picker_file(local, reopen_selector)
        media_id = self._select_picker_media(str(media_name))
        if not media_id:
            raise BrowserLiveUnavailable(f"Frame media not found in picker: {media_name}")
        self._click_add_to_prompt()
        return media_id

    def _submit_current_video_ui(self, prompt: str, timeout: int = 120) -> dict[str, Any]:
        page = self._page()
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=5, suppress_origin=True)
        seq = 0
        pending: list[dict[str, Any]] = []

        def call(method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
            nonlocal seq
            seq += 1
            ident = seq
            ws.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == ident:
                    return msg
                pending.append(msg)

        def evalv(expression: str) -> Any:
            r = call("Runtime.evaluate", {"expression": expression, "returnByValue": True})
            return r.get("result", {}).get("result", {}).get("value")

        def sanitize(value: Any, key: str = "") -> Any:
            """Redact browser/session material before returning capture evidence."""
            lowered = key.lower()
            if any(mark in lowered for mark in ("token", "authorization", "cookie", "signature")):
                return "<REDACTED>"
            if isinstance(value, dict):
                return {k: sanitize(v, k) for k, v in value.items()}
            if isinstance(value, list):
                return [sanitize(v, key) for v in value]
            if isinstance(value, str) and ("Signature=" in value or "flow-content.google" in value):
                return "<REDACTED_URL>"
            return value

        try:
            call("Network.enable")
            focused = evalv("""
            (()=>{const es=[...document.querySelectorAll('[contenteditable=true]')];const e=es.find(x=>x.offsetParent!==null)||es.at(-1);
            if(!e)return false;e.focus();document.execCommand('selectAll');document.execCommand('delete');return true;})()
            """)
            if not focused:
                raise BrowserLiveUnavailable("Flow generation prompt editor not found")
            call("Input.insertText", {"text": prompt})
            time.sleep(.3)
            clicked = evalv("""
            (()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('arrow_forward')&&(x.innerText||'').includes('Tạo'));
            if(!b||b.getAttribute('aria-disabled')==='true')return false;b.click();return true;})()
            """)
            if not clicked:
                raise BrowserLiveUnavailable("Flow Generate button was not enabled")

            ids: set[str] = set()
            endpoint_by_id: dict[str, str] = {}
            status_by_id: dict[str, int] = {}
            request_by_id: dict[str, Any] = {}
            response_by_id: dict[str, Any] = {}
            media_ids: list[str] = []
            remaining_credits: int | None = None
            deadline = time.time() + timeout
            ws.settimeout(1)
            while time.time() < deadline:
                try:
                    event = pending.pop(0) if pending else json.loads(ws.recv())
                except Exception:
                    continue
                method = event.get("method")
                params = event.get("params", {})
                if method == "Network.requestWillBeSent":
                    req = params.get("request", {})
                    url = req.get("url", "")
                    if "aisandbox-pa.googleapis.com" in url and req.get("method") == "POST" and "/v1/video:" in url:
                        rid = params.get("requestId")
                        ids.add(rid)
                        endpoint_by_id[rid] = url.split("?", 1)[0]
                        post_data = req.get("postData")
                        if isinstance(post_data, str) and post_data:
                            try:
                                request_by_id[rid] = sanitize(json.loads(post_data))
                            except Exception:
                                request_by_id[rid] = {"capture": "unparsed"}
                elif method == "Network.responseReceived" and params.get("requestId") in ids:
                    status_by_id[params.get("requestId")] = int(params.get("response", {}).get("status", 0))
                elif method == "Network.loadingFinished" and params.get("requestId") in ids:
                    rid = params.get("requestId")
                    try:
                        body = call("Network.getResponseBody", {"requestId": rid}).get("result", {}).get("body", "")
                        data = json.loads(body) if body else {}
                    except Exception:
                        data = {}
                    if isinstance(data, dict):
                        response_by_id[rid] = sanitize(data)
                        rc = data.get("remainingCredits")
                        if isinstance(rc, int):
                            remaining_credits = rc
                        media = data.get("media") or []
                        if isinstance(media, list):
                            for item in media:
                                if isinstance(item, dict):
                                    mid = item.get("name") or item.get("mediaId")
                                    if mid:
                                        media_ids.append(mid)
                        elif isinstance(media, dict):
                            mid = media.get("name") or media.get("mediaId")
                            if mid:
                                media_ids.append(mid)
                        if data.get("mediaId"):
                            media_ids.append(data["mediaId"])
                    if media_ids:
                        break
            if not media_ids:
                raise TimeoutError(f"No video media id captured; endpoints={list(endpoint_by_id.values())}")
            first_id = media_ids[0]
            first_rid = next(iter(endpoint_by_id), "")
            endpoint = endpoint_by_id.get(first_rid, "")
            http_status = status_by_id.get(first_rid, 0)
            return {
                "endpoint": endpoint,
                "http_status": http_status,
                "media_id": first_id,
                "media_ids": media_ids,
                "remaining_credits_present": remaining_credits is not None,
                "request_capture": request_by_id.get(first_rid),
                "response_capture": response_by_id.get(first_rid),
            }
        finally:
            ws.close()

    def poll_media(self, media_id: str, timeout: int = 600) -> dict[str, Any]:
        mid_json = json.dumps(media_id)
        deadline = time.time() + timeout
        last: dict[str, Any] = {}
        while time.time() < deadline:
            value = self._eval(f"""
            (async()=>{{
              const s=await fetch('/fx/api/auth/session',{{credentials:'include'}});const sd=await s.json();
              const projectId=(location.href.split('/project/')[1]||'').split('/')[0].split('?')[0];
              const r=await fetch('https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus',{{
                method:'POST',headers:{{Authorization:'Bearer '+sd.access_token,'Content-Type':'application/json',Origin:'https://labs.google'}},
                body:JSON.stringify({{media:[{{name:{mid_json},projectId}}]}})
              }});
              const d=await r.json();const m=(d.media||[{{}}])[0];
              return {{http:r.status,status:m?.mediaMetadata?.mediaStatus?.mediaGenerationStatus||null,mediaId:m?.name||null,workflowId:m?.workflowId||null,workflowStepId:m?.workflowStepId||null,hasVideo:!!m?.video}};
            }})()
            """, timeout=45)
            if isinstance(value, dict):
                last = value
                if value.get("status") in {
                    "MEDIA_GENERATION_STATUS_SUCCESSFUL", "MEDIA_GENERATION_STATUS_COMPLETE",
                    "MEDIA_GENERATION_STATUS_FAILED", "MEDIA_GENERATION_STATUS_CANCELED",
                }:
                    return value
            time.sleep(5)
        raise TimeoutError(f"Media poll timed out: {last}")

    def generate_t2v(self, prompt: str) -> dict[str, Any]:
        self.ensure_video_mode("components", count="x1", duration="4s")
        before = self.credit_balance()
        submitted = self._submit_current_video_ui(prompt)
        final = self.poll_media(submitted["media_id"])
        after = self.credit_balance()
        # Credit propagation can lag media completion by a few seconds.
        for _ in range(12):
            if after["total"] < before["total"]:
                break
            time.sleep(1)
            after = self.credit_balance()
        return {**submitted, "final": final, "credit_before": before["total"], "credit_after": after["total"], "credit_delta": before["total"] - after["total"]}

    def generate_reference(self, media_name: str, prompt: str) -> dict[str, Any]:
        self.ensure_video_mode("components", count="x1", duration="4s")
        input_id = self.attach_reference(media_name)
        submitted = self._submit_current_video_ui(prompt)
        final = self.poll_media(submitted["media_id"])
        return {**submitted, "final": final, "input_media_id": input_id}

    def generate_i2v(self, media_name: str, prompt: str) -> dict[str, Any]:
        self.ensure_video_mode("frames", count="x1", duration="4s")
        input_id = self.attach_frame("Bắt đầu", media_name)
        submitted = self._submit_current_video_ui(prompt)
        final = self.poll_media(submitted["media_id"])
        return {**submitted, "final": final, "input_media_id": input_id}

    def generate_interpolation(self, start_name: str, end_name: str, prompt: str) -> dict[str, Any]:
        self.ensure_video_mode("frames", count="x1", duration="4s")
        start_id = self.attach_frame("Bắt đầu", start_name)
        end_id = self.attach_frame("Kết thúc", end_name)
        submitted = self._submit_current_video_ui(prompt)
        final = self.poll_media(submitted["media_id"])
        return {**submitted, "final": final, "start_media_id": start_id, "end_media_id": end_id}

    def edit_url_for_media(self, media_id: str, timeout: int = 45) -> str:
        base = self.ensure_project_page()
        # The status API returns workflowId, and runtime verification confirms
        # that this UUID is the `/edit/<workflowId>` route identifier. Prefer
        # this over scanning the virtualized media grid DOM.
        try:
            meta = self.poll_media(media_id, timeout=max(timeout, 30))
            workflow_id = meta.get("workflowId") if isinstance(meta, dict) else None
            if workflow_id:
                return f"{base}/edit/{workflow_id}"
        except Exception:
            pass
        # Fallback for older responses that may omit workflowId.
        mid_json = json.dumps(media_id)
        deadline = time.time() + timeout
        while time.time() < deadline:
            href = self._eval(f"""
            (()=>{{const el=[...document.querySelectorAll('video,img')].find(e=>(e.getAttribute('src')||'').includes({mid_json}));
            return el?.closest('a[href*="/edit/"]')?.href||null;}})()
            """)
            if isinstance(href, str) and "/edit/" in href:
                return href
            time.sleep(2)
        raise BrowserLiveUnavailable(f"Edit URL not found for media {media_id}")

    def generate_edit(self, source_media_id: str, prompt: str) -> dict[str, Any]:
        edit_url = self.edit_url_for_media(source_media_id)
        self._navigate(edit_url)
        submitted = self._submit_current_video_ui(prompt)
        final = self.poll_media(submitted["media_id"])
        return {**submitted, "final": final, "source_media_id": source_media_id, "edit_url": edit_url}

    def download_redirect_probe(self, media_id: str, timeout: int = 45) -> dict[str, Any]:
        """Verify the authenticated 307 -> flow-content video stream chain.

        Chrome's built-in media loader normally requests a byte range, so the
        final CDN status can legitimately be 206 rather than 200.
        """
        from urllib.parse import quote, urlparse
        create = urllib.request.Request(f"http://127.0.0.1:{self.port}/json/new?about:blank", method="PUT")
        with urllib.request.urlopen(create, timeout=5) as r:
            target = json.load(r)
        target_id = target["id"]
        ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=5, suppress_origin=True)
        seq = 0
        pending: list[dict[str, Any]] = []

        def call(method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
            nonlocal seq
            seq += 1
            ident = seq
            ws.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == ident:
                    return msg
                pending.append(msg)

        redirect_status = None
        final: dict[str, Any] | None = None
        try:
            call("Network.enable")
            url = f"https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name={quote(media_id)}"
            call("Page.navigate", {"url": url})
            ws.settimeout(1)
            deadline = time.time() + timeout
            while time.time() < deadline:
                try:
                    ev = pending.pop(0) if pending else json.loads(ws.recv())
                except Exception:
                    continue
                if ev.get("method") == "Network.requestWillBeSent":
                    rr = ev.get("params", {}).get("redirectResponse")
                    if isinstance(rr, dict) and "labs.google" in rr.get("url", ""):
                        redirect_status = int(rr.get("status", 0))
                elif ev.get("method") == "Network.responseReceived":
                    resp = ev.get("params", {}).get("response", {})
                    if "flow-content.google" in resp.get("url", ""):
                        final = {
                            "status": int(resp.get("status", 0)),
                            "mimeType": resp.get("mimeType"),
                            "host": urlparse(resp.get("url", "")).hostname,
                        }
                        break
            return {"redirect_status": redirect_status, "final": final}
        finally:
            ws.close()
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/close/{target_id}", timeout=3).read()
            except Exception:
                pass

    def cancel_active_t2v(self, prompt: str) -> dict[str, Any]:
        self.ensure_video_mode("components", count="x1", duration="10s")
        submitted = self._submit_current_video_ui(prompt, timeout=90)
        mid_json = json.dumps(submitted["media_id"])
        result = self._eval(f"""
        (async()=>{{
          const s=await fetch('/fx/api/auth/session',{{credentials:'include'}});const sd=await s.json();
          const r=await fetch('https://aisandbox-pa.googleapis.com/v1/flowMedia:cancelGeneration',{{
            method:'POST',headers:{{Authorization:'Bearer '+sd.access_token,'Content-Type':'application/json',Origin:'https://labs.google'}},
            body:JSON.stringify({{mediaId:{mid_json}}})
          }});
          let d={{}};try{{d=await r.json()}}catch(e){{}}
          return {{status:r.status,errorStatus:d?.error?.status||null,errorCode:d?.error?.code||null,message:d?.error?.message||null}};
        }})()
        """, timeout=45)
        return {**submitted, "cancel": result}
