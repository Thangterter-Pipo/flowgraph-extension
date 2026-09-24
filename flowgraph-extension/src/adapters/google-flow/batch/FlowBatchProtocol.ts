// Google Flow batchexecute protocol.
//
// Pure wire-format helpers only: no Chrome APIs, network, cookies, reCAPTCHA
// execution, or workflow state. Keeping this module deterministic makes it
// possible to lock captured Flow payloads with golden-wire tests.
//
// Reference implementation cross-checked against FlowKit main (Sep 2026), then
// adapted to FlowGraph's TypeScript provider boundary.

export const FLOW_BATCH_PATH = '/_/AiSandboxAngularFrontend/data/batchexecute';
export const FLOW_BATCH_MEDIA_HOST = 'flow-content.google';
export const FLOW_BATCH_CAPTCHA_SLOT = '__CAPTCHA__';

export const FLOW_BATCH_RPC = {
  GENERATE_IMAGE: 'ogiZ0b',
  GENERATE_VIDEO: 'eb1hJf',
  GENERATE_VIDEO_TEXT: 'YhhmEf',
  GENERATE_VIDEO_FIRST_LAST: 'nprQif',
  GENERATE_VIDEO_REFERENCES: 'MZZa6b',
  OPERATION: 'jwpduf',
  PROJECT_MEDIA: 'Zzl0ze',
  MEDIA: 'as29s',
  UPLOAD_IMAGE: 'maseQ',
  UPSCALE_IMAGE: 'SPrCad',
} as const;

export const FLOW_BATCH_CAPTCHA_ACTION = {
  IMAGE: 'IMAGE_GENERATION',
  VIDEO: 'VIDEO_GENERATION',
} as const;

export type FlowBatchRpcId = (typeof FLOW_BATCH_RPC)[keyof typeof FLOW_BATCH_RPC];

export interface FlowBatchRpcResult {
  rpcId: string;
  data: unknown;
  error?: unknown;
}

export interface FlowBatchGeneratedImage {
  mediaId: string;
  url: string;
}

export interface FlowBatchOperation {
  operationId: string;
  projectId?: string;
  status?: string;
  error?: string;
}

export interface FlowBatchMediaUrls {
  mediaId: string;
  video?: string;
  image?: string;
}

export type FlowBatchIdFactory = () => string;

const defaultIdFactory: FlowBatchIdFactory = () => crypto.randomUUID().toUpperCase();

const SURFACE_ID = 22;
const FULL_FRAME_CROP = [null, 0.0038759689922481244, 1, 0.9961240310077519] as const;
const REF_TYPE_IMAGE = 1;
const BASE_TYPE_IMAGE = 2;

const IMAGE_MODEL_ALIASES: Readonly<Record<string, string>> = {
  NANO_BANANA_PRO: 'GEM_PIX_2',
  NANO_BANANA_2: 'NARWHAL',
  NANO_BANANA_2_LITE: 'HARBOR_SEAL',
  NANO_BANANA_LITE: 'HARBOR_SEAL',
};

const IMAGE_MODEL_ID_RE = /^[A-Z][A-Z0-9_]{1,95}$/;

const IMAGE_ASPECT_BY_NAME: Readonly<Record<string, number>> = {
  IMAGE_ASPECT_RATIO_SQUARE: 1,
  IMAGE_ASPECT_RATIO_PORTRAIT: 2,
  IMAGE_ASPECT_RATIO_LANDSCAPE: 3,
  IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR: 4,
  IMAGE_ASPECT_RATIO_PORTRAIT_FOUR_THREE: 4,
  IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE: 5,
  '1:1': 1,
  '9:16': 2,
  '16:9': 3,
  '3:4': 4,
  '4:3': 5,
};

const VIDEO_ASPECT_BY_NAME: Readonly<Record<string, number>> = {
  VIDEO_ASPECT_RATIO_PORTRAIT: 1,
  VIDEO_ASPECT_RATIO_LANDSCAPE: 2,
  '9:16': 1,
  '16:9': 2,
};

export class FlowBatchProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowBatchProtocolError';
  }
}

export class FlowBatchRpcError extends Error {
  constructor(
    public readonly rpcId: string,
    public readonly detail: unknown,
  ) {
    super(`${rpcId} failed: ${JSON.stringify(detail)}`);
    this.name = 'FlowBatchRpcError';
  }
}

export function resolveFlowImageModel(model?: string): string {
  if (typeof model !== 'string') return 'GEM_PIX_2';
  const normalized = model.trim().toUpperCase().replace(/-/g, '_');
  if (IMAGE_MODEL_ALIASES[normalized]) return IMAGE_MODEL_ALIASES[normalized];
  if (IMAGE_MODEL_ID_RE.test(normalized)) return normalized;
  return 'GEM_PIX_2';
}

export function resolveFlowImageAspect(aspect: unknown): number {
  if (typeof aspect === 'number' && Number.isInteger(aspect) && aspect >= 1 && aspect <= 5) {
    return aspect;
  }
  const key = typeof aspect === 'string'
    ? (aspect.match(/\b(?:1:1|9:16|16:9|3:4|4:3)\b/)?.[0] ?? aspect.trim())
    : '';
  const value = IMAGE_ASPECT_BY_NAME[key];
  if (value) return value;
  throw new FlowBatchProtocolError(`Unknown image aspect: ${String(aspect)}`);
}

export function resolveFlowFirstLastModelKey(model: string): string {
  const key = String(model || '').trim();
  const match = key.match(/^abra_i2v_(4|6|8|10)s(_360p)?$/i);
  if (match) {
    return `omni_flash_i2v_${match[1]}s_first_last${match[2] ?? ''}`;
  }
  return key;
}

export function resolveFlowVideoAspect(aspect: unknown): number {
  if (aspect === 1 || aspect === 2) return aspect;
  const key = typeof aspect === 'string'
    ? (aspect.match(/\b(?:9:16|16:9)\b/)?.[0] ?? aspect.trim())
    : '';
  const value = VIDEO_ASPECT_BY_NAME[key];
  if (value) return value;
  throw new FlowBatchProtocolError(`Unknown video aspect: ${String(aspect)}`);
}

export function buildFlowBatchEnvelope(rpcId: string, inner: unknown): string {
  return JSON.stringify([[[rpcId, JSON.stringify(inner), null, 'generic']]]);
}

function context(projectId: string | null): unknown[] {
  return [null, SURFACE_ID, null, null, null, projectId, null, null, null, null, [FLOW_BATCH_CAPTCHA_SLOT, 1]];
}

function imageInput(mediaId: string, inputType: number): unknown[] {
  return [mediaId, null, null, null, inputType];
}

export interface BuildFlowImageRequestOptions {
  prompt: string;
  projectId: string;
  model?: string;
  aspect?: string | number;
  seed?: number;
  referenceMediaIds?: string[];
  baseMediaId?: string;
  idFactory?: FlowBatchIdFactory;
}

/**
 * Build one image-generation RPC. The current Flow UI submits x2/x3/x4 as
 * independent single-image RPCs, each with a fresh reCAPTCHA token; callers
 * should schedule multiple calls rather than packing variants into this one.
 */
export function buildFlowImageRequest(options: BuildFlowImageRequestOptions): string {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const inputs: unknown[] = [];
  if (options.baseMediaId) inputs.push(imageInput(options.baseMediaId, BASE_TYPE_IMAGE));
  for (const mediaId of options.referenceMediaIds ?? []) {
    if (mediaId && mediaId !== options.baseMediaId) inputs.push(imageInput(mediaId, REF_TYPE_IMAGE));
  }

  const item = [
    null,
    null,
    inputs.length ? inputs : null,
    options.seed ?? Math.floor(Math.random() * 1_000_000_000) + 1,
    resolveFlowImageAspect(options.aspect ?? '1:1'),
    resolveFlowImageModel(options.model),
    null,
    context(options.projectId),
    [[[options.prompt]]],
    null,
    null,
    null,
    idFactory(),
    idFactory(),
  ];

  return buildFlowBatchEnvelope(FLOW_BATCH_RPC.GENERATE_IMAGE, [
    null,
    [item],
    1,
    context(options.projectId),
    [idFactory()],
  ]);
}

export interface BuildFlowVideoRequestOptions {
  prompt: string;
  projectId: string;
  sourceMediaId: string;
  model: string;
  aspect?: string | number;
  crop?: readonly unknown[];
  idFactory?: FlowBatchIdFactory;
}

export function buildFlowFirstFrameVideoRequest(options: BuildFlowVideoRequestOptions): string {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const request = [
    [null, null, [[[options.prompt]]]],
    options.model,
    resolveFlowVideoAspect(options.aspect ?? '16:9'),
    null,
    [null, options.sourceMediaId, null, null, null, options.crop ?? FULL_FRAME_CROP],
    [null, null, null, null, idFactory(), idFactory()],
  ];

  return buildFlowBatchEnvelope(FLOW_BATCH_RPC.GENERATE_VIDEO, [
    [request],
    context(options.projectId),
    [idFactory(), 2],
  ]);
}

export interface BuildFlowTextVideoRequestOptions {
  prompt: string;
  projectId: string;
  model: string;
  aspect?: string | number;
  idFactory?: FlowBatchIdFactory;
}

export function buildFlowTextVideoRequest(options: BuildFlowTextVideoRequestOptions): string {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const request = [
    [null, null, [[[options.prompt]]]],
    options.model,
    resolveFlowVideoAspect(options.aspect ?? '16:9'),
    null,
    [null, null, null, null, idFactory(), idFactory()],
  ];

  return buildFlowBatchEnvelope(FLOW_BATCH_RPC.GENERATE_VIDEO_TEXT, [
    [request],
    context(options.projectId),
    [idFactory(), 1],
  ]);
}

export interface BuildFlowFirstLastVideoRequestOptions {
  prompt: string;
  projectId: string;
  startMediaId: string;
  endMediaId: string;
  model: string;
  aspect?: string | number;
  startCrop?: readonly unknown[];
  endCrop?: readonly unknown[];
  idFactory?: FlowBatchIdFactory;
}

export function buildFlowFirstLastVideoRequest(options: BuildFlowFirstLastVideoRequestOptions): string {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const request = [
    [null, null, [[[options.prompt]]]],
    options.model,
    resolveFlowVideoAspect(options.aspect ?? '16:9'),
    null,
    [null, options.startMediaId, null, null, null, options.startCrop ?? FULL_FRAME_CROP],
    [null, options.endMediaId, null, null, null, options.endCrop ?? FULL_FRAME_CROP],
    [null, null, null, null, idFactory(), idFactory()],
  ];

  return buildFlowBatchEnvelope(FLOW_BATCH_RPC.GENERATE_VIDEO_FIRST_LAST, [
    [request],
    context(options.projectId),
    [idFactory(), 2],
  ]);
}

export interface BuildFlowReferenceVideoRequestOptions {
  prompt: string;
  projectId: string;
  referenceMediaIds: string[];
  model: string;
  aspect?: string | number;
  idFactory?: FlowBatchIdFactory;
}

export function buildFlowReferenceVideoRequest(options: BuildFlowReferenceVideoRequestOptions): string {
  const refs = options.referenceMediaIds.filter(Boolean);
  if (!refs.length) throw new FlowBatchProtocolError('Reference video requires at least one image.');
  const idFactory = options.idFactory ?? defaultIdFactory;
  const request = [
    [null, null, [[[options.prompt]]]],
    refs.map((mediaId) => [null, mediaId]),
    options.model,
    resolveFlowVideoAspect(options.aspect ?? '16:9'),
    null,
    [null, null, null, null, idFactory(), idFactory()],
  ];

  return buildFlowBatchEnvelope(FLOW_BATCH_RPC.GENERATE_VIDEO_REFERENCES, [
    [request],
    context(options.projectId),
    [idFactory(), 2],
  ]);
}

export function buildFlowOperationRequest(operationId: string): string {
  return buildFlowBatchEnvelope(FLOW_BATCH_RPC.OPERATION, [null, null, [[operationId]]]);
}

export function buildFlowProjectMediaRequest(projectId: string): string {
  return buildFlowBatchEnvelope(FLOW_BATCH_RPC.PROJECT_MEDIA, [`projects/${projectId}`, null, null, null, [1]]);
}

export function buildFlowMediaRequest(mediaId: string): string {
  return buildFlowBatchEnvelope(FLOW_BATCH_RPC.MEDIA, [mediaId]);
}

function walkStrings(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (!Array.isArray(node)) return [];
  return node.flatMap((item) => walkStrings(item));
}

function walkLists(node: unknown): unknown[][] {
  if (!Array.isArray(node)) return [];
  return [node, ...node.flatMap((item) => walkLists(item))];
}

export function parseFlowBatchEnvelope(text: string): FlowBatchRpcResult[] {
  if (!text) return [];
  // Responses start with )]}' followed by line-delimited length-prefixed JSON
  // chunks. Length prefixes are not trusted because escaped payloads can make
  // them disagree; scan for decodable JSON arrays instead.
  const body = text.startsWith(")]}'") ? text.slice(text.indexOf('\n') + 1) : text;
  const results: FlowBatchRpcResult[] = [];

  let index = 0;
  while (index < body.length) {
    const start = body.indexOf('[', index);
    if (start < 0) break;

    // JavaScript has no stdlib raw_decode equivalent. Walk candidate endings
    // until a full JSON chunk parses. Batchexecute chunks are line-delimited,
    // so try each subsequent line boundary first.
    let parsed: unknown = null;
    let consumedEnd = -1;
    let probe = body.indexOf('\n', start);
    while (probe >= 0) {
      const candidate = body.slice(start, probe).trim();
      try {
        parsed = JSON.parse(candidate);
        consumedEnd = probe + 1;
        break;
      } catch {
        probe = body.indexOf('\n', probe + 1);
      }
    }
    if (consumedEnd < 0) {
      const candidate = body.slice(start).trim();
      try {
        parsed = JSON.parse(candidate);
        consumedEnd = body.length;
      } catch {
        index = start + 1;
        continue;
      }
    }

    index = consumedEnd;
    if (!Array.isArray(parsed)) continue;

    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry[0] !== 'wrb.fr') continue;
      const rpcId = typeof entry[1] === 'string' ? entry[1] : '?';
      const payload = entry[2];
      if (payload == null) {
        results.push({ rpcId, data: null, error: entry[5] ?? true });
        continue;
      }
      if (typeof payload === 'string') {
        try {
          results.push({ rpcId, data: JSON.parse(payload) });
        } catch {
          results.push({ rpcId, data: payload });
        }
      } else {
        results.push({ rpcId, data: payload });
      }
    }
  }

  return results;
}

export function firstFlowBatchPayload(text: string, rpcId: string): unknown {
  const result = parseFlowBatchEnvelope(text).find((candidate) => candidate.rpcId === rpcId);
  if (!result) throw new FlowBatchProtocolError(`No ${rpcId} envelope in response`);
  if (result.error !== undefined) throw new FlowBatchRpcError(rpcId, result.error);
  return result.data;
}

export function readFlowGeneratedImages(payload: unknown): FlowBatchGeneratedImage[] {
  const seen = new Set<string>();
  const result: FlowBatchGeneratedImage[] = [];

  for (const value of walkStrings(payload)) {
    const marker = `${FLOW_BATCH_MEDIA_HOST}/image/`;
    if (!value.includes(marker)) continue;
    const mediaId = value.split(marker, 2)[1]?.split('?', 1)[0];
    if (!mediaId || seen.has(mediaId)) continue;
    seen.add(mediaId);
    result.push({ mediaId, url: value });
  }

  return result;
}

export interface FlowBatchTextVideoSubmit {
  mediaId: string;
  projectId?: string;
  workflowId?: string;
  status?: string;
}

export function readFlowTextVideoSubmit(payload: unknown): FlowBatchTextVideoSubmit {
  const root = Array.isArray(payload) ? payload : [];
  const records = Array.isArray(root[3]) ? root[3] : [];
  const record = Array.isArray(records[0]) ? records[0] : null;
  if (!record || typeof record[0] !== 'string' || !record[0]) {
    throw new FlowBatchProtocolError('Text-video submit carried no media id.');
  }

  return {
    mediaId: record[0],
    projectId: typeof record[1] === 'string' ? record[1] : undefined,
    workflowId: typeof record[2] === 'string' ? record[2] : record[0],
    status: typeof record[3] === 'string' ? record[3] : undefined,
  };
}

export function readFlowOperation(payload: unknown): FlowBatchOperation {
  const root = Array.isArray(payload) ? payload : [];
  const records = Array.isArray(root[2]) ? root[2] : [];
  const record = Array.isArray(records[0]) ? records[0] : null;
  if (!record || typeof record[0] !== 'string') {
    throw new FlowBatchProtocolError('Operation payload carried no operation id');
  }

  let error: string | undefined;
  const detail = record[5];
  if (Array.isArray(detail) && Array.isArray(detail[8]) && detail[8][0] === 4) {
    error = walkStrings(detail[8])[0] ?? 'operation complaint';
  }

  return {
    operationId: record[0],
    projectId: typeof record[1] === 'string' ? record[1] : undefined,
    status: typeof record[3] === 'string' ? record[3] : undefined,
    error,
  };
}

export function findFlowMediaId(payload: unknown, operationId: string): string | undefined {
  for (const node of walkLists(payload)) {
    if (node.length < 4 || node[0] !== operationId || !Array.isArray(node[3])) continue;
    const detail = node[3] as unknown[];
    if (typeof detail[4] === 'string') return detail[4];
  }
  return undefined;
}

const MEDIA_SLOT_RE = /null,null,\\?"([0-9a-fA-F-]{36})\\?"/;

export function findFlowMediaIdInText(text: string, operationId: string): string | undefined {
  const start = text.indexOf(operationId);
  if (start < 0) return undefined;
  return MEDIA_SLOT_RE.exec(text.slice(start, start + 800))?.[1];
}

export function readFlowMediaUrls(payload: unknown, mediaId: string): FlowBatchMediaUrls {
  const result: FlowBatchMediaUrls = { mediaId };
  for (const value of walkStrings(payload)) {
    if (!value.startsWith('https://')) continue;
    if (!result.video && value.includes(`${FLOW_BATCH_MEDIA_HOST}/video/`)) result.video = value;
    else if (!result.image && value.includes(`${FLOW_BATCH_MEDIA_HOST}/image/`)) result.image = value;
  }
  return result;
}
