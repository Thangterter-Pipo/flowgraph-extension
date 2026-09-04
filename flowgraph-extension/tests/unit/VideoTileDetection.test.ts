import { describe, expect, it } from 'vitest';
import {
  decideVideoTileArrival,
  editorPromptMatches,
  isEditorPlaceholder,
} from '../../src/background/videoTileDetection';

// Token shapes copied from live flow.google gallery probing: same-origin /asb/
// proxy posters, and a lazy tile whose poster has not loaded yet ('').
const A = 'asb:AB-nOUYjw-XT7-';
const B = 'asb:AB-nOUbe8StyNJ';
const C = 'asb:AB-nOUY_WFGjSW';

describe('video tile arrival detection (FG-1505 I2V)', () => {
  it('treats a growing tile list as a finished render and checks newest-first first', () => {
    const verdict = decideVideoTileArrival({ tokens: [A, B, C] }, { tokens: ['asb:NEW', A, B, C] });
    expect(verdict.grew).toBe(true);
    expect(verdict.candidates).toEqual([0, 1, 2, 3]);
  });

  it('still proposes the newest tile when its lazy poster has not loaded yet', () => {
    // The new tile is at index 0 with an empty src, so no token explains it.
    const verdict = decideVideoTileArrival({ tokens: [A, B] }, { tokens: ['', A, B] });
    expect(verdict.grew).toBe(true);
    expect(verdict.unknownIndexes).toEqual([]);
    expect(verdict.candidates[0]).toBe(0);
  });

  it('does not fail a node when signed posters merely rotate', () => {
    const verdict = decideVideoTileArrival({ tokens: [A, B] }, { tokens: ['asb:RESIGNED', B] });
    expect(verdict.grew).toBe(false);
    expect(verdict.candidates).toEqual([]);
    expect(verdict.rotated).toBe(true);
  });

  it('reports no change for an identical snapshot', () => {
    const verdict = decideVideoTileArrival({ tokens: [A, B, ''] }, { tokens: [A, B, ''] });
    expect(verdict).toEqual({ grew: false, unknownIndexes: [], candidates: [], rotated: false });
  });

  it('caps the candidate list so a re-render storm cannot open every tile', () => {
    const before = { tokens: [A] };
    const now = { tokens: ['t0', 't1', 't2', 't3', 't4', A] };
    const verdict = decideVideoTileArrival(before, now);
    expect(verdict.grew).toBe(true);
    expect(verdict.candidates).toEqual([0, 1, 2, 3]);
  });
});

describe('editor prompt attribution', () => {
  const prompt = 'A futuristic sports car driving on a wet neon-lit street at night';

  it('accepts the editor prompt for the clip we submitted', () => {
    expect(editorPromptMatches(prompt, prompt)).toBe(true);
  });

  it('accepts whitespace-normalised composer text', () => {
    expect(editorPromptMatches(`  ${prompt.replace(' ', '\n')}  `, prompt)).toBe(true);
  });

  it('rejects an unrelated older clip', () => {
    expect(editorPromptMatches('Red paper boat floating lake', prompt)).toBe(false);
  });

  it('cannot be satisfied by an empty prompt on either side', () => {
    expect(editorPromptMatches('', prompt)).toBe(false);
    expect(editorPromptMatches(prompt, '   ')).toBe(false);
  });
});

// Live bug (run a82e1b01): the /edit/<mediaId> composer holds a localised
// placeholder, not the clip prompt, so every tile compared as a mismatch.
describe('editor placeholder filtering', () => {
  it('recognises the Vietnamese composer placeholder', () => {
    expect(isEditorPlaceholder('Mô tả cách chỉnh sửa video này…')).toBe(true);
  });

  it('recognises the English composer placeholder', () => {
    expect(isEditorPlaceholder('Describe how to edit this video')).toBe(true);
  });

  it('treats blank text as unusable rather than as a prompt', () => {
    expect(isEditorPlaceholder('   ')).toBe(true);
  });

  it('keeps a real clip prompt', () => {
    expect(isEditorPlaceholder('A cinematic red paper boat floating on a calm lake')).toBe(false);
  });
});
