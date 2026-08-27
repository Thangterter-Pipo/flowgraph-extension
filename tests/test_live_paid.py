from __future__ import annotations

import base64
import json
import mimetypes
import os
import time
import uuid
from pathlib import Path
from typing import Any

import pytest
import requests

AI = "https://aisandbox-pa.googleapis.com"
LABS = "https://labs.google"

pytestmark = pytest.mark.live_paid


def _enabled() -> None:
    if os.getenv("FLOW_RUN_LIVE_PAID", "0") != "1":
        pytest.skip("Set FLOW_RUN_LIVE_PAID=1 to run paid/live Google Flow E2E tests")


def _env(name: str, *, required: bool = True, default: str | None = None) -> str | None:
    value = os.getenv(name, default)
    if required and not value:
        pytest.skip(f"Missing required live-test environment variable: {name}")
    return value


def _bearer_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Origin": LABS,
    }


def _get_session() -> dict[str, Any]:
    cookie = _env("FLOW_SESSION_COOKIE")
    r = requests.get(f"{LABS}/fx/api/auth/session", headers={"Cookie": cookie}, timeout=30)
    assert r.status_code == 200, f"auth/session failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    assert data.get("access_token")
    return {"cookie": cookie, "access_token": data["access_token"], "session": data}


def _get_credits(access_token: str) -> dict[str, Any]:
    r = requests.get(f"{AI}/v1/credits", headers=_bearer_headers(access_token), timeout=30)
    assert r.status_code == 200, f"credits failed: {r.status_code} {r.text[:300]}"
    return r.json()


def _create_project(cookie: str) -> str:
    project_id = os.getenv("FLOW_PROJECT_ID")
    if project_id:
        return project_id
    payload = {"json": {"projectTitle": f"FLOW_LIVE_TEST_{int(time.time())}", "toolName": "PINHOLE"}}
    r = requests.post(
        f"{LABS}/fx/api/trpc/project.createProject",
        headers={"Cookie": cookie, "Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    assert r.status_code == 200, f"create project failed: {r.status_code} {r.text[:300]}"
    return r.json()["result"]["data"]["json"]["result"]["projectId"]


def _context(project_id: str, tier: str | None, recaptcha_token: str) -> dict[str, Any]:
    ctx: dict[str, Any] = {
        "projectId": project_id,
        "tool": "PINHOLE",
        "sessionId": str(int(time.time() * 1000)),
        "recaptchaContext": {
            "token": recaptcha_token,
            "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB",
        },
    }
    if tier:
        ctx["userPaygateTier"] = tier
    return ctx


def _generation_context() -> dict[str, Any]:
    return {
        "batchId": str(uuid.uuid4()),
        "audioFailurePreference": "AUDIO_FAILURE_PREFERENCE_UNSPECIFIED",
    }


def _poll(access_token: str, project_id: str, media_id: str, timeout_s: int = 900) -> dict[str, Any]:
    deadline = time.time() + timeout_s
    payload = {"media": [{"name": media_id, "projectId": project_id}]}
    last: dict[str, Any] = {}
    while time.time() < deadline:
        r = requests.post(
            f"{AI}/v1/video:batchCheckAsyncVideoGenerationStatus",
            headers=_bearer_headers(access_token),
            json=payload,
            timeout=30,
        )
        assert r.status_code == 200, f"poll failed: {r.status_code} {r.text[:300]}"
        last = r.json()
        media = (last.get("media") or [{}])[0]
        status = media.get("mediaMetadata", {}).get("mediaStatus", {}).get("mediaGenerationStatus")
        if status in {"MEDIA_GENERATION_STATUS_SUCCESSFUL", "MEDIA_GENERATION_STATUS_COMPLETE"}:
            return last
        if status in {"MEDIA_GENERATION_STATUS_FAILED", "MEDIA_GENERATION_STATUS_CANCELED"}:
            pytest.fail(f"Generation terminal failure: {json.dumps(last)[:1000]}")
        time.sleep(8)
    pytest.fail(f"Generation timeout after {timeout_s}s; last={json.dumps(last)[:1000]}")


def _submit_video(endpoint: str, access_token: str, payload: dict[str, Any]) -> dict[str, Any]:
    r = requests.post(f"{AI}{endpoint}", headers=_bearer_headers(access_token), json=payload, timeout=60)
    assert r.status_code == 200, f"submit failed {endpoint}: {r.status_code} {r.text[:800]}"
    data = r.json()
    assert "error" not in data
    assert data.get("media") or data.get("mediaId")
    return data


def _extract_media_id(data: dict[str, Any]) -> str:
    if data.get("mediaId"):
        return data["mediaId"]
    media = data.get("media") or []
    if isinstance(media, list) and media:
        return media[0].get("name") or media[0].get("mediaId")
    if isinstance(media, dict):
        return media.get("name") or media.get("mediaId")
    raise AssertionError(f"Unable to extract media id from response: {json.dumps(data)[:500]}")


@pytest.fixture(scope="session")
def live_ctx():
    _enabled()
    sess = _get_session()
    credits = _get_credits(sess["access_token"])
    project_id = _create_project(sess["cookie"])
    return {
        **sess,
        "project_id": project_id,
        "tier": credits.get("userPaygateTier"),
        "credits_initial": credits,
    }


@pytest.fixture(scope="session")
def live_uploaded_image_id(live_ctx):
    path_value = _env("FLOW_UPLOAD_IMAGE_PATH", required=False)
    existing = os.getenv("FLOW_IMAGE_MEDIA_ID")
    if existing:
        return existing
    if not path_value:
        pytest.skip("Set FLOW_IMAGE_MEDIA_ID or FLOW_UPLOAD_IMAGE_PATH for upload/I2V tests")
    path = Path(path_value)
    assert path.exists() and path.is_file(), f"FLOW_UPLOAD_IMAGE_PATH does not exist: {path}"
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    payload = {
        "clientContext": {"projectId": live_ctx["project_id"], "tool": "PINHOLE"},
        "imageBytes": base64.b64encode(path.read_bytes()).decode("ascii"),
        "isUserUploaded": True,
        "isHidden": False,
        "mimeType": mime,
        "fileName": path.name,
    }
    r = requests.post(
        f"{AI}/v1/flow/uploadImage",
        headers=_bearer_headers(live_ctx["access_token"]),
        json=payload,
        timeout=60,
    )
    assert r.status_code == 200, f"uploadImage failed: {r.status_code} {r.text[:800]}"
    data = r.json()
    return (
        data.get("media", {}).get("name")
        or data.get("workflow", {}).get("metadata", {}).get("primaryMediaId")
    )


@pytest.fixture(scope="session")
def live_t2v_media(live_ctx):
    token = _env("FLOW_RECAPTCHA_T2V")
    model_key = _env("FLOW_T2V_MODEL_KEY")
    aspect = _env("FLOW_T2V_ASPECT_RATIO", required=False, default="VIDEO_ASPECT_RATIO_LANDSCAPE")
    prompt = _env("FLOW_T2V_PROMPT", required=False, default="A fox walking through autumn forest leaves")
    credits_before = _get_credits(live_ctx["access_token"])
    payload = {
        "mediaGenerationContext": _generation_context(),
        "clientContext": _context(live_ctx["project_id"], live_ctx["tier"], token),
        "requests": [{
            "aspectRatio": aspect,
            "textInput": {"structuredPrompt": {"parts": [{"text": prompt}]}},
            "videoModelKey": model_key,
            "metadata": {},
        }],
        "useV2ModelConfig": True,
    }
    submitted = _submit_video("/v1/video:batchAsyncGenerateVideoText", live_ctx["access_token"], payload)
    media_id = _extract_media_id(submitted)
    final = _poll(live_ctx["access_token"], live_ctx["project_id"], media_id)
    credits_after = _get_credits(live_ctx["access_token"])
    return {"media_id": media_id, "submitted": submitted, "final": final, "credits_before": credits_before, "credits_after": credits_after}


@pytest.fixture(scope="session")
def live_i2v_media(live_ctx, live_uploaded_image_id):
    token = _env("FLOW_RECAPTCHA_I2V")
    model_key = _env("FLOW_I2V_MODEL_KEY")
    payload = {
        "mediaGenerationContext": _generation_context(),
        "clientContext": _context(live_ctx["project_id"], live_ctx["tier"], token),
        "requests": [{
            "aspectRatio": _env("FLOW_I2V_ASPECT_RATIO", required=False, default="VIDEO_ASPECT_RATIO_LANDSCAPE"),
            "textInput": {"structuredPrompt": {"parts": [{"text": _env("FLOW_I2V_PROMPT", required=False, default="Camera slow zoom in")}] }},
            "startImage": {"mediaId": live_uploaded_image_id},
            "videoModelKey": model_key,
            "metadata": {},
        }],
        "useV2ModelConfig": True,
    }
    submitted = _submit_video("/v1/video:batchAsyncGenerateVideoStartImage", live_ctx["access_token"], payload)
    media_id = _extract_media_id(submitted)
    final = _poll(live_ctx["access_token"], live_ctx["project_id"], media_id)
    return {"media_id": media_id, "submitted": submitted, "final": final}


@pytest.fixture(scope="session")
def live_interpolation_media(live_ctx, live_uploaded_image_id):
    end_id = _env("FLOW_END_IMAGE_MEDIA_ID")
    token = _env("FLOW_RECAPTCHA_INTERPOLATION")
    model_key = _env("FLOW_INTERPOLATION_MODEL_KEY")
    payload = {
        "mediaGenerationContext": _generation_context(),
        "clientContext": _context(live_ctx["project_id"], live_ctx["tier"], token),
        "requests": [{
            "aspectRatio": _env("FLOW_INTERPOLATION_ASPECT_RATIO", required=False, default="VIDEO_ASPECT_RATIO_LANDSCAPE"),
            "textInput": {"structuredPrompt": {"parts": [{"text": _env("FLOW_INTERPOLATION_PROMPT", required=False, default="Smooth transition")}] }},
            "startImage": {"mediaId": live_uploaded_image_id},
            "endImage": {"mediaId": end_id},
            "videoModelKey": model_key,
            "metadata": {},
        }],
        "useV2ModelConfig": True,
    }
    submitted = _submit_video("/v1/video:batchAsyncGenerateVideoStartAndEndImage", live_ctx["access_token"], payload)
    media_id = _extract_media_id(submitted)
    final = _poll(live_ctx["access_token"], live_ctx["project_id"], media_id)
    return {"media_id": media_id, "submitted": submitted, "final": final}


# ---------------------------------------------------------------------------
# Live paid test cases
# ---------------------------------------------------------------------------

def test_live_001_auth_session_returns_access_token(live_ctx):
    assert live_ctx["access_token"]
    assert live_ctx["project_id"]


def test_live_002_credits_endpoint_returns_tier(live_ctx):
    data = _get_credits(live_ctx["access_token"])
    assert "userPaygateTier" in data or "serviceTier" in data or "remainingCredits" in data


def test_live_003_image_upload_returns_media_id(live_uploaded_image_id):
    assert live_uploaded_image_id and isinstance(live_uploaded_image_id, str)


def test_live_010_t2v_generates_successful_media(live_t2v_media):
    media = live_t2v_media["final"]["media"][0]
    status = media["mediaMetadata"]["mediaStatus"]["mediaGenerationStatus"]
    assert status in {"MEDIA_GENERATION_STATUS_SUCCESSFUL", "MEDIA_GENERATION_STATUS_COMPLETE"}


def test_live_011_t2v_credit_balance_does_not_increase(live_t2v_media):
    before = live_t2v_media["credits_before"].get("remainingCredits")
    after = live_t2v_media["credits_after"].get("remainingCredits")
    if isinstance(before, int) and isinstance(after, int):
        assert after <= before


def test_live_020_i2v_generates_from_start_image_media_id(live_i2v_media):
    media = live_i2v_media["final"]["media"][0]
    assert media["mediaMetadata"]["mediaStatus"]["mediaGenerationStatus"] in {
        "MEDIA_GENERATION_STATUS_SUCCESSFUL", "MEDIA_GENERATION_STATUS_COMPLETE"
    }


def test_live_030_interpolation_generates_from_two_media_ids(live_interpolation_media):
    media = live_interpolation_media["final"]["media"][0]
    assert media["mediaMetadata"]["mediaStatus"]["mediaGenerationStatus"] in {
        "MEDIA_GENERATION_STATUS_SUCCESSFUL", "MEDIA_GENERATION_STATUS_COMPLETE"
    }


def test_live_040_reference_images_media_id_shape(live_ctx, live_uploaded_image_id):
    token = _env("FLOW_RECAPTCHA_REFERENCE")
    model_key = _env("FLOW_REFERENCE_MODEL_KEY")
    payload = {
        "mediaGenerationContext": _generation_context(),
        "clientContext": _context(live_ctx["project_id"], live_ctx["tier"], token),
        "requests": [{
            "aspectRatio": _env("FLOW_REFERENCE_ASPECT_RATIO", required=False, default="VIDEO_ASPECT_RATIO_LANDSCAPE"),
            "textInput": {"structuredPrompt": {"parts": [{"text": _env("FLOW_REFERENCE_PROMPT", required=False, default="Use the reference image")}] }},
            "referenceImages": [{"mediaId": live_uploaded_image_id}],
            "videoModelKey": model_key,
            "metadata": {},
        }],
        "useV2ModelConfig": True,
    }
    submitted = _submit_video("/v1/video:batchAsyncGenerateVideoReferenceImages", live_ctx["access_token"], payload)
    media_id = _extract_media_id(submitted)
    final = _poll(live_ctx["access_token"], live_ctx["project_id"], media_id)
    assert final["media"][0]["mediaMetadata"]["mediaStatus"]["mediaGenerationStatus"] in {
        "MEDIA_GENERATION_STATUS_SUCCESSFUL", "MEDIA_GENERATION_STATUS_COMPLETE"
    }


def test_live_050_edit_or_extend_video_input_media_id(live_ctx, live_t2v_media):
    token = _env("FLOW_RECAPTCHA_EDIT")
    model_key = _env("FLOW_EDIT_MODEL_KEY")
    endpoint = _env("FLOW_EDIT_ENDPOINT", required=False, default="/v1/video:batchAsyncGenerateVideoEditVideo")
    payload = {
        "mediaGenerationContext": _generation_context(),
        "clientContext": _context(live_ctx["project_id"], live_ctx["tier"], token),
        "requests": [{
            "aspectRatio": _env("FLOW_EDIT_ASPECT_RATIO", required=False, default="VIDEO_ASPECT_RATIO_LANDSCAPE"),
            "textInput": {"structuredPrompt": {"parts": [{"text": _env("FLOW_EDIT_PROMPT", required=False, default="Continue the scene naturally")}] }},
            "videoInput": {"mediaId": live_t2v_media["media_id"]},
            "videoModelKey": model_key,
            "metadata": {},
        }],
    }
    # Some edit variants reject useV2ModelConfig; only add it if explicitly requested.
    if os.getenv("FLOW_EDIT_USE_V2_MODEL_CONFIG") == "1":
        payload["useV2ModelConfig"] = True
    submitted = _submit_video(endpoint, live_ctx["access_token"], payload)
    media_id = _extract_media_id(submitted)
    final = _poll(live_ctx["access_token"], live_ctx["project_id"], media_id)
    assert final["media"][0]["mediaMetadata"]["mediaStatus"]["mediaGenerationStatus"] in {
        "MEDIA_GENERATION_STATUS_SUCCESSFUL", "MEDIA_GENERATION_STATUS_COMPLETE"
    }


def test_live_060_download_redirect_is_307_and_cdn_is_mp4(live_ctx, live_t2v_media):
    media_id = live_t2v_media["media_id"]
    r = requests.get(
        f"{LABS}/fx/api/trpc/media.getMediaUrlRedirect?name={media_id}",
        headers={"Cookie": live_ctx["cookie"]},
        allow_redirects=False,
        timeout=30,
    )
    assert r.status_code == 307
    location = r.headers.get("Location")
    assert location and location.startswith("https://flow-content.google/")
    cdn = requests.get(location, stream=True, timeout=120)
    assert cdn.status_code == 200
    assert cdn.headers.get("Content-Type", "").startswith("video/mp4")
    first = next(cdn.iter_content(chunk_size=32), b"")
    assert len(first) >= 8 and first[4:8] == b"ftyp"


def test_live_070_cancel_active_generation_uses_media_id(live_ctx):
    """Consumes a fresh generation attempt; intended specifically to test cancel while job is active."""
    token = _env("FLOW_RECAPTCHA_CANCEL_JOB")
    model_key = _env("FLOW_CANCEL_MODEL_KEY")
    payload = {
        "mediaGenerationContext": _generation_context(),
        "clientContext": _context(live_ctx["project_id"], live_ctx["tier"], token),
        "requests": [{
            "aspectRatio": _env("FLOW_CANCEL_ASPECT_RATIO", required=False, default="VIDEO_ASPECT_RATIO_LANDSCAPE"),
            "textInput": {"structuredPrompt": {"parts": [{"text": _env("FLOW_CANCEL_PROMPT", required=False, default="A slow cinematic landscape")}] }},
            "videoModelKey": model_key,
            "metadata": {},
        }],
        "useV2ModelConfig": True,
    }
    submitted = _submit_video("/v1/video:batchAsyncGenerateVideoText", live_ctx["access_token"], payload)
    media_id = _extract_media_id(submitted)
    cancel = requests.post(
        f"{AI}/v1/flowMedia:cancelGeneration",
        headers=_bearer_headers(live_ctx["access_token"]),
        json={"mediaId": media_id},
        timeout=30,
    )
    assert cancel.status_code in {200, 204}, f"cancel failed: {cancel.status_code} {cancel.text[:500]}"


def test_live_080_invalid_recaptcha_token_is_rejected_without_bypass(live_ctx):
    payload = {
        "mediaGenerationContext": _generation_context(),
        "clientContext": _context(live_ctx["project_id"], live_ctx["tier"], "INVALID_NEGATIVE_CONTROL_TOKEN"),
        "requests": [{
            "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
            "textInput": {"structuredPrompt": {"parts": [{"text": "negative control"}]}},
            "videoModelKey": _env("FLOW_T2V_MODEL_KEY"),
            "metadata": {},
        }],
        "useV2ModelConfig": True,
    }
    r = requests.post(
        f"{AI}/v1/video:batchAsyncGenerateVideoText",
        headers=_bearer_headers(live_ctx["access_token"]),
        json=payload,
        timeout=60,
    )
    assert r.status_code == 403
    data = r.json()
    assert data.get("error", {}).get("status") == "PERMISSION_DENIED"
