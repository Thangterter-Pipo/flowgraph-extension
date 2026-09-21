import { describe, it, expect, vi } from 'vitest';
import { ExtendVideoExecutor } from '../../src/runtime/executors/ExtendVideoExecutor';
import { mediaRefFromPayload } from '../../src/runtime/RuntimeValue';
import { ExecutionContext } from '../../src/runtime/ExecutionContext';
import { RUNTIME_SUPPORTED_KINDS, buildExecutors } from '../../src/runtime/executors';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';

function makeMockContext(projectId = 'proj-1') {
  const activeProject = { projectId, projectName: 'Test Project', selectedAt: '2026-09-01T00:00:00Z', verifiedAt: '2026-09-01T00:00:00Z' };
  const account = { state: 'CONNECTED' as const, email: 'test@example.com' };
  const flow = { state: 'READY' as const, projectId };
  const ctx = new ExecutionContext({
    runId: 'run-test-ext',
    workflowId: 'wf-test',
    activeProject,
    account,
    flow,
  });
  return { ctx, activeProject };
}

describe('ExtendVideoExecutor (Task 3)', () => {
  it('registry includes extend', () => {
    expect(RUNTIME_SUPPORTED_KINDS.has('extend')).toBe(true);
    const adapter: GoogleFlowAdapter = {} as any;
    const executors = buildExecutors(adapter);
    expect(executors.has('extend')).toBe(true);
    expect(executors.get('extend')?.kind).toBe('extend');
  });

  it('validates video, prompt, and valid mode requirement', () => {
    const adapter: GoogleFlowAdapter = {} as any;
    const exec = new ExtendVideoExecutor({ adapter });
    const { ctx } = makeMockContext();

    const noInputs = exec.validate({
      runId: 'run-1',
      nodeId: 'node-ext',
      inputs: {},
      config: {},
      context: ctx,
    });
    expect(noInputs.valid).toBe(false);
    expect(noInputs.errors).toContain('Extend/Edit Video requires a video input connected.');
    expect(noInputs.errors).toContain('Extend/Edit Video requires a prompt from a connected node or node configuration.');

    const invalidMode = exec.validate({
      runId: 'run-1',
      nodeId: 'node-ext',
      inputs: {
        video: mediaRefFromPayload({ mediaId: 'vid-1', type: 'VIDEO', projectId: 'proj-1' }),
      },
      config: { prompt: 'Valid prompt', mode: 'Invalid Mode' },
      context: ctx,
    });
    expect(invalidMode.valid).toBe(false);
    expect(invalidMode.errors).toContain('Invalid mode "Invalid Mode". Mode must be "Extend Forward" or "Edit Video".');

    const validExtend = exec.validate({
      runId: 'run-1',
      nodeId: 'node-ext',
      inputs: {
        video: mediaRefFromPayload({ mediaId: 'vid-1', type: 'VIDEO', projectId: 'proj-1' }),
      },
      config: { prompt: 'Valid prompt', mode: 'Extend Forward' },
      context: ctx,
    });
    expect(validExtend.valid).toBe(true);
    expect(validExtend.errors).toHaveLength(0);

    const validEdit = exec.validate({
      runId: 'run-1',
      nodeId: 'node-ext',
      inputs: {
        video: mediaRefFromPayload({ mediaId: 'vid-1', type: 'VIDEO', projectId: 'proj-1' }),
      },
      config: { prompt: 'Valid prompt', mode: 'Edit Video' },
      context: ctx,
    });
    expect(validEdit.valid).toBe(true);
    expect(validEdit.errors).toHaveLength(0);
  });

  it('rejects non-VIDEO input in validate and execute', async () => {
    const generateFn = vi.fn();
    const adapter: GoogleFlowAdapter = { generate: generateFn } as any;
    const exec = new ExtendVideoExecutor({ adapter });
    const { ctx } = makeMockContext();

    const imgInput = mediaRefFromPayload({ mediaId: 'img-1', type: 'IMAGE', projectId: 'proj-1' });

    const valResult = exec.validate({
      runId: 'run-1',
      nodeId: 'node-ext',
      inputs: { video: imgInput },
      config: { prompt: 'Valid prompt' },
      context: ctx,
    });
    expect(valResult.valid).toBe(false);
    expect(valResult.errors).toContain('Extend/Edit Video input must strictly be a valid VIDEO MediaRef.');

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-ext',
      inputs: { video: imgInput },
      config: { prompt: 'Valid prompt' },
      context: ctx,
    })).rejects.toThrow('Extend/Edit Video input must strictly be a VIDEO MediaRef.');

    expect(generateFn).not.toHaveBeenCalled();
  });

  it('fails closed on missing or blank prompt at execute without calling adapter', async () => {
    const generateFn = vi.fn();
    const adapter: GoogleFlowAdapter = { generate: generateFn } as any;
    const exec = new ExtendVideoExecutor({ adapter });
    const { ctx } = makeMockContext();

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-ext',
      inputs: {
        video: mediaRefFromPayload({ mediaId: 'vid-1', type: 'VIDEO', projectId: 'proj-1' }),
      },
      config: { prompt: '   ' },
      context: ctx,
    })).rejects.toThrow('Extend/Edit Video received no prompt input. Connect a Prompt node or configure a prompt.');

    expect(generateFn).not.toHaveBeenCalled();
  });

  it('fails closed on empty mediaId', async () => {
    const generateFn = vi.fn();
    const adapter: GoogleFlowAdapter = { generate: generateFn } as any;
    const exec = new ExtendVideoExecutor({ adapter });
    const { ctx } = makeMockContext();

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-ext',
      inputs: {
        video: { type: 'video', value: { mediaId: '', projectId: 'proj-1', type: 'VIDEO' } } as any,
      },
      config: { prompt: 'Valid prompt' },
      context: ctx,
    })).rejects.toThrow('Video input has empty mediaId.');

    expect(generateFn).not.toHaveBeenCalled();
  });

  it('enforces project isolation on input video', async () => {
    const adapter: GoogleFlowAdapter = {} as any;
    const exec = new ExtendVideoExecutor({ adapter });
    const { ctx } = makeMockContext('proj-1');

    await expect(exec.execute({
      runId: 'run-1',
      nodeId: 'node-ext',
      inputs: {
        video: mediaRefFromPayload({ mediaId: 'vid-alien', type: 'VIDEO', projectId: 'proj-alien' }),
      },
      config: { prompt: 'Test' },
      context: ctx,
    })).rejects.toThrow('Input Video vid-alien belongs to project proj-alien, not the active project proj-1.');
  });

  it('executes Extend Forward and passes exact payload to adapter', async () => {
    const generateFn = vi.fn().mockResolvedValue({
      mediaId: 'vid-ext-123',
      type: 'VIDEO',
      projectId: 'proj-1',
      previewUrl: 'https://cdn.example.com/ext.mp4',
      completedViaUi: true,
    });
    const adapter: GoogleFlowAdapter = { generate: generateFn } as any;
    const exec = new ExtendVideoExecutor({ adapter });
    const { ctx } = makeMockContext('proj-1');

    const output = await exec.execute({
      runId: 'run-1',
      nodeId: 'node-ext',
      inputs: {
        video: mediaRefFromPayload({ mediaId: 'vid-in-1', type: 'VIDEO', projectId: 'proj-1' }),
      },
      config: {
        prompt: 'FG-EXT-RUN1: Extend the supplied video forward with coherent motion',
        mode: 'Extend Forward',
        aspectRatio: '16:9 (Landscape)',
      },
      context: ctx,
    });

    expect(generateFn.mock.calls[0][0]).toEqual(expect.objectContaining({
      kind: 'extend',
      projectId: 'proj-1',
      prompt: 'FG-EXT-RUN1: Extend the supplied video forward with coherent motion',
      mode: 'Extend Forward',
      videoInput: { mediaId: 'vid-in-1' },
    }));

    expect(output.outputs.video.type).toBe('video');
    expect((output.outputs.video.value as any).type).toBe('VIDEO');
    expect(output.result).toEqual({
      type: 'video',
      mediaId: 'vid-ext-123',
      previewUrl: 'https://cdn.example.com/ext.mp4',
      mimeType: 'video/mp4',
    });
  });

  it('executes Edit Video and passes exact payload to adapter', async () => {
    const generateFn = vi.fn().mockResolvedValue({
      mediaId: 'vid-edit-456',
      type: 'VIDEO',
      projectId: 'proj-1',
      previewUrl: 'https://cdn.example.com/edit.mp4',
      completedViaUi: true,
    });
    const adapter: GoogleFlowAdapter = { generate: generateFn } as any;
    const exec = new ExtendVideoExecutor({ adapter });
    const { ctx } = makeMockContext('proj-1');

    const output = await exec.execute({
      runId: 'run-2',
      nodeId: 'node-edit',
      inputs: {
        video: mediaRefFromPayload({ mediaId: 'vid-in-2', type: 'VIDEO', projectId: 'proj-1' }),
      },
      config: {
        prompt: 'FG-EDIT-RUN2: Edit the supplied video while preserving the main subject',
        mode: 'Edit Video',
      },
      context: ctx,
    });

    expect(generateFn.mock.calls[0][0]).toEqual(expect.objectContaining({
      kind: 'extend',
      projectId: 'proj-1',
      prompt: 'FG-EDIT-RUN2: Edit the supplied video while preserving the main subject',
      mode: 'Edit Video',
      videoInput: { mediaId: 'vid-in-2' },
    }));

    expect(output.outputs.video.type).toBe('video');
    expect((output.outputs.video.value as any).type).toBe('VIDEO');
    expect(output.result?.mediaId).toBe('vid-edit-456');
  });

  it('polls to completion when completedViaUi is not set', async () => {
    const generateFn = vi.fn().mockResolvedValue({
      mediaId: 'vid-ext-poll',
      type: 'VIDEO',
      projectId: 'proj-1',
    });
    const waitForMediaFn = vi.fn().mockResolvedValue({
      status: 'SUCCESSFUL',
      media: {
        mediaId: 'vid-ext-poll',
        previewUrl: 'https://cdn.example.com/polled-ext.mp4',
      },
    });

    const adapter: GoogleFlowAdapter = {
      generate: generateFn,
      waitForMedia: waitForMediaFn,
    } as any;

    const exec = new ExtendVideoExecutor({ adapter });
    const { ctx } = makeMockContext('proj-1');

    const output = await exec.execute({
      runId: 'run-1',
      nodeId: 'node-ext',
      inputs: {
        video: mediaRefFromPayload({ mediaId: 'vid-in-1', type: 'VIDEO', projectId: 'proj-1' }),
      },
      config: { prompt: 'Poll test', mode: 'Extend Forward' },
      context: ctx,
    });

    expect(waitForMediaFn).toHaveBeenCalledWith({ projectId: 'proj-1', mediaId: 'vid-ext-poll' });
    expect(output.outputs.video.type).toBe('video');
    expect((output.outputs.video.value as any).type).toBe('VIDEO');
    expect(output.result?.mediaId).toBe('vid-ext-poll');
    expect(output.result?.previewUrl).toBe('https://cdn.example.com/polled-ext.mp4');
  });
});
