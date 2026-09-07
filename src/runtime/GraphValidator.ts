// Graph validation (FG-0401/0402/0403) — port-level + graph-level pre-run report.
// Blocking errors must be fixed before Run calls Google Flow (no wasted credits).
import { planGraph, type PlanEdge, type PlanNode } from './GraphPlanner';

export type { PlanEdge } from './GraphPlanner';

export interface RuntimePlanEdge extends Omit<PlanEdge, 'sourceHandle' | 'targetHandle'> {
  sourceHandle?: string | null;
  targetHandle?: string | null;
}
import type { PortDataType } from '../ui/studio/ports';

export type ValidationSeverity = 'ERROR' | 'WARNING';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  nodeIds: string[];
}

export interface ValidationReport {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  valid: boolean;
}

export interface PortSpec {
  id: string;
  label: string;
  type: PortDataType;
  required?: boolean;
  multiple?: boolean;
  configKey?: string;
}

export interface NodeSpecForValidation {
  id: string;
  kind: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  config: Record<string, string>;
}

export interface ValidateOptions {
  activeProject?: { projectId: string } | null;
  supportedKinds?: ReadonlySet<string>;
  /** Validate model/aspect/duration against a provider resolver when available. */
  modelResolver?: (node: NodeSpecForValidation) => { valid: boolean; reason?: string };
}

const BASIC_TYPES: Record<string, PortDataType> = {
  prompt: 'PROMPT',
  text: 'TEXT',
  image: 'IMAGE',
  video: 'VIDEO',
  media: 'MEDIA',
  number: 'NUMBER',
  boolean: 'BOOLEAN',
};

/** Map a runtime value type to its port data type for compatibility checks. */
export function runtimeTypeToPort(runtimeType: string): PortDataType | undefined {
  return BASIC_TYPES[runtimeType];
}

/** Port type compatibility (mirrors ui/studio/ports.ts portTypesCompatible core rules). */
export function portTypesCompatible(source: PortDataType, target: PortDataType): boolean {
  if (source === target) return true;
  if (source === 'ANY' || target === 'ANY') return true;
  if (source === 'MEDIA' && ['IMAGE', 'VIDEO', 'FILE'].includes(target)) return true;
  if (target === 'MEDIA' && ['IMAGE', 'VIDEO', 'FILE'].includes(source)) return true;
  if (source === 'PROMPT' && target === 'TEXT') return true;
  if (source === 'TEXT' && target === 'PROMPT') return true;
  return false;
}

/** Build node specs from plan nodes without requiring full FlowNode types. */
export function validateGraph(nodes: NodeSpecForValidation[], edges: RuntimePlanEdge[], options: ValidateOptions = {}): ValidationReport {
  const planEdges: PlanEdge[] = edges.map((edge) => ({ ...edge, sourceHandle: edge.sourceHandle ?? undefined, targetHandle: edge.targetHandle ?? undefined }));
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const supported = options.supportedKinds;
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // Graph-level: cycles (via planner)
  const compiled = planGraph(nodes.map(({ id, kind }) => ({ id, kind })), planEdges);
  if (compiled.cycles.length) {
    errors.push({
      severity: 'ERROR',
      code: 'CYCLE_DETECTED',
      message: `Graph contains a cycle: ${compiled.cycles[0].join(' → ')}.`,
      nodeIds: compiled.cycles[0],
    });
  }

  // Graph-level: active project required
  if (!options.activeProject) {
    errors.push({
      severity: 'ERROR',
      code: 'PROJECT_REQUIRED',
      message: 'An active Google Flow project is required before running.',
      nodeIds: [],
    });
  }

  for (const node of nodes) {
    const nodeId = node.id;

    // Unsupported node kind
    if (supported && !supported.has(node.kind)) {
      errors.push({
        severity: 'ERROR',
        code: 'UNSUPPORTED_NODE',
        message: `Node "${node.kind}" has no runtime executor in this build.`,
        nodeIds: [nodeId],
      });
      continue;
    }

    // Port-level: required inputs must be connected or provided via config
    const incoming = planEdges.filter((edge) => edge.target === nodeId);
    for (const input of node.inputs) {
      const connections = incoming.filter((edge) => edge.targetHandle === input.id);
      const configProvided = input.configKey !== undefined && Boolean(node.config[input.configKey]);
      if (input.required && connections.length === 0 && !configProvided) {
        errors.push({
          severity: 'ERROR',
          code: 'MISSING_REQUIRED_INPUT',
          message: `Node requires "${input.label}" input but nothing is connected.`,
          nodeIds: [nodeId],
        });
        continue;
      }
      if (!input.multiple && connections.length > 1) {
        errors.push({
          severity: 'ERROR',
          code: 'MULTIPLE_SOURCE',
          message: `Input "${input.label}" accepts a single connection (${connections.length} found).`,
          nodeIds: [nodeId],
        });
        continue;
      }
      // Type compatibility
      for (const connection of connections) {
        const sourceNode = byId.get(connection.source);
        const sourcePort = sourceNode?.outputs.find((port) => port.id === connection.sourceHandle);
        if (sourceNode && sourcePort && !portTypesCompatible(sourcePort.type, input.type)) {
          errors.push({
            severity: 'ERROR',
            code: 'TYPE_MISMATCH',
            message: `Edge "${connection.id}" connects ${sourcePort.type} → ${input.type} (incompatible).`,
            nodeIds: [nodeId, connection.source],
          });
        }
      }
    }

    // Config validation: prompt nodes must have a prompt; generation nodes need a model
    const configNode = node.config as Record<string, unknown>;
    if (node.kind === 'prompt' && !String(configNode.prompt ?? '').trim()) {
      errors.push({
        severity: 'ERROR',
        code: 'MISSING_CONFIG',
        message: 'Prompt node has an empty prompt.',
        nodeIds: [nodeId],
      });
    }
    if (['t2i', 'i2v', 't2v', 'extend'].includes(node.kind) && !configNode.model) {
      errors.push({
        severity: 'ERROR',
        code: 'INVALID_MODEL',
        message: `Node is missing its model/resolution config.`,
        nodeIds: [nodeId],
      });
    }

    // Model/duration/aspect validation via provider resolver
    if (options.modelResolver) {
      const resolved = options.modelResolver(node);
      if (!resolved.valid) {
        errors.push({
          severity: 'ERROR',
          code: 'INVALID_MODEL',
          message: resolved.reason ?? 'Model configuration does not match the provider registry.',
          nodeIds: [nodeId],
        });
      }
    }
  }

  // Disconnected required inputs from disconnected nodes → warning, not error (may be intentional leaves)
  if (compiled.disconnected.length) {
    warnings.push({
      severity: 'WARNING',
      code: 'DISCONNECTED_NODES',
      message: `Nodes with no root path will be skipped: ${compiled.disconnected.join(', ')}.`,
      nodeIds: compiled.disconnected,
    });
  }

  return { errors, warnings, valid: errors.length === 0 };
}

export function validateAgainstPorts(
  kind: string,
  config: Record<string, string>,
  inputs: PortSpec[],
  outputs: PortSpec[],
  supportedKinds?: ReadonlySet<string>,
): ValidationIssue[] {
  const report = validateGraph([{ id: 'node', kind, config, inputs, outputs }], [], { activeProject: { projectId: 'x' }, supportedKinds });
  return [...report.errors, ...report.warnings];
}
