import { describe, expect, it } from 'vitest';
import { CacheStore, fingerprintNode, isCacheableNodeKind } from '../../src/runtime/CacheStore';

describe('CacheStore (FG-0901/0902)', () => {
  it('fingerprints deterministically from config + upstream media + project', () => {
    const a = fingerprintNode({ nodeKind: 't2i', config: { model: 'NARWHAL' }, prompt: 'x', upstreamMediaIds: ['img-1'], projectId: 'p1' });
    const b = fingerprintNode({ nodeKind: 't2i', config: { model: 'NARWHAL' }, prompt: 'x', upstreamMediaIds: ['img-1'], projectId: 'p1' });
    const c = fingerprintNode({ nodeKind: 't2i', config: { model: 'NARWHAL' }, prompt: 'x', upstreamMediaIds: ['img-2'], projectId: 'p1' });
    const d = fingerprintNode({ nodeKind: 't2i', config: { model: 'NARWHAL' }, prompt: 'x', upstreamMediaIds: ['img-1'], projectId: 'p2' });
    expect(a).toBe(b);   // same node → same fingerprint
    expect(a).not.toBe(c); // different upstream media → different
    expect(a).not.toBe(d); // different project → different (project isolation)

    // Task 2B.1: Ordered upstream mediaIds must produce distinct fingerprints
    const ab = fingerprintNode({ nodeKind: 'reference', config: {}, prompt: 'x', upstreamMediaIds: ['img-A', 'img-B'], projectId: 'p1' });
    const ba = fingerprintNode({ nodeKind: 'reference', config: {}, prompt: 'x', upstreamMediaIds: ['img-B', 'img-A'], projectId: 'p1' });
    const ab2 = fingerprintNode({ nodeKind: 'reference', config: {}, prompt: 'x', upstreamMediaIds: ['img-A', 'img-B'], projectId: 'p1' });
    expect(ab).not.toBe(ba); // order matters!
    expect(ab).toBe(ab2);   // deterministic for same order
  });

  it('fingerprints resolved inputs by handle, order, and character DNA', () => {
    const base = { nodeKind: 'interpolation', config: {}, prompt: 'move', upstreamMediaIds: ['A', 'B'], projectId: 'p1' };
    const ab = fingerprintNode({
      ...base,
      resolvedInputs: {
        startImage: { type: 'image', mediaId: 'A' },
        endImage: { type: 'image', mediaId: 'B' },
        characters: [{ type: 'character', value: { characterId: 'c1', dnaText: 'red coat' } }],
      },
    });
    const ba = fingerprintNode({
      ...base,
      resolvedInputs: {
        startImage: { type: 'image', mediaId: 'B' },
        endImage: { type: 'image', mediaId: 'A' },
        characters: [{ type: 'character', value: { characterId: 'c1', dnaText: 'red coat' } }],
      },
    });
    const changedDna = fingerprintNode({
      ...base,
      resolvedInputs: {
        startImage: { type: 'image', mediaId: 'A' },
        endImage: { type: 'image', mediaId: 'B' },
        characters: [{ type: 'character', value: { characterId: 'c1', dnaText: 'blue coat' } }],
      },
    });
    expect(ab).not.toBe(ba);
    expect(ab).not.toBe(changedDna);
  });

  it('is scoped per project — the same key in another project misses', () => {
    const store = new CacheStore('p1');
    store.set('k', { nodeId: 'n', output: { outputs: {} }, fingerprint: 'k', completedAt: new Date().toISOString() });
    expect(store.get('k')).toBeDefined();
    const other = new CacheStore('p2');
    expect(other.get('k')).toBeUndefined();
  });

  it('keeps generation cacheable and excludes preview/download sinks', () => {
    expect(isCacheableNodeKind('t2i')).toBe(true);
    expect(isCacheableNodeKind('t2v')).toBe(true);
    expect(isCacheableNodeKind('uploadImage')).toBe(true);
    expect(isCacheableNodeKind('gemini')).toBe(true);
    expect(isCacheableNodeKind('preview')).toBe(false);
    expect(isCacheableNodeKind('download')).toBe(false);
  });

  it('strips signed URLs from cached outputs', () => {
    const store = new CacheStore('p1');
    store.set('k', {
      nodeId: 'n',
      output: { outputs: { image: { type: 'image', value: { provider: 'GOOGLE_FLOW', mediaId: 'm1', type: 'IMAGE', projectId: 'p1', previewUrl: 'https://cdn.example/signed?Expires=1' } } } },
      fingerprint: 'k',
      completedAt: new Date().toISOString(),
    });
    const cached = store.get('k');
    const media = (cached?.output as { outputs: { image: { value: Record<string, unknown> } } }).outputs.image.value;
    expect(media.previewUrl).toBeUndefined();
    expect(media.mediaId).toBe('m1');
  });

  it('expires entries beyond TTL', async () => {
    const store = new CacheStore('p1', 1000);
    store.set('k', { nodeId: 'n', output: {}, fingerprint: 'k', completedAt: '2020-01-01T00:00:00.000Z' });
    expect(store.get('k')).toBeUndefined();
  });

  it('clear resets the store', () => {
    const store = new CacheStore('p1');
    store.set('k', { nodeId: 'n', output: {}, fingerprint: 'k', completedAt: new Date().toISOString() });
    expect(store.size).toBe(1);
    store.clear();
    expect(store.size).toBe(0);
    expect(store.get('k')).toBeUndefined();
  });

  it('evicts oldest entries when exceeding maxEntries', () => {
    const store = new CacheStore('p1', 60_000, 2);
    store.set('k1', { nodeId: 'n1', output: {}, fingerprint: 'k1', completedAt: new Date().toISOString() });
    store.set('k2', { nodeId: 'n2', output: {}, fingerprint: 'k2', completedAt: new Date().toISOString() });
    expect(store.size).toBe(2);
    expect(store.get('k1')).toBeDefined();
    store.set('k3', { nodeId: 'n3', output: {}, fingerprint: 'k3', completedAt: new Date().toISOString() });
    expect(store.size).toBe(2);
    expect(store.get('k1')).toBeUndefined();
    expect(store.get('k2')).toBeDefined();
    expect(store.get('k3')).toBeDefined();
  });
});
