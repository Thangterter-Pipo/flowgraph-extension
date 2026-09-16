import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { palette, paletteSpecForKind } from '../../src/ui/studio/model';
import { localImageDropAction } from '../../src/ui/studio/mediaInputUi';
import { ImageInputExecutor } from '../../src/runtime/executors/ImageInputExecutor';
import { VideoInputExecutor } from '../../src/runtime/executors/VideoInputExecutor';
import { runtimeClassFor } from '../../src/ui/studio/capabilities';
import { supportedKinds } from '../../src/runtime/executors';
import { validateGraph } from '../../src/runtime/GraphValidator';
import { portsForKind } from '../../src/ui/studio/ports';
import { BUILTIN_TEMPLATES } from '../../src/ui/studio/workflowTemplates';

vi.mock('../../src/ui/studio/mediaStorage', () => ({
  getMediaBlob: vi.fn(),
}));

const PROJECT = '729eaa19-1c85-4cfc-89c3-5f86de2dffc5';

describe('simplified media input palette', () => {
  it('shows Image/Video Input and hides legacy Upload Image / Media Input while removing audioInput', () => {
    const kinds = palette.map((spec) => spec.kind);
    expect(kinds).toContain('imageInput');
    expect(kinds).toContain('videoInput');
    expect(kinds).not.toContain('audioInput');
    expect(kinds).not.toContain('uploadImage');
    expect(kinds).not.toContain('mediaInput');
    expect(paletteSpecForKind('uploadImage')?.kind).toBe('uploadImage');
    expect(paletteSpecForKind('mediaInput')?.kind).toBe('mediaInput');
  });

  it('keeps legacy uploadImage/mediaInput executable', () => {
    expect(supportedKinds.has('uploadImage')).toBe(true);
    expect(supportedKinds.has('mediaInput')).toBe(true);
    expect(supportedKinds.has('audioInput')).toBe(false);
    expect(runtimeClassFor('audioInput')).toBe('COMING_SOON');
  });

  it('stages local images on Image Input and rejects local video', () => {
    expect(localImageDropAction('imageInput', 'node')).toBe('stage-on-upload');
    expect(localImageDropAction('videoInput', 'node')).toBe('reject');
  });

  it('renders provider picker HUD in both image and video media branches', () => {
    const source = readFileSync(resolve(__dirname, '../../src/ui/studio/WorkflowNode.tsx'), 'utf8');
    expect(source.match(/className="provider-media-hud nodrag nopan"/g)?.length).toBeGreaterThanOrEqual(2);
    const videoBranch = source.slice(source.indexOf('className="video-player-preview"'), source.indexOf('className="image-preview-wrap"'));
    expect(videoBranch).toContain('provider-media-hud nodrag nopan');
    expect(videoBranch).toContain('flowgraph:request-verified-media');
  });

  it('uploads local Image Input through UploadImageExecutor on Run', async () => {
    const { getMediaBlob } = await import('../../src/ui/studio/mediaStorage');
    vi.mocked(getMediaBlob).mockResolvedValueOnce('data:image/png;base64,aaa');
    const uploadImage = vi.fn(async () => ({ mediaId: 'uploaded-from-image-input', type: 'IMAGE' as const, projectId: PROJECT }));
    const executor = new ImageInputExecutor({ adapter: { uploadImage, resolvePreviewUrl: vi.fn(async () => '') } as any });
    const ctx = {
      runId: 'r1',
      nodeId: 'n1',
      inputs: {},
      config: { mediaId: 'dropped-hero', fileName: 'hero.png' },
      context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() },
    } as any;
    expect(executor.validate(ctx).valid).toBe(true);
    const out = await executor.execute(ctx);
    expect(uploadImage).toHaveBeenCalled();
    expect((out.outputs.image.value as { mediaId: string }).mediaId).toBe('uploaded-from-image-input');
  });

  it('does not let Video Input run local files', () => {
    const executor = new VideoInputExecutor();
    const ctx = {
      runId: 'r1',
      nodeId: 'n1',
      inputs: {},
      config: { mediaId: 'dropped-1', mediaType: 'VIDEO', projectId: PROJECT },
      context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() },
    } as any;
    expect(executor.validate(ctx).valid).toBe(false);
  });

  it('keeps typed IMAGE/VIDEO ports and exposes Audio only as a non-connectable placeholder', () => {
    expect(portsForKind('imageInput').outputs[0].type).toBe('IMAGE');
    expect(portsForKind('videoInput').outputs[0].type).toBe('VIDEO');
    expect(portsForKind('audioInput').outputs).toEqual([
      expect.objectContaining({ id: 'audio', type: 'AUDIO', connectable: false }),
    ]);
    const report = validateGraph([{
      id: 'a',
      kind: 'audioInput',
      config: {},
      inputs: [],
      outputs: [{ id: 'audio', label: 'Audio', type: 'AUDIO' }],
    }], [], { activeProject: { projectId: PROJECT }, supportedKinds });
    expect(report.valid).toBe(false);
    expect(report.errors.some((error) => error.code === 'UNSUPPORTED_NODE')).toBe(true);
  });

  it('uses only the new media input taxonomy in built-in templates', () => {
    const templateKinds = BUILTIN_TEMPLATES.flatMap((template) => template.nodes.map((node) => node.data.kind));
    expect(templateKinds).not.toContain('uploadImage');
    expect(templateKinds).not.toContain('mediaInput');
  });
});
