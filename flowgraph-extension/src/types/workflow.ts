export type PortType = "TEXT" | "PROMPT" | "IMAGE" | "VIDEO" | "MEDIA" | "NUMBER" | "BOOLEAN";
export type NodeRunStatus = "IDLE" | "READY" | "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
