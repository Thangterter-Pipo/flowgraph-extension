# Cancel Generation Fixture Notes

- **Status**: 400 FAILED_PRECONDITION
- **Endpoint**: `POST https://aisandbox-pa.googleapis.com/v1/flowMedia:cancelGeneration`
- **Verified Field Shape**: `{ "mediaId": "<media_id>" }`
- **Behavior**: 
  - `mediaId` field is parsed by backend (unlike `name` which returns Unknown field)
  - Completed generation returns `PUBLIC_ERROR_MEDIA_GENERATION_CANNOT_BE_CANCELED`
  - Active generation should return 200 OK (to be verified on a live queued job)
- **Date**: 2026-08-27
