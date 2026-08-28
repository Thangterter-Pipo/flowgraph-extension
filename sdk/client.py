"""
Google Flow SDK v2 - Truly Dynamic Specification-Compliant Client
"""
import json
import re
import uuid
import time
import requests
from typing import Dict, Any, Optional

class FlowMedia:
    """Normalized Flow Media Artifact Object supporting Chaining."""
    def __init__(self, name: str, project_id: str, media_type: str = "video", fife_url: Optional[str] = None):
        self.name = name
        self.project_id = project_id
        self.media_type = media_type
        self.fife_url = fife_url
        self.status = "PENDING"

class AuthManager:
    """Manages session cookies & OAuth access tokens dynamic sync without hardcoding defaults."""
    def __init__(self, session_cookie: str):
        self.session_cookie = session_cookie
        self.access_token: Optional[str] = None
        self.user_tier: Optional[str] = None
        self.service_tier: Optional[str] = None
        self.refresh()

    def refresh(self):
        """Fetch fresh access token & dynamic billing tier from session cookie."""
        session_url = "https://labs.google/fx/api/auth/session"
        res = requests.get(session_url, headers={"Cookie": self.session_cookie}, timeout=30)
        res.raise_for_status()
        data = res.json()
        self.access_token = data.get("access_token")

        # Fetch credits & tiers dynamically without fallback hardcoding
        credits_url = "https://aisandbox-pa.googleapis.com/v1/credits"
        c_res = requests.get(credits_url, headers=self.get_headers(), timeout=30)
        if c_res.ok:
            c_data = c_res.json()
            self.user_tier = c_data.get("userPaygateTier")
            self.service_tier = c_data.get("serviceTier")

    def get_headers(self) -> Dict[str, str]:
        if not self.access_token:
            raise RuntimeError("Access token unavailable. Call refresh() with valid session cookie.")
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "Origin": "https://labs.google",
        }

class ModelResolver:
    """Resolves friendly query specs to active usage keys using normalized registry."""
    def __init__(self, registry_data: Dict[str, Any]):
        self.registry = registry_data

    def resolve(self, family: str, aspect_ratio: Optional[str] = None) -> Optional[str]:
        for key, spec in self.registry.items():
            if spec.get("deprecated"):
                continue
            if family in key or spec.get("family") == family:
                ars = spec.get("aspectRatios", [])
                if not aspect_ratio or not ars or f"VIDEO_ASPECT_RATIO_{aspect_ratio.upper()}" in ars:
                    return key
        return None

class Poller:
    """Async generation status polling engine."""
    def __init__(self, auth: AuthManager):
        self.auth = auth

    def poll(self, media: FlowMedia, interval: int = 8, timeout: int = 600) -> bool:
        url = "https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus"
        deadline = time.time() + timeout
        payload = {"media": [{"name": media.name, "projectId": media.project_id}]}

        while time.time() < deadline:
            res = requests.post(url, json=payload, headers=self.auth.get_headers(), timeout=30)
            res.raise_for_status()
            m = res.json().get("media", [{}])[0]
            st = m.get("mediaMetadata", {}).get("mediaStatus", {}).get("mediaGenerationStatus")
            media.status = st

            if st in ("MEDIA_GENERATION_STATUS_SUCCESSFUL", "MEDIA_GENERATION_STATUS_COMPLETE"):
                return True
            if st in ("MEDIA_GENERATION_STATUS_FAILED", "MEDIA_GENERATION_STATUS_CANCELED"):
                raise RuntimeError(f"Generation failed with status: {st}")
            time.sleep(interval)
        raise TimeoutError("Polling exceeded timeout boundary.")

class DownloadClient:
    """Downloads signed MP4 streams via 307 CDN Redirect."""
    def __init__(self, auth: AuthManager):
        self.auth = auth

    def download(self, media: FlowMedia, save_path: str) -> str:
        redirect_url = f"https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name={media.name}"
        with requests.get(redirect_url, headers={"Cookie": self.auth.session_cookie}, allow_redirects=True, stream=True, timeout=120) as res:
            res.raise_for_status()
            with open(save_path, "wb") as fh:
                for chunk in res.iter_content(chunk_size=65536):
                    fh.write(chunk)
        return save_path

class BrowserOverlayClient:
    """Local Chrome/CDP helper for dismissing non-security Flow UI overlays."""

    SAFE_LABELS = {
        "Bắt đầu", "Đóng", "Got it", "Dismiss", "Continue", "Tiếp tục",
        "Skip", "Bỏ qua", "Not now", "Để sau",
    }
    DANGEROUS_PATTERN = re.compile(
        r"captcha|recaptcha|security|bảo mật|verify|xác minh|payment|thanh toán",
        re.I,
    )

    def __init__(self, host: str = "127.0.0.1", port: int = 9222):
        self.host = host
        self.port = port

    def _find_flow_page(self) -> Dict[str, Any]:
        res = requests.get(f"http://{self.host}:{self.port}/json/list", timeout=5)
        res.raise_for_status()
        pages = res.json()
        for page in pages:
            if page.get("type") == "page" and "labs.google/fx" in page.get("url", ""):
                return page
        raise RuntimeError("No Google Flow page found on the configured CDP port.")

    def dismiss_overlays(self) -> Dict[str, Any]:
        """Dismiss visible onboarding/changelog overlays without touching security/payment UI."""
        try:
            import websocket
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("Install websocket-client to use BrowserOverlayClient.") from exc

        page = self._find_flow_page()
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=5, suppress_origin=True)
        labels_json = json.dumps(sorted(self.SAFE_LABELS), ensure_ascii=False)
        danger = self.DANGEROUS_PATTERN.pattern.replace("\\", "\\\\").replace("/", "\\/")
        expression = f"""
(() => {{
  const safe = new Set({labels_json});
  const danger = new RegExp({json.dumps(danger)}, 'i');
  const visible = el => {{
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  }};
  const overlayAncestor = el => {{
    let n = el;
    for (let i = 0; i < 10 && n; i++, n = n.parentElement) {{
      const role = n.getAttribute && n.getAttribute('role');
      const modal = n.getAttribute && n.getAttribute('aria-modal');
      const pos = getComputedStyle(n).position;
      if (role === 'dialog' || modal === 'true' || pos === 'fixed') return true;
    }}
    return false;
  }};
  const clicked = [];
  for (const el of document.querySelectorAll('button,[role="button"]')) {{
    if (!visible(el) || !overlayAncestor(el)) continue;
    const raw = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
    const parts = raw.split(/\\n+/).map(s => s.trim()).filter(Boolean);
    const label = parts[parts.length - 1] || raw;
    if (!label || danger.test(raw)) continue;
    if (safe.has(label) || safe.has(raw)) {{
      el.click();
      clicked.push(label);
    }}
  }}
  return {{clicked, url: location.href, title: document.title}};
}})()
"""
        try:
            ws.send(json.dumps({
                "id": 1,
                "method": "Runtime.evaluate",
                "params": {"expression": expression, "returnByValue": True, "awaitPromise": True},
            }))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == 1:
                    value = msg.get("result", {}).get("result", {}).get("value")
                    return value or {"clicked": [], "url": page.get("url")}
        finally:
            ws.close()

class VideoTextClient:
    """Dedicated Sub-client for Text-to-Video Requests."""
    def __init__(self, auth: AuthManager):
        self.auth = auth

    def generate(self, project_id: str, recaptcha_token: str, prompt: str, model_key: str, aspect_ratio: str, seed: Optional[int] = None, audio_failure_preference: Optional[str] = None) -> FlowMedia:
        url = "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText"
        req_item = {
            "textInput": {"structuredPrompt": {"parts": [{"text": prompt}]}},
            "videoModelKey": model_key,
            "metadata": {}
        }
        if aspect_ratio:
            req_item["aspectRatio"] = f"VIDEO_ASPECT_RATIO_{aspect_ratio.upper()}" if not aspect_ratio.startswith("VIDEO_ASPECT_RATIO_") else aspect_ratio
        if seed is not None:
            req_item["seed"] = seed

        ctx = {
            "batchId": str(uuid.uuid4())
        }
        if audio_failure_preference:
            ctx["audioFailurePreference"] = audio_failure_preference

        body = {
            "mediaGenerationContext": ctx,
            "clientContext": {
                "projectId": project_id,
                "tool": "PINHOLE",
                "userPaygateTier": self.auth.user_tier,
                "sessionId": str(int(time.time() * 1000)),
                "recaptchaContext": {
                    "token": recaptcha_token,
                    "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB"
                }
            },
            "requests": [req_item],
            "useV2ModelConfig": True
        }
        res = requests.post(url, json=body, headers=self.auth.get_headers(), timeout=60)
        res.raise_for_status()
        media_name = res.json()["media"][0]["name"]
        return FlowMedia(name=media_name, project_id=project_id, media_type="video")

class GoogleFlowClient:
    """Top-level Google Flow API SDK Client."""
    def __init__(self, session_cookie: str, registry_data: Optional[Dict[str, Any]] = None, browser_host: str = "127.0.0.1", browser_port: int = 9222):
        self.auth = AuthManager(session_cookie)
        self.poller = Poller(self.auth)
        self.downloader = DownloadClient(self.auth)
        self.resolver = ModelResolver(registry_data or {})
        self.video_text = VideoTextClient(self.auth)
        self.browser = BrowserOverlayClient(browser_host, browser_port)

    def create_project(self, title: str) -> str:
        url = "https://labs.google/fx/api/trpc/project.createProject"
        res = requests.post(url, json={"json": {"projectTitle": title, "toolName": "PINHOLE"}}, headers={"Cookie": self.auth.session_cookie}, timeout=30)
        res.raise_for_status()
        return res.json()["result"]["data"]["json"]["result"]["projectId"]

    def generate_video(self, project_id: str, recaptcha_token: str, prompt: str, model_key: str, aspect_ratio: str, seed: Optional[int] = None, audio_failure_preference: Optional[str] = None) -> FlowMedia:
        return self.video_text.generate(project_id, recaptcha_token, prompt, model_key, aspect_ratio, seed, audio_failure_preference)

    def dismiss_flow_overlays(self) -> Dict[str, Any]:
        """Close non-security onboarding/changelog overlays in the local Flow browser."""
        return self.browser.dismiss_overlays()
