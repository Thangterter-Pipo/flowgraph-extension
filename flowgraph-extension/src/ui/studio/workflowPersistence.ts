import {
  cloneInitialNodes,
  initialEdges,
  type FlowEdge,
  type FlowNode,
  type NodeStatus,
} from './model';

export const WORKFLOW_SCHEMA_VERSION = 4;
const isStitchArtifactId = (id?: string) => Boolean(id?.startsWith('stitch-idb:'));
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
  runtimeResults?: Record<string, { type: 'image' | 'video'; mediaId: string; mimeType?: string; fileName?: string; projectId?: string }>;
}

type ReadWriteStorage = Pick<Storage, 'getItem' | 'setItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

function isLocalPseudoMediaId(mediaId?: string): boolean {
  return Boolean(mediaId && /^(?:local-|dropped-|local-vid-)/.test(mediaId));
}

export function workflowStorageKey(projectId: string, workflowId: string) {
  return `${WORKFLOW_KEY_PREFIX}.${encodeURIComponent(projectId)}.${encodeURIComponent(workflowId)}`;
}

function nodesForPersistence(nodes: FlowNode[]): FlowNode[] {
  return nodes.map((node) => {
    // Nếu là ảnh/video kéo từ ngoài vào (có dataUrl hoặc previewUrl dạng blob: hay data:),
    // hoặc có mediaId, thì bảo tồn previewUrl nếu là data: URL để khi reload không bao giờ mất ảnh!
    let previewUrl = '';
    if (node.data.result?.previewUrl?.startsWith('data:')) {
      previewUrl = node.data.result.previewUrl;
    } else if (node.data.config?.localDataUrl?.startsWith('data:') || node.data.config?.localDataUrl?.startsWith('blob:')) {
      previewUrl = node.data.config.localDataUrl;
    }

    const result = node.data.result ? { ...node.data.result, previewUrl } : undefined;

    // Strip signed URLs or transient URLs
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
    if (node.data.result?.mediaId && !isLocalPseudoMediaId(node.data.result.mediaId)) {
      runtimeResults[node.id] = {
        type: node.data.result.type,
        mediaId: node.data.result.mediaId,
        mimeType: node.data.result.mimeType,
        fileName: node.data.result.fileName,
        projectId: node.data.result.projectId,
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
  try {
    const payload = buildSavedWorkflow(nodes, edges, workflowId, workflowName, projectBinding);
    const key = projectBinding?.projectId
      ? workflowStorageKey(projectBinding.projectId, workflowId)
      : LEGACY_WORKFLOW_KEY;
    storage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    // Chống sập do QuotaExceededError khi kéo ảnh dung lượng lớn
    if (error instanceof Error && (error.name === 'QuotaExceededError' || error.message.includes('quota'))) {
      console.warn('localStorage QuotaExceededError: stripping large local data URLs and retrying');
      try {
        const strippedNodes = nodes.map((n) => {
          const config = { ...n.data.config };
          delete config.localDataUrl;
          const result = n.data.result ? { ...n.data.result, previewUrl: '' } : undefined;
          return {
            ...n,
            data: {
              ...n.data,
              config,
              result,
            },
          };
        });
        const strippedPayload = buildSavedWorkflow(strippedNodes, edges, workflowId, workflowName, projectBinding);
        const key = projectBinding?.projectId
          ? workflowStorageKey(projectBinding.projectId, workflowId)
          : LEGACY_WORKFLOW_KEY;
        storage.setItem(key, JSON.stringify(strippedPayload));
      } catch (innerError) {
        console.error('Failed to persist workflow even after stripping large data URLs:', innerError);
      }
    } else {
      console.error('Failed to persist workflow:', error);
    }
  }
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

export function resolveHydratedProjectId(
  activeProjectId?: string,
  hydratedProjectId?: string,
): string | undefined {
  return activeProjectId && hydratedProjectId === activeProjectId ? activeProjectId : undefined;
}

export function shouldPersistToProject(activeProjectId?: string, hydratedProjectId?: string): boolean {
  return resolveHydratedProjectId(activeProjectId, hydratedProjectId) !== undefined;
}

export function persistWorkflowIfHydrated(
  nodes: FlowNode[],
  edges: FlowEdge[],
  workflowId: string,
  workflowName: string,
  projectBinding: { projectId: string; projectName: string } | undefined,
  hydratedProjectId: string | undefined,
  storage: WriteStorage = localStorage,
): boolean {
  if (!shouldPersistToProject(projectBinding?.projectId, hydratedProjectId)) return false;
  persistWorkflow(nodes, edges, workflowId, workflowName, projectBinding, storage);
  return true;
}

export function restoreWorkflow(
  projectId?: string,
  workflowId = 'main',
  storage: ReadWriteStorage = localStorage,
) {
  const saved = readSavedWorkflow(projectId, workflowId, storage);
  const nodes = saved?.nodes?.length
    ? saved.nodes.map((node) => {
        const restored = { ...node, data: { ...node.data } } as FlowNode;
        if (saved.runtimeResults?.[node.id]) {
          const media = saved.runtimeResults[node.id];
          restored.data.result = {
            type: media.type,
            previewUrl: isStitchArtifactId(media.mediaId) ? '' : node.data.result?.previewUrl || (media.type === 'video'
              ? (media.mediaId.startsWith('stitched-') || media.mediaId.startsWith('concat-')
                  ? ''
                  : `https://flow-content.google/video/${media.mediaId}`)
              : ''),
            mediaId: media.mediaId,
            mimeType: media.mimeType,
            fileName: media.fileName,
            projectId: media.projectId || node.data.result?.projectId,
          };
          restored.data.status = 'success';
        } else if (node.data.config?.localDataUrl) {
          // Restore the local preview, but never mark a local pseudo-id as provider success.
          restored.data.result = {
            type: 'image',
            previewUrl: String(node.data.config.localDataUrl),
            mediaId: node.data.result?.mediaId || `local-${node.id}`,
          };
          restored.data.status = 'idle';
        } else if (node.data.result?.mediaId) {
          restored.data.status = isLocalPseudoMediaId(node.data.result.mediaId) ? 'idle' : 'success';
        }
        return restored;
      })
    : cloneInitialNodes();
  const edges = saved && Array.isArray(saved.edges) ? saved.edges : initialEdges;
  return { nodes, edges, name: saved?.name };
}
