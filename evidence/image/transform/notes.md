# Image Transform Fixture Notes

- **Endpoint:** POST https://aisandbox-pa.googleapis.com/v1/flow:transformImage
- **Status:** 400 INVALID_ARGUMENT (schema accepted, missing required enum fields)
- **Verified Field Shape:** { "mediaId": "<uuid>" }
- **UI Crop Flow:** The Flow web UI triggers transform via Crop button (Cắt) with aspect ratio options (16:9, 9:16, 1:1, custom)
- **Blocker:** reCAPTCHA Enterprise blocks direct API calls (403 PUBLIC_ERROR_UNUSUAL_ACTIVITY)
- **Evidence Date:** 2026-08-28
