import { afterEach, describe, expect, it, vi } from 'vitest';
import * as store from '../../src/runtime/stitch/StitchArtifactStore';
import { recoverExactVideo } from '../../src/ui/studio/videoPlaybackRecovery';
import { buildSavedWorkflow, restoreWorkflow } from '../../src/ui/studio/workflowPersistence';
import { PreviewExecutor } from '../../src/runtime/executors/PreviewExecutor';
import { DownloadExecutor } from '../../src/runtime/executors/DownloadExecutor';
import { mediaValue } from '../../src/runtime/RuntimeValue';

const media = { provider: 'GOOGLE_FLOW' as const, type: 'VIDEO' as const, mediaId: 'stitch-idb:test', projectId: 'p' };
afterEach(() => vi.restoreAllMocks());
describe('Stitch artifact integration', () => {
  it('recovers local artifacts without a provider request', async () => {
    vi.spyOn(store, 'stitchArtifactUrl').mockResolvedValue('blob:restored');
    const request = vi.fn();
    expect(await recoverExactVideo(media.mediaId, 'p', request)).toBe('blob:restored');
    expect(request).not.toHaveBeenCalled();
  });
  it('persists only durable identity and never reconstructs a Google URL for local artifacts', () => {
    const node = { id: 'stitch', data: { kind: 'videoConcat', config: {}, status: 'success', result: { ...media, type: 'video', previewUrl: 'blob:expired' } } } as any;
    const saved = buildSavedWorkflow([node], [], 'main', 'test', { projectId: 'p', projectName: 'p' });
    expect(saved.nodes[0].data.result?.previewUrl).toBe('');
    const storage = { getItem: () => JSON.stringify(saved), setItem: vi.fn() };
    expect(restoreWorkflow('p', 'main', storage).nodes[0].data.result?.previewUrl).toBe('');
  });
  it('preview and download sinks resolve durable artifacts locally and never auto-download them', async () => {
    vi.spyOn(store, 'stitchArtifactUrl').mockResolvedValue('blob:restored');
    const adapter = { resolvePreviewUrl: vi.fn(), downloadMedia: vi.fn() } as any;
    const context = { nodeId: 'sink', runId: 'r', config: { autoDownload: 'true' }, inputs: { media: mediaValue(media) }, context: { activeProject: { projectId: 'p' }, throwIfAborted: vi.fn() } } as any;
    const preview = await new PreviewExecutor({ adapter }).execute(context);
    expect(preview.result?.previewUrl).toBe('blob:restored');
    const download = await new DownloadExecutor({ adapter }).execute(context);
    expect(download.result?.previewUrl).toBe('blob:restored');
    expect(adapter.resolvePreviewUrl).not.toHaveBeenCalled();
    expect(adapter.downloadMedia).not.toHaveBeenCalled();
  });
});
