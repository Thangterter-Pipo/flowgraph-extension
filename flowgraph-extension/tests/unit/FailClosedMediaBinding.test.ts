import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canSubmitGenerateWithMediaBindings,
  referenceMediaExactlyBound,
  shouldFailClosedOnMediaBindFailure,
  slotSourcesContainExactMediaId,
} from '../../src/shared/generationPreflight';

const workerSource = () => readFileSync(resolve(__dirname, '../../src/background/service-worker.ts'), 'utf8');

describe('fail-closed media binding', () => {
  it('fails closed on interpolation end-image and reference-media bind failure', () => {
    expect(shouldFailClosedOnMediaBindFailure('interpolation', 'endImage')).toBe(true);
    expect(shouldFailClosedOnMediaBindFailure('interpolation', 'startImage')).toBe(true);
    expect(shouldFailClosedOnMediaBindFailure('reference', 'referenceMedia')).toBe(true);
  });

  it('keeps I2V start-image recovery as a tolerated preflight miss', () => {
    expect(shouldFailClosedOnMediaBindFailure('i2v', 'startImage')).toBe(false);
    expect(shouldFailClosedOnMediaBindFailure('i2v', 'endImage')).toBe(true);
  });

  it('rejects mismatched interpolation end-image sources that lack the requested mediaId', () => {
    const requested = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const stale = 'https://flow-content.google/image/ffffffff-0000-1111-2222-333333333333?w=512';
    expect(slotSourcesContainExactMediaId([stale, 'https://flow-content.google/image/other'], requested)).toBe(false);
    expect(slotSourcesContainExactMediaId(['', null, 'https://flow.google.com/asb/preview-x'], requested)).toBe(false);
  });

  it('accepts an exact end-image UUID in src or data-media-id', () => {
    const requested = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(slotSourcesContainExactMediaId(
      [`https://flow-content.google/image/${requested}?w=512`],
      requested,
    )).toBe(true);
    expect(slotSourcesContainExactMediaId([requested], requested)).toBe(true);
  });

  it('rejects mismatched or reordered reference-media bindings', () => {
    expect(referenceMediaExactlyBound(['img-a', 'img-b'], ['img-a'])).toBe(false);
    expect(referenceMediaExactlyBound(['img-a', 'img-b'], ['img-b', 'img-a'])).toBe(false);
    expect(referenceMediaExactlyBound(['img-a'], ['img-stale'])).toBe(false);
    expect(referenceMediaExactlyBound(['img-a', 'img-b'], ['img-a', 'img-b'])).toBe(true);
  });

  it('failed/mismatched interpolation end-image and reference bindings cause 0 Generate submissions', () => {
    expect(canSubmitGenerateWithMediaBindings({
      kind: 'interpolation',
      hasStart: true,
      hasEnd: true,
      startBound: true,
      endBound: false,
    })).toBe(false);
    expect(canSubmitGenerateWithMediaBindings({
      kind: 'interpolation',
      hasStart: true,
      hasEnd: true,
      startBound: false,
      endBound: true,
    })).toBe(false);
    expect(canSubmitGenerateWithMediaBindings({
      kind: 'reference',
      hasRefs: true,
      referenceBound: false,
    })).toBe(false);
  });

  it('successful exact bindings still proceed to Generate', () => {
    expect(canSubmitGenerateWithMediaBindings({
      kind: 'interpolation',
      hasStart: true,
      hasEnd: true,
      startBound: true,
      endBound: true,
    })).toBe(true);
    expect(canSubmitGenerateWithMediaBindings({
      kind: 'reference',
      hasRefs: true,
      referenceBound: true,
    })).toBe(true);
  });

  it('I2V exact-start recovery remains valid when preflight start bind missed', () => {
    expect(shouldFailClosedOnMediaBindFailure('i2v', 'startImage')).toBe(false);
    expect(canSubmitGenerateWithMediaBindings({
      kind: 'i2v',
      hasStart: true,
      startBound: false,
    })).toBe(true);
  });

  it('service worker no longer proceeds to Generate after endImage/reference bind failure', () => {
    const source = workerSource();
    expect(source).toContain('shouldFailClosedOnMediaBindFailure');
    expect(source).not.toContain('endImage preflight warning, proceeding with generation');
    expect(source).not.toContain('referenceMedia preflight warning, proceeding with generation');
    expect(source).toContain('Upstream image ${startImageId} was not bound as the Flow video start image');
  });

  it('re-checks exact interpolation/reference bindings immediately before Generate click and Enter fallback', () => {
    const source = workerSource();
    expect(source).toContain('assertMediaReadyToSubmit');
    expect(source).toContain('canSubmitGenerateWithMediaBindings');
    expect(source).toContain('referenceMediaExactlyBound');
    expect(source).toMatch(/await assertMediaReadyToSubmit\(\);\s*await assertPromptReadyToSubmit\(\);\s*await clickAtCenter\(fresh\.x, fresh\.y\);/);
    const enterIdx = source.indexOf("key: 'Enter', code: 'Enter'");
    const clickIdx = source.indexOf('await clickAtCenter(fresh.x, fresh.y);');
    expect(clickIdx).toBeGreaterThan(-1);
    expect(enterIdx).toBeGreaterThan(clickIdx);
    const betweenClickAndEnter = source.slice(clickIdx, enterIdx);
    expect(betweenClickAndEnter).toContain('await assertMediaReadyToSubmit()');
  });

  it('does not treat a generic flow-content.google slot as an exact bind', () => {
    const source = workerSource();
    expect(source).not.toMatch(/source\.includes\(mediaId\) \|\| directId === mediaId \|\| \(source && source\.includes\('flow-content\.google'\)\)/);
    expect(source).not.toContain("|| [...(dialog?.querySelectorAll('img, [data-media-id]') || [])].find(el => el.getBoundingClientRect().width > 30)");
  });

  it('binds Reference/Ingredients from the live composer add-menu without stale Components-mode switching', () => {
    const source = workerSource();
    expect(source).toContain("button.add-menu-trigger");
    expect(source).toContain('Thêm thành phần vào ô nhập câu lệnh');
    expect(source).toContain("throw bridgeError('UI_NOT_READY', 'Flow Reference/Ingredients add-menu was not available.'");
    expect(source).not.toContain("type: 'FLOWGRAPH_INTERNAL_SET_COMPONENT_MODE'");
    expect(source).not.toContain("Flow Components mode was not available in Settings.");
    expect(source).toContain('rect.width > 0 && rect.height > 0');
  });
});
