// Single source of truth for the generation time budgets.
//
// Live run 54058dc8 failed node 2 with `PROVIDER_ERROR: Provider request timed
// out` after 5m12s while the service worker was still working normally. The
// cause was two independent numbers: the UI adapter cut the bridge request off
// at 300s, but the worker's own submit-verify loop plus media wait can legitimately
// need longer than that. When the outer ceiling is smaller than the inner work, the
// run reports a generic provider error and throws away the specific, diagnosable
// error the worker was about to produce.
//
// These constants exist so that relationship is stated once and can be asserted in
// a test instead of being re-derived by whoever next hits a timeout.

/** Worst case for the click-and-verify submit loop: 4 attempts of measure, click,
 *  settle checks, and the Enter fallback. */
export const SUBMIT_VERIFY_BUDGET_MS = 4 * 30_000;

/** How long the worker waits for a generated **image** to show up in the gallery. */
export const MEDIA_WAIT_IMAGE_MS = 180_000;

/** How long the worker waits for a generated **video** to render. Omni Flash
 *  exceeded the old flat 180s budget on real runs, so video gets its own. */
export const MEDIA_WAIT_VIDEO_MS = 420_000;

/** Per-tile editor recovery: open the tile, read the URL, return to the gallery. */
export const VIDEO_TILE_RECOVERY_STEP_MS = 15_000;

/** How many tiles the worker may open while attributing a new video clip. */
export const VIDEO_TILE_MAX_CANDIDATES = 4;

/** Preflight sync + model/aspect/duration verification before the click. */
export const PREFLIGHT_SYNC_BUDGET_MS = 120_000;

/**
 * The worker's own worst case for one `FLOWGRAPH_GENERATE` request. Anything the
 * UI waits for must be at least this generous or it will mask real progress.
 */
export const GENERATE_WORKER_BUDGET_MS =
  PREFLIGHT_SYNC_BUDGET_MS
  + SUBMIT_VERIFY_BUDGET_MS
  + MEDIA_WAIT_VIDEO_MS
  + VIDEO_TILE_RECOVERY_STEP_MS * VIDEO_TILE_MAX_CANDIDATES;

/**
 * Ceiling the UI adapter puts on a generation request. Deliberately above
 * `GENERATE_WORKER_BUDGET_MS`: this is a safety net for a wedged worker, not the
 * real budget, and must never be the thing that ends a healthy run.
 */
export const GENERATE_BRIDGE_CEILING_MS = GENERATE_WORKER_BUDGET_MS + 120_000;

/**
 * Ceiling the UI adapter puts on a media-download request. The worker's own
 * worst case is the video-tile resolve loop (navigate to the editor, drive the
 * download menu, retry on a stale overlay) plus the `chrome.downloads` transfer,
 * which the worker bounds at 180s. Live run 30c818fa proved the generic 120s
 * bridge default fired *while the worker was still resolving*, surfacing a
 * healthy-but-slow download as `TIMEOUT: Provider request timed out` and
 * discarding the real outcome. This sits above every worker-side download
 * deadline so it is only ever a wedged-worker safety net, never the budget.
 */
export const DOWNLOAD_RESOLVE_BUDGET_MS = 90_000;
export const DOWNLOAD_TRANSFER_BUDGET_MS = 180_000;
export const DOWNLOAD_BRIDGE_CEILING_MS =
  DOWNLOAD_RESOLVE_BUDGET_MS + DOWNLOAD_TRANSFER_BUDGET_MS + 60_000;
