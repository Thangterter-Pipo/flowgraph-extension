// studioHelpers.ts — Pure utility functions for the Studio canvas.
// Extracted from main.tsx to reduce file size (FG refactor).
// These functions have no React hooks and can be unit-tested independently.
import {
  deriveRegistryConfig,
  type ServiceTier,
} from './flowModelRegistry';
import { type FlowEdge, type FlowNode } from './model';
import { loadSettings } from './SettingsModal';
import { isSyncGenerationNode, normalizeFlowUiModelLabel, getSyncNodeCapability } from '../../shared/sync/SyncCapabilityRegistry';
import { type FlowSyncField } from '../../shared/sync/FlowSyncTypes';
import { restoreWorkflow } from './workflowPersistence';

// ─── Project / Entitlement Storage ──────────────────────────────────────────

export function getStoredActiveProjectId(): string | undefined {
  try {
    const raw = localStorage.getItem('flowgraph.activeProject');
    if (raw) {
      const parsed = JSON.parse(raw) as { projectId?: string };
      return parsed.projectId;
    }
  } catch { /* ignore */ }
  return undefined;
}

export function storedEntitlementServiceTier(): string | undefined {
  const entitlement = loadSettings().flowEntitlement;
  if (entitlement === 'ultra') return 'SERVICE_TIER_ADVANCED';
  if (entitlement === 'pro') return 'SERVICE_TIER_INTERMEDIATE';
  return undefined;
}

export function applyStoredEntitlement(nodes: FlowNode[]): FlowNode[] {
  const serviceTier = storedEntitlementServiceTier() ?? 'SERVICE_TIER_INTERMEDIATE';
  return nodes.map((node) => {
    const effectiveTier = (node.data.config?.serviceTier as ServiceTier | undefined) || serviceTier;
    return {
      ...node,
      data: {
        ...node.data,
        config: deriveRegistryConfig(node.data.kind, {
          ...(node.data.config || {}),
          serviceTier: effectiveTier,
        }),
      },
    };
  });
}

export function restoreSavedNodes(): FlowNode[] {
  const projectId = getStoredActiveProjectId();
  return applyStoredEntitlement(restoreWorkflow(projectId, 'main').nodes);
}

export function restoreSavedEdges(): FlowEdge[] {
  const projectId = getStoredActiveProjectId();
  return restoreWorkflow(projectId, 'main').edges;
}

export function initialSelectedNodeId(): string {
  const restored = restoreSavedNodes();
  return restored.find((node) => isSyncGenerationNode(node.data.kind))?.id ?? restored[0]?.id ?? '';
}

// ─── Sync Value Helpers ───────────────────────────────────────────────────────

export function ratioForFlow(value: string | undefined): string | undefined {
  return value?.match(/\b\d{1,2}:\d{1,2}\b/)?.[0];
}

export function resolveSelectedSyncTarget(
  selected: FlowNode | undefined,
  nodes: FlowNode[],
  edges: FlowEdge[],
): FlowNode | undefined {
  if (!selected) return undefined;
  if (isSyncGenerationNode(selected.data.kind)) return selected;
  if (selected.data.kind !== 'prompt') return undefined;
  const downstream = edges
    .filter((edge) => edge.source === selected.id && edge.targetHandle === 'prompt')
    .map((edge) => nodes.find((node) => node.id === edge.target))
    .filter((node): node is FlowNode => Boolean(node && isSyncGenerationNode(node.data.kind)));
  // A prompt wired to several generation nodes is ambiguous; require the user
  // to select the intended generation node rather than mirroring to one at random.
  return downstream.length === 1 ? downstream[0] : undefined;
}

export function linkedPromptForNode(
  node: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
): string | undefined {
  // Match runtime semantics: a connected Prompt input wins over a stale/configured
  // fallback on the generation node itself.
  const edge = edges.find(
    (candidate) => candidate.target === node.id && candidate.targetHandle === 'prompt',
  );
  const source = edge ? nodes.find((candidate) => candidate.id === edge.source) : undefined;
  if (source?.data.config.prompt !== undefined) return source.data.config.prompt;
  return node.data.config.prompt;
}

export function mediaBindingsAtInput(
  node: FlowNode,
  targetHandle: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
): Array<{ mediaId: string }> {
  return edges
    .filter((edge) => edge.target === node.id && edge.targetHandle === targetHandle)
    .map((edge) => nodes.find((candidate) => candidate.id === edge.source)?.data.result?.mediaId)
    .filter((mediaId): mediaId is string => Boolean(mediaId))
    .map((mediaId) => ({ mediaId }));
}

export function syncValuesForNode(
  node: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
): Partial<Record<FlowSyncField, unknown>> {
  const capability = getSyncNodeCapability(node.data.kind);
  if (!capability) return {};
  const config = node.data.config;
  const values: Partial<Record<FlowSyncField, unknown>> = {};

  for (const field of capability.fields) {
    if (field === 'prompt') {
      const prompt = linkedPromptForNode(node, nodes, edges);
      if (prompt !== undefined) values.prompt = prompt;
    } else if (field === 'model' && config.model) {
      values.model = normalizeFlowUiModelLabel(config.model);
    } else if (field === 'aspectRatio') {
      const ratio = ratioForFlow(config.aspectRatio);
      if (ratio) values.aspectRatio = ratio;
    } else if (field === 'batchCount' && config.batchCount) {
      values.batchCount = config.batchCount;
    } else if (field === 'durationSeconds' && config.duration) {
      const duration = Number.parseInt(config.duration, 10);
      if (Number.isFinite(duration)) values.durationSeconds = duration;
    } else if (field === 'seed' && config.seed) {
      const seed = Number.parseInt(config.seed, 10);
      if (Number.isInteger(seed)) values.seed = seed;
    } else if (field === 'targetResolution') {
      const resolution = config.targetResolution ?? config.resolution;
      if (resolution) values.targetResolution = resolution;
    } else if (field === 'startImage') {
      const handle = node.data.kind === 'i2v' ? 'image' : 'startImage';
      const [binding] = mediaBindingsAtInput(node, handle, nodes, edges);
      if (binding) values.startImage = binding;
    } else if (field === 'endImage') {
      const [binding] = mediaBindingsAtInput(node, 'endImage', nodes, edges);
      if (binding) values.endImage = binding;
    } else if (field === 'referenceMedia') {
      const bindings = mediaBindingsAtInput(node, 'references', nodes, edges);
      if (bindings.length) {
        values.referenceMedia = bindings;
      } else if (config.flowReferenceMediaIds) {
        const persisted = config.flowReferenceMediaIds
          .split(',')
          .map((mediaId: string) => mediaId.trim())
          .filter(Boolean)
          .map((mediaId: string) => ({ mediaId }));
        if (persisted.length) values.referenceMedia = persisted;
      }
    }
  }
  return values;
}
