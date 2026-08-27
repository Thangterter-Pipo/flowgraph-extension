# I2V Fixture Notes

- **Status**: 403
- **Verified field shape**: `startImage: { 'mediaId': '<uuid>' }`
- **Evidence**: backend returned 403 reCAPTCHA (valid payload) for mediaId shape; rejected `name`/`imageMediaId` shapes with 400 Unknown field.
- **Date**: 2026-08-27
