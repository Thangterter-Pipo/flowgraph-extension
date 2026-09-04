import type { Edge, Node } from '@xyflow/react';
import { capabilityFor, type CapabilityMaturity } from './capabilities';
import { deriveRegistryConfig } from './flowModelRegistry';

export type NodeStatus = 'idle' | 'queued' | 'running' | 'success' | 'failed' | 'skipped';
export type RunStatus = 'ready' | 'running' | 'success' | 'error';
export type NodeTone = 'purple' | 'blue' | 'green' | 'orange';
export type NodeGroup = 'Generative' | 'Image' | 'Video' | 'Character' | 'Utility';

export interface NodeMediaResult {
  type: 'image' | 'video';
  previewUrl: string;
  mediaId?: string;
  workflowId?: string;
  mimeType?: string;
  fileName?: string;
}

export interface FlowNodeData extends Record<string, unknown> {
  title: string;
  kind: string;
  subtitle: string;
  tone: NodeTone;
  status: NodeStatus;
  config: Record<string, string>;
  preview?: 'image' | 'video';
  result?: NodeMediaResult;
  experimental?: boolean;
  maturity: CapabilityMaturity;
  capabilityLabel: string;
  capabilitySummary: string;
  evidence?: string;
  isNew?: boolean;
  errorMessage?: string;
  errorCode?: string;
  errorRetryable?: boolean;
  diagnosticId?: string;
  cacheHit?: boolean;
}

export type FlowNode = Node<FlowNodeData, 'flowNode'>;
export type FlowEdge = Edge;

export interface PaletteSpec {
  kind: string;
  title: string;
  subtitle: string;
  tone: NodeTone;
  group: NodeGroup;
  preview?: 'image' | 'video';
  experimental?: boolean;
  isNew?: boolean;
  config: Record<string, string>;
}

export const palette: PaletteSpec[] = [
  {
    kind: 'prompt',
    title: 'Prompt',
    subtitle: 'Create text prompts',
    tone: 'purple',
    group: 'Generative',
    config: { prompt: 'A futuristic sports car driving on a wet neon-lit street at night, cinematic, ultra realistic.' },
  },
  {
    kind: 'gemini',
    title: 'Gemini Enhance',
    subtitle: 'Enhance with Gemini',
    tone: 'purple',
    group: 'Generative',
    config: { model: 'Gemini 2.5 Pro', style: 'Cinematic' },
  },
  {
    kind: 't2i',
    title: 'Text to Image',
    subtitle: 'Generate images with Google Flow',
    tone: 'blue',
    group: 'Generative',
    preview: 'image',
    config: { model: '🍌 Nano Banana 2', serviceTier: 'SERVICE_TIER_INTERMEDIATE', aspectRatio: '16:9 (Landscape)', promptSource: 'Input' },
  },
  {
    kind: 'uploadImage',
    title: 'Upload Image',
    subtitle: 'Upload PNG/JPEG to Flow',
    tone: 'blue',
    group: 'Image',
    preview: 'image',
    config: { source: 'Local File', inputFormat: 'PNG / JPEG', output: 'Image MediaRef' },
  },
  {
    kind: 'imageTransform',
    title: 'Image Transform',
    subtitle: 'Crop / transform image',
    tone: 'orange',
    group: 'Image',
    preview: 'image',
    experimental: true,
    config: { transform: 'Crop', aspectRatio: '16:9 (Landscape)', mediaSource: 'Input MediaRef' },
  },
  {
    kind: 'imageUpscale',
    title: 'Image Upscale',
    subtitle: 'Upsample image to 2K / 4K',
    tone: 'orange',
    group: 'Image',
    preview: 'image',
    experimental: true,
    config: { model: '2K', serviceTier: 'SERVICE_TIER_INTERMEDIATE', targetResolution: '2K', mediaSource: 'Input MediaRef' },
  },
  {
    kind: 't2v',
    title: 'Text to Video',
    subtitle: 'Veo 3.1 / Omni 1.1 Flash',
    tone: 'green',
    group: 'Video',
    preview: 'video',
    isNew: true,
    config: {
      model: 'Omni 1.1 Flash',
      serviceTier: 'SERVICE_TIER_INTERMEDIATE',
      aspectRatio: '16:9 (Landscape)',
      duration: '10 seconds',
      resolution: '720p',
      frameRate: '24 fps',
      nativeAudio: 'Enabled',
      estimatedCredits: '15 credits',
    },
  },
  {
    kind: 'i2v',
    title: 'Image to Video',
    subtitle: 'Animate an Image MediaRef',
    tone: 'green',
    group: 'Video',
    preview: 'video',
    config: { model: 'Omni Flash', serviceTier: 'SERVICE_TIER_INTERMEDIATE', duration: '8 seconds', aspectRatio: '16:9 (Landscape)', motion: 'Auto', imageSource: 'Input MediaRef' },
  },
  {
    kind: 'extend',
    title: 'Extend / Edit Video',
    subtitle: 'Continue or edit video',
    tone: 'orange',
    group: 'Video',
    preview: 'video',
    config: { model: 'Veo 3.1 - Fast', serviceTier: 'SERVICE_TIER_INTERMEDIATE', mode: 'Extend Forward', duration: '8 seconds', aspectRatio: '16:9 (Landscape)', frameRate: '24 fps', videoSource: 'Input MediaRef' },
  },
  {
    kind: 'interpolation',
    title: 'Start - End Frame',
    subtitle: 'Interpolate between two images',
    tone: 'green',
    group: 'Video',
    preview: 'video',
    config: { model: 'Veo 3.1 - Fast', serviceTier: 'SERVICE_TIER_INTERMEDIATE', duration: '8 seconds', aspectRatio: '16:9 (Landscape)', startImage: 'Input A', endImage: 'Input B' },
  },
  {
    kind: 'reference',
    title: 'Reference Images Video',
    subtitle: 'Generate video from references',
    tone: 'green',
    group: 'Video',
    preview: 'video',
    config: { model: 'Omni Flash', serviceTier: 'SERVICE_TIER_INTERMEDIATE', duration: '8 seconds', aspectRatio: '16:9 (Landscape)', usageType: 'ASSET', references: '1+ Image MediaRefs' },
  },
  {
    kind: 'videoUpscale',
    title: 'Video Upscale',
    subtitle: 'Upsample video to 1080p / 4K',
    tone: 'orange',
    group: 'Video',
    preview: 'video',
    experimental: true,
    config: { targetResolution: '1080p', model: 'Veo 3.1 - Upsampler 1080P', serviceTier: 'SERVICE_TIER_INTERMEDIATE', duration: '60 seconds', aspectRatio: '16:9 (Landscape)', estimatedCredits: '0 credits', videoSource: 'Input MediaRef' },
  },
  {
    kind: 'cancelGeneration',
    title: 'Cancel Generation',
    subtitle: 'Attempt to cancel active media',
    tone: 'orange',
    group: 'Video',
    experimental: true,
    config: { mediaSource: 'Active MediaRef', behavior: 'Provider precondition applies' },
  },
  {
    kind: 'likenessCheck',
    title: 'Check Likeness Eligibility',
    subtitle: 'Verify account eligibility',
    tone: 'purple',
    group: 'Character',
    config: { populateImage: 'No', output: 'Eligibility Boolean' },
  },
  {
    kind: 'likenessList',
    title: 'List User Likenesses',
    subtitle: 'Load likeness records',
    tone: 'purple',
    group: 'Character',
    config: { populateImage: 'Yes', output: 'Likeness List' },
  },
  {
    kind: 'characterAssign',
    title: 'Assign Character Image',
    subtitle: 'Copy media into character slot',
    tone: 'blue',
    group: 'Character',
    preview: 'image',
    config: { characterId: 'Select Character', imageReferenceIndex: '1', mediaSource: 'Input MediaRef' },
  },
  {
    kind: 'characterCreate',
    title: 'Character Creation',
    subtitle: 'Experimental character surface',
    tone: 'orange',
    group: 'Character',
    preview: 'image',
    experimental: true,
    config: { displayName: 'Character name', primaryMedia: 'Input MediaRef', model: '🍌 Nano Banana 2', serviceTier: 'SERVICE_TIER_INTERMEDIATE', aspectRatio: '1:1 (Square)' },
  },
  {
    kind: 'creationAgent',
    title: 'Creation Agent',
    subtitle: 'Experimental SSE creative agent',
    tone: 'purple',
    group: 'Character',
    experimental: true,
    config: { mode: 'streamChat', session: 'Auto', input: 'Prompt / context' },
  },
  {
    kind: 'download',
    title: 'Download',
    subtitle: 'Export generated media',
    tone: 'blue',
    group: 'Utility',
    config: { format: 'Original media', fileName: 'flowgraph-output' },
  },
  {
    kind: 'condition',
    title: 'Condition',
    subtitle: 'Add local branching logic',
    tone: 'orange',
    group: 'Utility',
    experimental: true,
    config: { expression: 'status == success' },
  },
  {
    kind: 'delay',
    title: 'Delay',
    subtitle: 'Wait before continuing',
    tone: 'orange',
    group: 'Utility',
    config: { duration: '5 seconds' },
  },
  {
    kind: 'note',
    title: 'Note',
    subtitle: 'Annotate the workflow',
    tone: 'purple',
    group: 'Utility',
    config: { note: 'Add workflow documentation here.' },
  },
];

export function hydrateNodeData(spec: PaletteSpec, extra?: Partial<FlowNodeData>): FlowNodeData {
  const capability = capabilityFor(spec.kind);
  return {
    title: spec.title,
    kind: spec.kind,
    subtitle: spec.subtitle,
    tone: spec.tone,
    status: 'idle',
    config: deriveRegistryConfig(spec.kind, { ...spec.config }),
    preview: spec.preview,
    experimental: spec.experimental ?? capability.experimental,
    maturity: capability.maturity,
    capabilityLabel: capability.label,
    capabilitySummary: capability.summary,
    evidence: capability.evidence,
    isNew: spec.isNew,
    ...extra,
  };
}

const node = (id: string, kind: string, x: number, y: number, extra?: Partial<FlowNodeData>): FlowNode => {
  const spec = palette.find((item) => item.kind === kind)!;
  return {
    id,
    type: 'flowNode',
    position: { x, y },
    data: hydrateNodeData(spec, extra),
  };
};

// V1 real pipeline: Prompt → Text-to-Image → Image-to-Video → Download.
export const initialNodes: FlowNode[] = [
  node('1', 'prompt', 90, 90),
  node('2', 't2i', 400, 90),
  node('3', 'i2v', 710, 90),
  node('4', 'download', 1020, 90),
];

export const initialEdges: FlowEdge[] = [
  { id: 'e1-2', source: '1', sourceHandle: 'prompt', target: '2', targetHandle: 'prompt', type: 'smoothstep', animated: false, style: { stroke: '#9a52f8' } },
  { id: 'e2-3', source: '2', sourceHandle: 'image', target: '3', targetHandle: 'image', type: 'smoothstep', animated: false, style: { stroke: '#4e9fff' } },
  { id: 'e3-4', source: '3', sourceHandle: 'video', target: '4', targetHandle: 'media', type: 'smoothstep', animated: false, style: { stroke: '#3ad39c' } },
];

export function cloneInitialNodes(): FlowNode[] {
  return initialNodes.map((item) => ({
    ...item,
    data: { ...item.data, config: { ...item.data.config } },
    position: { ...item.position },
  }));
}
