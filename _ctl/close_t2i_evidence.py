from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from browser_live_support import BrowserLiveClient  # noqa: E402

EVIDENCE = ROOT / "evidence" / "image" / "t2i"
PROMPT = "A small red paper boat floating on a calm blue lake at sunrise, clean cinematic composition"


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def image_kind(head: bytes, content_type: str) -> tuple[str, bool]:
    ct = (content_type or "").split(";", 1)[0].strip().lower()
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png", True
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg", True
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return ".webp", True
    if head.startswith((b"GIF87a", b"GIF89a")):
        return ".gif", True
    if len(head) >= 12 and head[4:8] == b"ftyp" and ("avif" in ct or b"avif" in head[:32]):
        return ".avif", True
    ext = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/avif": ".avif",
        "image/gif": ".gif",
    }.get(ct, ".bin")
    return ext, False


def download_image(url: str, media_id: str) -> tuple[Path, int, str, str, bool]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
        content_type = r.headers.get("Content-Type", "")
    suffix, valid_magic = image_kind(data[:64], content_type)
    out = EVIDENCE / f"t2i_verified_{media_id}{suffix}"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return out, len(data), hashlib.sha256(data).hexdigest(), content_type.split(";", 1)[0], valid_magic


def main() -> int:
    client = BrowserLiveClient()
    result = client.generate_t2i(PROMPT)
    endpoint = result.get("endpoint", "")
    if "flowMedia:batchGenerateImages" not in endpoint:
        raise RuntimeError(f"Unexpected endpoint: {endpoint}")
    if result.get("http_status") != 200:
        raise RuntimeError(f"T2I submit failed: HTTP {result.get('http_status')}")
    if not result.get("request_capture") or not result.get("response_capture"):
        raise RuntimeError("Sanitized T2I request/response capture missing")
    artifact_url = result.get("artifact_url")
    if not isinstance(artifact_url, str) or not artifact_url.startswith("http"):
        raise RuntimeError("T2I response did not expose an artifact URL")

    media_id = str(result["media_id"])
    artifact, total, sha256, content_type, valid_magic = download_image(artifact_url, media_id)
    if total <= 1024 or not valid_magic:
        raise RuntimeError(f"Downloaded T2I artifact invalid: bytes={total}, type={content_type}, magic={valid_magic}")

    response_capture = dict(result["response_capture"])
    response_capture["_evidence"] = {
        "status": 200,
        "artifact": f"evidence/image/t2i/{artifact.name}",
        "artifact_bytes": total,
        "content_type": content_type,
        "sha256": sha256,
        "valid_image_magic": valid_magic,
    }
    write_json(EVIDENCE / "request.json", result["request_capture"])
    write_json(EVIDENCE / "response.json", response_capture)

    notes = (
        "# Text-to-Image runtime verification\n\n"
        f"- Endpoint: `{endpoint}`\n"
        "- Submit: HTTP 200\n"
        f"- Media ID: `{media_id}`\n"
        f"- Artifact: `{artifact.name}`\n"
        f"- Artifact bytes: `{total}`\n"
        f"- Content-Type: `{content_type}`\n"
        f"- SHA-256: `{sha256}`\n"
        "- Image magic signature validated.\n"
        "- Browser session, OAuth token, reCAPTCHA token, cookies and raw artifact URL were not persisted.\n"
    )
    (EVIDENCE / "notes.md").write_text(notes, encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "endpoint": endpoint,
        "http_status": 200,
        "media_id": media_id,
        "artifact_bytes": total,
        "content_type": content_type,
        "sha256": sha256,
        "valid_magic": valid_magic,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
