import { describe, it, expect } from 'vitest';
import { portTypesCompatible as uiCompat, nodePortCatalog, portsForKind } from '../../src/ui/studio/ports';
import { portTypesCompatible as validatorCompat, validateGraph } from '../../src/runtime/GraphValidator';
import type { PortDataType } from '../../src/ui/studio/ports';
import { RUNTIME_SUPPORTED_KINDS } from '../../src/runtime/executors';
import {
  capabilityRegistry,
  runtimeCapabilityMatrix,
  runtimeClassFor,
} from '../../src/ui/studio/capabilities';
import { palette } from '../../src/ui/studio/model';
import { BUILTIN_TEMPLATES } from '../../src/ui/studio/workflowTemplates';
import { getPresentationSpec } from '../../src/ui/studio/nodePresentationSpec';
import {
  VIDEO_DURATION_OPTIONS,
  VIDEO_UPSCALE_RESOLUTIONS,
  formatPlayerTimestamp,
  computeEstimatedCredits,
} from '../../src/ui/studio/nodeUiContracts';
import { VideoUpscaleExecutor } from '../../src/runtime/executors/VideoUpscaleExecutor';
import { getSyncNodeCapability } from '../../src/shared/sync/SyncCapabilityRegistry';

const PORT_CASES: Array<[PortDataType, PortDataType]> = [
  ['IMAGE', 'IMAGE'],
  ['IMAGE', 'MEDIA'],
  ['VIDEO', 'MEDIA'],
  ['AUDIO', 'MEDIA'],
  ['MEDIA', 'IMAGE'],
  ['MEDIA', 'VIDEO'],
  ['MEDIA', 'FILE'],
  ['PROMPT', 'TEXT'],
  ['TEXT', 'PROMPT'],
  ['PROMPT', 'IMAGE'],
  ['CHARACTER', 'CHARACTER'],
  ['CHARACTER_LIST', 'CHARACTER'],
  ['ANY', 'IMAGE'],
  ['FILE', 'FILE'],
];

describe('Node conflict remediation — shared port compatibility', () => {
  it('UI and validator use identical portTypesCompatible behavior', () => {
    for (const [source, target] of PORT_CASES) {
      expect(uiCompat(source, target), `${source} → ${target}`).toBe(validatorCompat(source, target));
    }
  });

  it('allows IMAGE/VIDEO/AUDIO into MEDIA and rejects MEDIA into IMAGE', () => {
    expect(uiCompat('IMAGE', 'MEDIA')).toBe(true);
    expect(uiCompat('VIDEO', 'MEDIA')).toBe(true);
    expect(uiCompat('AUDIO', 'MEDIA')).toBe(true);
    expect(uiCompat('MEDIA', 'IMAGE')).toBe(false);
    expect(uiCompat('PROMPT', 'TEXT')).toBe(true);
    expect(uiCompat('CHARACTER_LIST', 'CHARACTER')).toBe(false);
  });
});

describe('Node conflict remediation — ports vs executors', () => {
  it('characterCreate Face Ref is required to match executor fail-closed', () => {
    const face = portsForKind('characterCreate').inputs.find((port) => port.id === 'image');
    expect(face).toBeDefined();
    expect(face?.required).toBe(true);
  });

  it('i2v accepts optional CHARACTER[] so DNA can wire into video', () => {
    const chars = portsForKind('i2v').inputs.find((port) => port.id === 'characters');
    expect(chars).toBeDefined();
    expect(chars?.type).toBe('CHARACTER');
    expect(chars?.multiple).toBe(true);
    expect(chars?.required).not.toBe(true);
  });

  it('every matrix executor:true kind is registered in RUNTIME_SUPPORTED_KINDS', () => {
    for (const row of runtimeCapabilityMatrix) {
      if (!row.executor) continue;
      expect(RUNTIME_SUPPORTED_KINDS.has(row.kind), row.kind).toBe(true);
    }
  });

  it('does not advertise ghost node kind upscale in the runtime matrix', () => {
    expect(runtimeCapabilityMatrix.some((row) => row.kind === 'upscale')).toBe(false);
    expect(nodePortCatalog.upscale).toBeUndefined();
    expect(runtimeClassFor('upscale')).toBe('COMING_SOON');
  });

  it('t2v registry maturity matches live executor matrix', () => {
    expect(capabilityRegistry.t2v.maturity).toBe('RUNTIME_VERIFIED');
    expect(runtimeCapabilityMatrix.find((row) => row.kind === 't2v')?.runtime).toBe('RUNTIME_VERIFIED');
  });
});

describe('Node conflict remediation — palette & templates', () => {
  it('hides UI_ONLY kinds from the default palette so they cannot block Run', () => {
    const uiOnly = new Set(
      runtimeCapabilityMatrix.filter((row) => row.runtime === 'UI_ONLY').map((row) => row.kind),
    );
    for (const spec of palette) {
      expect(uiOnly.has(spec.kind), spec.kind).toBe(false);
    }
  });

  it('every palette kind is runtime-supported unless explicitly disabled', () => {
    for (const spec of palette) {
      if (spec.paletteDisabled) {
        expect(RUNTIME_SUPPORTED_KINDS.has(spec.kind), spec.kind).toBe(false);
        continue;
      }
      expect(RUNTIME_SUPPORTED_KINDS.has(spec.kind), spec.kind).toBe(true);
    }
  });

  it('builtin templates never double-wire a single-input port', () => {
    for (const template of BUILTIN_TEMPLATES) {
      const counts = new Map<string, number>();
      for (const edge of template.edges) {
        const node = template.nodes.find((candidate) => candidate.id === edge.target);
        if (!node) continue;
        const port = portsForKind(node.data.kind).inputs.find((item) => item.id === edge.targetHandle);
        if (!port || port.multiple) continue;
        const key = `${template.id}:${edge.target}:${edge.targetHandle}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [key, count] of counts) {
        expect(count, key).toBe(1);
      }
    }
  });

  it('builtin template handles match the port catalog', () => {
    for (const template of BUILTIN_TEMPLATES) {
      for (const edge of template.edges) {
        const source = template.nodes.find((node) => node.id === edge.source);
        const target = template.nodes.find((node) => node.id === edge.target);
        expect(source, `${template.id} missing source ${edge.source}`).toBeDefined();
        expect(target, `${template.id} missing target ${edge.target}`).toBeDefined();
        if (!source || !target) continue;
        const out = portsForKind(source.data.kind).outputs.some((port) => port.id === edge.sourceHandle);
        const inn = portsForKind(target.data.kind).inputs.some((port) => port.id === edge.targetHandle);
        expect(out, `${template.id} ${edge.id} sourceHandle=${edge.sourceHandle}`).toBe(true);
        expect(inn, `${template.id} ${edge.id} targetHandle=${edge.targetHandle}`).toBe(true);
      }
    }
  });

  it('gemini enhance template actually contains a gemini node', () => {
    const template = BUILTIN_TEMPLATES.find((item) => item.id === 'tpl-gemini-enhance-t2i');
    expect(template).toBeDefined();
    expect(template?.nodes.some((node) => node.data.kind === 'gemini')).toBe(true);
  });

  it('benchmark template does not stack two nodes on the same coordinates', () => {
    const template = BUILTIN_TEMPLATES.find((item) => item.id === 'tpl-all-nodes-benchmark');
    expect(template).toBeDefined();
    const seen = new Set<string>();
    for (const node of template?.nodes ?? []) {
      const key = `${node.position.x},${node.position.y}`;
      expect(seen.has(key), `${node.id} at ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('validator requires a model on interpolation and reference', () => {
    const interpolation = validateGraph(
      [{ id: 'i', kind: 'interpolation', inputs: [], outputs: [], config: {} }],
      [],
      { activeProject: { projectId: 'p' }, supportedKinds: RUNTIME_SUPPORTED_KINDS },
    );
    expect(interpolation.errors.some((issue) => issue.code === 'INVALID_MODEL')).toBe(true);

    const reference = validateGraph(
      [{ id: 'r', kind: 'reference', inputs: [], outputs: [], config: {} }],
      [],
      { activeProject: { projectId: 'p' }, supportedKinds: RUNTIME_SUPPORTED_KINDS },
    );
    expect(reference.errors.some((issue) => issue.code === 'INVALID_MODEL')).toBe(true);
  });
});

describe('Node conflict remediation — UI contracts', () => {
  it('duration options use registry seconds labels, not compact 4s tokens', () => {
    expect(VIDEO_DURATION_OPTIONS).toEqual(['4 seconds', '6 seconds', '8 seconds', '10 seconds']);
  });

  it('video upscale UI only offers 1080p and 4K', () => {
    expect(VIDEO_UPSCALE_RESOLUTIONS).toEqual(['1080p', '4K']);
    expect(VIDEO_UPSCALE_RESOLUTIONS).not.toContain('720p');
  });

  it('player timestamp reads real current/duration seconds', () => {
    expect(formatPlayerTimestamp(0, 8)).toBe('0:00 / 0:08');
    expect(formatPlayerTimestamp(3, 8)).toBe('0:03 / 0:08');
    expect(formatPlayerTimestamp(65, 125)).toBe('1:05 / 2:05');
  });

  it('t2i credits are 0 and missing variants are Unavailable, not hardcoded 12', () => {
    expect(computeEstimatedCredits('t2i', {})).toBe('0');
    expect(computeEstimatedCredits('i2v', { model: 'not-a-real-model' })).toBe('Unavailable');
  });

  it('download presentation is not hard-locked to video chrome', () => {
    expect(getPresentationSpec('download').isVideoMedia).toBe(false);
  });

  it('VideoUpscaleExecutor rejects 720p the same way the UI stops offering it', () => {
    const executor = new VideoUpscaleExecutor({ adapter: {} as never });
    const result = executor.validate({
      runId: 'r',
      nodeId: 'n',
      inputs: {
        video: { type: 'video', value: { mediaId: 'v', projectId: 'p', type: 'VIDEO' } },
      },
      config: { targetResolution: '720p' },
      context: { activeProject: { projectId: 'p' }, throwIfAborted: () => undefined } as never,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('720p');
  });

  it('i2v sync fields do not leak interpolation endImage', () => {
    expect(getSyncNodeCapability('i2v')?.fields).not.toContain('endImage');
    expect(getSyncNodeCapability('interpolation')?.fields).toContain('endImage');
  });
});
