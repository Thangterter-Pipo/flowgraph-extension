import { afterEach, describe, expect, it, vi } from 'vitest';
import { playVerified, recoverExactVideo, shouldRecoverVideoSource } from '../../src/ui/studio/videoPlaybackRecovery';

function makePlaybackProbe(options?: {
  readyState?: number;
  paused?: boolean;
  currentTime?: number;
  playError?: Error;
}) {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const video = {
    readyState: options?.readyState ?? 2,
    paused: options?.paused ?? false,
    currentTime: options?.currentTime ?? 0,
    play: vi.fn(async () => {
      if (options?.playError) throw options.playError;
    }),
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      const set = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      set.add(listener);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(listener);
    }),
  };
  const emit = (type: string) => {
    for (const listener of listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(new Event(type));
      else listener.handleEvent(new Event(type));
    }
  };
  return { video, emit };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('video playback recovery', () => {
  it('recovers known image/poster sources but leaves verified video-shaped sources alone', () => {
    expect(shouldRecoverVideoSource('')).toBe(true);
    expect(shouldRecoverVideoSource('https://flow-content.google/image/clip-id')).toBe(true);
    expect(shouldRecoverVideoSource('https://flow.google.com/asb/opaque-poster')).toBe(true);
    expect(shouldRecoverVideoSource('data:image/jpeg;base64,aaa')).toBe(true);
    expect(shouldRecoverVideoSource('https://flow-content.google/video/clip-id?sig=x')).toBe(false);
    expect(shouldRecoverVideoSource('https://cdn.example.test/clip.mp4?sig=x')).toBe(false);
    expect(shouldRecoverVideoSource('blob:chrome-extension://id/source')).toBe(false);
  });

  it('does not report playing when the browser rejects playback', async () => {
    const { video } = makePlaybackProbe({ playError: new Error('format') });
    expect(await playVerified(video as any, 5)).toBe(false);
  });

  it('lets play() finish loading a freshly replaced source before verifying progress', async () => {
    const { video, emit } = makePlaybackProbe({ readyState: 0, paused: true, currentTime: 0 });
    video.play.mockImplementation(async () => {
      video.readyState = 3;
      video.paused = false;
      setTimeout(() => {
        video.currentTime = 0.2;
        emit('timeupdate');
      }, 5);
    });
    expect(await playVerified(video as any, 100)).toBe(true);
  });

  it('requires timeline advancement, not just canplay/readyState/!paused', async () => {
    const { video } = makePlaybackProbe({ readyState: 3, paused: false, currentTime: 0 });
    expect(await playVerified(video as any, 5)).toBe(false);
  });

  it('verifies playback only after the current source advances', async () => {
    const { video, emit } = makePlaybackProbe({ readyState: 3, paused: false, currentTime: 0 });
    const proof = playVerified(video as any, 100);
    await Promise.resolve();
    await Promise.resolve();
    video.currentTime = 0.2;
    emit('timeupdate');
    await expect(proof).resolves.toBe(true);
    expect(video.removeEventListener).toHaveBeenCalledWith('timeupdate', expect.any(Function));
  });

  it('rejects a response for another media ID', async () => {
    await expect(recoverExactVideo('clip', 'project', async () => ({
      status: 'SUCCESSFUL', media: { mediaId: 'other', projectId: 'project', type: 'VIDEO', previewUrl: 'https://example.test/video' },
    }))).rejects.toThrow('exact video');
  });

  it('makes only one request and fails without a recovered URL', async () => {
    let calls = 0;
    await expect(recoverExactVideo('clip', 'project', async () => {
      calls += 1;
      return { status: 'FAILED' };
    })).rejects.toThrow('exact video');
    expect(calls).toBe(1);
  });

  it('accepts exact mediaId/projectId/type VIDEO with non-empty previewUrl', async () => {
    const url = await recoverExactVideo('clip123', 'proj456', async () => ({
      status: 'SUCCESSFUL',
      media: { mediaId: 'clip123', projectId: 'proj456', type: 'VIDEO', previewUrl: 'https://example.test/v.mp4' },
    }));
    expect(url).toBe('https://example.test/v.mp4');
  });

  it('keeps passive recovery read-only and marks explicit refresh separately', async () => {
    const passiveRequests: unknown[] = [];
    await recoverExactVideo('clip123', 'proj456', async (payload) => {
      passiveRequests.push(payload);
      return {
        status: 'SUCCESSFUL',
        media: { mediaId: 'clip123', projectId: 'proj456', type: 'VIDEO', previewUrl: 'https://example.test/passive.mp4' },
      };
    });
    expect(passiveRequests).toEqual([{ mediaId: 'clip123', projectId: 'proj456', playbackRecovery: true }]);

    const refreshRequests: unknown[] = [];
    await recoverExactVideo('clip123', 'proj456', async (payload) => {
      refreshRequests.push(payload);
      return {
        status: 'SUCCESSFUL',
        media: { mediaId: 'clip123', projectId: 'proj456', type: 'VIDEO', previewUrl: 'https://example.test/refreshed.mp4' },
      };
    }, true);
    expect(refreshRequests).toEqual([{
      mediaId: 'clip123',
      projectId: 'proj456',
      playbackRecovery: true,
      playbackRefresh: true,
    }]);
  });

  it('rejects wrong projectId', async () => {
    await expect(recoverExactVideo('clip', 'project', async () => ({
      status: 'SUCCESSFUL', media: { mediaId: 'clip', projectId: 'other', type: 'VIDEO', previewUrl: 'u' },
    }))).rejects.toThrow('exact video');
  });

  it('rejects wrong type (not VIDEO)', async () => {
    await expect(recoverExactVideo('clip', 'project', async () => ({
      status: 'SUCCESSFUL', media: { mediaId: 'clip', projectId: 'project', type: 'IMAGE', previewUrl: 'u' },
    }))).rejects.toThrow('exact video');
  });

  it('rejects missing previewUrl', async () => {
    await expect(recoverExactVideo('clip', 'project', async () => ({
      status: 'SUCCESSFUL', media: { mediaId: 'clip', projectId: 'project', type: 'VIDEO' },
    }))).rejects.toThrow('exact video');
  });

  it('rejects non-success status', async () => {
    await expect(recoverExactVideo('clip', 'project', async () => ({
      status: 'FAILED', media: { mediaId: 'clip', projectId: 'project', type: 'VIDEO', previewUrl: 'u' },
    }))).rejects.toThrow('exact video');
  });

  it('config-only provenance still passes projectId/mediaId to recovery', async () => {
    const mockRequest = async (p: any) => ({
      status: 'SUCCESSFUL' as const,
      media: { mediaId: p.mediaId, projectId: p.projectId, type: 'VIDEO' as const, previewUrl: 'https://t/v.mp4' },
    });
    const url = await recoverExactVideo('cfg-media', 'cfg-proj', mockRequest);
    expect(url).toBe('https://t/v.mp4');
  });

  it('times out passive recovery without leaking the pending request', async () => {
    vi.useFakeTimers();
    const pending = recoverExactVideo('clip', 'project', async () => new Promise(() => {}));
    const assertion = expect(pending).rejects.toThrow(/10 seconds|timeout/i);
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
  });
});
