# Image Upsample Fixture Notes

- **Endpoint:** POST https://aisandbox-pa.googleapis.com/v1/flow/upsampleImage
- **Status:** 403 PERMISSION_DENIED (Schema accepted! reCAPTCHA only blocker)
- **Verified Field Shape:** { "mediaId": "<uuid>", "targetResolution": "UPSAMPLE_IMAGE_RESOLUTION_2K" | "UPSAMPLE_IMAGE_RESOLUTION_4K" }
- **Enum values (from JS bundle):** UPSAMPLE_IMAGE_RESOLUTION_UNSPECIFIED, UPSAMPLE_IMAGE_RESOLUTION_2K, UPSAMPLE_IMAGE_RESOLUTION_4K
- **Blocker:** reCAPTCHA Enterprise blocks direct API calls (403 PUBLIC_ERROR_UNUSUAL_ACTIVITY). No dedicated upsample button exists in the current Flow web UI.
- **Evidence Date:** 2026-08-28
