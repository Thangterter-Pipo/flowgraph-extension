// Runtime value model — normalized values flowing between node outputs and inputs (FG-0302).
import type { RuntimeInputValue } from '../engine/execution/NodeExecutor';

export type RuntimeValueType = 'text' | 'image' | 'video' | 'media' | 'file' | 'character' | 'number' | 'boolean' | 'json';

export interface RuntimeMediaRef {
  provider: 'GOOGLE_FLOW';
  mediaId: string;
  type: 'IMAGE' | 'VIDEO';
  projectId: string;
  workflowId?: string;
  /** Transient signed CDN preview URL — never persisted to workflow storage. */
  previewUrl?: string;
  mimeType?: string;
  fileName?: string;
}

export interface RuntimeValue {
  type: RuntimeValueType;
  value: string | number | boolean | RuntimeMediaRef | Record<string, unknown> | null;
}

export function textValue(text: string): RuntimeValue {
  return { type: 'text', value: text };
}

export function numberValue(number: number): RuntimeValue {
  return { type: 'number', value: number };
}

export function booleanValue(boolean: boolean): RuntimeValue {
  return { type: 'boolean', value: boolean };
}

export function mediaValue(media: RuntimeMediaRef): RuntimeValue {
  return { type: media.type === 'IMAGE' ? 'image' : 'video', value: media };
}

/** Build a runtime media value from a normalized media ref payload (bridge/success output). */
export function mediaRefFromPayload(media: Omit<RuntimeMediaRef, 'provider'> & { provider?: 'GOOGLE_FLOW' }): RuntimeValue {
  if (!media.mediaId) throw new Error('Media payload is missing mediaId — cannot build a runtime media value');
  return mediaValue({
    provider: 'GOOGLE_FLOW',
    mediaId: media.mediaId,
    type: media.type,
    projectId: media.projectId,
    workflowId: media.workflowId,
    previewUrl: media.previewUrl,
    mimeType: media.mimeType,
    fileName: media.fileName,
  });
}

export function asText(value: RuntimeInputValue | undefined): string | undefined {
  if (!value) return undefined;
  const single = Array.isArray(value) ? value[0] : value;
  if (single && single.type === 'text') return String(single.value);
  return undefined;
}

export function asMedia(value: RuntimeInputValue | undefined): RuntimeMediaRef | undefined {
  if (!value) return undefined;
  const single = Array.isArray(value) ? value[0] : value;
  if (!single) return undefined;
  if (single.type === 'image' || single.type === 'video' || single.type === 'media') {
    const media = single.value as RuntimeMediaRef | null;
    if (media && typeof media === 'object' && 'mediaId' in media) return media;
  }
  return undefined;
}

export function asMediaList(value: RuntimeInputValue | undefined): RuntimeMediaRef[] {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  const result: RuntimeMediaRef[] = [];
  for (const item of items) {
    if (item.type === 'image' || item.type === 'video' || item.type === 'media') {
      const media = item.value as RuntimeMediaRef | null;
      if (media && typeof media === 'object' && 'mediaId' in media) {
        result.push(media);
      }
    }
  }
  return result;
}

export function valueTypeOf(value: RuntimeValue): RuntimeValueType {
  return value.type;
}

export function isImageMedia(value: RuntimeValue | undefined): value is RuntimeValue {
  return value?.type === 'image';
}

export function isVideoMedia(value: RuntimeValue | undefined): value is RuntimeValue {
  return value?.type === 'video';
}

/** Normalized result shape for node UI preview (type mirrors ui model's NodeMediaResult fields only). */
export function runtimeValueToResult(value: RuntimeValue): {
  type: 'image' | 'video';
  mediaId?: string;
  previewUrl: string;
  mimeType?: string;
  fileName?: string;
} | undefined {
  const media = asMedia(value);
  if (!media) return undefined;
  return {
    type: media.type === 'VIDEO' ? 'video' : 'image',
    mediaId: media.mediaId,
    previewUrl: media.previewUrl ?? '',
    mimeType: media.mimeType,
    fileName: media.fileName,
  };
}

export interface CharacterDnaRecord {
  characterId?: string;
  displayName?: string;
  dnaText: string;
}

export function extractCharacterDna(input: RuntimeInputValue | undefined): string[] {
  if (!input) return [];
  const items = Array.isArray(input) ? input : [input];
  const dnaBlocks: string[] = [];
  for (const item of items) {
    const raw = (item && typeof item === 'object' && 'value' in item) ? item.value : item;
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (typeof obj.dnaText === 'string' && obj.dnaText.trim()) {
        const label = String(obj.characterId || obj.displayName || 'CHARACTER');
        dnaBlocks.push(`[CHARACTER DNA: ${label}]\n${obj.dnaText}`);
      }
    }
  }
  return dnaBlocks;
}

export function mergeCharacterDna(prompt: string, characterInput: RuntimeInputValue | undefined, executionHeader = 'SCENE EXECUTION'): string {
  const dnaBlocks = extractCharacterDna(characterInput);
  if (!dnaBlocks.length) return prompt;
  return `${dnaBlocks.join('\n\n')}\n\n[${executionHeader}]\n${prompt}`;
}
