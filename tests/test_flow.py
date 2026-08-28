from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest

from conftest import (
    ROOT,
    VERIFIED_ARTIFACTS,
    assert_mp4,
    assert_uuid,
    load_json,
    read_text,
    repo_path,
)

DOC = "GOOGLE_FLOW_API_REFERENCE.md"
MANIFEST = "evidence_manifest.json"
REGISTRY = "model_registry/normalized_registry.json"

META_VERIFIED_LINE_ALLOWLIST = (
    "1. **`[RUNTIME_VERIFIED]`** —",
    "Mọi claim `[RUNTIME_VERIFIED]` phải có",
    "not promoted to independent `[RUNTIME_VERIFIED]` claims",
    "not promoted to `[RUNTIME_VERIFIED]`",
    "GATE 6 — EVIDENCE",
)

KNOWN_SUCCESS_RULES = {
    "no_top_level_error",
    "recaptcha_invalid_403",
    "result_status_200",
    "has_media_name",
    "has_image_artifact",
    "has_mp4_artifact",
    "has_cdn_url",
    "has_eligible_field",
    "has_character_slot",
}

# ---------------------------------------------------------------------------
# A. Repository / Manifest / Documentation guardrails
# ---------------------------------------------------------------------------

def test_001_required_core_files_exist():
    required = [
        DOC,
        MANIFEST,
        REGISTRY,
        "sdk/client.py",
        "_ctl/verify_docs.py",
        "_ctl/schemas_master.json",
        "evidence/auth/response.json",
        "evidence/project/response.json",
        "evidence/upload/image/request.json",
        "evidence/upload/image/response.json",
        "evidence/video/t2v/response.json",
        "evidence/video/i2v/response.json",
        "evidence/video/interpolation/response.json",
        "evidence/video/extend/response.json",
        "evidence/download/response.json",
        "evidence/polling/poll_final.json",
    ]
    for rel in required:
        assert repo_path(rel).exists(), f"Required repo file missing: {rel}"


def test_002_manifest_claim_ids_are_unique(manifest):
    ids = [c["id"] for c in manifest.get("claims", [])]
    assert ids, "Manifest has no claims"
    assert len(ids) == len(set(ids)), "Duplicate claim id in evidence_manifest.json"


def test_003_manifest_has_13_runtime_verified_claims(manifest):
    verified = [c for c in manifest["claims"] if c.get("status") == "RUNTIME_VERIFIED"]
    assert len(verified) == 14, f"Expected 14 verified claims, got {len(verified)}"


def test_004_every_verified_heading_has_immediate_claim_id(master_text):
    lines = master_text.splitlines()
    for idx, line in enumerate(lines):
        if "[RUNTIME_VERIFIED]" not in line:
            continue
        if not line.lstrip().startswith("#"):
            assert any(allowed in line for allowed in META_VERIFIED_LINE_ALLOWLIST), (
                f"Unexpected non-heading [RUNTIME_VERIFIED] marker at line {idx + 1}: {line}"
            )
            continue
        assert idx + 1 < len(lines), f"Verified heading at EOF: line {idx + 1}"
        assert re.fullmatch(r"\s*<!--\s*claim_id:\s*[^\s]+\s*-->\s*", lines[idx + 1]), (
            f"Verified heading missing immediate claim_id at line {idx + 1}: {line}"
        )


def test_005_master_verified_claims_exact_match_manifest(master_text, manifest):
    doc_claims = set(re.findall(
        r"(?m)^#{2,6}\s+.*\[RUNTIME_VERIFIED\][^\n]*\n\s*<!--\s*claim_id:\s*([^\s]+)\s*-->",
        master_text,
    ))
    manifest_claims = {
        c["id"] for c in manifest["claims"] if c.get("status") == "RUNTIME_VERIFIED"
    }
    assert doc_claims == manifest_claims, (
        f"Master/manifest mismatch. doc_only={sorted(doc_claims-manifest_claims)}; "
        f"manifest_only={sorted(manifest_claims-doc_claims)}"
    )


def test_006_manifest_fixtures_exist(manifest):
    for claim in manifest["claims"]:
        fixture = claim.get("fixture")
        assert fixture, f"Claim {claim['id']} missing fixture"
        assert repo_path(fixture).exists(), f"Claim {claim['id']} missing fixture: {fixture}"


def test_007_manifest_success_rules_are_known(manifest):
    for claim in manifest["claims"]:
        assert claim.get("success_rule") in KNOWN_SUCCESS_RULES, (
            f"Unknown success rule for {claim['id']}: {claim.get('success_rule')}"
        )


def _validate_manifest_claim(claim: dict):
    data = load_json(claim["fixture"])
    rule = claim["success_rule"]

    if rule == "no_top_level_error":
        assert "error" not in data
    elif rule == "recaptcha_invalid_403":
        err = data.get("error", {})
        assert err.get("code") == 403
        assert err.get("status") == "PERMISSION_DENIED"
        assert "recaptcha" in err.get("message", "").lower()
    elif rule == "result_status_200":
        assert data.get("result", {}).get("data", {}).get("json", {}).get("status") == 200
    elif rule == "has_media_name":
        assert "media" in data and isinstance(data["media"], dict)
        primary = data.get("workflow", {}).get("metadata", {}).get("primaryMediaId")
        assert primary or data["media"].get("name")
    elif rule == "has_image_artifact":
        ev = data.get("_evidence", {})
        assert ev.get("status") == 200
        artifact = ev.get("artifact")
        assert artifact, f"No image artifact recorded for {claim['id']}"
        path = repo_path(artifact)
        assert path.exists() and path.stat().st_size == ev.get("artifact_bytes")
        assert path.stat().st_size > 1024
        head = path.read_bytes()[:16]
        assert head.startswith(b"\xff\xd8\xff") or head.startswith(b"\x89PNG\r\n\x1a\n") or head.startswith(b"RIFF")
        assert ev.get("valid_image_magic") is True
    elif rule == "has_mp4_artifact":
        ev = data.get("_evidence", {})
        assert ev.get("status") == 200
        artifact = ev.get("mp4_artifact")
        assert artifact, f"No mp4_artifact recorded for {claim['id']}"
        assert_mp4(repo_path(artifact), ev.get("mp4_bytes") or data.get("length_bytes"))
    elif rule == "has_cdn_url":
        assert data.get("direct_cdn_url", "").startswith("https://flow-content.google/")
        assert data.get("contentType") == "video/mp4"
    elif rule == "has_eligible_field":
        assert isinstance(data.get("eligible"), bool)
    elif rule == "has_character_slot":
        ctx = data.get("destinationMediaContext", {}).get("entityContext", {})
        assert "entityId" in ctx and "characterSlot" in ctx
    else:  # pragma: no cover
        raise AssertionError(f"Unhandled success rule: {rule}")


def test_008_all_manifest_success_validators_pass(manifest):
    for claim in manifest["claims"]:
        _validate_manifest_claim(claim)


# ---------------------------------------------------------------------------
# B. Auth / Project / reCAPTCHA evidence
# ---------------------------------------------------------------------------

def test_010_auth_fixture_schema_and_redaction():
    data = load_json("evidence/auth/response.json")
    assert "expires" in data
    assert "access_token" in data
    assert "user" in data
    assert str(data["access_token"]).startswith("<REDACTED")


def test_011_project_create_response_is_http_200_semantic_success():
    data = load_json("evidence/project/response.json")
    payload = data["result"]["data"]["json"]
    assert payload["status"] == 200
    assert payload["statusText"] == "OK"
    assert_uuid(payload["result"]["projectId"])


def test_012_invalid_recaptcha_token_negative_control_is_403():
    data = load_json("evidence/recaptcha/invalid_token_response.json")
    assert data["error"]["code"] == 403
    assert data["error"]["status"] == "PERMISSION_DENIED"
    assert "evaluation failed" in data["error"]["message"].lower()


def test_013_recaptcha_notes_do_not_overclaim_single_use():
    data = load_json("evidence/recaptcha/batch_notes.json")
    blob = json.dumps(data).lower()
    # RC2 must not turn the invalid-token negative control into replay proof.
    if "single_use_verified" in data:
        assert data["single_use_verified"] is not True
    assert "invalid" in blob


# ---------------------------------------------------------------------------
# C. Image upload
# ---------------------------------------------------------------------------

def test_020_image_upload_uses_image_bytes_not_encoded_image():
    req = load_json("evidence/upload/image/request.json")
    assert "imageBytes" in req
    assert "encodedImage" not in req
    assert req.get("mimeType", "").startswith("image/")
    assert req.get("isUserUploaded") is True


def test_021_image_upload_success_response_has_media_and_workflow():
    res = load_json("evidence/upload/image/response.json")
    assert "error" not in res
    assert isinstance(res.get("media"), dict)
    assert isinstance(res.get("workflow"), dict)
    assert int(res["media"]["mediaMetadata"]["mediaBlobSize"]) > 0


def test_022_image_upload_primary_media_id_is_uuid():
    res = load_json("evidence/upload/image/response.json")
    assert_uuid(res["workflow"]["metadata"]["primaryMediaId"])


def test_023_image_upload_dimensions_are_positive():
    dims = load_json("evidence/upload/image/response.json")["media"]["image"]["dimensions"]
    assert dims["width"] > 0 and dims["height"] > 0


# ---------------------------------------------------------------------------
# D. T2V runtime + polling + artifact
# ---------------------------------------------------------------------------

def test_030_t2v_runtime_response_is_successful():
    res = load_json("evidence/video/t2v/response.json")
    assert "error" not in res
    assert res["_evidence"]["status"] == 200
    media = res["media"][0]
    assert media["mediaMetadata"]["mediaStatus"]["mediaGenerationStatus"] == "MEDIA_GENERATION_STATUS_SUCCESSFUL"
    assert_uuid(media["name"])


def test_031_t2v_response_model_and_duration_are_recorded():
    media = load_json("evidence/video/t2v/response.json")["media"][0]
    assert media["video"]["generatedVideo"]["model"]
    assert re.fullmatch(r"\d+s", media["video"]["dimensions"]["length"])


def test_032_t2v_mp4_artifact_exists_and_matches_evidence_size():
    res = load_json("evidence/video/t2v/response.json")
    ev = res["_evidence"]
    assert_mp4(repo_path(ev["mp4_artifact"]), ev["mp4_bytes"])


def test_033_poll_final_matches_t2v_media_and_success_state():
    t2v = load_json("evidence/video/t2v/response.json")
    poll = load_json("evidence/polling/poll_final.json")
    assert poll["media"][0]["name"] == t2v["media"][0]["name"]
    assert poll["media"][0]["mediaMetadata"]["mediaStatus"]["mediaGenerationStatus"] == "MEDIA_GENERATION_STATUS_SUCCESSFUL"
    assert poll["remainingCredits"] == t2v["remainingCredits"]


# ---------------------------------------------------------------------------
# E. I2V
# ---------------------------------------------------------------------------

def test_040_i2v_request_uses_start_image_media_id():
    req = load_json("evidence/video/i2v/request.json")
    start = req["requests"][0]["startImage"]
    assert set(start) == {"mediaId"}
    assert_uuid(start["mediaId"])


def test_041_i2v_request_does_not_use_legacy_start_image_name():
    start = load_json("evidence/video/i2v/request.json")["requests"][0]["startImage"]
    assert "name" not in start


def test_042_i2v_response_has_mp4_and_cdn_metadata():
    res = load_json("evidence/video/i2v/response.json")
    assert res["_evidence"]["status"] == 200
    assert_uuid(res["mediaId"])
    assert res["contentType"] == "video/mp4"
    assert res["cdn_url"].startswith("https://flow-content.google/")
    assert_mp4(repo_path(res["_evidence"]["mp4_artifact"]), res["length_bytes"])


def test_043_i2v_verified_field_shape_mentions_media_id():
    res = load_json("evidence/video/i2v/response.json")
    assert "startImage" in res["verified_field_shape"]
    assert "mediaId" in res["verified_field_shape"]


# ---------------------------------------------------------------------------
# F. Start/end interpolation
# ---------------------------------------------------------------------------

def test_050_interpolation_request_uses_start_and_end_media_id():
    req = load_json("evidence/video/interpolation/request.json")["requests"][0]
    assert set(req["startImage"]) == {"mediaId"}
    assert set(req["endImage"]) == {"mediaId"}
    assert_uuid(req["startImage"]["mediaId"])
    assert_uuid(req["endImage"]["mediaId"])
    assert req["startImage"]["mediaId"] != req["endImage"]["mediaId"]


def test_051_interpolation_response_has_real_mp4():
    res = load_json("evidence/video/interpolation/response.json")
    assert res["_evidence"]["status"] == 200
    assert res["contentType"] == "video/mp4"
    assert_mp4(repo_path(res["_evidence"]["mp4_artifact"]), res["length_bytes"])


def test_052_interpolation_verified_shape_has_no_legacy_name():
    shape = load_json("evidence/video/interpolation/response.json")["verified_field_shape"]
    assert "mediaId" in shape
    assert ".name" not in shape


# ---------------------------------------------------------------------------
# G. Reference images (runtime verified)
# ---------------------------------------------------------------------------

def test_060_reference_request_uses_media_id_shape():
    refs = load_json("evidence/video/reference/request.json")["requests"][0]["referenceImages"]
    assert refs
    for item in refs:
        assert "mediaId" in item
        assert_uuid(item["mediaId"])
        if "imageUsageType" in item:
            assert item["imageUsageType"] == "IMAGE_USAGE_TYPE_ASSET"
        assert "name" not in item


def test_061_reference_response_and_artifact_are_verified():
    res = load_json("evidence/video/reference/response.json")
    ev = res["_evidence"]
    assert ev["status"] == 200
    assert ev["terminal_status"] == "MEDIA_GENERATION_STATUS_SUCCESSFUL"
    assert ev["ftyp"] is True
    assert_mp4(repo_path(ev["mp4_artifact"]), ev["mp4_bytes"])
    media = res["media"][0]
    assert_uuid(media["name"])
    assert media["mediaMetadata"]["requestData"]["videoGenerationRequestData"]["videoModelControlInput"]["videoGenerationMode"] == "VIDEO_GENERATION_MODE_REFERENCE_TO_VIDEO"


def test_062_reference_is_in_runtime_verified_manifest(manifest):
    ids = {c["id"] for c in manifest["claims"] if c["status"] == "RUNTIME_VERIFIED"}
    assert "reference_to_video" in ids


# ---------------------------------------------------------------------------
# H. Extend/Edit + regression of legacy name payload
# ---------------------------------------------------------------------------

def test_070_extend_edit_success_response_records_media_id_shape():
    res = load_json("evidence/video/extend/response.json")
    assert res["_evidence"]["status"] == 200
    assert "videoInput" in res["verified_field_shape"]
    assert "mediaId" in res["verified_field_shape"]
    assert_uuid(res["mediaId"])
    assert_uuid(res["_evidence"]["source_video_media_id"])


def test_071_extend_edit_success_artifact_is_real_mp4():
    res = load_json("evidence/video/extend/response.json")
    assert_mp4(repo_path(res["_evidence"]["mp4_artifact"]), res["length_bytes"])


def test_072_legacy_edit_name_payload_is_rejected_by_backend():
    req = load_json("evidence/video/edit/request.json")
    res = load_json("evidence/video/edit/response.json")
    assert "name" in req["requests"][0]["videoInput"]
    assert res["error"]["code"] == 400
    desc = json.dumps(res).lower()
    assert "unknown name" in desc and "video_input" in desc


def test_073_extend_request_fixture_is_known_stale_vs_verified_shape():
    """Do not silently treat the legacy extend/request.json as the successful mediaId capture."""
    req = load_json("evidence/video/extend/request.json")
    res = load_json("evidence/video/extend/response.json")
    assert "name" in req["requests"][0]["videoInput"], "If this becomes mediaId, update this regression test"
    assert "mediaId" in res["verified_field_shape"]


# ---------------------------------------------------------------------------
# I. Cancel generation
# ---------------------------------------------------------------------------

def test_080_cancel_request_uses_media_id_only():
    req = load_json("evidence/cancel/request.json")
    assert set(req) == {"mediaId"}
    assert_uuid(req["mediaId"])


def test_081_cancel_completed_media_fails_precondition_not_schema_validation():
    res = load_json("evidence/cancel/response.json")
    assert res["error"]["code"] == 400
    assert res["error"]["status"] == "FAILED_PRECONDITION"
    reasons = json.dumps(res)
    assert "PUBLIC_ERROR_MEDIA_GENERATION_CANNOT_BE_CANCELED" in reasons
    assert "Unknown name" not in reasons


# ---------------------------------------------------------------------------
# J. Download/CDN + artifact integrity
# ---------------------------------------------------------------------------

def test_090_download_evidence_is_signed_flow_content_mp4():
    res = load_json("evidence/download/response.json")
    url = res["direct_cdn_url"]
    assert url.startswith("https://flow-content.google/video/")
    assert "Expires=" in url and "KeyName=" in url and "Signature=" in url
    assert res["contentType"] == "video/mp4"
    assert res["length_bytes"] > 1_000_000


def test_091_download_signature_is_sanitized():
    url = load_json("evidence/download/response.json")["direct_cdn_url"]
    assert "Signature=REDACTED" in url


def test_092_primary_download_artifact_matches_download_length():
    res = load_json("evidence/download/response.json")
    assert_mp4(repo_path(VERIFIED_ARTIFACTS["t2v"]), res["length_bytes"])


def test_093_all_five_verified_mp4_artifacts_are_real_files():
    evidence = {
        "t2v": load_json("evidence/video/t2v/response.json")["_evidence"]["mp4_bytes"],
        "i2v": load_json("evidence/video/i2v/response.json")["length_bytes"],
        "interpolation": load_json("evidence/video/interpolation/response.json")["length_bytes"],
        "reference": load_json("evidence/video/reference/response.json")["_evidence"]["mp4_bytes"],
        "extend_edit": load_json("evidence/video/extend/response.json")["length_bytes"],
    }
    for key, rel in VERIFIED_ARTIFACTS.items():
        assert_mp4(repo_path(rel), evidence[key])


def test_094_total_verified_mp4_bytes_are_consistent():
    expected = sum([
        load_json("evidence/video/t2v/response.json")["_evidence"]["mp4_bytes"],
        load_json("evidence/video/i2v/response.json")["length_bytes"],
        load_json("evidence/video/interpolation/response.json")["length_bytes"],
        load_json("evidence/video/reference/response.json")["_evidence"]["mp4_bytes"],
        load_json("evidence/video/extend/response.json")["length_bytes"],
    ])
    actual = sum(repo_path(p).stat().st_size for p in VERIFIED_ARTIFACTS.values())
    assert actual == expected
    assert actual > 24_000_000


# ---------------------------------------------------------------------------
# K. Credit accounting
# ---------------------------------------------------------------------------

def _credit_steps():
    return [
        ("t2v", load_json("evidence/video/t2v/response.json")["_evidence"]),
        ("i2v", load_json("evidence/video/i2v/response.json")["_evidence"]),
        ("interpolation", load_json("evidence/video/interpolation/response.json")["_evidence"]),
        ("extend_edit", load_json("evidence/video/extend/response.json")["_evidence"]),
    ]


def test_100_each_credit_deduction_equals_before_minus_after():
    for name, ev in _credit_steps():
        assert ev["credits_before"] - ev["credits_after"] == ev["credits_deducted"], name


def test_101_credit_chain_is_contiguous():
    steps = _credit_steps()
    for (_, prev), (_, nxt) in zip(steps, steps[1:]):
        assert prev["credits_after"] == nxt["credits_before"]


def test_102_credit_chain_exact_sequence():
    steps = _credit_steps()
    seq = [steps[0][1]["credits_before"]] + [ev["credits_after"] for _, ev in steps]
    assert seq == [1050, 1038, 1023, 1003, 983]


def test_103_credit_deductions_exact_sequence():
    deductions = [ev["credits_deducted"] for _, ev in _credit_steps()]
    assert deductions == [12, 15, 20, 20]


def test_104_total_credit_spend_is_67():
    assert sum(ev["credits_deducted"] for _, ev in _credit_steps()) == 67
    assert _credit_steps()[0][1]["credits_before"] - _credit_steps()[-1][1]["credits_after"] == 67


# ---------------------------------------------------------------------------
# L. Partial / disproved regression fixtures
# ---------------------------------------------------------------------------

def test_110_t2i_success_fixture_has_real_image_artifact():
    res = load_json("evidence/image/t2i/response.json")
    assert "error" not in res
    assert res["_evidence"]["status"] == 200
    assert res["_evidence"]["valid_image_magic"] is True
    assert_uuid(res["media"][0]["name"])
    assert repo_path(res["_evidence"]["artifact"]).stat().st_size == res["_evidence"]["artifact_bytes"]


def test_111_transform_mediaId_root_recognized_400():
    res = load_json("evidence/image/transform/response.json")
    assert res["error"]["code"] == 400
    assert res["error"]["status"] == "INVALID_ARGUMENT"
    assert "Unknown name" not in json.dumps(res)


def test_112_image_upsample_schema_validated_recaptcha_403():
    res = load_json("evidence/image/upsample/response.json")
    assert res["error"]["code"] == 403
    assert "reCAPTCHA" in json.dumps(res)


def test_113_video_upsample_remains_partial():
    res = load_json("evidence/video/upsample/response.json")
    assert "error" in res


def test_114_partial_features_are_not_promoted_in_manifest(manifest):
    verified = {c["id"] for c in manifest["claims"] if c["status"] == "RUNTIME_VERIFIED"}
    forbidden = {
        "image_transform",
        "image_upsample",
        "video_upsample",
        "cancel_active_generation",
        "audio_reference",
        "creation_agent_sse_success",
    }
    assert not (verified & forbidden), f"Partial feature promoted: {verified & forbidden}"


# ---------------------------------------------------------------------------
# M. Model registry
# ---------------------------------------------------------------------------

def test_120_registry_has_exactly_82_entries():
    reg = load_json(REGISTRY)
    assert len(reg) == 82


def test_121_registry_usage_keys_match_dictionary_keys():
    reg = load_json(REGISTRY)
    for key, spec in reg.items():
        assert spec["usageKey"] == key


def test_122_registry_entries_have_minimum_schema():
    reg = load_json(REGISTRY)
    required = {"usageKey", "family", "kind", "creditMapping", "deprecated", "status"}
    for key, spec in reg.items():
        assert required <= set(spec), f"Registry entry {key} missing {required-set(spec)}"


def test_123_registry_all_snapshot_entries_mark_available():
    reg = load_json(REGISTRY)
    assert all(spec.get("status") == "MODEL_AVAILABLE" for spec in reg.values())


def test_124_registry_snapshot_copy_matches_current_registry():
    current = load_json(REGISTRY)
    snap = load_json("snapshots/2026-08-27/normalized_registry.json")
    assert current == snap


# ---------------------------------------------------------------------------
# N. SDK static architecture
# ---------------------------------------------------------------------------

def _sdk_ast():
    return ast.parse(read_text("sdk/client.py"))


def test_130_sdk_contains_expected_core_classes():
    tree = _sdk_ast()
    classes = {node.name for node in tree.body if isinstance(node, ast.ClassDef)}
    assert {"FlowMedia", "AuthManager", "ModelResolver", "Poller", "DownloadClient", "BrowserOverlayClient", "VideoTextClient", "GoogleFlowClient"} <= classes


def test_131_sdk_does_not_hardcode_paygate_tier_one():
    text = read_text("sdk/client.py")
    assert "PAYGATE_TIER_ONE" not in text


def test_132_sdk_does_not_hardcode_default_video_model():
    text = read_text("sdk/client.py")
    assert 'model_key: str = "' not in text
    assert "veo_3_1_t2v_fast" not in text


def test_133_video_text_generate_requires_aspect_ratio_argument():
    tree = _sdk_ast()
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "VideoTextClient")
    fn = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "generate")
    names = [a.arg for a in fn.args.args]
    assert "aspect_ratio" in names
    # Defaults correspond to the last N positional args. aspect_ratio must not be among them.
    defaulted_names = names[len(names) - len(fn.args.defaults):] if fn.args.defaults else []
    assert "aspect_ratio" not in defaulted_names


def test_134_seed_is_optional_and_only_conditionally_emitted():
    text = read_text("sdk/client.py")
    assert "seed: Optional[int] = None" in text
    assert 'if seed is not None:' in text


def test_135_audio_failure_preference_is_not_forced_into_payload():
    text = read_text("sdk/client.py")
    assert "audio_failure_preference: Optional[str] = None" in text
    assert "if audio_failure_preference:" in text


def test_136_browser_overlay_helper_is_exposed_on_google_flow_client():
    tree = _sdk_ast()
    browser_cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "BrowserOverlayClient")
    browser_methods = {n.name for n in browser_cls.body if isinstance(n, ast.FunctionDef)}
    assert {"_find_flow_page", "dismiss_overlays"} <= browser_methods
    top_cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "GoogleFlowClient")
    top_methods = {n.name for n in top_cls.body if isinstance(n, ast.FunctionDef)}
    assert "dismiss_flow_overlays" in top_methods


def test_137_overlay_helper_has_security_and_payment_denylist():
    text = read_text("sdk/client.py").lower()
    for marker in ("recaptcha", "security", "bảo mật", "verify", "xác minh", "payment", "thanh toán"):
        assert marker in text
    assert "overlayancestor" in text.lower()


# ---------------------------------------------------------------------------
# O. Security / sanitization
# ---------------------------------------------------------------------------

def _evidence_text_files():
    allowed_ext = {".json", ".md", ".jsonl", ".txt"}
    return [p for p in repo_path("evidence").rglob("*") if p.is_file() and p.suffix.lower() in allowed_ext]


def test_140_no_obvious_email_or_google_profile_url_in_evidence():
    email_re = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
    for p in _evidence_text_files():
        text = p.read_text(encoding="utf-8", errors="ignore")
        assert not email_re.search(text), f"Possible email leaked in {p.relative_to(ROOT)}"
        assert "lh3.googleusercontent.com" not in text, f"Google profile URL leaked in {p.relative_to(ROOT)}"


def test_141_no_unredacted_secret_like_json_fields():
    secret_keys = {"token", "access_token", "authorization", "cookie", "session_cookie"}

    def walk(obj, rel):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k.lower() in secret_keys and isinstance(v, str):
                    assert v.startswith("<REDACTED"), f"Possible secret in {rel}: key={k}"
                walk(v, rel)
        elif isinstance(obj, list):
            for item in obj:
                walk(item, rel)

    for p in repo_path("evidence").rglob("*.json"):
        try:
            obj = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        walk(obj, p.relative_to(ROOT))


def test_142_signed_cdn_signatures_are_redacted_in_text_evidence():
    for p in _evidence_text_files():
        text = p.read_text(encoding="utf-8", errors="ignore")
        for match in re.finditer(r"Signature=([^&\s\"']+)", text):
            assert match.group(1) in {"REDACTED", "<REDACTED>", "<REDACTED_TOKEN>"}, (
                f"Unredacted CDN signature in {p.relative_to(ROOT)}"
            )


# ---------------------------------------------------------------------------
# P. Cross-evidence consistency
# ---------------------------------------------------------------------------

def test_150_t2v_media_id_matches_download_url_media_id():
    media_id = load_json("evidence/video/t2v/response.json")["media"][0]["name"]
    url = load_json("evidence/download/response.json")["direct_cdn_url"]
    assert f"/video/{media_id}?" in url


def test_151_t2v_blob_size_matches_download_size():
    t2v = load_json("evidence/video/t2v/response.json")
    download = load_json("evidence/download/response.json")
    blob_size = int(t2v["media"][0]["mediaMetadata"]["mediaBlobSize"])
    assert blob_size == download["length_bytes"] == t2v["_evidence"]["mp4_bytes"]


def test_152_i2v_input_media_id_matches_recorded_evidence():
    req_id = load_json("evidence/video/i2v/request.json")["requests"][0]["startImage"]["mediaId"]
    ev_id = load_json("evidence/video/i2v/response.json")["_evidence"]["input_image_media_id"]
    assert req_id == ev_id


def test_153_extend_source_is_interpolation_output():
    interp_id = load_json("evidence/video/interpolation/response.json")["mediaId"]
    source_id = load_json("evidence/video/extend/response.json")["_evidence"]["source_video_media_id"]
    assert source_id == interp_id


def test_154_list_likenesses_http_200_is_present_in_capture_index():
    master = load_json("_ctl/schemas_master.json")
    matches = [
        value for key, value in master.items()
        if key.startswith("GET https://aisandbox-pa.googleapis.com/v1/flow/likeness:listUserLikenesses")
    ]
    assert matches, "No listUserLikenesses GET capture in schemas_master"
    assert any(item.get("status") == 200 and item.get("res") == {} for item in matches)


# ---------------------------------------------------------------------------
# Q. Master documentation schema assertions
# ---------------------------------------------------------------------------

def test_160_master_documents_image_bytes_as_verified_upload_field(master_text):
    assert "imageBytes" in master_text
    assert "encodedImage" in master_text  # retained only as disproved historical hypothesis


def test_161_master_documents_media_id_for_i2v_and_interpolation(master_text):
    assert 'startImage: { "mediaId"' in master_text or "startImage" in master_text and "mediaId" in master_text
    assert "endImage" in master_text and "mediaId" in master_text


def test_162_master_marks_reference_generation_verified(master_text):
    ref_idx = master_text.find("Reference Images")
    assert ref_idx >= 0
    window = master_text[ref_idx:ref_idx + 900]
    assert "[RUNTIME_VERIFIED]" in window
    assert "claim_id: reference_to_video" in window
    assert "reference_verified_1d2d1e90-a4be-4b6a-82b3-f691e787632e.mp4" in window


# ---------------------------------------------------------------------------
# R. Full evidence inventory sanity
# ---------------------------------------------------------------------------

def test_170_manifest_verified_fixtures_are_json_and_parseable(manifest):
    for claim in manifest["claims"]:
        path = repo_path(claim["fixture"])
        assert path.suffix == ".json", f"Verified fixture should be JSON: {path}"
        json.loads(path.read_text(encoding="utf-8"))


def test_171_all_verified_artifact_paths_are_relative_to_repo():
    for _, ev in _credit_steps():
        artifact = ev.get("mp4_artifact")
        assert artifact and not Path(artifact).is_absolute()
        assert ".." not in Path(artifact).parts


def test_172_verified_video_artifacts_have_distinct_content_sizes():
    sizes = [repo_path(p).stat().st_size for p in VERIFIED_ARTIFACTS.values()]
    assert len(set(sizes)) == len(sizes), "Unexpected duplicate artifact sizes; inspect for accidental file reuse"
