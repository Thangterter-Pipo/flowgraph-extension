import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_BRIDGE_CEILING_MS,
  DOWNLOAD_RESOLVE_BUDGET_MS,
  DOWNLOAD_TRANSFER_BUDGET_MS,
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

  // Regression guard for run 30c818fa: node 4 reached the worker's video resolve
  // loop, but the adapter's generic 120s bridge default expired first and the run
  // recorded `TIMEOUT: Provider request timed out` instead of the real outcome.
  // Download needs the same "ceiling above worker budget" invariant as generate.
  it('keeps the download bridge ceiling above the worker download worst case', () => {
    expect(DOWNLOAD_BRIDGE_CEILING_MS).toBeGreaterThan(
      DOWNLOAD_RESOLVE_BUDGET_MS + DOWNLOAD_TRANSFER_BUDGET_MS,
    );
  });

  it('never lets the generic request timeout end a healthy download', () => {
    // The adapter's ordinary bridge default is 120s; it must stay below the
    // download ceiling so download is never routed through the generic budget.
    expect(DOWNLOAD_BRIDGE_CEILING_MS).toBeGreaterThan(120_000);
  });
});
