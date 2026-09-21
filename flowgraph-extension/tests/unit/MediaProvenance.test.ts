import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ImageInputExecutor } from '../../src/runtime/executors/ImageInputExecutor';
import { VideoInputExecutor } from '../../src/runtime/executors/VideoInputExecutor';
import { MediaInputExecutor } from '../../src/runtime/executors/MediaInputExecutor';
import { UploadImageExecutor } from '../../src/runtime/executors/UploadImageExecutor';
import { DownloadExecutor } from '../../src/runtime/executors/DownloadExecutor';
import { WorkflowRuntime } from '../../src/runtime/WorkflowRuntime';
import { trustedProjectIdForProviderMedia } from '../../src/runtime/mediaProvenance';
import type { NodeExecutionContext } from '../../src/engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';
import type { NodeSpecForValidation } from '../../src/runtime/GraphValidator';

vi.mock('../../src/ui/studio/mediaStorage', () => ({
  getMediaBlob: vi.fn(),
}));

const PROJECT = '729eaa19-1c85-4cfc-89c3-5f86de2dffc5';
const FOREIGN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const UUID = '65bdee87-426f-432c-8b5c-8272bb5fb9fd';

function ctx(config: Record<string, string>, extra?: Partial<NodeExecutionContext>): NodeExecutionContext {
  return {
    runId: 'r1',
    nodeId: 'n1',
    inputs: {},
    config,
    context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
    ...extra,
  } as NodeExecutionContext;
}

describe('media provenance', () => {
  it('rejects literal current as proof for an arbitrary provider UUID', () => {
    const result = trustedProjectIdForProviderMedia({
      configProjectId: 'current',
      activeProjectId: PROJECT,
      mediaId: UUID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PROJECT_ISOLATION');
  });

  it('accepts a concrete matching active projectId', () => {
    expect(trustedProjectIdForProviderMedia({
      configProjectId: PROJECT,
      activeProjectId: PROJECT,
      mediaId: UUID,
    })).toEqual({ ok: true, projectId: PROJECT });
  });

  it('imageInput/videoInput/mediaInput with projectId current cannot execute', async () => {
    const image = new ImageInputExecutor();
    const video = new VideoInputExecutor();
    const media = new MediaInputExecutor();
    expect(image.validate(ctx({ mediaId: UUID, mediaType: 'IMAGE', projectId: 'current' })).valid).toBe(false);
    await expect(image.execute(ctx({ mediaId: UUID, mediaType: 'IMAGE', projectId: 'current' }))).rejects.toMatchObject({ code: 'PROJECT_ISOLATION' });
    await expect(video.execute(ctx({ mediaId: UUID, mediaType: 'VIDEO', projectId: 'current' }))).rejects.toMatchObject({ code: 'PROJECT_ISOLATION' });
    await expect(media.execute(ctx({ mediaId: UUID, mediaType: 'VIDEO', projectId: 'current' }))).rejects.toMatchObject({ code: 'PROJECT_ISOLATION' });
  });

  it('foreign explicit projectId is blocked', async () => {
    await expect(new ImageInputExecutor().execute(ctx({
      mediaId: UUID, mediaType: 'IMAGE', projectId: FOREIGN,
    }))).rejects.toMatchObject({ code: 'PROJECT_ISOLATION' });
  });

  it('matching concrete active projectId still works', async () => {
    const out = await new ImageInputExecutor().execute(ctx({
      mediaId: UUID, mediaType: 'IMAGE', projectId: PROJECT,
    }));
    expect((out.outputs.image.value as { projectId: string }).projectId).toBe(PROJECT);
  });

  it('UploadImage local dropped keys still upload; non-local passthrough needs provenance', async () => {
    const uploadImage = vi.fn(async () => ({ mediaId: 'uploaded-1', type: 'IMAGE' as const, projectId: PROJECT }));
    const resolvePreviewUrl = vi.fn(async () => '');
    const executor = new UploadImageExecutor({ adapter: { uploadImage, resolvePreviewUrl } as any });
    await expect(executor.execute(ctx({ mediaId: UUID }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(executor.execute(ctx({ mediaId: UUID, projectId: 'current' }))).rejects.toMatchObject({ code: 'PROJECT_ISOLATION' });
    const ok = await executor.execute(ctx({ mediaId: UUID, projectId: PROJECT }));
    expect((ok.outputs.image.value as { mediaId: string }).mediaId).toBe(UUID);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('UploadImage local dropped keys still upload into the active project', async () => {
    const { getMediaBlob } = await import('../../src/ui/studio/mediaStorage');
    vi.mocked(getMediaBlob).mockResolvedValueOnce('data:image/png;base64,aaa');
    const uploadImage = vi.fn(async () => ({ mediaId: 'uploaded-local', type: 'IMAGE' as const, projectId: PROJECT }));
    const resolvePreviewUrl = vi.fn(async () => '');
    const executor = new UploadImageExecutor({ adapter: { uploadImage, resolvePreviewUrl } as any });
    const out = await executor.execute(ctx({ mediaId: 'dropped-abc' }));
    expect(uploadImage).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT, mimeType: 'image/png' }));
    expect((out.outputs.image.value as { mediaId: string }).mediaId).toBe('uploaded-local');
  });

  it('Download fails PROJECT_ISOLATION before adapter.downloadMedia for foreign media', async () => {
    const downloadMedia = vi.fn();
    const executor = new DownloadExecutor({ adapter: { downloadMedia } as unknown as GoogleFlowAdapter });
    await expect(executor.execute({
      ...ctx({ autoDownload: 'true' }),
      inputs: {
        media: { type: 'media', value: { mediaId: UUID, projectId: FOREIGN, type: 'IMAGE' } },
      },
    } as any)).rejects.toMatchObject({ code: 'PROJECT_ISOLATION' });
    expect(downloadMedia).not.toHaveBeenCalled();
  });

  it('imageInput with projectId current cannot feed generation or download', async () => {
    const generate = vi.fn();
    const downloadMedia = vi.fn();
    const runtime = new WorkflowRuntime({
      generate,
      downloadMedia,
      pollUntilComplete: vi.fn(),
      resolvePreviewUrl: vi.fn(),
      cancel: vi.fn(),
    } as any);
    const nodes: NodeSpecForValidation[] = [
      {
        id: '1',
        kind: 'imageInput',
        config: { mediaId: UUID, mediaType: 'IMAGE', projectId: 'current' },
        inputs: [],
        outputs: [{ id: 'image', label: 'Image', type: 'IMAGE' }],
      },
      {
        id: '2',
        kind: 'download',
        config: { autoDownload: 'true' },
        inputs: [{ id: 'media', label: 'Media', type: 'MEDIA', required: true }],
        outputs: [{ id: 'file', label: 'File', type: 'FILE' }],
      },
    ];
    const edges = [{ id: 'e1', source: '1', sourceHandle: 'image', target: '2', targetHandle: 'media' }];
    await expect(runtime.run(nodes, edges, {
      workflowId: 'wf-prov',
      activeProject: { projectId: PROJECT, projectName: 'Test', selectedAt: '2026-09-10' },
      account: { email: 'a@b.c' } as any,
      flow: { ready: true } as any,
    }, vi.fn())).rejects.toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
    expect(downloadMedia).not.toHaveBeenCalled();
  });

  it('built-in templates no longer stamp hard-coded provider UUIDs as current', () => {
    const source = readFileSync(resolve(__dirname, '../../src/ui/studio/workflowTemplates.ts'), 'utf8');
    expect(source).not.toContain("projectId: 'current'");
    expect(source).not.toContain('65bdee87-426f-432c-8b5c-8272bb5fb9fd');
    expect(source).not.toContain('40e8547b-9bee-4cd9-b0a4-39dbf906f368');
    expect(source).not.toContain('b4578f6e-5a05-48c9-ab03-28044b2ce138');
    expect(source).not.toContain('ccf4cf84-397f-4e23-bca3-08049196a8a1');
  });
});
