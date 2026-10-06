export type AgentStatus =
  | 'idle'
  | 'running'
  | 'awaiting_approval'
  | 'rendering'
  | 'success'
  | 'error'
  | 'aborted';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface AgentTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

export interface AgentStep {
  id: string;
  timestamp: number;
  type: 'thought' | 'tool_call' | 'tool_result' | 'approval_required' | 'render_started' | 'error' | 'success';
  title: string;
  details?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
}

export interface SceneSummary {
  index: number;
  title: string;
  prompt: string;
  nodeKind?: string;
  model?: string;
  duration?: string;
}

export interface AgentApprovalRequest {
  id: string;
  /** The kind of approval requested. Omitted for backwards-compatible render approvals. */
  kind?: 'render' | 'destructive';
  title: string;
  summary: string;
  scenes: SceneSummary[];
  nodeCount: number;
  edgeCount: number;
  estimatedCredits?: string;
  graphSnapshot?: {
    nodes: any[];
    edges: any[];
  };
}

export interface AgentExecutionOptions {
  maxTurns?: number;
  signal?: AbortSignal;
  onStep?: (step: AgentStep) => void;
  onStatusChange?: (status: AgentStatus) => void;
  onApprovalRequest?: (request: AgentApprovalRequest) => Promise<boolean>;
}
