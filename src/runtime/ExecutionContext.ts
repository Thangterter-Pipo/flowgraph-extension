// Execution context (FG-0303) — everything a node executor and the runtime need
// about the current run, scoped to the active project.
import type { AccountStatus, FlowStatus } from '../shared/bridge';
import type { RuntimeError } from './RuntimeError';

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

  private failures = new Map<string, RuntimeError>();

  constructor(options: ExecutionContextOptions) {
    this.runId = options.runId;
    this.workflowId = options.workflowId;
    this.activeProject = options.activeProject;
    this.account = options.account;
    this.flow = options.flow;
    this.abortSignal = options.abortSignal;
    this.cache = options.cache;
  }

  fail(nodeId: string, error: RuntimeError): void {
    this.failures.set(nodeId, error);
  }

  failureFor(nodeId: string): RuntimeError | undefined {
    return this.failures.get(nodeId);
  }

  /** Node ids that failed during this run (read by cancel/retry paths). */
  get failedNodeIds(): string[] {
    return [...this.failures.keys()];
  }

  get aborted(): boolean {
    return this.abortSignal?.aborted ?? false;
  }

  throwIfAborted(message = 'Run aborted'): void {
    if (this.aborted) {
      const error = new Error(message) as Error & { code: string; retryable: boolean };
      error.code = 'CANCELLED';
      error.retryable = false;
      throw error;
    }
  }
}
