"""OAuth lock-down: ChatGPT redirect allowlist + owner consent PIN.

Public DCR stays ON so ChatGPT can register a connector, but:
  - redirect_uris must match ChatGPT (or other allowlisted) prefixes
  - /authorize parks the request and sends the browser to /consent
  - the machine owner types FLOW_VEO_MCP_CONSENT_PIN once to issue the code

chatgpt-web-bridge (127.0.0.1:5005) does not use this OAuth path — it talks
to the ChatGPT tab over DOM. Combined: Bridge = Pipo talks TO GPT;
MCP OAuth = GPT operates THIS machine.
"""
from __future__ import annotations

import html
import os
import secrets
import time
from urllib.parse import urlparse

DEFAULT_REDIRECT_PREFIXES = (
    "https://chatgpt.com/connector/oauth/",
    "https://chat.openai.com/connector/oauth/",
)

# ticket -> pending authorize payload
PENDING_CONSENT: dict[str, dict] = {}
PIN_FAILS: dict[str, int] = {}
MAX_PIN_FAILS = 5
TICKET_TTL_S = 600


def consent_pin() -> str:
    return os.environ.get("FLOW_VEO_MCP_CONSENT_PIN", "").strip()


def redirect_prefixes() -> tuple[str, ...]:
    extra = os.environ.get("FLOW_VEO_MCP_OAUTH_REDIRECT_PREFIXES", "").strip()
    prefixes = list(DEFAULT_REDIRECT_PREFIXES)
    if extra:
        prefixes.extend(p.strip() for p in extra.split(",") if p.strip())
    if os.environ.get("FLOW_VEO_MCP_ALLOW_LOCAL_OAUTH", "").strip() in {"1", "true", "yes"}:
        prefixes.extend(("http://127.0.0.1/", "http://localhost/", "http://[::1]/"))
    return tuple(prefixes)


def allowed_redirect(uri: str | None) -> bool:
    if not uri or not isinstance(uri, str):
        return False
    raw = uri.strip()
    if not raw or "\\" in raw or "\n" in raw or "\r" in raw:
        return False
    parsed = urlparse(raw)
    if parsed.scheme not in {"https", "http"}:
        return False
    if parsed.username or parsed.password:
        return False
    for prefix in redirect_prefixes():
        if raw.startswith(prefix):
            return True
    return False


def assert_client_redirects(redirect_uris: list | None) -> None:
    uris = list(redirect_uris or [])
    if not uris:
        raise ValueError("redirect_uris required")
    bad = [u for u in uris if not allowed_redirect(str(u))]
    if bad:
        raise ValueError(
            "redirect_uri not allowlisted (ChatGPT connector prefixes only): "
            + ", ".join(str(u) for u in bad)
        )


def park_consent(*, client_id: str, client_name: str, params) -> str:
    """Store AuthorizationParams until the owner confirms with the PIN."""
    redirect_uri = str(getattr(params, "redirect_uri", "") or "")
    if not allowed_redirect(redirect_uri):
        raise ValueError("redirect_uri not allowlisted")
    ticket = secrets.token_urlsafe(24)
    PENDING_CONSENT[ticket] = {
        "client_id": client_id,
        "client_name": client_name or "unknown",
        "redirect_uri": redirect_uri,
        "state": getattr(params, "state", None),
        "scopes": list(getattr(params, "scopes", None) or []),
        "code_challenge": getattr(params, "code_challenge", None),
        "redirect_uri_provided_explicitly": bool(
            getattr(params, "redirect_uri_provided_explicitly", True)
        ),
        "resource": getattr(params, "resource", None),
        "params": params,
        "expires": time.time() + TICKET_TTL_S,
    }
    return ticket


def take_ticket(ticket: str) -> dict | None:
    if not ticket:
        return None
    payload = PENDING_CONSENT.get(ticket)
    if payload is None:
        return None
    if time.time() > payload["expires"]:
        PENDING_CONSENT.pop(ticket, None)
        PIN_FAILS.pop(ticket, None)
        return None
    return payload


def consume_ticket(ticket: str) -> dict | None:
    payload = take_ticket(ticket)
    if payload is None:
        return None
    PENDING_CONSENT.pop(ticket, None)
    PIN_FAILS.pop(ticket, None)
    return payload


def record_pin_failure(ticket: str) -> bool:
    """Return True if the ticket is now burned."""
    n = PIN_FAILS.get(ticket, 0) + 1
    PIN_FAILS[ticket] = n
    if n >= MAX_PIN_FAILS:
        PENDING_CONSENT.pop(ticket, None)
        PIN_FAILS.pop(ticket, None)
        return True
    return False


def pin_ok(candidate: str) -> bool:
    expected = consent_pin()
    if not expected:
        return False
    return secrets.compare_digest(candidate.strip(), expected)


def consent_page(*, ticket: str, client_name: str, redirect_uri: str, error: str = "") -> str:
    name = html.escape(client_name or "client")
    dest = html.escape(redirect_uri or "")
    err = html.escape(error) if error else ""
    pin_ready = bool(consent_pin())
    err_block = f'<p class="err">{err}</p>' if err else ""
    pin_block = (
        '<label>PIN máy chủ<input type="password" name="pin" autocomplete="one-time-code" required></label>'
        if pin_ready
        else '<p class="err">FLOW_VEO_MCP_CONSENT_PIN chưa cấu hình — từ chối OAuth.</p>'
    )
    allow_btn = (
        '<button type="submit" name="decision" value="allow">Cho phép ChatGPT</button>'
        if pin_ready
        else ""
    )
    return f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<title>FlowVeo MCP — xác nhận</title>
<style>
body{{margin:0;font:15px/1.45 Segoe UI,system-ui,sans-serif;background:#1e1e1e;color:#ccc}}
main{{max-width:440px;margin:12vh auto;padding:28px;background:#252526;border:1px solid #3c3c3c;border-radius:12px}}
h1{{font-size:18px;color:#eee;margin:0 0 12px}}
p{{margin:0 0 12px}}
code{{color:#ddd;word-break:break-all}}
label{{display:block;margin:16px 0 8px;color:#aaa;font-size:12px;letter-spacing:.06em;text-transform:uppercase}}
input{{width:100%;box-sizing:border-box;padding:10px;border:1px solid #3c3c3c;border-radius:8px;background:#1e1e1e;color:#eee}}
.row{{display:flex;gap:8px;margin-top:18px}}
button{{flex:1;padding:10px;border:1px solid #3c3c3c;border-radius:8px;background:#2d2d2d;color:#eee;cursor:pointer}}
button[value=allow]{{background:#0e639c;border-color:#0e639c}}
.err{{color:#f48771}}
</style></head><body><main>
<h1>Cho phép kết nối MCP?</h1>
<p>Ứng dụng <strong>{name}</strong> muốn điều khiển máy này qua FlowVeo MCP.</p>
<p>Redirect: <code>{dest}</code></p>
{err_block}
<form method="post" action="/consent">
<input type="hidden" name="ticket" value="{html.escape(ticket)}">
{pin_block}
<div class="row">
{allow_btn}
<button type="submit" name="decision" value="deny">Từ chối</button>
</div>
</form>
<p style="margin-top:18px;color:#888;font-size:12px">Chỉ chủ máy biết PIN trong mcp_server/.env. ChatGPT Web Bridge (cổng 5005) không đi qua trang này.</p>
</main></body></html>"""


def error_page(message: str) -> str:
    return f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>FlowVeo MCP</title></head>
<body style="background:#1e1e1e;color:#ccc;font:15px Segoe UI,sans-serif;padding:40px">
<p>{html.escape(message)}</p></body></html>"""
