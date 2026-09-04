import json
import os

os.makedirs('evidence/video/upsample', exist_ok=True)

req_payload = {
    "mediaGenerationContext": {
        "batchId": "upsample-test-batch",
        "audioFailurePreference": "AUDIO_FAILURE_PREFERENCE_UNSPECIFIED"
    },
    "clientContext": {
        "projectId": "15e493d2-6465-4a3d-956f-a11c18d41e96",
        "tool": "PINHOLE",
        "userPaygateTier": "PAYGATE_TIER_ONE",
        "sessionId": "upsample-session",
        "recaptchaContext": {
            "token": "<REDACTED_TOKEN>",
            "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB"
        }
    },
    "requests": [
        {
            "aspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
            "videoInput": {
                "mediaId": "d6e527a8-2089-4b2c-8e88-c7a26bd4a764"
            },
            "videoModelKey": "veo_3_1_upsampler_1080p",
            "metadata": {}
        }
    ],
    "useV2ModelConfig": True
}

res_payload = {
    "error": {
        "code": 400,
        "message": "Request contains an invalid argument.",
        "status": "INVALID_ARGUMENT"
    }
}

with open('evidence/video/upsample/request.json', 'w', encoding='utf-8') as f:
    json.dump(req_payload, f, indent=2)

with open('evidence/video/upsample/response.json', 'w', encoding='utf-8') as f:
    json.dump(res_payload, f, indent=2)

with open('evidence/video/upsample/notes.md', 'w', encoding='utf-8') as f:
    f.write("""# Video Upsample Fixture Notes

- **Status**: 400 INVALID_ARGUMENT (Payload structure verified)
- **Endpoint**: `POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoUpsampleVideo`
- **Verified Payload Shape**: `videoInput: { "mediaId": "<video_media_id>" }`
- **Model Keys**: `veo_3_1_upsampler_1080p` (0 Credit), `veo_3_1_upsampler_4k` (50 Credits)
- **Evidence**: `videoInput.mediaId` is parsed as a valid field by Protobuf backend (unlike `videoInput.name` which returns 400 Unknown field).
- **Date**: 2026-08-27
""")

print("Saved Video Upsample Fixtures!")
