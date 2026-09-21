"""Unit tests for OAuth redirect allowlist + consent PIN (no live server)."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("FLOW_VEO_MCP_CONSENT_PIN", "unit-test-pin")
os.environ.pop("FLOW_VEO_MCP_OAUTH_REDIRECT_PREFIXES", None)
os.environ.pop("FLOW_VEO_MCP_ALLOW_LOCAL_OAUTH", None)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from security import oauth_policy as pol  # noqa: E402

PASS = 0
FAIL = 0


def check(label: str, cond: bool, extra: object = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}  {extra}")


def main() -> None:
    check(
        "chatgpt callback allowed",
        pol.allowed_redirect("https://chatgpt.com/connector/oauth/callback"),
    )
    check(
        "chatgpt per-install suffix allowed",
        pol.allowed_redirect("https://chatgpt.com/connector/oauth/ahZQkc9Y2MzN"),
    )
    check(
        "random https rejected",
        not pol.allowed_redirect("https://example.com/cb"),
    )
    check(
        "javascript rejected",
        not pol.allowed_redirect("javascript:alert(1)"),
    )
    check(
        "http chatgpt rejected",
        not pol.allowed_redirect("http://chatgpt.com/connector/oauth/callback"),
    )
    check(
        "chatgpt.com other path rejected",
        not pol.allowed_redirect("https://chatgpt.com/backend-api/foo"),
    )

    try:
        pol.assert_client_redirects(["https://evil.example/cb"])
        check("assert evil raises", False)
    except ValueError:
        check("assert evil raises", True)

    pol.assert_client_redirects(["https://chatgpt.com/connector/oauth/callback"])
    check("assert chatgpt ok", True)

    params = SimpleNamespace(
        state="st",
        scopes=["filesystem"],
        code_challenge="abc",
        redirect_uri="https://chatgpt.com/connector/oauth/callback",
        redirect_uri_provided_explicitly=True,
        resource="https://flowveo.thangterter.online",
    )
    ticket = pol.park_consent(client_id="cid", client_name="ChatGPT", params=params)
    check("park ticket", bool(ticket) and pol.take_ticket(ticket) is not None)
    check("pin wrong", not pol.pin_ok("nope"))
    check("pin right", pol.pin_ok("unit-test-pin"))
    burned = False
    for _ in range(pol.MAX_PIN_FAILS):
        burned = pol.record_pin_failure(ticket)
    check("pin lockout burns ticket", burned and pol.take_ticket(ticket) is None)

    page = pol.consent_page(
        ticket="t",
        client_name="<script>",
        redirect_uri="https://chatgpt.com/connector/oauth/callback",
    )
    check("consent html escapes name", "<script>" not in page and "&lt;script&gt;" in page)

    print(f"\n{PASS} passed, {FAIL} failed")
    raise SystemExit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
