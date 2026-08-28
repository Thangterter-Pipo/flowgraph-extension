from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import websocket

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_live_support import BrowserLiveClient  # noqa: E402

EVIDENCE = ROOT / "evidence" / "video" / "reference"
INPUT = ROOT / "_ctl" / "g3_image.png"
PROMPT = "Camera slowly pushes toward the subject while preserving the reference appearance"


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def download_via_browser_redirect(client: BrowserLiveClient, media_id: str, out_path: Path) -> tuple[int, str, bool]:
    create = urllib.request.Request(f"http://127.0.0.1:{client.port}/json/new?about:blank", method="PUT")
    with urllib.request.urlopen(create, timeout=5) as r:
        target = json.load(r)
    target_id = target["id"]
    ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
    seq = 0
    pending = []

    def call(method: str, params=None):
        nonlocal seq
        seq += 1
        ident = seq
        ws.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == ident:
                return msg
            pending.append(msg)

    final_url = None
    try:
        call("Network.enable")
        redirect = "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=" + urllib.parse.quote(media_id)
        call("Page.navigate", {"url": redirect})
        ws.settimeout(1)
        deadline = time.time() + 30
        while time.time() < deadline and not final_url:
            try:
                ev = pending.pop(0) if pending else json.loads(ws.recv())
            except Exception:
                continue
            if ev.get("method") == "Network.requestWillBeSent":
                req = ev.get("params", {}).get("request", {})
                url = req.get("url", "")
                if "flow-content.google" in url:
                    final_url = url
            elif ev.get("method") == "Network.responseReceived":
                resp = ev.get("params", {}).get("response", {})
                url = resp.get("url", "")
                if "flow-content.google" in url:
                    final_url = url
        if not final_url:
            raise RuntimeError("Signed media redirect target was not observed")
    finally:
        ws.close()
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{client.port}/json/close/{target_id}", timeout=3).read()
        except Exception:
            pass

    out_path.parent.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256()
    total = 0
    head = b""
    req = urllib.request.Request(final_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r, out_path.open("wb") as f:
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            if len(head) < 64:
                head += chunk[: 64 - len(head)]
            f.write(chunk)
            h.update(chunk)
            total += len(chunk)
    return total, h.hexdigest(), b"ftyp" in head


def main() -> int:
    client = BrowserLiveClient()
    result = client.generate_reference(INPUT, PROMPT)
    endpoint = result.get("endpoint", "")
    final = result.get("final") or {}
    if not endpoint.endswith("/v1/video:batchAsyncGenerateVideoReferenceImages"):
        raise RuntimeError(f"Unexpected endpoint: {endpoint}")
    if result.get("http_status") != 200:
        raise RuntimeError(f"Reference submit failed: HTTP {result.get('http_status')}")
    if final.get("status") not in {"MEDIA_GENERATION_STATUS_SUCCESSFUL", "MEDIA_GENERATION_STATUS_COMPLETE"}:
        raise RuntimeError(f"Reference terminal status was not successful: {final}")
    if not result.get("request_capture") or not result.get("response_capture"):
        raise RuntimeError("Sanitized request/response capture missing")

    media_id = str(result["media_id"])
    write_json(EVIDENCE / "request.json", result["request_capture"])
    write_json(EVIDENCE / "poll_final.json", final)

    mp4_path = EVIDENCE / f"reference_verified_{media_id}.mp4"
    total, sha256, has_ftyp = download_via_browser_redirect(client, media_id, mp4_path)
    if total <= 0 or not has_ftyp:
        raise RuntimeError(f"Downloaded artifact invalid: bytes={total}, ftyp={has_ftyp}")

    response_capture = dict(result["response_capture"])
    response_capture["_evidence"] = {
        "status": 200,
        "terminal_status": final.get("status"),
        "mp4_artifact": f"evidence/video/reference/{mp4_path.name}",
        "mp4_bytes": total,
        "sha256": sha256,
        "ftyp": has_ftyp,
    }
    write_json(EVIDENCE / "response.json", response_capture)

    notes = (
        "# Reference Images runtime verification\n\n"
        f"- Endpoint: `{endpoint}`\n"
        "- Submit: HTTP 200\n"
        f"- Terminal status: `{final.get('status')}`\n"
        f"- Media ID: `{media_id}`\n"
        f"- Artifact: `{mp4_path.name}`\n"
        f"- Artifact bytes: `{total}`\n"
        f"- SHA-256: `{sha256}`\n"
        "- MP4 signature: `ftyp` present\n"
        "- Browser session, OAuth token, reCAPTCHA token, cookies and signed download URL were not persisted.\n"
    )
    (EVIDENCE / "notes.md").write_text(notes, encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "endpoint": endpoint,
        "http_status": 200,
        "media_id": media_id,
        "terminal_status": final.get("status"),
        "artifact_bytes": total,
        "sha256": sha256,
        "ftyp": has_ftyp,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
