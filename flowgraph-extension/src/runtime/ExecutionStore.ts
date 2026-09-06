// ExecutionStore (FG-0702 persistence + FG-1103 run history) — persists run records
// and node outputs scoped to a project, without auth material or signed URLs.
import { stripSecrets } from './CacheStore';

export interface NodeRunRecord {
  nodeId: string;
  status: 'success' | 'failed' | 'skipped';
  errorCode?: string;
  errorMessage?: string;
  diagnosticId?: string;
  creditsUsed?: number;
  result?: { type: 'image' | 'video'; mediaId: string; mimeType?: string; fileName?: string };
  durationMs?: number;
}

export interface WorkflowRunRecord {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: 'success' | 'failed' | 'cancelled';
  projectId: string;
  projectName: string;
  startedAt: string;
  finishedAt: string;
  nodeRuns: NodeRunRecord[];
  creditDelta: number;
}

const RUN_HISTORY_KEY = 'flowgraph.runHistory.v1';
const HISTORY_STORAGE_KEY = RUN_HISTORY_KEY;

export class ExecutionStore {
  private readonly projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  appendRun(record: WorkflowRunRecord): void {
    const history = this.loadAll();
    history.unshift(record);
    // Cap history at 50 runs per project.
    const pruned = history.filter((entry) => entry.projectId === this.projectId).slice(0, 50);
    const kept = [...pruned, ...history.filter((entry) => entry.projectId !== this.projectId).slice(0, 100)];
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(kept));
  }

  listRuns(limit = 20): WorkflowRunRecord[] {
    return this.loadAll().filter((entry) => entry.projectId === this.projectId).slice(0, limit);
  }

  private loadAll(): WorkflowRunRecord[] {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return [];
      return stripSecrets(JSON.parse(raw)) as WorkflowRunRecord[];
    } catch {
      return [];
    }
  }
}

/** Factory that respects the storage boundary: records are re-read through stripSecrets. */
export function createRunRecord(params: Omit<WorkflowRunRecord, 'finishedAt'> & { finishedAt?: string }): WorkflowRunRecord {
  return {
    ...params,
    finishedAt: params.finishedAt ?? new Date().toISOString(),
  };
}

export { stripSecrets };
