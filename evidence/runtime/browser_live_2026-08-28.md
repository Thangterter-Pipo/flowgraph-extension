# Browser-Live Runtime Verification — 2026-08-28

This evidence note records sanitized outcomes from authorized Google Flow browser/CDP tests. OAuth/session cookies, Bearer tokens, reCAPTCHA tokens, signed URL signatures and PII are intentionally not stored.

## Individually observed successful runtime cases

- Auth session: HTTP 200; access-token/user/expiry presence verified without exporting secret values.
- Credits: HTTP 200; live balance/tier schema observed.
- Image upload: HTTP 200; real media ID returned.
- Invalid reCAPTCHA negative control: HTTP 403 `PERMISSION_DENIED`, message `reCAPTCHA evaluation failed`.
- T2V: `POST /v1/video:batchAsyncGenerateVideoText` → HTTP 200 → terminal `MEDIA_GENERATION_STATUS_SUCCESSFUL`.
- T2V credit delta: positive deduction observed after successful generation.
- I2V: `POST /v1/video:batchAsyncGenerateVideoStartImage` → HTTP 200 → terminal SUCCESS.
- Interpolation: `POST /v1/video:batchAsyncGenerateVideoStartAndEndImage` → HTTP 200 → terminal SUCCESS.
- Reference Images: `POST /v1/video:batchAsyncGenerateVideoReferenceImages` → HTTP 200 → terminal SUCCESS when run independently.
- Edit/Extend: `POST /v1/video:batchAsyncGenerateVideoEditVideo` → HTTP 200 → terminal SUCCESS. Poll response `workflowId` was confirmed to be the UUID used in `/edit/{workflowId}`.
- Download: authenticated Labs redirect → HTTP 307 → `flow-content.google` → HTTP 200/206 `video/mp4`.

## Not verified as successful

- Cancel ACTIVE: immediate call to `POST /v1/flowMedia:cancelGeneration` with `{ "mediaId": "<active-media-id>" }` returned HTTP 400 `FAILED_PRECONDITION` (`Precondition check failed.`). Schema acceptance is observed; active-cancel success is not claimed.

## Full sequential browser-live run

A full 12-case sequential run most recently completed with 8 PASS / 4 FAIL. The four failures were `WebSocketTimeoutException` transport failures in later CDP operations (Interpolation/Reference/Edit/Cancel), not HTTP failure responses from those generation endpoints. Interpolation and Reference had already passed independently; Edit had already succeeded in a direct runtime probe.

The browser helper's default `Runtime.evaluate` timeout was increased from 30s to 90s after this run to reduce long-sequence CDP flakiness.

## Evidence policy consequence

Reference Images remains `[RUNTIME_PARTIAL]` in the strict API reference despite browser-live success because a sanitized successful direct request/response fixture plus persisted MP4 artifact has not yet been committed under `evidence/video/reference/`.
