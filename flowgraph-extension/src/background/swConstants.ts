// swConstants.ts — Service worker shared constants.
// Extracted from service-worker.ts to reduce file size.
// DO NOT import service-worker.ts from here (circular dependency risk).
import { DOWNLOAD_TRANSFER_BUDGET_MS } from '../shared/timeouts';

export const AISANDBOX_BASE = 'https://aisandbox-pa.googleapis.com/v1';
export const FX_API_BASE = 'https://labs.google/fx/api';

export const TOKEN_TTL_MS = 50 * 60 * 1000; // refresh below 1h lifespan (~3600s)
export const REQUEST_TIMEOUT_MS = 60_000;

// Content-script settings writes can legitimately spend ~6-7s exhausting the
// settings-menu retry loop before returning NO_UI_COUNTERPART. Keep the outer
// worker budget above that inner retry window so we do not manufacture a false
// SYNC_TIMEOUT while the provider adapter is still resolving the real outcome.
export const SYNC_WRITE_TIMEOUT_MS = 10_000;

// The transfer budget only. The signed-URL resolve loop above has its own
// bounds, and the adapter's DOWNLOAD_BRIDGE_CEILING_MS sits above both, so the
// bridge is never the thing that ends a healthy download.
export const DOWNLOAD_TIMEOUT_MS = DOWNLOAD_TRANSFER_BUDGET_MS;

export const FLOW_SITEKEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

// FLOWGRAPH_PROXY_FETCH runs with the extension's host permissions and cookie
// jar, so without an allowlist it is an authenticated open proxy. Local gateways
// are user-configurable on any port; add vetted remote hosts here explicitly.
export const PROXY_FETCH_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'gateway.thangterter.online',
  'api.openai.com',
  'generativelanguage.googleapis.com',
]);

// Video generation kinds share a video composer mode / VIDEO media type. Image
// generation (t2i) is the only IMAGE kind; everything else in GeneratePayload is
// video. Centralizing this avoids per-kind mishandling (e.g. t2v being returned
// as an image just because only i2v was special-cased).
export const VIDEO_KINDS: ReadonlySet<string> = new Set([
  'i2v',
  't2v',
  'extend',
  'interpolation',
  'reference',
  'upscale',
]);

export function isVideoKind(kind: string): boolean {
  return VIDEO_KINDS.has(kind);
}
