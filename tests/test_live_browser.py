from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from browser_live_support import BrowserLiveClient, BrowserLiveUnavailable

pytestmark = pytest.mark.live_paid

ROOT = Path(__file__).resolve().parents[1]


def _enabled() -> None:
    if os.getenv("FLOW_RUN_LIVE_BROWSER", "0") != "1":
        pytest.skip("Set FLOW_RUN_LIVE_BROWSER=1 to run authorized Chrome/CDP live tests")


@pytest.fixture(scope="session")
def browser_live() -> BrowserLiveClient:
    _enabled()
    port = int(os.getenv("FLOW_CDP_PORT", "9222"))
    client = BrowserLiveClient(port=port)
    try:
        assert client.project_id(), "Open a Google Flow project page before browser-live tests"
    except BrowserLiveUnavailable as exc:
        pytest.skip(str(exc))
    return client


def test_browser_live_001_auth_session(browser_live):
    data = browser_live.auth_probe()
    assert data["status"] == 200
    assert data["ok"] is True
    assert data["hasAccessToken"] is True
    assert data["hasUser"] is True
    assert data["hasExpires"] is True


def test_browser_live_002_credits(browser_live):
    data = browser_live.credits_probe()
    assert data["status"] == 200
    assert data["sessionOk"] is True
    assert set(data["jsonKeys"]) & {"userPaygateTier", "serviceTier", "credits", "subscriptionCredits"}


def test_browser_live_003_upload_image(browser_live):
    path = Path(os.getenv("FLOW_BROWSER_UPLOAD_IMAGE", str(ROOT / "_ctl" / "g3_image.png")))
    data = browser_live.upload_image(path)
    assert data["status"] == 200
    assert data["has_media"] is True
    assert isinstance(data["media_id"], str) and len(data["media_id"]) >= 32


def test_browser_live_080_invalid_recaptcha(browser_live):
    req_path = ROOT / "evidence" / "video" / "t2v" / "request.json"
    req = json.loads(req_path.read_text(encoding="utf-8"))
    model_key = req.get("requests", [{}])[0].get("videoModelKey")
    assert model_key, "No T2V model key available in verified request fixture"
    data = browser_live.invalid_recaptcha_probe(model_key)
    assert data["status"] == 403
    assert data["errorStatus"] == "PERMISSION_DENIED"
    assert "recaptcha" in (data.get("message") or "").lower()


# Shared browser-live generation cache. Expensive generations run once per
# pytest process and dependent assertions reuse their sanitized results.
_BROWSER_RESULTS: dict[str, dict] = {}
_START_IMAGE = Path(os.getenv("FLOW_BROWSER_START_IMAGE_PATH", str(ROOT / "_ctl" / "g3_image.png")))
_END_IMAGE = Path(os.getenv("FLOW_BROWSER_END_IMAGE_PATH", str(ROOT / "_ctl" / "asset_menu.png")))


def _cached(key: str, factory):
    if key not in _BROWSER_RESULTS:
        _BROWSER_RESULTS[key] = factory()
    return _BROWSER_RESULTS[key]


def test_browser_live_010_t2v(browser_live):
    data = _cached("t2v", lambda: browser_live.generate_t2v(
        "Browser live T2V test: a small red paper boat drifting slowly across a calm lake, stable camera"
    ))
    assert data["http_status"] == 200
    assert data["endpoint"].endswith("/v1/video:batchAsyncGenerateVideoText")
    assert data["final"]["status"] == "MEDIA_GENERATION_STATUS_SUCCESSFUL"
    assert data["final"]["hasVideo"] is True
    assert data["final"]["mediaId"] == data["media_id"]


def test_browser_live_011_t2v_credit_delta(browser_live):
    data = _cached("t2v", lambda: browser_live.generate_t2v(
        "Browser live T2V credit test: a red paper boat moving gently on water"
    ))
    assert isinstance(data["credit_delta"], int)
    assert data["credit_delta"] > 0


def test_browser_live_020_i2v(browser_live):
    data = _cached("i2v", lambda: browser_live.generate_i2v(
        _START_IMAGE,
        "Browser live I2V test: gently zoom toward the center while the scene remains calm and natural",
    ))
    assert data["http_status"] == 200
    assert data["endpoint"].endswith("/v1/video:batchAsyncGenerateVideoStartImage")
    assert data["input_media_id"]
    assert data["final"]["status"] == "MEDIA_GENERATION_STATUS_SUCCESSFUL"
    assert data["final"]["hasVideo"] is True


def test_browser_live_030_interpolation(browser_live):
    data = _cached("interpolation", lambda: browser_live.generate_interpolation(
        _START_IMAGE,
        _END_IMAGE,
        "Browser live interpolation test: transition smoothly from the first frame to the last frame",
    ))
    assert data["http_status"] == 200
    assert data["endpoint"].endswith("/v1/video:batchAsyncGenerateVideoStartAndEndImage")
    assert data["start_media_id"] and data["end_media_id"]
    assert data["start_media_id"] != data["end_media_id"]
    assert data["final"]["status"] == "MEDIA_GENERATION_STATUS_SUCCESSFUL"
    assert data["final"]["hasVideo"] is True


def test_browser_live_040_reference(browser_live):
    data = _cached("reference", lambda: browser_live.generate_reference(
        _START_IMAGE,
        "Browser live reference test: create a short calm cinematic video using this visual reference",
    ))
    assert data["http_status"] == 200
    assert data["endpoint"].endswith("/v1/video:batchAsyncGenerateVideoReferenceImages")
    assert data["input_media_id"]
    assert data["final"]["status"] == "MEDIA_GENERATION_STATUS_SUCCESSFUL"
    assert data["final"]["hasVideo"] is True


def test_browser_live_050_edit_extend(browser_live):
    source = _cached("interpolation", lambda: browser_live.generate_interpolation(
        _START_IMAGE,
        _END_IMAGE,
        "Browser live interpolation source for edit test",
    ))
    data = _cached("edit", lambda: browser_live.generate_edit(
        source["media_id"],
        "Continue the motion naturally with a gentle camera push forward while preserving the scene",
    ))
    assert data["http_status"] == 200
    assert data["endpoint"].endswith("/v1/video:batchAsyncGenerateVideoEditVideo")
    assert data["source_media_id"] == source["media_id"]
    assert data["final"]["status"] == "MEDIA_GENERATION_STATUS_SUCCESSFUL"
    assert data["final"]["hasVideo"] is True


def test_browser_live_060_download(browser_live):
    source = _cached("t2v", lambda: browser_live.generate_t2v(
        "Browser live T2V source for download test: a paper boat drifting on a lake"
    ))
    data = browser_live.download_redirect_probe(source["media_id"])
    assert data["redirect_status"] == 307
    assert data["final"] is not None
    assert data["final"]["host"] == "flow-content.google"
    assert data["final"]["status"] in {200, 206}
    assert data["final"]["mimeType"] == "video/mp4"


def test_browser_live_070_cancel_active(browser_live):
    data = browser_live.cancel_active_t2v(
        "Browser live cancel test: a slow cinematic aerial move over a quiet lake with soft morning mist"
    )
    assert data["http_status"] == 200
    assert data["endpoint"].endswith("/v1/video:batchAsyncGenerateVideoText")
    assert data["media_id"]
    if data["cancel"]["status"] == 400 and data["cancel"].get("errorStatus") == "FAILED_PRECONDITION":
        pytest.xfail("Active cancel remains runtime-unverified: backend rejected immediate cancel with FAILED_PRECONDITION")
    assert data["cancel"]["status"] == 200
