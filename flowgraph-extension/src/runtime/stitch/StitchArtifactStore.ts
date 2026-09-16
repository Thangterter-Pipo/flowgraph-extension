import { RuntimeError } from '../RuntimeError';

export interface StitchArtifact {
  blob: Blob;
  duration: number;
  width: number;
  height: number;
}

const DATABASE = 'flowgraph-stitch-artifacts-v1';
const STORE = 'artifacts';
export const isStitchArtifact = (id?: string): boolean => Boolean(id?.startsWith('stitch-idb:'));

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new RuntimeError('MEDIA_FAILED', 'IndexedDB is required for Stitch.'));
    const request = indexedDB.open(DATABASE, 1);
    const timer = setTimeout(() => reject(new RuntimeError('TIMEOUT', 'Stitch artifact database open timed out.')), 10_000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => { clearTimeout(timer); reject(new RuntimeError('MEDIA_FAILED', 'Cannot open Stitch artifact database.')); };
    request.onblocked = () => { clearTimeout(timer); reject(new RuntimeError('MEDIA_FAILED', 'Stitch artifact database is blocked.')); };
    request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>, signal?: AbortSignal): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let value: T;
      const abort = () => { try { tx.abort(); } catch { /* already finished */ } };
      const timer = setTimeout(abort, 15_000);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      tx.oncomplete = () => { cleanup(); resolve(value); };
      tx.onabort = tx.onerror = () => {
        cleanup();
        reject(new RuntimeError(signal?.aborted ? 'CANCELLED' : 'MEDIA_FAILED', 'Stitch artifact transaction did not commit.'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      const request = operation(tx.objectStore(STORE));
      request.onsuccess = () => { value = request.result; };
    });
  } finally { db.close(); }
}

export async function saveStitchArtifact(projectId: string, artifact: StitchArtifact, signal?: AbortSignal): Promise<string> {
  if (!projectId || !artifact.blob.size || !artifact.blob.type.startsWith('video/') || !Number.isFinite(artifact.duration) || artifact.duration <= 0) {
    throw new RuntimeError('MEDIA_FAILED', 'Cannot save an empty or invalid Stitch artifact.');
  }
  const id = `stitch-idb:${crypto.randomUUID()}`;
  await transaction('readwrite', (store) => store.add({ ...artifact, projectId }, id), signal);
  return id;
}

export async function loadStitchArtifact(id: string, projectId: string): Promise<StitchArtifact> {
  if (!isStitchArtifact(id) || !projectId) throw new RuntimeError('INVALID_INPUT', 'Invalid Stitch artifact identity.');
  const value = await transaction('readonly', (store) => store.get(id)) as (StitchArtifact & { projectId: string }) | undefined;
  if (!value || !(value.blob instanceof Blob) || !value.blob.size) throw new RuntimeError('MEDIA_FAILED', 'Stitch artifact is missing; run Stitch again from its original sources.');
  if (value.projectId !== projectId) throw new RuntimeError('PROJECT_ISOLATION', 'Stitch artifact belongs to another project.');
  return value;
}

// Session-only URL cache. Durable identity is the IndexedDB key, never this URL.
const urls = new Map<string, string>();
export async function stitchArtifactUrl(id: string, projectId: string): Promise<string> {
  const artifact = await loadStitchArtifact(id, projectId);
  const key = `${projectId}/${id}`;
  let url = urls.get(key);
  if (!url) { url = URL.createObjectURL(artifact.blob); urls.set(key, url); }
  return url;
}
