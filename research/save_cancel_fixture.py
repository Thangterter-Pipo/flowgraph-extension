import json
import os

os.makedirs('evidence/cancel', exist_ok=True)

with open('evidence/cancel/request.json', 'w', encoding='utf-8') as f:
    json.dump({
        "mediaId": "b834294a-0e9a-4dd3-b2ff-f6cfdeb30550"
    }, f, indent=2)

with open('evidence/cancel/response.json', 'w', encoding='utf-8') as f:
    json.dump({
        "error": {
            "code": 400,
            "message": "Precondition check failed.",
            "status": "FAILED_PRECONDITION",
            "details": [
                {
                    "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                    "reason": "PUBLIC_ERROR_MEDIA_GENERATION_CANNOT_BE_CANCELED"
                }
            ]
        }
    }, f, indent=2)

with open('evidence/cancel/notes.md', 'w', encoding='utf-8') as f:
    f.write("""# Cancel Generation Fixture Notes

- **Status**: 400 FAILED_PRECONDITION
- **Endpoint**: `POST https://aisandbox-pa.googleapis.com/v1/flowMedia:cancelGeneration`
- **Verified Field Shape**: `{ "mediaId": "<media_id>" }`
- **Behavior**: 
  - `mediaId` field is parsed by backend (unlike `name` which returns Unknown field)
  - Completed generation returns `PUBLIC_ERROR_MEDIA_GENERATION_CANNOT_BE_CANCELED`
  - Active generation should return 200 OK (to be verified on a live queued job)
- **Date**: 2026-08-27
""")

print("Saved Cancel Fixtures!")
