import { describe, expect, it } from 'vitest';
import { asMedia, asText, mediaRefFromPayload, mediaValue, textValue } from '../../src/runtime/RuntimeValue';

describe('RuntimeValue', () => {
  it('creates typed values', () => {
    expect(textValue('hi').value).toBe('hi');
    expect(textValue('hi').type).toBe('text');
    const media = mediaRefFromPayload({ mediaId: 'abc-123', type: 'IMAGE', projectId: 'p1' });
    expect(media.type).toBe('image');
    expect(asMedia(media)).toMatchObject({ mediaId: 'abc-123', projectId: 'p1' });
  });

  it('asText only returns text values', () => {
    expect(asText(textValue('hello'))).toBe('hello');
    expect(asText(mediaRefFromPayload({ mediaId: 'x', type: 'IMAGE', projectId: 'p' }))).toBeUndefined();
  });

  it('rejects media payloads without an id', () => {
    expect(() => mediaRefFromPayload({ mediaId: '', type: 'IMAGE', projectId: 'p' })).toThrow(/mediaId/);
  });

  it('round-trips image/video type through mediaValue', () => {
    const image = mediaValue({ provider: 'GOOGLE_FLOW', mediaId: 'i', type: 'IMAGE', projectId: 'p' });
    expect(image.type).toBe('image');
    const video = mediaValue({ provider: 'GOOGLE_FLOW', mediaId: 'v', type: 'VIDEO', projectId: 'p' });
    expect(video.type).toBe('video');
  });
});
