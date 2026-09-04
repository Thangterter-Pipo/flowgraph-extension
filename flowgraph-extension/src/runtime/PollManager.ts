// PollManager (FG-0801) — polls provider job status with interval + backoff, supports
// abort and timeout. Provider statuses are mapped to normalized terminal states.

export type PollStatus = 'ACTIVE' | 'SUCCESSFUL' | 'FAILED' | 'CANCELED' | 'UNKNOWN';

export interface PollProbe {
  status: PollStatus;
  progress?: number;
  errorMessage?: string;
  data?: unknown;
}

export interface PollOptions {
  intervalMs?: number;
  maxWaitMs?: number;
  backoffFactor?: number;
  abortSignal?: AbortSignal;
}

const DEFAULT_INTERVAL_MS = 2_500;
const DEFAULT_MAX_WAIT_MS = 15 * 60_000;
const DEFAULT_BACKOFF = 1.0;

const TERMINAL: ReadonlySet<PollStatus> = new Set(['SUCCESSFUL', 'FAILED', 'CANCELED']);

export class PollManager {
  private readonly intervalMs: number;
  private readonly maxWaitMs: number;
  private readonly backoffFactor: number;

  constructor(options: PollOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.backoffFactor = options.backoffFactor ?? DEFAULT_BACKOFF;
  }

  async untilTerminal(probe: () => Promise<PollProbe>, context: { abortSignal?: AbortSignal } = {}): Promise<PollProbe> {
    const signal = context.abortSignal;
    const started = Date.now();
    let interval = this.intervalMs;

    for (;;) {
      if (signal?.aborted) throw abortError();
      const result = await probe();
      if (TERMINAL.has(result.status) || Date.now() - started >= this.maxWaitMs) {
        return Date.now() - started >= this.maxWaitMs && !TERMINAL.has(result.status)
          ? { status: 'UNKNOWN', errorMessage: `Polling timed out after ${this.maxWaitMs}ms` }
          : result;
      }
      await sleep(interval);
      interval = Math.min(interval * (this.backoffFactor > 1 ? this.backoffFactor : 1), this.maxWaitMs);
    }
  }
}

function abortError(): Error & { code: string; retryable: boolean } {
  const error = new Error('Polling aborted') as Error & { code: string; retryable: boolean };
  error.code = 'CANCELLED';
  error.retryable = false;
  return error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
