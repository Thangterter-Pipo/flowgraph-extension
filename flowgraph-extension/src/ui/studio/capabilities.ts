export type CapabilityMaturity =
  | 'RUNTIME_VERIFIED'
  | 'RUNTIME_PARTIAL'
  | 'BUNDLE_VERIFIED'
  | 'LOCAL_UTILITY';

export interface CapabilityMeta {
  maturity: CapabilityMaturity;
  label: string;
  experimental: boolean;
  summary: string;
  evidence?: string;
  added?: string;
}

export const capabilityRegistry: Record<string, CapabilityMeta> = {
  prompt: {
    maturity: 'LOCAL_UTILITY',
    label: 'LOCAL',
    experimental: false,
    summary: 'Local workflow prompt input.',
  },
  gemini: {
    maturity: 'LOCAL_UTILITY',
    label: 'AI',
    experimental: false,
    summary: 'Prompt enhancement through the Gemini adapter.',
  },
  uploadImage: {
    maturity: 'RUNTIME_VERIFIED',
    label: 'VERIFIED',
    experimental: false,
    summary: 'Google Flow image upload using imageBytes.',
    evidence: '§6.1 Image Upload',
  },
  t2i: {
    maturity: 'RUNTIME_VERIFIED',
    label: 'VERIFIED',
    experimental: false,
    summary: 'Text-to-Image via flowMedia:batchGenerateImages.',
    evidence: '§7.1 Text-to-Image',
  },
  t2v: {
    maturity: 'RUNTIME_PARTIAL',
    label: 'EXPERIMENTAL',
    experimental: false,
    summary: 'Text-to-Video executor wired; awaiting live Google Flow verification. Includes Veo 3.1 and Omni 1.1 Flash model profiles.',
    evidence: '§8.1 / §8.7 Text-to-Video (payload verified; live runtime pending)',
  },
  i2v: {
    maturity: 'RUNTIME_VERIFIED',
    label: 'VERIFIED',
    experimental: false,
    summary: 'Image-to-Video with startImage.mediaId.',
    evidence: '§8.2 Image-to-Video',
  },
  interpolation: {
    maturity: 'RUNTIME_VERIFIED',
    label: 'VERIFIED',
    experimental: false,
    summary: 'Start + End frame interpolation using mediaId references.',
    evidence: '§8.3 Start + End Interpolation (Live Runs 1 & 2 verified 2026-09-05)',
  },
  reference: {
    maturity: 'RUNTIME_VERIFIED',
    label: 'VERIFIED',
    experimental: false,
    summary: 'Reference-image video generation with referenceImages[].mediaId.',
    evidence: '§8.4 Reference Images Video',
  },
  extend: {
    maturity: 'RUNTIME_VERIFIED',
    label: 'VERIFIED',
    experimental: false,
    summary: 'Extend/Edit Video with videoInput.mediaId.',
    evidence: '§8.5 Video Extension & Edit',
  },
  imageTransform: {
    maturity: 'RUNTIME_PARTIAL',
    label: 'EXPERIMENTAL',
    experimental: true,
    summary: 'Image transform/crop shape partially verified; successful end-to-end artifact path is not closed.',
    evidence: '§7.2 Image Transform',
  },
  imageUpscale: {
    maturity: 'RUNTIME_PARTIAL',
    label: 'EXPERIMENTAL',
    experimental: true,
    summary: 'Image Upscale (2K/4K) executor wired with exact upstream IMAGE MediaRef; waiting for live provider verification.',
    evidence: '§7.3 Image Upsample 2K/4K (FG-1205)',
  },
  videoUpscale: {
    maturity: 'RUNTIME_PARTIAL',
    label: 'EXPERIMENTAL',
    experimental: true,
    summary: 'Video Upscale (1080p/4K) executor wired with exact upstream VIDEO MediaRef; waiting for live provider verification.',
    evidence: '§8.6 Video Upsample (FG-1205)',
  },
  cancelGeneration: {
    maturity: 'RUNTIME_PARTIAL',
    label: 'EXPERIMENTAL',
    experimental: true,
    summary: 'cancelGeneration accepts mediaId but current runtime attempts return FAILED_PRECONDITION.',
    evidence: '§14 Cancel Generation',
  },
  likenessCheck: {
    maturity: 'RUNTIME_VERIFIED',
    label: 'VERIFIED',
    experimental: false,
    summary: 'Checks whether the current account is eligible for likeness features.',
    evidence: '§10.1 Likeness Eligibility',
  },
  likenessList: {
    maturity: 'RUNTIME_VERIFIED',
    label: 'VERIFIED',
    experimental: false,
    summary: 'Lists user likeness records with optional populated images.',
    evidence: '§10.2 List User Likenesses',
  },
  characterAssign: {
    maturity: 'RUNTIME_VERIFIED',
    label: 'VERIFIED',
    experimental: false,
    summary: 'Assigns project media to a Character image slot using flow:copyProjectMedia.',
    evidence: '§10.3 Assign Image to Character Slot',
  },
  characterCreate: {
    maturity: 'RUNTIME_PARTIAL',
    label: 'EXPERIMENTAL',
    experimental: true,
    summary: 'Overall Character/Likeness creation surface remains runtime-partial.',
    evidence: '§10.4 Character Creation Surface',
  },
  creationAgent: {
    maturity: 'RUNTIME_PARTIAL',
    label: 'EXPERIMENTAL',
    experimental: true,
    summary: 'Creation Agent SSE endpoint is documented, but it is not required for the stable MVP execution path.',
    evidence: '§17 Creation Agent SSE',
  },
  download: {
    maturity: 'RUNTIME_VERIFIED',
    label: 'VERIFIED',
    experimental: false,
    summary: 'Media redirect/download pipeline is runtime verified.',
    evidence: '§15 Download Pipeline',
  },
  condition: {
    maturity: 'LOCAL_UTILITY',
    label: 'LOCAL',
    experimental: true,
    summary: 'Local workflow branching concept; not a Google Flow API.',
  },
  delay: {
    maturity: 'LOCAL_UTILITY',
    label: 'LOCAL',
    experimental: false,
    summary: 'Local workflow delay utility.',
  },
  note: {
    maturity: 'LOCAL_UTILITY',
    label: 'LOCAL',
    experimental: false,
    summary: 'Local workflow annotation node.',
  },
};

export function capabilityFor(kind: string): CapabilityMeta {
  return capabilityRegistry[kind] ?? {
    maturity: 'LOCAL_UTILITY',
    label: 'LOCAL',
    experimental: false,
    summary: 'Local workflow capability.',
  };
}

// FG-1603 capability matrix — what the current runtime actually EXECUTES.
// RUNTIME_VERIFIED = executor + real adapter path implemented and contract-tested;
// the execution itself must still be proven against a live Flow session (Milestone A).
export type RuntimeCapabilityClass = 'RUNTIME_VERIFIED' | 'RUNTIME_PARTIAL' | 'UI_ONLY' | 'COMING_SOON';

export interface RuntimeCapabilityRow {
  kind: string;
  runtime: RuntimeCapabilityClass;
  executor: boolean;
  adapter: boolean;
  note: string;
}

export const runtimeCapabilityMatrix: RuntimeCapabilityRow[] = [
  { kind: 'prompt', runtime: 'RUNTIME_VERIFIED', executor: true, adapter: false, note: 'Local text output.' },
  { kind: 't2i', runtime: 'RUNTIME_VERIFIED', executor: true, adapter: true, note: 'Real Flow UI generation (CDP text insert + trusted Generate click); live Runs 1-7.' },
  { kind: 'i2v', runtime: 'RUNTIME_VERIFIED', executor: true, adapter: true, note: 'Exact upstream IMAGE mediaId selected in the Flow gallery, then UI generate; live Runs 1-7.' },
  { kind: 'download', runtime: 'RUNTIME_VERIFIED', executor: true, adapter: true, note: 'Trusted tile click + Fetch-intercepted signed URL + chrome.downloads; live Runs 1-7 (mp4 on disk).' },
  { kind: 't2v', runtime: 'RUNTIME_VERIFIED', executor: true, adapter: true, note: 'Flow UI VIDEO mode + poll; 3 fresh live runs.' },
  { kind: 'extend', runtime: 'RUNTIME_VERIFIED', executor: true, adapter: true, note: 'Extend Forward and Edit Video executor + UI binding; live Runs 1 & 2 verified 2026-09-05.' },
  { kind: 'interpolation', runtime: 'RUNTIME_VERIFIED', executor: true, adapter: true, note: 'Start + End Frame interpolation executor + UI binding; live Runs 1 & 2 verified 2026-09-05.' },
  { kind: 'reference', runtime: 'RUNTIME_VERIFIED', executor: true, adapter: true, note: 'Ordered Reference Images video executor + UI binding; live Runs 1 & 2 verified 2026-09-05.' },
  { kind: 'upscale', runtime: 'RUNTIME_PARTIAL', executor: true, adapter: true, note: 'Video upscale executor (1080p/4K) wired; live verification pending.' },
  { kind: 'uploadImage', runtime: 'UI_ONLY', executor: false, adapter: true, note: 'uploadImage adapter implemented; node executor not enabled in V1.' },
  { kind: 'imageTransform', runtime: 'RUNTIME_PARTIAL', executor: false, adapter: false, note: 'Provider shape partially verified (HTTP 400 on incomplete payload).' },
  { kind: 'imageUpscale', runtime: 'RUNTIME_PARTIAL', executor: true, adapter: true, note: 'Image upscale executor (2K/4K) wired; live verification pending.' },
  { kind: 'cancelGeneration', runtime: 'RUNTIME_PARTIAL', executor: false, adapter: true, note: 'cancelGeneration verified shape; FAILED_PRECONDITION on terminal media.' },
  { kind: 'gemini', runtime: 'UI_ONLY', executor: false, adapter: false, note: 'Gemini enhance UI; adapter interface only.' },
  { kind: 'likenessCheck', runtime: 'UI_ONLY', executor: false, adapter: false, note: 'Eligibility API verified; no executor in V1.' },
  { kind: 'likenessList', runtime: 'UI_ONLY', executor: false, adapter: false, note: 'List API verified; no executor in V1.' },
  { kind: 'characterAssign', runtime: 'UI_ONLY', executor: false, adapter: false, note: 'copyProjectMedia verified; no executor in V1.' },
  { kind: 'characterCreate', runtime: 'RUNTIME_PARTIAL', executor: false, adapter: false, note: 'Character surface partial.' },
  { kind: 'creationAgent', runtime: 'UI_ONLY', executor: false, adapter: false, note: 'SSE endpoint documented; not in V1 path.' },
  { kind: 'condition', runtime: 'UI_ONLY', executor: false, adapter: false, note: 'Local branch concept (Phase 13).' },
  { kind: 'delay', runtime: 'UI_ONLY', executor: false, adapter: false, note: 'Local utility (Phase 13).' },
  { kind: 'note', runtime: 'UI_ONLY', executor: false, adapter: false, note: 'Local annotation.' },
];

export function runtimeClassFor(kind: string): RuntimeCapabilityClass {
  return runtimeCapabilityMatrix.find((row) => row.kind === kind)?.runtime ?? 'COMING_SOON';
}

