import { describe, expect, it } from 'vitest';
import {
  GENERATE_BRIDGE_CEILING_MS,
  GENERATE_WORKER_BUDGET_MS,
  MEDIA_WAIT_IMAGE_MS,
  MEDIA_WAIT_VIDEO_MS,
} from '../../src/shared/timeouts';

describe('generation time budgets (FG-1505)', () => {
  it('gives a real video render more room than an image', () => {
    expect(MEDIA_WAIT_VIDEO_MS).toBeGreaterThan(MEDIA_WAIT_IMAGE_MS);
  });

  // Regression guard for run 54058dc8: the UI adapter's 300s ceiling expired while
  // the service worker was still inside its own media wait, so node 2 reported a
  // generic `Provider request timed out` and the worker's specific, diagnosable
  // error never reached the run record. The outer ceiling must always be a safety
  // net, never the thing that ends a healthy run.
  it('keeps the UI bridge ceiling above the worker worst case', () => {
    expect(GENERATE_BRIDGE_CEILING_MS).toBeGreaterThan(GENERATE_WORKER_BUDGET_MS);
  });

  it('keeps the worker worst case above the media wait it contains', () => {
    expect(GENERATE_WORKER_BUDGET_MS).toBeGreaterThan(MEDIA_WAIT_VIDEO_MS);
  });
});
