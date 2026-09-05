// CacheStore (FG-0902) — project-scoped result cache for successful node outputs.
// Cache keys are node fingerprints; entries expire and are cleared on project switch.
// Never stores auth material — only normalized media refs (no signed URLs).
import type { CachedNodeResult, RuntimeCache } from './ExecutionContext';

export class CacheStore implements RuntimeCache {
  private readonly entries = new Map<string, CachedNodeResult>();
  private readonly projectId: string;
  private readonly ttlMs: number;

  constructor(projectId: string, ttlMs = 24 * 60 * 60 * 1000) {
    this.projectId = projectId;
    this.ttlMs = ttlMs;
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
    // Media refs may transiently carry previewUrl; strip it so the cache never persists signed URLs.
    const sanitized = { ...value, output: stripSecrets(value.output), fullOutput: stripSecrets(value.fullOutput) };
    this.entries.set(`${this.projectId}:${key}`, sanitized);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
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
  projectId: string;
}): string {
  const json = JSON.stringify({
    nodeKind: input.nodeKind,
    config: sortEntries(input.config),
    prompt: input.prompt ?? null,
    model: input.model ?? null,
    seed: input.seed ?? null,
    upstreamMediaIds: [...input.upstreamMediaIds],
    projectId: input.projectId,
  });
  let hash = 5381;
  for (let index = 0; index < json.length; index += 1) {
    hash = ((hash * 33) ^ json.charCodeAt(index)) >>> 0;
  }
  return `${hash.toString(36)}-${json.length}`;
}

function sortEntries(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
