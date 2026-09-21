import { describe, it, expect, vi } from 'vitest';
import { InterpolationExecutor } from '../../src/runtime/executors/InterpolationExecutor';
import { mediaRefFromPayload } from '../../src/runtime/RuntimeValue';
import { ExecutionContext } from '../../src/runtime/ExecutionContext';
import { RUNTIME_SUPPORTED_KINDS, buildExecutors } from '../../src/runtime/executors';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';

function makeMockContext(projectId = 'proj-1') {
  const activeProject = { projectId, projectName: 'Test Project', selectedAt: '2026-09-01T00:00:00Z', verifiedAt: '2026-09-01T00:00:00Z' };
  const account = { state: 'CONNECTED' as const, email: 'test@example.com' };
  const flow = { state: 'READY' as const, projectId };
  const ctx = new ExecutionContext({
    runId: 'run-test-1',
    workflowId: 'wf-test',
    activeProject,
    account,
    flow,
  });
  return { ctx, activeProject };
}

describe('InterpolationExecutor', () => {
  it('registry includes interpolation', () => {
    expect(RUNTIME_SUPPORTED_KINDS.has('interpolation')).toBe(true);
    const adapter: GoogleFlowAdapter = {} as any;
    const executors = buildExecutors(adapter);
    expect(executors.has('interpolation')).toBe(true);
    expect(executors.get('interpolation')?.kind).toBe('interpolation');
  });

  it('validates startImage, endImage and prompt requirement', () => {
    const adapter: GoogleFlowAdapter = {} as any;
    const exec = new InterpolationExecutor({ adapter });
    const { ctx } = makeMockContext();

    const noInputs = exec.validate({
      runId: 'run-1',
      nodeId: 'node-interp',
      inputs: {},
      config: {},
      context: ctx,
    });
    expect(noInputs.valid).toBe(false);
    expect(noInputs.errors).toContain('Interpolation requires a Start Image from a connected node.');
    expect(noInputs.errors).toContain('Interpolation requires an End Image from a connected node.');
    expect(noInputs.errors).toContain('Interpolation requires a prompt from a connected node or node configuration.');

    const missingPrompt = exec.validate({
      runId: 'run-1',
      nodeId: 'node-interp',
      inputs: {
        startImage: mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-1' }),
        endImage: mediaRefFromPayload({ mediaId: 'img-2', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: { prompt: '   ' },
      context: ctx,
    });
    expect(missingPrompt.valid).toBe(false);
    expect(missingPrompt.errors).toContain('Interpolation requires a prompt from a connected node or node configuration.');

    const valid = exec.validate({
      runId: 'run-1',
      nodeId: 'node-interp',
      inputs: {
        startImage: mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-1' }),
        endImage: mediaRefFromPayload({ mediaId: 'img-2', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: { prompt: 'Morph scene' },
      context: ctx,
    });
    expect(valid.valid).toBe(true);
    expect(valid.errors).toHaveLength(0);
  });

  it('fails closed on missing or blank prompt at execute without calling adapter', async () => {
    const generateFn = vi.fn();
    const adapter: GoogleFlowAdapter = { generate: generateFn } as any;
    const exec = new InterpolationExecutor({ adapter });
    const { ctx } = makeMockContext();

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-interp',
      inputs: {
        startImage: mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-1' }),
        endImage: mediaRefFromPayload({ mediaId: 'img-2', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: {},
      context: ctx,
    })).rejects.toThrow('Interpolation received no prompt input. Connect a Prompt node or configure a prompt.');

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-interp',
      inputs: {
        startImage: mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-1' }),
        endImage: mediaRefFromPayload({ mediaId: 'img-2', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: { prompt: '   \n\t ' },
      context: ctx,
    })).rejects.toThrow('Interpolation received no prompt input. Connect a Prompt node or configure a prompt.');

    expect(generateFn).not.toHaveBeenCalled();
  });

  it('fails closed on missing startImage input at execute', async () => {
    const adapter: GoogleFlowAdapter = {} as any;
    const exec = new InterpolationExecutor({ adapter });
    const { ctx } = makeMockContext();

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-interp',
      inputs: {
        endImage: mediaRefFromPayload({ mediaId: 'img-2', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: { prompt: 'Test' },
      context: ctx,
    })).rejects.toThrow('Interpolation received no Start Image input.');
  });

  it('fails closed on missing endImage input at execute', async () => {
    const adapter: GoogleFlowAdapter = {} as any;
    const exec = new InterpolationExecutor({ adapter });
    const { ctx } = makeMockContext();

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-interp',
      inputs: {
        startImage: mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: { prompt: 'Test' },
      context: ctx,
    })).rejects.toThrow('Interpolation received no End Image input.');
  });

  it('enforces project isolation for startImage', async () => {
    const adapter: GoogleFlowAdapter = {} as any;
    const exec = new InterpolationExecutor({ adapter });
    const { ctx } = makeMockContext('proj-1');

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-interp',
      inputs: {
        startImage: mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-alien' }),
        endImage: mediaRefFromPayload({ mediaId: 'img-2', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: { prompt: 'Test' },
      context: ctx,
    })).rejects.toThrow('Start Image belongs to project proj-alien, not the active project proj-1.');
  });

  it('enforces project isolation for endImage', async () => {
    const adapter: GoogleFlowAdapter = {} as any;
    const exec = new InterpolationExecutor({ adapter });
    const { ctx } = makeMockContext('proj-1');

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-interp',
      inputs: {
        startImage: mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-1' }),
        endImage: mediaRefFromPayload({ mediaId: 'img-2', type: 'IMAGE', projectId: 'proj-alien' }),
      },
      config: { prompt: 'Test' },
      context: ctx,
    })).rejects.toThrow('End Image belongs to project proj-alien, not the active project proj-1.');
  });

  it('executes successfully and returns VIDEO MediaRef with completedViaUi', async () => {
    const generateFn = vi.fn().mockResolvedValue({
      mediaId: 'vid-interp-123',
      type: 'VIDEO',
      projectId: 'proj-1',
      previewUrl: 'https://cdn.example.com/interp.mp4',
      completedViaUi: true,
    });
    const adapter: GoogleFlowAdapter = {
      generate: generateFn,
    } as any;

    const exec = new InterpolationExecutor({ adapter });
    const { ctx } = makeMockContext('proj-1');

    const output = await exec.execute({
      runId: 'run-1',
      nodeId: 'node-interp',
      inputs: {
        startImage: mediaRefFromPayload({ mediaId: 'img-start-abc', type: 'IMAGE', projectId: 'proj-1' }),
        endImage: mediaRefFromPayload({ mediaId: 'img-end-xyz', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: {
        prompt: 'Morph from flower to butterfly',
        aspectRatio: '16:9 (Landscape)',
      },
      context: ctx,
    });

    expect(generateFn.mock.calls[0][0]).toEqual(expect.objectContaining({
      kind: 'interpolation',
      projectId: 'proj-1',
      prompt: 'Morph from flower to butterfly',
      startImage: { mediaId: 'img-start-abc' },
      endImage: { mediaId: 'img-end-xyz' },
    }));

    expect(output.outputs.video).toBeDefined();
    expect(output.outputs.video.type).toBe('video');
    expect((output.outputs.video.value as any).type).toBe('VIDEO');
    expect(output.result).toEqual({
      type: 'video',
      mediaId: 'vid-interp-123',
      previewUrl: 'https://cdn.example.com/interp.mp4',
      mimeType: 'video/mp4',
    });
  });

  it('polls to completion when completedViaUi is not set', async () => {
    const generateFn = vi.fn().mockResolvedValue({
      mediaId: 'vid-interp-poll',
      type: 'VIDEO',
      projectId: 'proj-1',
    });
    const waitForMediaFn = vi.fn().mockResolvedValue({
      status: 'SUCCESSFUL',
      media: {
        mediaId: 'vid-interp-poll',
        previewUrl: 'https://cdn.example.com/polled.mp4',
      },
    });

    const adapter: GoogleFlowAdapter = {
      generate: generateFn,
      waitForMedia: waitForMediaFn,
    } as any;

    const exec = new InterpolationExecutor({ adapter });
    const { ctx } = makeMockContext('proj-1');

    const output = await exec.execute({
      runId: 'run-1',
      nodeId: 'node-interp',
      inputs: {
        startImage: mediaRefFromPayload({ mediaId: 'img-start', type: 'IMAGE', projectId: 'proj-1' }),
        endImage: mediaRefFromPayload({ mediaId: 'img-end', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: { prompt: 'Poll test' },
      context: ctx,
    });

    expect(waitForMediaFn).toHaveBeenCalledWith({ projectId: 'proj-1', mediaId: 'vid-interp-poll' });
    expect(output.outputs.video.type).toBe('video');
    expect((output.outputs.video.value as any).type).toBe('VIDEO');
    expect(output.result?.mediaId).toBe('vid-interp-poll');
    expect(output.result?.previewUrl).toBe('https://cdn.example.com/polled.mp4');
  });

  it('cancel during pending generate rejects without returning success', async () => {
    const abort = new AbortController();
    const generateFn = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return { mediaId: 'vid-late', type: 'VIDEO', projectId: 'proj-1', previewUrl: 'https://cdn.example.com/late.mp4' };
    });
    const adapter: GoogleFlowAdapter = { generate: generateFn } as any;
    const exec = new InterpolationExecutor({ adapter });
    const ctx = new ExecutionContext({
      runId: 'run-1',
      workflowId: 'wf-test',
      activeProject: { projectId: 'proj-1', projectName: 'Test Project', selectedAt: '2026-09-01T00:00:00Z' },
      account: { state: 'CONNECTED', email: 'test@example.com' },
      flow: { state: 'READY', projectId: 'proj-1' },
      abortSignal: abort.signal,
    });
    const started = Date.now();
    const run = exec.execute({
      runId: 'run-1',
      nodeId: 'node-interp',
      inputs: {
        startImage: mediaRefFromPayload({ mediaId: 'img-start', type: 'IMAGE', projectId: 'proj-1' }),
        endImage: mediaRefFromPayload({ mediaId: 'img-end', type: 'IMAGE', projectId: 'proj-1' }),
      },
      config: { prompt: 'Morph scene' },
      context: ctx,
    }, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 30));
    abort.abort();
    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
