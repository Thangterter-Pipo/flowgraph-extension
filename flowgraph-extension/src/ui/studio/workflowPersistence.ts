import {
  cloneInitialNodes,
  initialEdges,
  type FlowEdge,
  type FlowNode,
  type NodeStatus,
} from './model';

export const WORKFLOW_SCHEMA_VERSION = 4;
export const LEGACY_WORKFLOW_KEY = 'flowgraph.demo.workflow';
const WORKFLOW_KEY_PREFIX = 'flowgraph.workflow.v1';

export interface SavedWorkflow {
  schemaVersion: number;
  workflowId?: string;
  name: string;
  savedAt: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  projectBinding?: { projectId: string; projectName: string };
  runtimeResults?: Record<string, { type: 'image' | 'video'; mediaId: string; mimeType?: string; fileName?: string }>;
}

type ReadWriteStorage = Pick<Storage, 'getItem' | 'setItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

export function workflowStorageKey(projectId: string, workflowId: string) {
  return `${WORKFLOW_KEY_PREFIX}.${encodeURIComponent(projectId)}.${encodeURIComponent(workflowId)}`;
}

function nodesForPersistence(nodes: FlowNode[]): FlowNode[] {
  return nodes.map((node) => {
    // Strip transient preview URL from result
    const result = node.data.result ? { ...node.data.result, previewUrl: '' } : undefined;
    // Strip any signed URLs or transient data from config
    const config = { ...node.data.config };
    delete config.signedPreviewUrl;
    delete config.transientUrl;

    return {
      ...node,
      data: {
        ...node.data,
        result,
        config,
      },
    };
  });
}

export function buildSavedWorkflow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  workflowId: string,
  workflowName: string,
  projectBinding?: { projectId: string; projectName: string },
): SavedWorkflow {
  const runtimeResults: NonNullable<SavedWorkflow['runtimeResults']> = {};
  for (const node of nodes) {
    if (node.data.result?.mediaId) {
      runtimeResults[node.id] = {
        type: node.data.result.type,
        mediaId: node.data.result.mediaId,
        mimeType: node.data.result.mimeType,
        fileName: node.data.result.fileName,
      };
    }
  }

  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    workflowId,
    name: workflowName,
    savedAt: new Date().toISOString(),
    nodes: nodesForPersistence(nodes),
    edges,
    projectBinding,
    runtimeResults: Object.keys(runtimeResults).length ? runtimeResults : undefined,
  };
}

export function persistWorkflow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  workflowId: string,
  workflowName: string,
  projectBinding?: { projectId: string; projectName: string },
  storage: WriteStorage = localStorage,
) {
  const payload = buildSavedWorkflow(nodes, edges, workflowId, workflowName, projectBinding);
  const key = projectBinding?.projectId
    ? workflowStorageKey(projectBinding.projectId, workflowId)
    : LEGACY_WORKFLOW_KEY;
  storage.setItem(key, JSON.stringify(payload));
}

export function readSavedWorkflow(
  projectId?: string,
  workflowId = 'main',
  storage: ReadWriteStorage = localStorage,
): SavedWorkflow | undefined {
  try {
    const primaryKey = projectId ? workflowStorageKey(projectId, workflowId) : LEGACY_WORKFLOW_KEY;
    const raw = storage.getItem(primaryKey);
    if (raw) {
      const saved = JSON.parse(raw) as SavedWorkflow;
      if (saved.schemaVersion === WORKFLOW_SCHEMA_VERSION && Array.isArray(saved.nodes) && Array.isArray(saved.edges)) return saved;
    }

    // One-time compatibility path for the pre-project-scoped V1 graph.
    if (projectId && workflowId === 'main') {
      const legacyRaw = storage.getItem(LEGACY_WORKFLOW_KEY);
      if (!legacyRaw) return undefined;
      const legacy = JSON.parse(legacyRaw) as SavedWorkflow;
      if (
        legacy.schemaVersion === WORKFLOW_SCHEMA_VERSION
        && legacy.projectBinding?.projectId === projectId
        && Array.isArray(legacy.nodes)
        && Array.isArray(legacy.edges)
      ) {
        const migrated = { ...legacy, workflowId: 'main' };
        storage.setItem(workflowStorageKey(projectId, 'main'), JSON.stringify(migrated));
        return migrated;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function restoreWorkflow(
  projectId?: string,
  workflowId = 'main',
  storage: ReadWriteStorage = localStorage,
) {
  const saved = readSavedWorkflow(projectId, workflowId, storage);
  const nodes = saved?.nodes?.length
    ? saved.nodes.map((node) => {
        const restored = { ...node, data: { ...node.data, status: 'idle' as NodeStatus } } as FlowNode;
        if (saved.runtimeResults?.[node.id]) {
          const media = saved.runtimeResults[node.id];
          restored.data.result = {
            type: media.type,
            previewUrl: '',
            mediaId: media.mediaId,
            mimeType: media.mimeType,
            fileName: media.fileName,
          };
          restored.data.status = 'success';
        }
        return restored;
      })
    : cloneInitialNodes();
  const edges = saved && Array.isArray(saved.edges) ? saved.edges : initialEdges;
  return { nodes, edges, name: saved?.name };
}
