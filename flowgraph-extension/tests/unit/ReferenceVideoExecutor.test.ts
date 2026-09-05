import { describe, it, expect, vi } from 'vitest';
import { ReferenceVideoExecutor } from '../../src/runtime/executors/ReferenceVideoExecutor';
import { mediaRefFromPayload, asMediaList } from '../../src/runtime/RuntimeValue';
import { ExecutionContext } from '../../src/runtime/ExecutionContext';
import { RUNTIME_SUPPORTED_KINDS, buildExecutors } from '../../src/runtime/executors';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';

function makeMockContext(projectId = 'proj-1') {
  const activeProject = { projectId, projectName: 'Test Project', selectedAt: '2026-09-01T00:00:00Z', verifiedAt: '2026-09-01T00:00:00Z' };
  const account = { state: 'CONNECTED' as const, email: 'test@example.com' };
  const flow = { state: 'READY' as const, projectId };
  const ctx = new ExecutionContext({
    runId: 'run-test-ref',
    workflowId: 'wf-test',
    activeProject,
    account,
    flow,
  });
  return { ctx, activeProject };
}

describe('ReferenceVideoExecutor', () => {
  it('registry includes reference', () => {
    expect(RUNTIME_SUPPORTED_KINDS.has('reference')).toBe(true);
    const adapter: GoogleFlowAdapter = {} as any;
    const executors = buildExecutors(adapter);
    expect(executors.has('reference')).toBe(true);
    expect(executors.get('reference')?.kind).toBe('reference');
  });

  it('asMediaList extracts single or multiple ordered media refs correctly', () => {
    const ref1 = mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-1' });
    const ref2 = mediaRefFromPayload({ mediaId: 'img-2', type: 'IMAGE', projectId: 'proj-1' });

    expect(asMediaList(undefined)).toEqual([]);
    expect(asMediaList(ref1)).toHaveLength(1);
    expect(asMediaList(ref1)[0].mediaId).toBe('img-1');

    const multi = [ref1, ref2];
    const extracted = asMediaList(multi);
    expect(extracted).toHaveLength(2);
    expect(extracted[0].mediaId).toBe('img-1');
    expect(extracted[1].mediaId).toBe('img-2');
  });

  it('validates references and prompt requirement', () => {
    const adapter: GoogleFlowAdapter = {} as any;
    const exec = new ReferenceVideoExecutor({ adapter });
    const { ctx } = makeMockContext();

    const noInputs = exec.validate({
      runId: 'run-1',
      nodeId: 'node-ref',
      inputs: {},
      config: {},
      context: ctx,
    });
    expect(noInputs.valid).toBe(false);
    expect(noInputs.errors).toContain('Reference Video requires at least one Reference Image from a connected node.');
    expect(noInputs.errors).toContain('Reference Video requires a prompt from a connected node or node configuration.');

    const missingPrompt = exec.validate({
      runId: 'run-1',
      nodeId: 'node-ref',
      inputs: {
        references: mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: { prompt: '   ' },
      context: ctx,
    });
    expect(missingPrompt.valid).toBe(false);
    expect(missingPrompt.errors).toContain('Reference Video requires a prompt from a connected node or node configuration.');

    const valid = exec.validate({
      runId: 'run-1',
      nodeId: 'node-ref',
      inputs: {
        references: [
          mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-1' }),
          mediaRefFromPayload({ mediaId: 'img-2', type: 'IMAGE', projectId: 'proj-1' }),
        ],
      },
      config: { prompt: 'Reference scene' },
      context: ctx,
    });
    expect(valid.valid).toBe(true);
    expect(valid.errors).toHaveLength(0);
  });

  it('fails closed on missing or blank prompt at execute without calling adapter', async () => {
    const generateFn = vi.fn();
    const adapter: GoogleFlowAdapter = { generate: generateFn } as any;
    const exec = new ReferenceVideoExecutor({ adapter });
    const { ctx } = makeMockContext();

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-ref',
      inputs: {
        references: mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: {},
      context: ctx,
    })).rejects.toThrow('Reference Video received no prompt input. Connect a Prompt node or configure a prompt.');

    expect(generateFn).not.toHaveBeenCalled();
  });

  it('fails closed on missing references at execute', async () => {
    const adapter: GoogleFlowAdapter = {} as any;
    const exec = new ReferenceVideoExecutor({ adapter });
    const { ctx } = makeMockContext();

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-ref',
      inputs: {},
      config: { prompt: 'Test prompt' },
      context: ctx,
    })).rejects.toThrow('Reference Video received no reference images input.');
  });

  it('enforces project isolation across all ordered reference images', async () => {
    const adapter: GoogleFlowAdapter = {} as any;
    const exec = new ReferenceVideoExecutor({ adapter });
    const { ctx } = makeMockContext('proj-1');

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-ref',
      inputs: {
        references: [
          mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-1' }),
          mediaRefFromPayload({ mediaId: 'img-alien', type: 'IMAGE', projectId: 'proj-alien' }),
        ],
      },
      config: { prompt: 'Test' },
      context: ctx,
    })).rejects.toThrow('Reference Image img-alien belongs to project proj-alien, not the active project proj-1.');
  });

  it('executes successfully and passes exact ordered imageRefs to adapter', async () => {
    const generateFn = vi.fn().mockResolvedValue({
      mediaId: 'vid-ref-123',
      type: 'VIDEO',
      projectId: 'proj-1',
      previewUrl: 'https://cdn.example.com/ref.mp4',
      completedViaUi: true,
    });
    const adapter: GoogleFlowAdapter = {
      generate: generateFn,
    } as any;

    const exec = new ReferenceVideoExecutor({ adapter });
    const { ctx } = makeMockContext('proj-1');

    const output = await exec.execute({
      runId: 'run-1',
      nodeId: 'node-ref',
      inputs: {
        references: [
          mediaRefFromPayload({ mediaId: 'img-ref-A', type: 'IMAGE', projectId: 'proj-1' }),
          mediaRefFromPayload({ mediaId: 'img-ref-B', type: 'IMAGE', projectId: 'proj-1' }),
        ],
      },
      config: {
        prompt: 'Generate stylized video based on reference images',
        aspectRatio: '16:9 (Landscape)',
      },
      context: ctx,
    });

    expect(generateFn).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'reference',
      projectId: 'proj-1',
      prompt: 'Generate stylized video based on reference images',
      imageRefs: [
        { mediaId: 'img-ref-A', imageUsageType: 'IMAGE_USAGE_TYPE_ASSET' },
        { mediaId: 'img-ref-B', imageUsageType: 'IMAGE_USAGE_TYPE_ASSET' },
      ],
    }));

    expect(output.outputs.video).toBeDefined();
    expect(output.outputs.video.type).toBe('video');
    expect((output.outputs.video.value as any).type).toBe('VIDEO');
    expect(output.result).toEqual({
      type: 'video',
      mediaId: 'vid-ref-123',
      previewUrl: 'https://cdn.example.com/ref.mp4',
      mimeType: 'video/mp4',
    });
  });

  it('polls to completion when completedViaUi is not set', async () => {
    const generateFn = vi.fn().mockResolvedValue({
      mediaId: 'vid-ref-poll',
      type: 'VIDEO',
      projectId: 'proj-1',
    });
    const waitForMediaFn = vi.fn().mockResolvedValue({
      status: 'SUCCESSFUL',
      media: {
        mediaId: 'vid-ref-poll',
        previewUrl: 'https://cdn.example.com/polled-ref.mp4',
      },
    });

    const adapter: GoogleFlowAdapter = {
      generate: generateFn,
      waitForMedia: waitForMediaFn,
    } as any;

    const exec = new ReferenceVideoExecutor({ adapter });
    const { ctx } = makeMockContext('proj-1');

    const output = await exec.execute({
      runId: 'run-1',
      nodeId: 'node-ref',
      inputs: {
        references: mediaRefFromPayload({ mediaId: 'img-ref-1', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: { prompt: 'Poll test' },
      context: ctx,
    });

    expect(waitForMediaFn).toHaveBeenCalledWith({ projectId: 'proj-1', mediaId: 'vid-ref-poll' });
    expect(output.outputs.video.type).toBe('video');
    expect((output.outputs.video.value as any).type).toBe('VIDEO');
    expect(output.result?.mediaId).toBe('vid-ref-poll');
    expect(output.result?.previewUrl).toBe('https://cdn.example.com/polled-ref.mp4');
  });
});
