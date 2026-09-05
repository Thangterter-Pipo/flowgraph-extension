// Node executor contract — a node's runtime behavior. Generic over execution
// context; concrete executors live in src/runtime/executors/.
import type { ExecutionContext } from '../../runtime/ExecutionContext';
import type { RuntimeValue } from '../../runtime/RuntimeValue';
import type { RuntimeErrorCode } from '../../runtime/RuntimeError';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface NodeExecutionContext {
  runId: string;
  nodeId: string;
  inputs: Record<string, RuntimeValue>;
  config: Record<string, unknown>;
  context: ExecutionContext;
}

export interface NodeExecutorOutput {
  outputs: Record<string, RuntimeValue>;
  /** Media result for UI preview, when the node produced media. */
  result?: { type: 'image' | 'video'; mediaId: string; previewUrl: string; mimeType?: string; fileName?: string };
  creditsUsed?: number;
}

export interface NodeExecutor {
  readonly kind: string;
  validate(context: NodeExecutionContext): ValidationResult;
  execute(context: NodeExecutionContext, abortSignal?: AbortSignal): Promise<NodeExecutorOutput>;
  /** Whether this node's failure is retryable — default: only transient provider errors. */
  retryable?(error: { code: RuntimeErrorCode }): boolean;
}
