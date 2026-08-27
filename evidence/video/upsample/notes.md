# Video Upsample Fixture Notes

- **Status**: 400 INVALID_ARGUMENT (Payload structure verified)
- **Endpoint**: `POST https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoUpsampleVideo`
- **Verified Payload Shape**: `videoInput: { "mediaId": "<video_media_id>" }`
- **Model Keys**: `veo_3_1_upsampler_1080p` (0 Credit), `veo_3_1_upsampler_4k` (50 Credits)
- **Evidence**: `videoInput.mediaId` is parsed as a valid field by Protobuf backend (unlike `videoInput.name` which returns 400 Unknown field).
- **Date**: 2026-08-27
