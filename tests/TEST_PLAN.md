# GOOGLE FLOW RC2 — FULL TEST PLAN

Status target: `2.0.0-RC2 / PARTIALLY_RUNTIME_VERIFIED`

## Test layers

1. **Offline evidence tests** — default; no network and no credit consumption.
2. **Regression/negative tests** — ensure disproved payloads stay disproved and partial features are not promoted.
3. **Live paid E2E tests** — explicit opt-in with `FLOW_RUN_LIVE_PAID=1`; may consume credits.

## Offline coverage

### A. Repository / manifest / documentation
- Required core files exist.
- Manifest claim IDs are unique.
- Exactly 11 current `RUNTIME_VERIFIED` manifest claims.
- Every verified heading has an immediate `claim_id`.
- Master claim IDs exactly equal manifest verified claim IDs.
- Every manifest fixture exists.
- Every `success_rule` is recognized.
- Every claim-specific validator passes.

### B. Auth / Project / reCAPTCHA
- Auth fixture contains user/expires/access_token schema.
- Access token is redacted in stored evidence.
- Project creation returns semantic status 200 / OK and UUID project ID.
- Invalid/unapproved reCAPTCHA negative control returns 403 PERMISSION_DENIED.
- reCAPTCHA notes do not overclaim replay/single-use proof.

### C. Image Upload
- Request uses `imageBytes`.
- Request does not use disproved `encodedImage`.
- MIME type and upload flags are present.
- Success response contains media/workflow.
- `primaryMediaId` is UUID.
- Image dimensions and blob size are positive.

### D. T2V
- Runtime response has no top-level error.
- `_evidence.status == 200`.
- Media generation status is successful.
- Media ID is UUID.
- Model/duration are present.
- MP4 artifact exists and exact byte count matches evidence.
- Poll final media ID/status/remaining credits match T2V response.

### E. I2V
- `startImage` contains only `mediaId`.
- Legacy `startImage.name` is absent.
- Response has media ID, CDN URL and `video/mp4`.
- Artifact is a real MP4 and exact size matches.
- Verified field-shape record contains `mediaId`.

### F. Interpolation
- `startImage.mediaId` and `endImage.mediaId` are valid UUIDs and distinct.
- Successful response has MP4 artifact.
- Verified shape contains `mediaId` and not legacy `.name`.

### G. Reference Images
- Request uses `referenceImages[].mediaId` only.
- Current response remains 403 / partial.
- Reference-to-video is not promoted to runtime verified manifest claim.

### H. Extend / Edit
- Successful evidence records `videoInput.mediaId` shape.
- Successful artifact is a real MP4.
- Legacy edit request using `videoInput.name` is confirmed rejected by backend 400.
- Existing stale extend request fixture is explicitly detected as legacy versus the verified response shape.

### I. Cancel
- Request body is exactly `{mediaId}`.
- Completed-media cancellation fails with FAILED_PRECONDITION / `PUBLIC_ERROR_MEDIA_GENERATION_CANNOT_BE_CANCELED`, not unknown-field validation.

### J. Download / CDN
- Signed URL host is `flow-content.google`.
- URL contains Expires / KeyName / Signature fields.
- Content type is `video/mp4`.
- Stored signature is redacted.
- Download artifact exact size matches evidence.
- All 4 verified MP4s pass ISO-BMFF `ftyp` magic-byte validation.
- Total artifact bytes exceed 24,000,000 and equal recorded evidence sum.

### K. Credits
- Every step satisfies `before - after == deducted`.
- Credit chain is contiguous.
- Exact chain: `1050 -> 1038 -> 1023 -> 1003 -> 983`.
- Exact deductions: `12, 15, 20, 20`.
- Total spend: `67`.

### L. Partial / disproved regression
- T2I still partial until successful fixture replaces current 403 evidence.
- Transform legacy payload remains disproved by 400.
- Image upsample legacy payload remains disproved by 400.
- Video upsample remains partial.
- No partial feature is promoted into verified manifest claims.

### M. Model Registry
- Exactly 82 entries.
- Each dictionary key equals `usageKey`.
- Minimum normalized schema is present.
- All current snapshot entries report `MODEL_AVAILABLE`.
- Snapshot file equals current normalized registry.

### N. SDK
- Required core classes exist.
- No hard-coded `PAYGATE_TIER_ONE`.
- No hard-coded default video model.
- `VideoTextClient.generate()` requires `aspect_ratio` explicitly.
- `seed` is optional and conditionally emitted.
- `audio_failure_preference` is optional and conditionally emitted.

### O. Security / sanitization
- No obvious email address in evidence text files.
- No Google profile image URL.
- Secret-like JSON fields are redacted.
- Signed CDN signatures are redacted.

### P. Cross-evidence consistency
- T2V media ID matches download URL media ID.
- T2V blob size equals download length and artifact byte count.
- I2V request input media ID equals response evidence record.
- Extend source media ID equals interpolation output media ID.
- `listUserLikenesses` HTTP 200 exists in `_ctl/schemas_master.json`.

## Live paid E2E coverage

Run only on an authorized account/browser session. Each mutation must use a fresh legitimate browser-generated reCAPTCHA token supplied through environment variables. The suite does not generate, bypass, replay, steal, or synthesize reCAPTCHA tokens.

Live cases:
- Auth session.
- Credits/tier endpoint.
- Image upload using `imageBytes`.
- T2V submit -> poll successful.
- T2V credit balance before/after.
- I2V using `startImage.mediaId` -> poll successful.
- Interpolation using start/end media IDs -> poll successful.
- Reference-image generation using `referenceImages[].mediaId` -> poll successful.
- Edit/extend using `videoInput.mediaId` -> poll successful.
- Download 307 -> signed CDN -> HTTP 200 `video/mp4` -> MP4 magic bytes.
- Cancel an active generation using `{mediaId}`.
- Invalid reCAPTCHA negative control returns 403.

## Commands

Default offline suite:

```bash
pytest tests/test_flow.py -q
```

All tests while keeping live tests skipped unless enabled:

```bash
pytest -q
```

Enable paid/live suite:

```bash
set FLOW_RUN_LIVE_PAID=1
pytest tests/test_live_paid.py -m live_paid -vv -s
```

Minimum live environment variables:

```text
FLOW_SESSION_COOKIE
FLOW_T2V_MODEL_KEY
FLOW_RECAPTCHA_T2V
```

Additional variables enable additional pipelines:

```text
FLOW_PROJECT_ID
FLOW_UPLOAD_IMAGE_PATH or FLOW_IMAGE_MEDIA_ID
FLOW_RECAPTCHA_I2V
FLOW_I2V_MODEL_KEY
FLOW_END_IMAGE_MEDIA_ID
FLOW_RECAPTCHA_INTERPOLATION
FLOW_INTERPOLATION_MODEL_KEY
FLOW_RECAPTCHA_REFERENCE
FLOW_REFERENCE_MODEL_KEY
FLOW_RECAPTCHA_EDIT
FLOW_EDIT_MODEL_KEY
FLOW_RECAPTCHA_CANCEL_JOB
FLOW_CANCEL_MODEL_KEY
```

Do not commit real cookies, OAuth tokens, reCAPTCHA tokens, or signed CDN signatures to the repository.
