# Reference Images Video Fixture Notes

- **Status**: 403 (Valid Payload Structure Verified)
- **Endpoint**: `POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages`
- **Verified Shape**: `referenceImages: [ { 'mediaId': '<uuid>' } ]`
- **Evidence**: `referenceImages[].mediaId` returned 403 reCAPTCHA (valid payload), whereas `referenceImages[].name` returned 400 Unknown field.
- **Date**: 2026-08-27
