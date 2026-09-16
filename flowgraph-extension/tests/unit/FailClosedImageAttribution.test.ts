import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decideVideoTileArrival,
  editorPromptMatches,
  selectAttributedImageMediaId,
} from '../../src/background/videoTileDetection';

const workerSource = () => readFileSync(resolve(__dirname, '../../src/background/service-worker.ts'), 'utf8');

describe('fail-closed image result attribution', () => {
  const prompt = 'A serene paper boat on a calm lake at sunrise';

  it('unrelated new image without request/prompt attribution is not claimed', () => {
    const selected = selectAttributedImageMediaId({
      candidates: [
        { mediaId: 'unrelated-img-1', editorPrompt: 'A futuristic electric hypercar' },
        { mediaId: 'unrelated-img-2', editorPrompt: '' },
      ],
      expectedPrompt: prompt,
    });
    expect(selected).toBeUndefined();
  });

  it('returns candidate proven to match the submitted prompt', () => {
    const selected = selectAttributedImageMediaId({
      candidates: [
        { mediaId: 'unrelated-img-1', editorPrompt: 'A futuristic electric hypercar' },
        { mediaId: 'proven-img-2', editorPrompt: 'A serene paper boat on a calm lake at sunrise' },
      ],
      expectedPrompt: prompt,
    });
    expect(selected).toBe('proven-img-2');
  });

  it('selects only the matching candidate when multiple new images arrive', () => {
    const selected = selectAttributedImageMediaId({
      candidates: [
        { mediaId: 'other-1', editorPrompt: 'another user image' },
        { mediaId: 'matching-2', matchedPrompt: true },
        { mediaId: 'other-3', editorPrompt: 'third image' },
      ],
      expectedPrompt: prompt,
    });
    expect(selected).toBe('matching-2');
  });

  it('fails closed when no candidates pass attribution', () => {
    expect(selectAttributedImageMediaId({ candidates: [], expectedPrompt: prompt })).toBeUndefined();
    expect(selectAttributedImageMediaId({
      candidates: [{ mediaId: 'x', editorPrompt: 'wrong' }],
      expectedPrompt: prompt,
    })).toBeUndefined();
  });

  it('batchCount > 1 permits a proven batch member as primary output', () => {
    const selected = selectAttributedImageMediaId({
      candidates: [
        { mediaId: 'batch-member-1', editorPrompt: 'A serene paper boat on a calm lake at sunrise (batch 1)' },
        { mediaId: 'batch-member-2', editorPrompt: 'A serene paper boat on a calm lake at sunrise (batch 2)' },
      ],
      expectedPrompt: prompt,
    });
    expect(selected).toBe('batch-member-1');
  });

  it('service worker no longer claims first new mediaId without attribution', () => {
    const source = workerSource();
    expect(source).toContain('selectAttributedImageMediaId');
    expect(source).not.toContain('const newId = current.find((id) => !initialSet.has(id));');
    expect(source).not.toMatch(/return completeGenerate\([\s\S]{0,120}mediaId:\s*newId/);
  });

  it('existing video tile attribution logic remains intact', () => {
    const v = decideVideoTileArrival({ tokens: ['t1'] }, { tokens: ['t1', 't2'] });
    expect(v.appeared).toBe(true);
    expect(editorPromptMatches('Hypercar in Tokyo', 'Hypercar')).toBe(true);
  });
});
