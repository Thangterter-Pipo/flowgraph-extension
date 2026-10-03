// Execution context (FG-0303) — everything a node executor and the runtime need
// about the current run, scoped to the active project.
import type { AccountStatus, FlowStatus } from '../shared/bridge';
import { RuntimeError } from './RuntimeError';

export interface ActiveProject {
  projectId: string;
  projectName: string;
  selectedAt: string;
}

export interface ExecutionContextOptions {
  runId: string;
  workflowId: string;
  activeProject: ActiveProject;
  account: AccountStatus;
  flow: FlowStatus;
  abortSignal?: AbortSignal;
  cache?: RuntimeCache;
  transportPreference?: 'BATCH_RPC' | 'FLOW_UI';
  qualityMode?: 'DRAFT' | 'MASTER';
}

export interface CachedNodeResult {
  nodeId: string;
  output: unknown;
  fingerprint: string;
  completedAt: string;
  /** Full executor output (outputs + result) so cache hits replay previews exactly. */
  fullOutput?: unknown;
}

export interface RuntimeCache {
  get(key: string): CachedNodeResult | undefined;
  set(key: string, value: CachedNodeResult): void;
  clear(): void;
}

export class ExecutionContext {
  readonly runId: string;
  readonly workflowId: string;
  readonly activeProject: ActiveProject;
  readonly account: AccountStatus;
  readonly flow: FlowStatus;
  readonly abortSignal?: AbortSignal;
  readonly cache?: RuntimeCache;
  readonly transportPreference?: 'BATCH_RPC' | 'FLOW_UI';
  readonly qualityMode?: 'DRAFT' | 'MASTER';

  private failures = new Map<string, RuntimeError>();
  private inFlightMediaJobs = new Set<string>();

  constructor(options: ExecutionContextOptions) {
    this.runId = options.runId;
    this.workflowId = options.workflowId;
    this.activeProject = options.activeProject;
    this.account = options.account;
    this.flow = options.flow;
    this.abortSignal = options.abortSignal;
    this.cache = options.cache;
    this.transportPreference = options.transportPreference;
    this.qualityMode = options.qualityMode;
  }

  fail(nodeId: string, error: RuntimeError): void {
    this.failures.set(nodeId, error);
  }

  failureFor(nodeId: string): RuntimeError | undefined {
    return this.failures.get(nodeId);
  }

  /** Node ids that failed during this run (read by retry paths). */
  get failedNodeIds(): string[] {
    return [...this.failures.keys()];
  }

  trackMediaJob(mediaId: string): void {
    if (mediaId) this.inFlightMediaJobs.add(mediaId);
  }

  completeMediaJob(mediaId: string): void {
    if (mediaId) this.inFlightMediaJobs.delete(mediaId);
  }

  get activeMediaIds(): string[] {
    return [...this.inFlightMediaJobs];
  }

  get aborted(): boolean {
    return this.abortSignal?.aborted ?? false;
  }

  throwIfAborted(message = 'Run aborted'): void {
    if (this.aborted) throw cancelledError(message);
  }
}

export function cancelledError(message = 'Run aborted'): RuntimeError {
  return new RuntimeError('CANCELLED', message, { retryable: false });
}

export function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(cancelledError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(cancelledError());
    };
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise
      .then((val) => {
        cleanup();
        resolve(val);
      })
      .catch((err) => {
        cleanup();
        reject(err);
      });
  });
}

export function whenAborted(signal?: AbortSignal): Promise<never> {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.reject(cancelledError());
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(cancelledError()), { once: true });
  });
}
