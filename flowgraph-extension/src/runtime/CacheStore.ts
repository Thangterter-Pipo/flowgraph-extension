// CacheStore (FG-0902) — project-scoped result cache for successful node outputs.
// Cache keys are node fingerprints; entries expire and are cleared on project switch.
// Never stores auth material — only normalized media refs (no signed URLs).
import type { CachedNodeResult, RuntimeCache } from './ExecutionContext';

export class CacheStore implements RuntimeCache {
  private readonly entries = new Map<string, CachedNodeResult>();
  private readonly projectId: string;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(projectId: string, ttlMs = 24 * 60 * 60 * 1000, maxEntries = 200) {
    this.projectId = projectId;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string): CachedNodeResult | undefined {
    const entry = this.entries.get(`${this.projectId}:${key}`);
    if (!entry) return undefined;
    if (Date.now() - Date.parse(entry.completedAt) > this.ttlMs) {
      this.entries.delete(`${this.projectId}:${key}`);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: CachedNodeResult): void {
    const fullKey = `${this.projectId}:${key}`;
    if (!this.entries.has(fullKey) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    // Media refs may transiently carry previewUrl; strip it so the cache never persists signed URLs.
    const sanitized = { ...value, output: stripSecrets(value.output), fullOutput: stripSecrets(value.fullOutput) };
    this.entries.set(fullKey, sanitized);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Fail-safe cache policy: transient URL resolvers and effectful sinks must always
 * execute. Preview needs a fresh signed previewUrl (CacheStore strips *url fields);
 * Download with autoDownload must call adapter.downloadMedia on every Run.
 * Generation / upload / Gemini credit-saving kinds stay cacheable.
 */
const UNCACHABLE_SINK_KINDS = new Set(['preview', 'download']);

export function isCacheableNodeKind(kind: string): boolean {
  return !UNCACHABLE_SINK_KINDS.has(kind);
}

export function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      if (key.toLowerCase().includes('url') || key.toLowerCase().includes('token') || key.toLowerCase().includes('cookie')) continue;
      copy[key] = stripSecrets(nested);
    }
    return copy;
  }
  return value;
}

/** Deterministic fingerprint of a node's identity within a run (FG-0901). */
export function fingerprintNode(input: {
  nodeKind: string;
  config: Record<string, unknown>;
  prompt?: string;
  model?: string;
  seed?: unknown;
  upstreamMediaIds: string[];
  /** Canonical resolved runtime inputs keyed by target handle. */
  resolvedInputs?: unknown;
  projectId: string;
}): string {
  const json = JSON.stringify({
    nodeKind: input.nodeKind,
    config: stableValue(input.config),
    prompt: input.prompt ?? null,
    model: input.model ?? null,
    seed: input.seed ?? null,
    upstreamMediaIds: [...input.upstreamMediaIds],
    resolvedInputs: stableValue(input.resolvedInputs ?? null),
    projectId: input.projectId,
  });
  let hash = 5381;
  for (let index = 0; index < json.length; index += 1) {
    hash = ((hash * 33) ^ json.charCodeAt(index)) >>> 0;
  }
  return `${hash.toString(36)}-${json.length}`;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}
