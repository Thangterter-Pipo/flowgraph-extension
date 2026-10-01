// WorkflowRuntime (FG-0605) — runs a compiled workflow against real executors:
// validate → plan → execute ready nodes (bounded concurrency, FG-1001) → emit node
// events → error/retry/cancel handling. The runtime never simulates: unsupported
// kinds block before any provider call; every success comes from an executor result.
import type { NodeExecutor, RuntimeInputValue } from '../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../adapters/google-flow/GoogleFlowAdapter';
import { asText, type RuntimeValue } from './RuntimeValue';
import { ExecutionContext, raceWithSignal, whenAborted, type ActiveProject, type CachedNodeResult, type RuntimeCache } from './ExecutionContext';
import { CacheStore, fingerprintNode, isCacheableNodeKind } from './CacheStore';
import { planGraph, readyNodes, downstreamOf, type CompiledGraph, type PlanEdge, type PlanNode } from './GraphPlanner';
import { selectReadyStage } from './executionPolicy';
import { validateGraph, type NodeSpecForValidation, type RuntimePlanEdge, type ValidationIssue, type ValidationReport } from './GraphValidator';
import { registryModelResolver } from './registryModelResolver';
import { retryGraphChanged, workflowRetrySnapshot } from './workflowSnapshot';
import { RuntimeError, toRuntimeError } from './RuntimeError';
import { reportDiagnostic } from '../shared/devDiagnostics';
import { attachTrustedProjectToNodeResult } from './mediaProvenance';
import { buildExecutors, supportedKinds } from './executors';
import { PollManager } from './PollManager';
import type { AccountStatus, FlowStatus } from '../shared/bridge';

export type RuntimeNodeState = 'idle' | 'queued' | 'running' | 'success' | 'failed' | 'skipped';
export type RuntimeRunState = 'idle' | 'validating' | 'running' | 'success' | 'failed' | 'cancelled';

export interface RuntimeRunOptions {
  workflowId: string;
  activeProject: ActiveProject;
  account: AccountStatus;
  flow: FlowStatus;
  cache?: RuntimeCache;
  /** Force re-execution of cached nodes (user chose "run anyway" — FG-0904). */
  bypassCache?: boolean;
  bypassCacheNodeIds?: ReadonlySet<string>;
  /** Max generations executing concurrently (FG-1001). */
  concurrency?: number;
  /** Initial completed node results from canvas (preserves already generated outputs across runs). */
  initialOutputs?: Map<string, Record<string, RuntimeValue>>;
  /** Initial completed node IDs from canvas. */
  initialCompleted?: Set<string>;
  /** Explicit transport route override (e.g. 'FLOW_UI' to bypass batch RPC). */
  transportPreference?: 'BATCH_RPC' | 'FLOW_UI';
}

export interface RuntimeNodeEvent {
  type: 'node';
  runId: string;
  nodeId: string;
  state: RuntimeNodeState;
  error?: { code: string; message: string; retryable: boolean; diagnosticId?: string; reason?: string };
  result?: { type: 'image' | 'video'; mediaId: string; previewUrl: string; mimeType?: string; fileName?: string; projectId?: string };
  creditsUsed?: number;
  /** True when the node result was replayed from the project cache (no provider call). */
  cacheHit?: boolean;
  outputs?: Record<string, RuntimeValue>;
}

export interface RuntimeRunEvent {
  type: 'run';
  runId: string;
  state: RuntimeRunState;
  issues?: ValidationIssue[];
}

export type RuntimeEvent = RuntimeNodeEvent | RuntimeRunEvent;

export interface RuntimeEmit {
  (event: RuntimeEvent): void;
}

const DEFAULT_CONCURRENCY = 1;
/**
 * FG-1001 — Verified Google Flow concurrency cap.
 * Live provider evidence (2026-09-06): Google Flow operates over a single active
 * browser UI tab and debugger target (`chrome.debugger.attach`). Attempting concurrent
 * generation causes UI/debugger surface contention (`UI_NOT_READY` on the overlapping
 * branch). Therefore, the verified effective production limit is strictly 1.
 */
export const VERIFIED_GOOGLE_FLOW_CONCURRENCY_LIMIT = 1;

export function stageReadyNodes(
  ready: readonly string[],
  kindById: ReadonlyMap<string, string>,
): string[] {
  const byId = new Map([...kindById.entries()].map(([id, kind]) => [id, { kind }]));
  return selectReadyStage(ready, byId);
}

export function resolveEffectiveConcurrency(requested?: number): number {
  if (requested === undefined || requested === null || requested < 1) {
    return DEFAULT_CONCURRENCY;
  }
  return Math.min(Math.floor(requested), VERIFIED_GOOGLE_FLOW_CONCURRENCY_LIMIT);
}

function fingerprintRuntimeValue(value: RuntimeValue): unknown {
  if (value.type === 'image' || value.type === 'video' || value.type === 'media') {
    const media = value.value as { mediaId?: string; projectId?: string; type?: string } | null;
    return {
      type: value.type,
      mediaId: media?.mediaId ?? null,
      projectId: media?.projectId ?? null,
      mediaType: media?.type ?? null,
    };
  }
  return { type: value.type, value: value.value };
}

function fingerprintResolvedInputs(inputs: Record<string, RuntimeInputValue>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(inputs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([handle, value]) => [
        handle,
        Array.isArray(value) ? value.map(fingerprintRuntimeValue) : fingerprintRuntimeValue(value),
      ]),
  );
}

interface RunSession {
  runId: string;
  context: ExecutionContext;
  completed: Set<string>;
  failed: Set<string>;
  outputs: Map<string, Record<string, RuntimeValue>>;
  planEdges: PlanEdge[];
  plan: CompiledGraph;
  abort: AbortController;
  retrySnapshot: string;
}

export class WorkflowRuntime {
  private readonly adapter: GoogleFlowAdapter;
  private readonly executors: ReadonlyMap<string, NodeExecutor>;
  private readonly poller: PollManager;
  private readonly projectCaches = new Map<string, CacheStore>();
  private activeRun: RunSession | null = null;

  constructor(adapter: GoogleFlowAdapter) {
    this.adapter = adapter;
    this.poller = new PollManager();
    this.executors = buildExecutors(adapter, this.poller);
  }

  private cacheForProject(projectId: string): CacheStore {
    let cache = this.projectCaches.get(projectId);
    if (!cache) {
      if (this.projectCaches.size >= 10) {
        const oldest = this.projectCaches.keys().next().value;
        if (oldest !== undefined) {
          this.projectCaches.get(oldest)?.clear();
          this.projectCaches.delete(oldest);
        }
      }
      cache = new CacheStore(projectId);
      this.projectCaches.set(projectId, cache);
    }
    return cache;
  }

  /** Clear cached results for a project (FG-0206 switch & reset / FG-0902 invalidation). */
  clearProjectCache(projectId: string): void {
    this.projectCaches.get(projectId)?.clear();
    this.projectCaches.delete(projectId);
  }

  validate(nodes: NodeSpecForValidation[], edges: RuntimePlanEdge[], activeProject: ActiveProject | null): ValidationReport {
    return validateGraph(nodes, edges, {
      activeProject,
      supportedKinds: supportedKinds,
      modelResolver: registryModelResolver,
    });
  }

  async run(nodes: NodeSpecForValidation[], edges: RuntimePlanEdge[], options: RuntimeRunOptions, emit: RuntimeEmit): Promise<void> {
    const session = await this.prepareRun(nodes, edges, options, emit);
    await this.executeSession(session, nodes, options, emit, true);
  }

  /** FG-0805 — retry every retryable failed node; upstream successes are preserved. */
  async retryFailed(nodes: NodeSpecForValidation[], edges: RuntimePlanEdge[], options: RuntimeRunOptions, emit: RuntimeEmit): Promise<void> {
    const session = this.activeRun;
    if (!session) throw new RuntimeError('PROVIDER_ERROR', 'No run session to retry.');
    this.assertRetryGraphUnchanged(session, nodes, edges, options);
    const retryable = [...session.failed].filter((nodeId) => session.context.failureFor(nodeId)?.retryable === true);
    if (!retryable.length) throw new RuntimeError('INVALID_INPUT', 'No retryable failures to retry.');
    for (const nodeId of retryable) {
      session.failed.delete(nodeId);
      // Nodes skipped because of this failure must be reopened as well, otherwise
      // the retried node can succeed while its downstream remains permanently skipped.
      for (const downstream of downstreamOf(nodeId, session.planEdges)) session.failed.delete(downstream);
    }
    await this.executeSession(session, nodes, options, emit, false);
  }

  /** FG-0804 — retry one selected node and resume downstream (never reruns upstream). */
  async retryNode(nodeId: string, nodes: NodeSpecForValidation[], edges: RuntimePlanEdge[], options: RuntimeRunOptions, emit: RuntimeEmit): Promise<void> {
    const session = this.activeRun;
    if (!session) throw new RuntimeError('PROVIDER_ERROR', 'No run session to retry.');
    this.assertRetryGraphUnchanged(session, nodes, edges, options);
    const failure = session.context.failureFor(nodeId);
    if (!failure || !failure.retryable) throw new RuntimeError('INVALID_INPUT', `Node ${nodeId} has no retryable failure.`, { nodeId });
    session.failed.delete(nodeId);
    for (const downstream of downstreamOf(nodeId, session.planEdges)) session.failed.delete(downstream);
    await this.executeSession(session, nodes, options, emit, false);
  }

  /** FG-0806 — abort the active run and best-effort provider cancel of in-flight jobs. */
  async cancel(): Promise<void> {
    const session = this.activeRun;
    if (!session) return;
    session.abort.abort();
    // Cancel only provider media jobs whose real mediaId is known. A graph nodeId is
    // not a provider mediaId, so sending failed node ids here was a no-op at best.
    for (const mediaId of session.context.activeMediaIds) {
      void this.adapter.cancel({ projectId: session.context.activeProject.projectId, mediaId }).catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private assertRetryGraphUnchanged(
    session: RunSession,
    nodes: NodeSpecForValidation[],
    edges: RuntimePlanEdge[],
    options: RuntimeRunOptions,
  ): void {
    const report = this.validate(nodes, edges, options.activeProject);
    if (!report.valid) {
      throw new RuntimeError('INVALID_INPUT', 'Workflow validation failed — see the pre-run report.');
    }
    if (retryGraphChanged(session.retrySnapshot, nodes, edges)) {
      throw new RuntimeError(
        'INVALID_INPUT',
        'Workflow graph or config changed since this run failed. Run the workflow fresh instead of retrying.',
      );
    }
  }

  private async prepareRun(nodes: NodeSpecForValidation[], edges: RuntimePlanEdge[], options: RuntimeRunOptions, emit: RuntimeEmit): Promise<RunSession> {
    this.activeRun?.abort.abort();
    const runId = crypto.randomUUID();
    const cache = options.cache ?? this.cacheForProject(options.activeProject.projectId);
    const abort = new AbortController();
    const context = new ExecutionContext({
      runId,
      workflowId: options.workflowId,
      activeProject: options.activeProject,
      account: options.account,
      flow: options.flow,
      abortSignal: abort.signal,
      cache,
      transportPreference: options.transportPreference,
    });
    const planEdges: PlanEdge[] = edges.map((edge) => ({ ...edge, sourceHandle: edge.sourceHandle ?? undefined, targetHandle: edge.targetHandle ?? undefined }));
    const plan = planGraph(nodes.map((node) => ({ id: node.id, kind: node.kind })), planEdges);

    emit({ type: 'run', runId, state: 'validating' });
    const report = this.validate(nodes, edges, options.activeProject);
    if (!report.valid) {
      emit({ type: 'run', runId, state: 'failed', issues: report.errors });
      throw new RuntimeError('INVALID_INPUT', 'Workflow validation failed — see the pre-run report.');
    }
    emit({ type: 'run', runId, state: 'running' });

    const session: RunSession = {
      runId,
      context,
      completed: new Set(options.initialCompleted ? [...options.initialCompleted] : []),
      failed: new Set(),
      outputs: new Map(options.initialOutputs ? [...options.initialOutputs.entries()] : []),
      planEdges,
      plan,
      abort,
      retrySnapshot: workflowRetrySnapshot(nodes, edges),
    };
    this.activeRun = session;
    return session;
  }

  private async executeSession(session: RunSession, nodes: NodeSpecForValidation[], options: RuntimeRunOptions, emit: RuntimeEmit, emitQueued: boolean): Promise<void> {
    const { runId, context, completed, failed, outputs, planEdges } = session;
    const concurrency = resolveEffectiveConcurrency(options.concurrency);
    const byId = new Map(nodes.map((node) => [node.id, node]));

    try {
      for (const nodeId of session.plan.disconnected) {
        if (!completed.has(nodeId) && !failed.has(nodeId)) {
          completed.add(nodeId);
          emit({ type: 'node', runId, nodeId, state: 'skipped' });
        }
      }
      for (;;) {
        // On abort the batch workers drain quickly; break instead of throwing so
        // the cancelled run event is still emitted before the promise rejects.
        if (context.aborted) break;

        const ready = readyNodes(session.plan.order, planEdges, completed, failed);
        if (!ready.length) break;
        const staged = selectReadyStage(ready, byId);
        if (!staged.length) break;
        if (emitQueued) for (const id of staged) emit({ type: 'node', runId, nodeId: id, state: 'queued' });

        await this.executeBatch(session, byId, staged, options, emit, concurrency, this.executors);

        // A failed node blocks only its downstream — independent branches keep running.
        for (const nodeId of [...failed]) {
          for (const downstream of downstreamOf(nodeId, planEdges)) {
            if (!completed.has(downstream) && !failed.has(downstream)) {
              failed.add(downstream);
              emit({ type: 'node', runId, nodeId: downstream, state: 'skipped' });
            }
          }
        }
      }

      const allDone = nodes.every((node) => completed.has(node.id) || failed.has(node.id));
      const runState: RuntimeRunState = context.aborted
        ? 'cancelled'
        : failed.size === 0 ? 'success' : allDone ? 'failed' : 'cancelled';
      emit({ type: 'run', runId, state: runState });
      if (runState === 'cancelled') throw new RuntimeError('CANCELLED', 'Run was cancelled.');
      if (runState === 'failed') {
        const first = [...failed].find((id) => context.failureFor(id));
        if (first) throw context.failureFor(first) as RuntimeError;
      }
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw toRuntimeError(error);
    } finally {
      if (context.aborted) this.activeRun = null;
    }
  }

  private async executeBatch(
    session: RunSession,
    byId: Map<string, NodeSpecForValidation>,
    ready: string[],
    options: RuntimeRunOptions,
    emit: RuntimeEmit,
    concurrency: number,
    executors: ReadonlyMap<string, NodeExecutor>,
  ): Promise<void> {
    const { runId, context, completed, failed, outputs, planEdges, abort } = session;
    const queue = [...ready];
    let cursor = 0;

    async function worker(): Promise<void> {
      for (;;) {
        const index = cursor++;
        if (index >= queue.length || context.aborted) return;
        const nodeId = queue[index];
        const node = byId.get(nodeId);
        if (!node) {
          failed.add(nodeId);
          emit({ type: 'node', runId, nodeId, state: 'failed', error: { code: 'UNSUPPORTED_NODE', message: 'Node definition missing.', retryable: false } });
          continue;
        }
        const executor = executors.get(node.kind);
        if (!executor) {
          failed.add(nodeId);
          emit({ type: 'node', runId, nodeId, state: 'failed', error: { code: 'UNSUPPORTED_NODE', message: `No runtime executor for "${node.kind}".`, retryable: false } });
          continue;
        }

        emit({ type: 'node', runId, nodeId, state: 'running' });
        try {
          context.throwIfAborted();
          const inputValues: Record<string, RuntimeInputValue> = {};
          for (const edge of planEdges.filter((candidate) => candidate.target === nodeId)) {
            const sourceOutput = outputs.get(edge.source)?.[edge.sourceHandle ?? ''];
            if (sourceOutput !== undefined) {
              const handle = edge.targetHandle ?? '';
              const existing = inputValues[handle];
              if (existing === undefined) {
                inputValues[handle] = sourceOutput;
              } else if (Array.isArray(existing)) {
                existing.push(sourceOutput);
              } else {
                inputValues[handle] = [existing, sourceOutput];
              }
            }
          }

          // FG-0902 — cache hit short-circuits provider calls (credit protection).
          const upstreamMediaIds = Object.values(inputValues)
            .flatMap((val) => (Array.isArray(val) ? val : [val]))
            .map((value) => (value.type === 'image' || value.type === 'video' ? (value.value as { mediaId?: string })?.mediaId : undefined))
            .filter((value): value is string => Boolean(value));
          const fingerprint = fingerprintNode({
            nodeKind: node.kind,
            config: node.config,
            // Cache identity must use the resolved Prompt input, not only node.config.prompt.
            // Otherwise two T2I/T2V nodes fed by different Prompt nodes can collide and
            // incorrectly reuse the first node's generated media.
            prompt: asText(inputValues.prompt) ?? String(node.config.prompt ?? ''),
            model: String(node.config.usageKey ?? node.config.model ?? ''),
            seed: node.config.seed,
            upstreamMediaIds,
            resolvedInputs: fingerprintResolvedInputs(inputValues),
            projectId: options.activeProject.projectId,
          });
          const cached = options.bypassCache || options.bypassCacheNodeIds?.has(nodeId) || !isCacheableNodeKind(node.kind)
            ? undefined
            : context.cache?.get(fingerprint);
          if (cached) {
            outputs.set(nodeId, cached.output as Record<string, RuntimeValue>);
            completed.add(nodeId);
            emit({
              type: 'node',
              runId,
              nodeId,
              state: 'success',
              result: attachTrustedProjectToNodeResult(
                (cached.fullOutput as { result?: RuntimeNodeEvent['result'] } | undefined)?.result,
                options.activeProject.projectId,
              ),
              creditsUsed: 0,
              cacheHit: true,
              outputs: cached.output as Record<string, RuntimeValue>,
            });
            continue;
          }

          const execContext = {
            runId,
            nodeId,
            inputs: inputValues,
            config: node.config,
            context,
          };
          const preflight = executor.validate(execContext);
          if (!preflight.valid) {
            throw new RuntimeError('INVALID_INPUT', preflight.errors.join(' ') || 'Executor rejected node inputs.', { nodeId });
          }
          const execPromise = executor.execute(execContext, abort.signal);
          let output;
          try {
            output = await raceWithSignal(execPromise, abort.signal);
          } catch (error) {
            void execPromise.catch(() => undefined);
            throw error;
          }
          context.throwIfAborted();

          outputs.set(nodeId, output.outputs);
          if (isCacheableNodeKind(node.kind)) {
            context.cache?.set(fingerprint, { nodeId, output: output.outputs, fullOutput: output, fingerprint, completedAt: new Date().toISOString() });
          }
          completed.add(nodeId);
          emit({ type: 'node', runId, nodeId, state: 'success', outputs: output.outputs, result: attachTrustedProjectToNodeResult(output.result, options.activeProject.projectId), creditsUsed: output.creditsUsed });
        } catch (error) {
          const runtimeError = toRuntimeError(error, nodeId);
          reportDiagnostic('WORKFLOW_FAILED');
          context.fail(nodeId, runtimeError);
          failed.add(nodeId);
          emit({
            type: 'node',
            runId,
            nodeId,
            state: 'failed',
            error: {
              code: runtimeError.code,
              message: runtimeError.message,
              retryable: runtimeError.retryable,
              diagnosticId: runtimeError.diagnosticId,
              ...(runtimeError.reason ? { reason: runtimeError.reason } : {}),
            },
          });
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, Math.max(ready.length, 1)) }, () => worker());
    await Promise.all(workers);
  }
}

export { supportedKinds as supportsRuntimeKind } from './executors';
export { fingerprintNode, isCacheableNodeKind } from './CacheStore';
export type { CachedNodeResult, RuntimeCache };
