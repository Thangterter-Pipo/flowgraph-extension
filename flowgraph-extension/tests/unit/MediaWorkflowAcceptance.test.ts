import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkflowRuntime } from '../../src/runtime/WorkflowRuntime';
import { planGraph } from '../../src/runtime/GraphPlanner';
import { isCacheableNodeKind } from '../../src/runtime/CacheStore';
import { isSemanticMutationLocked } from '../../src/ui/studio/runGenerationGuard';
import { localImageDropAction } from '../../src/ui/studio/mediaInputUi';
import { buildSavedWorkflow } from '../../src/ui/studio/workflowPersistence';
import { cloneInitialNodes as cloneNodes, initialEdges as demoEdges } from '../../src/ui/studio/model';
import type { NodeSpecForValidation } from '../../src/runtime/GraphValidator';

vi.mock('../../src/ui/studio/mediaStorage', () => ({
  getMediaBlob: vi.fn(),
}));

const PROJECT = '729eaa19-1c85-4cfc-89c3-5f86de2dffc5';
const FOREIGN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const IMAGE_ID = '65bdee87-426f-432c-8b5c-8272bb5fb9fd';
const VIDEO_ID = '40e8547b-9bee-4cd9-b0a4-39dbf906f368';

function ports(kind: 'uploadImage' | 'imageInput' | 'videoInput' | 'mediaInput' | 'preview' | 'download'): Pick<NodeSpecForValidation, 'inputs' | 'outputs'> {
  if (kind === 'uploadImage') return { inputs: [], outputs: [{ id: 'image', label: 'Image', type: 'IMAGE' }] };
  if (kind === 'imageInput') return { inputs: [], outputs: [{ id: 'image', label: 'Image', type: 'IMAGE' }] };
  if (kind === 'videoInput') return { inputs: [], outputs: [{ id: 'video', label: 'Video', type: 'VIDEO' }] };
  if (kind === 'mediaInput') return { inputs: [], outputs: [{ id: 'media', label: 'Media', type: 'MEDIA' }] };
  if (kind === 'preview') {
    return {
      inputs: [{ id: 'media', label: 'Media', type: 'MEDIA', required: true }],
      outputs: [{ id: 'media', label: 'Media', type: 'MEDIA' }],
    };
  }
  return {
    inputs: [{ id: 'media', label: 'Media', type: 'MEDIA', required: true }],
    outputs: [{ id: 'file', label: 'File', type: 'FILE' }],
  };
}

function runtime(extra: Record<string, unknown> = {}) {
  return new WorkflowRuntime({
    generate: vi.fn(),
    downloadMedia: vi.fn(),
    pollUntilComplete: vi.fn(),
    resolvePreviewUrl: vi.fn(async () => 'resolved-preview'),
    cancel: vi.fn(),
    uploadImage: vi.fn(),
    ...extra,
  } as any);
}

const runOpts = {
  workflowId: 'wf-media-e2e',
  activeProject: { projectId: PROJECT, projectName: 'Test', selectedAt: '2026-09-10' },
  account: { email: 'a@b.c' } as any,
  flow: { ready: true } as any,
};

describe('P1 media workflow acceptance', () => {
  it('uploads a staged local PNG and Preview receives provider media, not the local key', async () => {
    const { getMediaBlob } = await import('../../src/ui/studio/mediaStorage');
    vi.mocked(getMediaBlob).mockResolvedValue('data:image/png;base64,aaa');
    const uploadImage = vi.fn(async () => ({ mediaId: 'uploaded-live', type: 'IMAGE' as const, projectId: PROJECT }));
    const generate = vi.fn();
    const rt = runtime({ uploadImage, generate });
    const nodes: NodeSpecForValidation[] = [
      { id: 'up', kind: 'uploadImage', config: { mediaId: 'dropped-hero', fileName: 'hero.png' }, ...ports('uploadImage') },
      { id: 'pv', kind: 'preview', config: {}, ...ports('preview') },
    ];
    const events: Array<{ nodeId?: string; state?: string; result?: { mediaId?: string; projectId?: string } }> = [];
    await rt.run(nodes, [{ id: 'e1', source: 'up', sourceHandle: 'image', target: 'pv', targetHandle: 'media' }], runOpts, (event) => {
      if (event.type === 'node') events.push(event);
    });
    expect(generate).not.toHaveBeenCalled();
    expect(uploadImage).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT, mimeType: 'image/png' }));
    const preview = events.find((event) => event.nodeId === 'pv' && event.state === 'success');
    expect(preview?.result?.mediaId).toBe('uploaded-live');
    expect(preview?.result?.mediaId).not.toMatch(/^dropped-/);
    expect(preview?.result?.projectId).toBe(PROJECT);
  });

  it('uploads a local Image Input on Run through the verified upload path', async () => {
    const { getMediaBlob } = await import('../../src/ui/studio/mediaStorage');
    vi.mocked(getMediaBlob).mockResolvedValue('data:image/png;base64,aaa');
    const uploadImage = vi.fn(async () => ({ mediaId: 'uploaded-from-image-input', type: 'IMAGE' as const, projectId: PROJECT }));
    const generate = vi.fn();
    const rt = runtime({ uploadImage, generate });
    const nodes: NodeSpecForValidation[] = [
      { id: 'in', kind: 'imageInput', config: { mediaId: 'dropped-hero', fileName: 'hero.png', mediaType: 'IMAGE' }, ...ports('imageInput') },
      { id: 'pv', kind: 'preview', config: {}, ...ports('preview') },
    ];
    const events: Array<{ nodeId?: string; state?: string; result?: { mediaId?: string; projectId?: string } }> = [];
    await rt.run(nodes, [{ id: 'e1', source: 'in', sourceHandle: 'image', target: 'pv', targetHandle: 'media' }], runOpts, (event) => {
      if (event.type === 'node') events.push(event);
    });
    expect(generate).not.toHaveBeenCalled();
    expect(uploadImage).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT, mimeType: 'image/png' }));
    const preview = events.find((event) => event.nodeId === 'pv' && event.state === 'success');
    expect(preview?.result?.mediaId).toBe('uploaded-from-image-input');
    expect(preview?.result?.mediaId).not.toMatch(/^dropped-/);
  });

  it('routes trusted Image Input and Video Input into Preview with exact provenance', async () => {
    const generate = vi.fn();
    const downloadMedia = vi.fn();
    const rt = runtime({ generate, downloadMedia });
    const imageNodes: NodeSpecForValidation[] = [
      { id: 'in', kind: 'imageInput', config: { mediaId: IMAGE_ID, mediaType: 'IMAGE', projectId: PROJECT }, ...ports('imageInput') },
      { id: 'pv', kind: 'preview', config: {}, ...ports('preview') },
    ];
    const imageEvents: Array<{ nodeId?: string; state?: string; result?: { mediaId?: string; projectId?: string; type?: string } }> = [];
    await rt.run(imageNodes, [{ id: 'e1', source: 'in', sourceHandle: 'image', target: 'pv', targetHandle: 'media' }], runOpts, (event) => {
      if (event.type === 'node') imageEvents.push(event);
    });
    const imagePreview = imageEvents.find((event) => event.nodeId === 'pv' && event.state === 'success');
    expect(imagePreview?.result?.mediaId).toBe(IMAGE_ID);
    expect(imagePreview?.result?.projectId).toBe(PROJECT);

    const videoNodes: NodeSpecForValidation[] = [
      { id: 'in', kind: 'videoInput', config: { mediaId: VIDEO_ID, mediaType: 'VIDEO', projectId: PROJECT }, ...ports('videoInput') },
      { id: 'pv', kind: 'preview', config: {}, ...ports('preview') },
    ];
    const videoEvents: Array<{ nodeId?: string; result?: { mediaId?: string; projectId?: string; type?: string }; state?: string }> = [];
    await rt.run(videoNodes, [{ id: 'e1', source: 'in', sourceHandle: 'video', target: 'pv', targetHandle: 'media' }], runOpts, (event) => {
      if (event.type === 'node') videoEvents.push(event);
    });
    const videoPreview = videoEvents.find((event) => event.nodeId === 'pv' && event.state === 'success');
    expect(videoPreview?.result?.mediaId).toBe(VIDEO_ID);
    expect(videoPreview?.result?.projectId).toBe(PROJECT);
    expect(generate).not.toHaveBeenCalled();
    expect(downloadMedia).not.toHaveBeenCalled();
  });

  it('Media Input routes IMAGE and VIDEO RuntimeValues to a MEDIA sink', async () => {
    const rt = runtime();
    for (const [mediaType, mediaId] of [['IMAGE', IMAGE_ID], ['VIDEO', VIDEO_ID]] as const) {
      const nodes: NodeSpecForValidation[] = [
        { id: 'in', kind: 'mediaInput', config: { mediaId, mediaType, projectId: PROJECT }, ...ports('mediaInput') },
        { id: 'pv', kind: 'preview', config: {}, ...ports('preview') },
      ];
      const events: Array<{ nodeId?: string; state?: string; result?: { mediaId?: string; type?: string } }> = [];
      await rt.run(nodes, [{ id: 'e1', source: 'in', sourceHandle: 'media', target: 'pv', targetHandle: 'media' }], runOpts, (event) => {
        if (event.type === 'node') events.push(event);
      });
      const preview = events.find((event) => event.nodeId === 'pv' && event.state === 'success');
      expect(preview?.result?.mediaId).toBe(mediaId);
      expect(preview?.result?.type).toBe(mediaType === 'IMAGE' ? 'image' : 'video');
    }
  });

  it('fails closed before provider side effects on current/foreign/wrong-type binds', async () => {
    const generate = vi.fn();
    const downloadMedia = vi.fn();
    const uploadImage = vi.fn();
    const rt = runtime({ generate, downloadMedia, uploadImage });
    const bad: Array<{ kind: NodeSpecForValidation['kind']; config: Record<string, string> }> = [
      { kind: 'imageInput', config: { mediaId: IMAGE_ID, mediaType: 'IMAGE', projectId: 'current' } },
      { kind: 'imageInput', config: { mediaId: IMAGE_ID, mediaType: 'IMAGE', projectId: FOREIGN } },
      { kind: 'imageInput', config: { mediaId: IMAGE_ID, mediaType: 'VIDEO', projectId: PROJECT } },
      { kind: 'videoInput', config: { mediaId: VIDEO_ID, mediaType: 'IMAGE', projectId: PROJECT } },
      { kind: 'videoInput', config: { mediaId: 'dropped-1', mediaType: 'VIDEO', projectId: PROJECT } },
    ];
    for (const item of bad) {
      const nodes: NodeSpecForValidation[] = [
        { id: 'in', kind: item.kind, config: item.config, ...(item.kind === 'videoInput' ? ports('videoInput') : ports('imageInput')) },
        { id: 'dl', kind: 'download', config: { autoDownload: 'true' }, ...ports('download') },
      ];
      await expect(rt.run(nodes, [{
        id: 'e1',
        source: 'in',
        sourceHandle: item.kind === 'videoInput' ? 'video' : 'image',
        target: 'dl',
        targetHandle: 'media',
      }], runOpts, vi.fn())).rejects.toBeTruthy();
    }
    expect(generate).not.toHaveBeenCalled();
    expect(downloadMedia).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('keeps Preview as a sink and excludes Preview/Download from cache', () => {
    const withPreview = planGraph(
      [
        { id: 'a', kind: 'prompt' },
        { id: 'b', kind: 't2i' },
        { id: 'p', kind: 'preview' },
        { id: 'x', kind: 'prompt' },
        { id: 'y', kind: 't2v' },
      ],
      [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'p' },
        { id: 'e3', source: 'x', target: 'y' },
      ],
    );
    expect(withPreview.order).toEqual(['a', 'b', 'p']);
    const sinkless = planGraph(
      [{ id: 'a', kind: 'prompt' }, { id: 'b', kind: 't2i' }, { id: 'x', kind: 'prompt' }, { id: 'y', kind: 't2i' }],
      [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e3', source: 'x', target: 'y' }],
    );
    expect(sinkless.order.length).toBe(4);
    expect(isCacheableNodeKind('preview')).toBe(false);
    expect(isCacheableNodeKind('download')).toBe(false);
    expect(isCacheableNodeKind('t2i')).toBe(true);
    expect(isCacheableNodeKind('uploadImage')).toBe(true);
  });

  it('persists trusted projectId, strips signed URLs, and does not promote local pseudo-media', () => {
    const nodes = cloneNodes();
    nodes[0] = {
      ...nodes[0],
      id: 'gen',
      data: {
        ...nodes[0].data,
        kind: 't2i',
        status: 'success',
        result: { type: 'image', previewUrl: 'https://signed.example/x?token=1', mediaId: IMAGE_ID, projectId: PROJECT },
      },
    };
    nodes[1] = {
      ...nodes[1],
      id: 'local',
      data: {
        ...nodes[1].data,
        kind: 'uploadImage',
        status: 'idle',
        result: { type: 'image', previewUrl: 'data:image/png;base64,aaa', mediaId: 'dropped-1', fileName: 'hero.png' },
      },
    };
    const saved = buildSavedWorkflow(nodes, demoEdges, 'wf', 'Media E2E', { projectId: PROJECT, projectName: 'Test' });
    expect(saved.nodes.find((node) => node.id === 'gen')?.data.result?.previewUrl).toBe('');
    expect(saved.runtimeResults?.gen?.projectId).toBe(PROJECT);
    expect(saved.runtimeResults?.gen?.mediaId).toBe(IMAGE_ID);
    expect(saved.runtimeResults?.local).toBeUndefined();
    expect(saved.nodes.find((node) => node.id === 'local')?.data.status).not.toBe('success');
  });

  it('locks semantic drop/bind while a run is active', () => {
    expect(isSemanticMutationLocked('running')).toBe(true);
    expect(isSemanticMutationLocked('ready')).toBe(false);
    expect(localImageDropAction('imageInput', 'node')).toBe('stage-on-upload');
    const mainSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/main.tsx'), 'utf8');
    expect(mainSrc).toMatch(/handleNodeDropMedia[\s\S]{0,400}isSemanticMutationLocked\(runStatus\)/);
    expect(mainSrc).toMatch(/handleBindProviderMedia[\s\S]{0,250}isSemanticMutationLocked\(runStatus\)/);
  });
});
