import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import {
  addEdge,
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useUpdateNodeInternals,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  BookmarkCheck,
  BookmarkPlus,
  CircleUserRound,
  EllipsisVertical,
  FileDown,
  LayoutGrid,
  LayoutTemplate,
  Maximize2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,

  Trash2,
  Undo2,
  Redo2,
  Settings as SettingsIcon,
  Workflow,
  X,
  Layers,
  FolderOpen,
  Images,
  ChevronRight,
  Sliders,
  Terminal,
  Sun,
  Moon,
  Upload,
} from 'lucide-react';
import { calculateAutoLayout } from './autoLayout';
import { AvoidObstacleEdge } from './AvoidObstacleEdge';

const edgeTypes = {
  default: AvoidObstacleEdge,
  avoid: AvoidObstacleEdge,
};
import { TemplatesModal } from './TemplatesModal';
import {
  SettingsModal,
  loadSettings,
  saveSettings,
  type FlowGraphSettings,
} from './SettingsModal';
import {
  applyTheme,
  getPairedTheme,
  getThemeDefinition,
  isLightTheme,
} from '../themeSystem';
import { DebugLogDrawer } from './DebugLogDrawer';
import {
  BUILTIN_TEMPLATES,
  deleteCustomTemplate,
  loadAllTemplates,
  saveCustomTemplate,
  type WorkflowTemplate,
} from './workflowTemplates';
import '../theme.css';
import WorkflowNode, { NodeIcon } from './WorkflowNode';
import {
  WORKFLOW_SCHEMA_VERSION,
  buildSavedWorkflow,
  persistWorkflowIfHydrated,
  resolveHydratedProjectId,
  restoreWorkflow,
} from './workflowPersistence';
import { getMediaBlob, setMediaBlob } from './mediaStorage';
import {
  bindProviderMediaInput,
  collectVerifiedGraphMedia,
  localImageDropAction,
} from './mediaInputUi';
import { applySelectAllNodes, isEditableKeyTarget, isSelectAllShortcut } from './canvasKeyboard';
import {
  PROJECT_UPLOAD_DROP_COPY,
  PROJECT_UPLOAD_TITLE,
  PROJECT_UPLOAD_VIDEO_DISABLED,
  acceptProjectUploadResult,
  beginProjectImageUpload,
  classifyProjectUploadFile,
  friendlyUploadError,
  projectUploadAvailability,
  recentUploadAsVerifiedMedia,
  recentUploadInputKind,
  recentUploadsForProject,
  loadMediaLibrary,
  saveMediaLibrary,
  type ProjectUploadState,
  type RecentProjectUpload,
} from './projectMediaUploadUi';
import { MediaLibrary } from './MediaLibrary';
import { RunModeControl } from './RunModeControl';
import { buildRunModePlan, createRunReceipt, runNodeSignatures, type WorkflowRunMode } from './workflowRunMode';
import {
  FLOWGRAPH_MEDIA_CLIP,
  FLOWGRAPH_MEDIA_DRAG,
  FLOWGRAPH_NODES_CLIP,
  copySelectedGraph,
  cutSelectedGraph,
  isCopyShortcut,
  isCutShortcut,
  isPasteShortcut,
  parseClipboardPayload,
  pasteGraph,
} from './studioClipboard';
import {
  cloneInitialNodes,
  cloneFlowEdges,
  cloneFlowNodes,
  hydrateNodeData,
  initialEdges,
  palette,
  paletteSpecForKind,
  type FlowEdge,
  type FlowNode,
  type NodeStatus,
  type PaletteSpec,
  type RunStatus,
} from './model';
import {
  aspectRatioOptions,
  deriveRegistryConfig,
  modelFamilyOptions,
} from './flowModelRegistry';
import { inputPort, outputPort, portTypesCompatible, portsForKind } from './ports';
import { useStudioConnection, type ActiveProjectState, computeRunBlockReason, type RunBlockReason } from './useStudioConnection';
import { ConnectionPill, ProjectDropdown, ProjectGateOverlay, accountPillLabel, flowPillLabel } from './ProjectGate';
import {
  PENDING_RUN_ID,
  acceptRuntimeEvent,
  filterEdgeChangesDuringRun,
  filterNodeChangesDuringRun,
  generationAfterProjectChange,
  isLiveRun,
  isProjectSelectLocked,
  isSemanticMutationLocked,
  type RunGeneration,
} from './runGenerationGuard';
import {
  applySemanticReverseSync,
  collectDownstreamNodeIds,
  resetRuntimeStateForNodes,
} from './reverseSyncInvalidation';
import { RealGoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';

import { WorkflowRuntime, type RuntimeEvent } from '../../runtime/WorkflowRuntime';
import { RuntimeError } from '../../runtime/RuntimeError';
import { validateGraph } from '../../runtime/GraphValidator';
import { registryModelResolver } from '../../runtime/registryModelResolver';
import { supportedKinds } from '../../runtime/executors';
import { FlowSyncController } from '../../shared/sync/FlowSyncController';
import {
  isAuthoritativeFlowToStudioEvent,
  type FlowSyncEvent,
  type FlowSyncField,
} from '../../shared/sync/FlowSyncTypes';
import { flowUiModelLabelsEquivalent, getSyncNodeCapability, isSyncGenerationNode, normalizeFlowUiModelLabel, type SyncNodeKind } from '../../shared/sync/SyncCapabilityRegistry';

function colorForTone(tone: PaletteSpec['tone']) {
  return tone === 'purple' ? '#9a52f8' : tone === 'blue' ? '#4e9fff' : tone === 'green' ? '#3ad39c' : '#ff9941';
}

// FG-1101/1102 — workflow persistence with schemaVersion + project binding.
// Auth material is never saved: only node config + media ids (no signed URLs).
// v4: the V1 graph now wires the Prompt node into the Image-to-Video node too.
// Bumping this discards previously saved graphs that lack the edge, which is the
// point — a stale saved graph would keep reproducing the empty-prompt bug.
// FG-1103 — run history (project-scoped, no secrets/signed URLs).
const RUN_HISTORY_KEY = 'flowgraph.runHistory.v1';

function recordRun(events: RuntimeEvent[], startedAt: string, workflowId: string, workflowName: string, activeProject?: ActiveProjectState, forcedStatus?: 'cancelled') {
  if (!activeProject) return;
  const runEvent = [...events].reverse().find((event): event is Extract<RuntimeEvent, { type: 'run' }> => event.type === 'run');
  const observedStatus = runEvent?.type === 'run' ? (runEvent.state === 'validating' ? 'failed' : runEvent.state) : 'failed';
  const status = forcedStatus === 'cancelled' && runEvent?.state !== 'success' ? 'cancelled' : observedStatus;
  const nodeRuns = events
    .filter((event): event is Extract<RuntimeEvent, { type: 'node' }> => event.type === 'node' && event.state !== 'queued' && event.state !== 'running')
    .map((event) => ({
      nodeId: event.nodeId,
      status: event.state === 'success' ? 'success' as const : event.state === 'skipped' ? 'skipped' as const : 'failed' as const,
      errorCode: event.error?.code,
      errorMessage: event.error?.message,
      diagnosticId: event.error?.diagnosticId,
      creditsUsed: event.creditsUsed,
      result: event.result ? { type: event.result.type, mediaId: event.result.mediaId, mimeType: event.result.mimeType, fileName: event.result.fileName } : undefined,
    }));
  const record = {
    runId: runEvent?.type === 'run' ? runEvent.runId : crypto.randomUUID(),
    workflowId,
    workflowName,
    status: status === 'cancelled' ? 'cancelled' as const : status === 'success' ? 'success' as const : 'failed' as const,
    projectId: activeProject.projectId,
    projectName: activeProject.projectName,
    startedAt,
    finishedAt: new Date().toISOString(),
    nodeRuns,
    creditDelta: 0,
  };
  try {
    const history = JSON.parse(localStorage.getItem(RUN_HISTORY_KEY) ?? '[]') as unknown[];
    history.unshift(record);
    localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
  } catch {
    // history is best-effort; never block a run on persistence.
  }
}

function useWorkflowPersistence(
  nodes: FlowNode[],
  edges: FlowEdge[],
  workflowId: string,
  workflowName: string,
  projectBinding: { projectId: string; projectName: string } | undefined,
  hydratedProjectId: string | undefined,
  autoSave: boolean,
) {
  const persistableHydratedId = resolveHydratedProjectId(projectBinding?.projectId, hydratedProjectId);
  const save = useCallback(() => {
    persistWorkflowIfHydrated(nodes, edges, workflowId, workflowName, projectBinding, persistableHydratedId);
  }, [nodes, edges, workflowId, workflowName, projectBinding, persistableHydratedId]);

  // Auto-persist only after this project's workflow is on the canvas and the user has enabled Auto Save.
  useEffect(() => {
    if (!autoSave) return;
    persistWorkflowIfHydrated(nodes, edges, workflowId, workflowName, projectBinding, persistableHydratedId);
  }, [autoSave, nodes, edges, workflowId, workflowName, projectBinding, persistableHydratedId]);

  const exportJson = useCallback(() => {
    const payload = buildSavedWorkflow(nodes, edges, workflowId, workflowName, projectBinding);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${workflowName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'flowgraph-workflow'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, workflowId, workflowName, projectBinding]);

  return { save, exportJson };
}

function NodeLibrary({
  search,
  setSearch,
  locked,
  onOpenTemplatesModal,
  onAddNode,
  onClose,
}: {
  search: string;
  setSearch: (value: string) => void;
  locked: boolean;
  onOpenTemplatesModal?: () => void;
  onAddNode?: (spec: PaletteSpec) => void;
  onClose?: () => void;
}) {
  const [activeFilter, setActiveFilter] = useState<'All' | 'Image' | 'Video' | 'Utility'>('All');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 8 Danh mục chuẩn hóa theo kiến trúc semantic UX của ChatGPT
  const categories = [
    {
      id: 'input',
      name: 'INPUT',
      kinds: ['prompt', 'imageInput', 'videoInput'],
    },
    {
      id: 'ai',
      name: 'AI & ENHANCEMENT',
      kinds: ['gemini', 'creationAgent'],
    },
    {
      id: 'image',
      name: 'IMAGE',
      kinds: ['t2i', 'imageUpscale', 'imageTransform'],
    },
    {
      id: 'video',
      name: 'VIDEO',
      kinds: ['t2v', 'i2v', 'interpolation', 'extend', 'reference', 'videoUpscale', 'videoConcat'],
    },
    {
      id: 'character',
      name: 'CHARACTER',
      kinds: ['characterCreate', 'characterAssign', 'likenessCheck', 'likenessList'],
    },
    {
      id: 'output',
      name: 'OUTPUT',
      kinds: ['preview', 'download'],
    },
    {
      id: 'logic',
      name: 'LOGIC & CONTROL',
      kinds: ['condition', 'delay', 'note', 'cancelGeneration'],
    },
  ];

  const filterMatches = (node: PaletteSpec) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || `${node.title} ${node.subtitle} ${node.kind}`.toLowerCase().includes(q);
    if (!matchesSearch) return false;

    if (activeFilter === 'All') return true;
    if (activeFilter === 'Image') return node.group === 'Image' || node.kind.toLowerCase().includes('image') || node.kind === 't2i';
    if (activeFilter === 'Video') return node.group === 'Video' || node.kind.toLowerCase().includes('video') || node.kind === 't2v' || node.kind === 'i2v';
    if (activeFilter === 'Utility') return (node.group as string) === 'Utility' || (node.group as string) === 'Logic' || node.kind === 'prompt';
    return true;
  };

  const dragStart = (event: React.DragEvent, spec: PaletteSpec) => {
    event.dataTransfer.effectAllowed = 'all';
    (window as any).__draggedPaletteSpec = spec;
    try {
      event.dataTransfer.setData('application/flowgraph-node', JSON.stringify(spec));
      event.dataTransfer.setData('text/plain', JSON.stringify(spec));
    } catch {}
  };

  return (
    <aside className={`node-library modern-sidebar ${locked ? 'node-library-locked' : ''}`}>
      {/* 1. Header: Tiêu đề Nodes + Nút X tắt */}
      <div className="sidebar-modern-header">
        <span className="sidebar-modern-title">Nodes</span>
        {onClose && (
          <button className="sidebar-close-btn" onClick={onClose} title="Thu gọn danh sách Nodes" aria-label="Thu gọn Node Library">
            <X size={15} />
          </button>
        )}
      </div>

      {/* 2. Search box với phím tắt ⌘K */}
      <div className="sidebar-modern-search">
        <Search size={14} className="search-icon-left" />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search nodes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* 3. Filter Pills: (All) (Image) (Video) (Utility) */}
      <div className="sidebar-filter-pills">
        {(['All', 'Image', 'Video', 'Utility'] as const).map((filter) => (
          <button
            key={filter}
            className={`filter-pill-btn ${activeFilter === filter ? 'active' : ''}`}
            onClick={() => setActiveFilter(filter)}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* 4. Danh sách Node theo nhóm Categories */}
      <div className="sidebar-nodes-list">
        {categories.map((cat) => {
          const categoryNodes = palette.filter((node) => cat.kinds.includes(node.kind) && filterMatches(node));
          if (categoryNodes.length === 0) return null;

          return (
            <div key={cat.id} className="sidebar-category-group">
              <div className="sidebar-category-title">{cat.name}</div>
              <div className="sidebar-category-items">
                {categoryNodes.map((node) => {
                  const disabled = locked || Boolean(node.paletteDisabled);
                  return (
                  <div
                    key={node.kind}
                    className={`palette-node compact modern-node-row tone-${node.tone} ${node.paletteDisabled ? 'is-disabled' : ''}`}
                    draggable={!disabled}
                    onDragStart={disabled ? undefined : (event) => dragStart(event, node)}
                    onDoubleClick={disabled ? undefined : () => onAddNode?.(node)}
                    onKeyDown={disabled ? undefined : (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onAddNode?.(node);
                      }
                    }}
                    title={node.paletteDisabled ? `${node.title} — ${node.subtitle}` : `${node.title} — ${node.subtitle} (Kéo vào Canvas, Click đúp hoặc nhấn Enter để thêm)`}
                    role="button"
                    aria-disabled={disabled}
                    tabIndex={disabled ? -1 : 0}
                  >
                    <span className={`palette-icon ${node.tone}`}>
                      <NodeIcon kind={node.kind} size={15} />
                    </span>
                    <span className="palette-node-title">{node.title}</span>
                  </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Nhóm các node khác chưa xếp (nếu có) */}
        {(() => {
          const allCategorizedKinds = categories.flatMap((c) => c.kinds);
          const otherNodes = palette.filter((n) => !allCategorizedKinds.includes(n.kind) && filterMatches(n));
          if (otherNodes.length === 0) return null;
          return (
            <div className="sidebar-category-group">
              <div className="sidebar-category-title">OTHER NODES</div>
              <div className="sidebar-category-items">
                {otherNodes.map((node) => (
                  <div
                    key={node.kind}
                    className={`palette-node compact modern-node-row tone-${node.tone}`}
                    draggable={!locked}
                    onDragStart={locked ? undefined : (event) => dragStart(event, node)}
                    onDoubleClick={locked ? undefined : () => onAddNode?.(node)}
                    onKeyDown={locked ? undefined : (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onAddNode?.(node);
                      }
                    }}
                    title={`${node.title} — ${node.subtitle} (Kéo vào Canvas, Click đúp hoặc nhấn Enter để thêm)`}
                    role="button"
                    aria-disabled={locked}
                    tabIndex={locked ? -1 : 0}
                  >
                    <span className={`palette-icon ${node.tone}`}><NodeIcon kind={node.kind} size={15} /></span>
                    <span className="palette-node-title">{node.title}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </aside>
  );
}





interface NodeErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
  diagnosticId?: string;
}

function getStoredActiveProjectId(): string | undefined {
  try {
    const raw = localStorage.getItem('flowgraph.activeProject');
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed.projectId;
    }
  } catch {}
  return undefined;
}

function storedEntitlementServiceTier(): string | undefined {
  const entitlement = loadSettings().flowEntitlement;
  if (entitlement === 'ultra') return 'SERVICE_TIER_ADVANCED';
  if (entitlement === 'pro') return 'SERVICE_TIER_INTERMEDIATE';
  return undefined;
}

function applyStoredEntitlement(nodes: FlowNode[]): FlowNode[] {
  const serviceTier = storedEntitlementServiceTier();
  if (!serviceTier) return nodes;
  return nodes.map((node) => {
    if (!node.data.config.serviceTier || node.data.config.serviceTier === serviceTier) return node;
    return {
      ...node,
      data: {
        ...node.data,
        config: deriveRegistryConfig(node.data.kind, {
          ...node.data.config,
          serviceTier,
        }),
      },
    };
  });
}

function restoreSavedNodes(): FlowNode[] {
  const projectId = getStoredActiveProjectId();
  return applyStoredEntitlement(restoreWorkflow(projectId, 'main').nodes);
}

function restoreSavedEdges(): FlowEdge[] {
  const projectId = getStoredActiveProjectId();
  return restoreWorkflow(projectId, 'main').edges;
}

function ratioForFlow(value: string | undefined): string | undefined {
  return value?.match(/\b\d{1,2}:\d{1,2}\b/)?.[0];
}

function resolveSelectedSyncTarget(
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

function linkedPromptForNode(node: FlowNode, nodes: FlowNode[], edges: FlowEdge[]): string | undefined {
  // Match runtime semantics: a connected Prompt input wins over a stale/configured
  // fallback on the generation node itself.
  const edge = edges.find((candidate) => candidate.target === node.id && candidate.targetHandle === 'prompt');
  const source = edge ? nodes.find((candidate) => candidate.id === edge.source) : undefined;
  if (source?.data.config.prompt !== undefined) return source.data.config.prompt;
  return node.data.config.prompt;
}

function mediaBindingsAtInput(
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

function syncValuesForNode(
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
          .map((mediaId) => mediaId.trim())
          .filter(Boolean)
          .map((mediaId) => ({ mediaId }));
        if (persisted.length) values.referenceMedia = persisted;
      }
    }
  }
  return values;
}


function initialSelectedNodeId(): string {
  const restored = restoreSavedNodes();
  return restored.find((node) => isSyncGenerationNode(node.data.kind))?.id ?? restored[0]?.id ?? '';
}

function Studio() {
  // FG-1102 — restore a saved workflow on mount (schema 3; earlier schemas reset to the V1 chain).
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(restoreSavedNodes());
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState<FlowEdge>(restoreSavedEdges());
  const [selectedNodeId, setSelectedNodeId] = useState<string>(initialSelectedNodeId);
  const [search, setSearch] = useState('');
  const [activeWorkflowId, setActiveWorkflowId] = useState('main');
  const [workflowName, setWorkflowName] = useState('FlowGraph V1 Pipeline');
  const [runStatus, setRunStatus] = useState<RunStatus>('ready');
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [runFeedback, setRunFeedback] = useState('');
  const pendingRunModeRef = useRef<WorkflowRunMode>('continue');
  const runStartingRef = useRef(false);

  const [elapsed, setElapsed] = useState(0);
  const [experimentalGate, setExperimentalGate] = useState<{ open: boolean; failureMode: boolean }>({ open: false, failureMode: false });
  const [reactFlow, setReactFlow] = useState<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [runError, setRunError] = useState<NodeErrorInfo | undefined>();
  const [creditsBefore, setCreditsBefore] = useState<number | undefined>();
  const [creditsAfter, setCreditsAfter] = useState<number | undefined>();
  const [confirmRerun, setConfirmRerun] = useState<string[]>([]); // node ids with cached results
  // const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [saveTemplateDraft, setSaveTemplateDraft] = useState<{ title: string; description: string } | null>(null);
  const saveTemplateTitleRef = useRef<HTMLInputElement>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [activeDockTab, setActiveDockTab] = useState<'nodes' | 'media'>('nodes');
  const [debugLogOpen, setDebugLogOpen] = useState<boolean>(false);
  const [liveEvents, setLiveEvents] = useState<any[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [settings, setSettings] = useState<FlowGraphSettings>(loadSettings);
  const [syncStatus, setSyncStatus] = useState<{ state: 'idle' | 'syncing' | 'synced' | 'desynced'; message?: string }>({ state: 'idle' });

  const fitWorkflowView = useCallback((duration = 300) => {
    if (!reactFlow) return;
    void reactFlow.fitView({ padding: 0.22, maxZoom: 0.88, duration });
  }, [reactFlow]);

  useEffect(() => {
    if (!runFeedback) return;
    const timer = window.setTimeout(() => setRunFeedback(''), 4200);
    return () => window.clearTimeout(timer);
  }, [runFeedback]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  // Hook listener cho phép kích hoạt Run Workflow từ bên ngoài / script test
  useEffect(() => {
    const handleRunEvent = (event: any) => {
      const mode = event.detail?.mode === 'restart' ? 'restart' : 'continue';
      const confirmed = event.detail?.confirmed ?? true;
      if (mode === 'restart') {
        void runWorkflow(false, true, confirmed, 'restart');
      } else {
        void runWorkflow(false, true, confirmed, 'continue');
      }
    };
    window.addEventListener('flowgraph:run-workflow' as any, handleRunEvent);
    return () => {
      window.removeEventListener('flowgraph:run-workflow' as any, handleRunEvent);
    };
  });

  const cancelRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const runtimeRef = useRef<WorkflowRuntime | null>(null);
  useEffect(() => {
    if (!runtimeRef.current) {
      runtimeRef.current = new WorkflowRuntime(new RealGoogleFlowAdapter());
      (window as any).studioRuntime = runtimeRef.current;
    }
  }, []);
  const connection = useStudioConnection();
  const [hydratedProjectId, setHydratedProjectId] = useState<string | undefined>(undefined);

  // Provider entitlements are account-scoped, not node-scoped. Older saved
  // workflows and palette defaults carry INTERMEDIATE, which hid Ultra-only
  // variants even after an ADVANCED account connected. Auto uses the live
  // provider tier; the explicit Pro/Ultra override is a safe escape hatch while
  // the legacy OAuth credits endpoint is unavailable on the new Flow frontend.
  const liveServiceTier = connection.credits?.serviceTier;
  const effectiveServiceTier = settings.flowEntitlement === 'ultra'
    ? 'SERVICE_TIER_ADVANCED'
    : settings.flowEntitlement === 'pro'
      ? 'SERVICE_TIER_INTERMEDIATE'
      : liveServiceTier;
  const nodeServiceTierSignature = nodes
    .map((node) => `${node.id}:${node.data.config.serviceTier ?? ''}`)
    .join('|');
  useEffect(() => {
    if (!effectiveServiceTier || ![
      'SERVICE_TIER_ENTRY',
      'SERVICE_TIER_INTERMEDIATE',
      'SERVICE_TIER_ADVANCED',
    ].includes(effectiveServiceTier)) return;
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        if (!node.data.config.serviceTier || node.data.config.serviceTier === effectiveServiceTier) return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            config: deriveRegistryConfig(node.data.kind, {
              ...node.data.config,
              serviceTier: effectiveServiceTier,
            }),
          },
        };
      });
      return changed ? next : current;
    });
  }, [effectiveServiceTier, nodeServiceTierSignature, activeWorkflowId, setNodes]);
  const [projectUploadState, setProjectUploadState] = useState<ProjectUploadState>('idle');
  const [projectUploadMessage, setProjectUploadMessage] = useState('');
  const [projectUploadFileName, setProjectUploadFileName] = useState('');
  const [recentUploads, setRecentUploads] = useState<RecentProjectUpload[]>([]);
  const [librarySelectedId, setLibrarySelectedId] = useState('');
  const recentUploadsRef = useRef<RecentProjectUpload[]>([]);
  const nodeClipboardRef = useRef<ReturnType<typeof copySelectedGraph>>(null);
  const mediaClipboardRef = useRef<RecentProjectUpload | null>(null);
  recentUploadsRef.current = recentUploads;
  const runGenerationRef = useRef<RunGeneration | undefined>(undefined);
  const runProjectRef = useRef<string | undefined>(undefined);
  const runEpochRef = useRef(0);
  const cancelledRunEpochsRef = useRef(new Set<number>());
  const [history, setHistory] = useState<Array<{ nodes: FlowNode[]; edges: FlowEdge[] }>>([]);
  const [redoStack, setRedoStack] = useState<Array<{ nodes: FlowNode[]; edges: FlowEdge[] }>>([]);
  const isUndoRedoActionRef = useRef(false);
  const activeProjectId = connection.activeProject?.projectId;
  // Invalidate during render (before effects) so autosave never sees binding B + hydrated A.
  if (hydratedProjectId !== undefined && hydratedProjectId !== activeProjectId) {
    setHydratedProjectId(undefined);
  }

  const pushHistory = useCallback((prevNodes: FlowNode[], prevEdges: FlowEdge[]) => {
    if (isUndoRedoActionRef.current) return;
    setHistory((prev) => {
      const next = [...prev, { nodes: prevNodes, edges: prevEdges }];
      return next.length > 30 ? next.slice(next.length - 30) : next;
    });
    setRedoStack([]);
  }, []);

  useEffect(() => {
    if (!activeProjectId) {
      setRecentUploads([]);
      return;
    }
    setRecentUploads(loadMediaLibrary(activeProjectId));
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) return;
    if (recentUploads.length > 0 && recentUploads.some((item) => item.projectId !== activeProjectId)) return;
    saveMediaLibrary(activeProjectId, recentUploads);
  }, [activeProjectId, recentUploads]);

  const handleSpawnNode = useCallback((spec: PaletteSpec) => {
    if (spec.paletteDisabled) return;
    if (isSemanticMutationLocked(runStatus)) return;
    pushHistory(nodes, edges);
    const id = `${Date.now()}`;
    let spawnPos = { x: 350 + Math.random() * 80, y: 220 + Math.random() * 80 };
    if (reactFlow) {
      try {
        const centerPos = reactFlow.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
        spawnPos = { x: centerPos.x - 100 + Math.random() * 60, y: centerPos.y - 60 + Math.random() * 60 };
      } catch {}
    }
    const newNode: FlowNode = {
      id,
      type: 'flowNode',
      position: spawnPos,
      data: {
        ...hydrateNodeData(spec),
        title: spec.title,
        subtitle: spec.subtitle,
        tone: spec.tone,
        status: 'idle',
      },
    };
    setNodes((current) => [...current, newNode]);
    setSelectedNodeId(id);
  }, [nodes, edges, pushHistory, reactFlow, setNodes, runStatus]);

  const uploadAvailability = projectUploadAvailability({
    activeProjectId: connection.activeProject?.projectId,
    runStatus,
    canvasUnlocked: connection.isCanvasUnlocked,
  });

  const handleProjectImageFile = useCallback(async (file: File) => {
    const begun = beginProjectImageUpload({
      file,
      activeProjectId: connection.activeProject?.projectId,
      runStatus,
      canvasUnlocked: connection.isCanvasUnlocked,
    });
    if (!begun.ok) {
      setProjectUploadState('error');
      setProjectUploadMessage(begun.message);
      setProjectUploadFileName(file.name);
      return;
    }
    const snapshotProjectId = begun.projectId;
    setProjectUploadState('uploading');
    setProjectUploadFileName(file.name);
    setProjectUploadMessage(file.name);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read image'));
        reader.readAsDataURL(file);
      });
      const match = /^data:([^;,]+)[^,]*,(.*)$/s.exec(dataUrl);
      if (!match) throw new Error('Unreadable image');
      const adapter = new RealGoogleFlowAdapter();
      const ref = await adapter.uploadImage({
        projectId: snapshotProjectId,
        imageBytesBase64: match[2],
        mimeType: match[1],
        fileName: file.name,
      });
      if (ref.projectId && ref.projectId !== snapshotProjectId) {
        throw new Error(`Upload returned project ${ref.projectId}, not ${snapshotProjectId}`);
      }
      let previewUrl = '';
      try {
        previewUrl = (await adapter.resolvePreviewUrl(ref.mediaId, snapshotProjectId)) ?? '';
      } catch {}
      const accepted = acceptProjectUploadResult({
        snapshotProjectId,
        currentProjectId: connection.activeProject?.projectId ?? '',
        mediaId: ref.mediaId,
        mediaType: 'IMAGE',
        fileName: file.name,
        previewUrl,
      });
      if (!accepted.ok) {
        setProjectUploadState('error');
        setProjectUploadMessage(accepted.message);
        return;
      }
      setRecentUploads((current) => [accepted.item, ...current.filter((item) => item.id !== accepted.item.id)].slice(0, 8));
      setProjectUploadState('success');
      setProjectUploadMessage(accepted.visibleInCurrentProject ? 'Uploaded' : 'Uploaded to previous project');
    } catch (error) {
      setProjectUploadState('error');
      setProjectUploadMessage(friendlyUploadError(error));
    }
  }, [connection.activeProject?.projectId, connection.isCanvasUnlocked, runStatus]);

  const handleProjectDropFiles = useCallback((files: File[]) => {
    const video = files.find((file) => classifyProjectUploadFile(file) === 'video');
    const image = files.find((file) => classifyProjectUploadFile(file) === 'image');
    if (video && !image) {
      setProjectUploadState('error');
      setProjectUploadFileName(video.name);
      setProjectUploadMessage(PROJECT_UPLOAD_VIDEO_DISABLED);
      return;
    }
    if (image) void handleProjectImageFile(image);
  }, [handleProjectImageFile]);

  const handleAddRecentUploadToCanvas = useCallback((item: RecentProjectUpload) => {
    if (isSemanticMutationLocked(runStatus)) return;
    const kind = recentUploadInputKind(item);
    const spec = palette.find((entry) => entry.kind === kind);
    if (!spec) return;
    const bound = bindProviderMediaInput({
      kind,
      mediaId: item.mediaId,
      mediaType: item.mediaType,
      projectId: item.projectId,
      activeProjectId: connection.activeProject?.projectId ?? '',
    });
    if (!bound.ok) {
      setProjectUploadState('error');
      setProjectUploadMessage(bound.message);
      return;
    }
    pushHistory(nodes, edges);
    const id = `${Date.now()}`;
    let spawnPos = { x: 320, y: 200 };
    if (reactFlow) {
      try {
        const centerPos = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        spawnPos = { x: centerPos.x - 80, y: centerPos.y - 40 };
      } catch {}
    }
    const newNode: FlowNode = {
      id,
      type: 'flowNode',
      position: spawnPos,
      data: hydrateNodeData(spec, {
        config: { mediaId: bound.mediaId, mediaType: bound.mediaType, projectId: bound.projectId },
        result: {
          type: bound.mediaType === 'VIDEO' ? 'video' : 'image',
          previewUrl: item.previewUrl || '',
          mediaId: bound.mediaId,
          projectId: bound.projectId,
          fileName: item.fileName,
        },
        status: 'idle',
      }),
    };
    setNodes((current) => [...current, newNode]);
    setSelectedNodeId(id);
  }, [connection.activeProject?.projectId, edges, nodes, pushHistory, reactFlow, runStatus, setNodes]);

  const handleUndo = useCallback(() => {
    if (!connection.isCanvasUnlocked || runStatus === 'running') return;
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      const remaining = prev.slice(0, -1);
      setRedoStack((r) => [{ nodes, edges }, ...r]);
      isUndoRedoActionRef.current = true;
      setNodes(cloneFlowNodes(last.nodes));
      setEdges(cloneFlowEdges(last.edges));
      setTimeout(() => { isUndoRedoActionRef.current = false; }, 50);
      return remaining;
    });
  }, [connection.isCanvasUnlocked, runStatus, nodes, edges, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    if (!connection.isCanvasUnlocked || runStatus === 'running') return;
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[0];
      const remaining = prev.slice(1);
      setHistory((h) => [...h, { nodes, edges }]);
      isUndoRedoActionRef.current = true;
      setNodes(cloneFlowNodes(next.nodes));
      setEdges(cloneFlowEdges(next.edges));
      setTimeout(() => { isUndoRedoActionRef.current = false; }, 50);
      return remaining;
    });
  }, [connection.isCanvasUnlocked, runStatus, nodes, edges, setNodes, setEdges]);

  // Global Keyboard Shortcuts (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableKeyTarget(e.target as HTMLElement | null)) return;
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      if (isCtrlOrCmd && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (isCtrlOrCmd && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (isSelectAllShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        window.getSelection()?.removeAllRanges();
        if (!connection.isCanvasUnlocked) return;
        setNodes((current) => applySelectAllNodes(current));
      } else if (isCopyShortcut(e)) {
        e.preventDefault();
        if (activeDockTab === 'media' && librarySelectedId) {
          const item = recentUploads.find((entry) => entry.id === librarySelectedId);
          if (item) {
            mediaClipboardRef.current = item;
            void navigator.clipboard.writeText(JSON.stringify({ type: FLOWGRAPH_MEDIA_CLIP, item: { ...item, previewUrl: undefined } }));
          }
          return;
        }
        const clip = copySelectedGraph(nodes, edges);
        if (clip) {
          nodeClipboardRef.current = clip;
          void navigator.clipboard.writeText(JSON.stringify(clip));
        }
      } else if (isCutShortcut(e)) {
        e.preventDefault();
        if (isSemanticMutationLocked(runStatus)) return;
        if (activeDockTab === 'media' && librarySelectedId) {
          const item = recentUploads.find((entry) => entry.id === librarySelectedId);
          if (item) {
            mediaClipboardRef.current = item;
            void navigator.clipboard.writeText(JSON.stringify({ type: FLOWGRAPH_MEDIA_CLIP, item: { ...item, previewUrl: undefined } }));
            setRecentUploads((current) => current.filter((entry) => entry.id !== item.id));
            setLibrarySelectedId('');
          }
          return;
        }
        const cut = cutSelectedGraph(nodes, edges);
        if (!cut) return;
        nodeClipboardRef.current = cut.clipboard;
        void navigator.clipboard.writeText(JSON.stringify(cut.clipboard));
        pushHistory(nodes, edges);
        setNodes(cut.nodes);
        setEdges(cut.edges);
      } else if (isPasteShortcut(e)) {
        e.preventDefault();
        if (isSemanticMutationLocked(runStatus)) return;
        void (async () => {
          const text = await navigator.clipboard.readText().catch(() => '');
          const parsed = parseClipboardPayload(text);
          if (parsed?.type === FLOWGRAPH_MEDIA_CLIP && parsed.item) {
            const item = parsed.item as RecentProjectUpload;
            if (activeDockTab === 'media') {
              if (item.projectId === connection.activeProject?.projectId) {
                setRecentUploads((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 24));
              }
              return;
            }
            handleAddRecentUploadToCanvas(item);
            return;
          }
          const graph = parsed?.type === FLOWGRAPH_NODES_CLIP ? parsed : nodeClipboardRef.current;
          if (graph && 'nodes' in graph) {
            const pasted = pasteGraph(graph as { type: typeof FLOWGRAPH_NODES_CLIP; nodes: FlowNode[]; edges: FlowEdge[] }, `p${Date.now()}`);
            if (!pasted) return;
            pushHistory(nodes, edges);
            setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...pasted.nodes]);
            setEdges((current) => [...current, ...pasted.edges]);
            return;
          }
          const clipboardItems = await navigator.clipboard.read().catch(() => []);
          for (const clip of clipboardItems) {
            const type = clip.types.find((value) => value === 'image/png' || value === 'image/jpeg');
            if (!type) continue;
            const blob = await clip.getType(type);
            const file = new File([blob], type === 'image/png' ? 'paste.png' : 'paste.jpg', { type });
            await handleProjectImageFile(file);
            break;
          }
        })();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleUndo, handleRedo, connection.isCanvasUnlocked, connection.activeProject?.projectId, setNodes, setEdges, nodes, edges, activeDockTab, librarySelectedId, recentUploads, runStatus, pushHistory, handleAddRecentUploadToCanvas, handleProjectImageFile]);

  const nodeTypes = useMemo(() => ({ flowNode: WorkflowNode }), []);
  const { save, exportJson } = useWorkflowPersistence(
    nodes,
    edges,
    activeWorkflowId,
    workflowName,
    connection.activeProject ? { projectId: connection.activeProject.projectId, projectName: connection.activeProject.projectName } : undefined,
    hydratedProjectId,
    settings.autoSave,
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);

  useEffect(() => {
    const activeProject = connection.activeProject;
    const nextId = activeProject?.projectId;
    const previousId = runProjectRef.current;
    if (previousId && nextId && previousId !== nextId) {
      runEpochRef.current += 1;
      cancelRef.current = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
      void runtimeRef.current?.cancel();
    }
    runGenerationRef.current = generationAfterProjectChange(previousId, nextId, runGenerationRef.current);
    runProjectRef.current = nextId;
    if (!activeProject?.projectId) {
      setHydratedProjectId(undefined);
      return;
    }
    const restored = restoreWorkflow(activeProject.projectId, 'main');
    const restoredNodes = applyStoredEntitlement(restored.nodes);
    setNodes(restoredNodes);
    setEdges(restored.edges);
    setActiveWorkflowId('main');
    setWorkflowName(restored.name ?? `${activeProject.projectName} · FlowGraph`);
    setSelectedNodeId(restoredNodes.find((node) => isSyncGenerationNode(node.data.kind))?.id ?? restoredNodes[0]?.id ?? '');
    setRunStatus('ready');
    setRunError(undefined);
    setHydratedProjectId(activeProject.projectId);
  }, [connection.activeProject?.projectId, connection.activeProject?.projectName, setEdges, setNodes]);

  // React Flow's initial fit happens before the project-scoped workflow is hydrated.
  // Re-fit exactly once per hydrated project so restored graphs never inherit stale
  // pan/zoom or get magnified to fill the whole viewport.
  useEffect(() => {
    if (!reactFlow || !hydratedProjectId) return;
    // Restored nodes receive their measured dimensions after the first React Flow
    // paint. A single rAF can therefore fit the pre-hydration/default graph and
    // leave the real project at max zoom. Fit once immediately and once after
    // measurements settle; both calls are scoped to project hydration only, so
    // user pan/zoom is never fought during normal editing.
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (!cancelled) fitWorkflowView(0);
    });
    const settleTimer = window.setTimeout(() => {
      if (!cancelled) fitWorkflowView(260);
    }, 240);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
    };
  }, [reactFlow, hydratedProjectId, fitWorkflowView]);

  // Realtime sync: the pure controller owns conflict/loop rules; this React layer
  // only maps node config, applies Flow-originated writes, and verifies UI state.
  const syncControllerRef = useRef<FlowSyncController | null>(null);
  const syncUiVerifiedRef = useRef(false);
  const syncWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const syncTargetVersionRef = useRef(0);
  const syncPendingWritesRef = useRef(0);
  const syncFailedFieldsRef = useRef<Set<FlowSyncField>>(new Set());
  const syncNoCounterpartFieldsRef = useRef<Set<FlowSyncField>>(new Set());
  const edgesRef = useRef(edges);
  const adapterForSync = useCallback(() => new RealGoogleFlowAdapter(), []);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    const projectId = connection.activeProject?.projectId;
    syncWriteQueueRef.current = Promise.resolve();
    syncUiVerifiedRef.current = false;
    syncPendingWritesRef.current = 0;
    syncFailedFieldsRef.current.clear();
    syncNoCounterpartFieldsRef.current.clear();
    const controller = projectId
      ? new FlowSyncController({
          projectId: projectId ?? 'unknown-project',
          toFlow: { write: (event) => {
            const targetVersion = syncTargetVersionRef.current;
            syncPendingWritesRef.current += 1;
            setSyncStatus({ state: 'syncing', message: `Applying ${event.field ?? 'state'} to Google Flow.` });
            syncWriteQueueRef.current = syncWriteQueueRef.current
              .catch(() => undefined)
              .then(async () => {
                const active = syncControllerRef.current?.getActiveSnapshot();
                if (targetVersion !== syncTargetVersionRef.current || active?.nodeId !== event.nodeId) return;
                const startedAt = performance.now();
                try {
                  if (event.field !== 'mode' && syncFailedFieldsRef.current.has('mode')) {
                    throw Object.assign(
                      new Error(`Cannot apply ${event.field ?? 'setting'} because the required Google Flow mode did not apply.`),
                      { code: 'MODE_MISMATCH', retryable: true },
                    );
                  }
                  await adapterForSync().writeSync(event);
                  if (event.field) {
                    syncFailedFieldsRef.current.delete(event.field);
                    syncNoCounterpartFieldsRef.current.delete(event.field);
                  }
                  if (event.field === 'mode') {
                    setNodes((current) => current.map((node) => node.id === event.nodeId
                      ? { ...node, data: { ...node.data, config: { ...node.data.config, flowMode: String(event.value) } } }
                      : node));
                  }
                  console.info(`[FlowGraph Sync] ${event.field ?? 'state'} F→G SUCCESS ${Math.round(performance.now() - startedAt)}ms`, {
                    syncId: event.syncId,
                    projectId: event.projectId,
                    nodeId: event.nodeId,
                  });
                } catch (error) {
                  if (targetVersion !== syncTargetVersionRef.current) return;
                  const code = (error as { code?: string }).code ?? 'UNKNOWN';
                  if (code === 'NO_UI_COUNTERPART') {
                    if (event.field) {
                      syncFailedFieldsRef.current.delete(event.field);
                      syncNoCounterpartFieldsRef.current.add(event.field);
                    }
                    console.info(`[FlowGraph Sync] ${event.field ?? 'state'} F→G NO_UI_COUNTERPART ${Math.round(performance.now() - startedAt)}ms`, {
                      syncId: event.syncId,
                      projectId: event.projectId,
                      nodeId: event.nodeId,
                    });
                  } else {
                    if (event.field) syncFailedFieldsRef.current.add(event.field);
                    console.warn(`[FlowGraph Sync] ${event.field ?? 'state'} F→G FAILED ${Math.round(performance.now() - startedAt)}ms`, {
                      syncId: event.syncId,
                      projectId: event.projectId,
                      nodeId: event.nodeId,
                      code,
                    });
                    syncUiVerifiedRef.current = false;
                    setSyncStatus({
                      state: 'desynced',
                      message: error instanceof Error ? error.message : 'Google Flow did not apply the setting.',
                    });
                  }
                } finally {
                  if (targetVersion !== syncTargetVersionRef.current) return;
                  syncPendingWritesRef.current = Math.max(0, syncPendingWritesRef.current - 1);
                  if (syncPendingWritesRef.current === 0 && syncFailedFieldsRef.current.size === 0) {
                    syncUiVerifiedRef.current = true;
                    const limitations = [...syncNoCounterpartFieldsRef.current];
                    setSyncStatus({
                      state: 'synced',
                      message: limitations.length
                        ? `No Google Flow UI counterpart: ${limitations.join(', ')}.`
                        : undefined,
                    });
                  } else if (syncPendingWritesRef.current === 0) {
                    setSyncStatus({
                      state: 'desynced',
                      message: `Google Flow could not apply: ${[...syncFailedFieldsRef.current].join(', ')}.`,
                    });
                  } else {
                    setSyncStatus({
                      state: 'syncing',
                      message: `${syncPendingWritesRef.current} sync write(s) pending.`,
                    });
                  }
                }
              });
          } },
          toStudio: { write: (event) => {
            if (!event.field) return;
            // resultMedia/generationStatus keep the existing no-op policy.
            if (event.field === 'resultMedia' || event.field === 'generationStatus') {
              return;
            }
            setNodes((current) => applySemanticReverseSync(current, edgesRef.current, event, {
              runActive: Boolean(runGenerationRef.current),
              patchConfig: (node, ev) => {
                if (ev.field === 'prompt') {
                  return { ...node, data: { ...node.data, config: { ...node.data.config, prompt: String(ev.value ?? '') } } };
                }
                if (ev.field === 'mode') {
                  return { ...node, data: { ...node.data, config: { ...node.data.config, flowMode: String(ev.value ?? '') } } };
                }
                if (ev.field === 'model') {
                  const rawModel = String(ev.value ?? '');
                  const mappedModel = modelFamilyOptions(node.data.kind, node.data.config)
                    .find((candidate) => flowUiModelLabelsEquivalent(candidate, rawModel)) ?? rawModel;
                  return { ...node, data: { ...node.data, config: { ...node.data.config, model: mappedModel } } };
                }
                if (ev.field === 'aspectRatio') {
                  const rawRatio = String(ev.value ?? '');
                  const mappedRatio = aspectRatioOptions(node.data.kind, node.data.config)
                    .find((candidate) => ratioForFlow(candidate) === rawRatio) ?? rawRatio;
                  return { ...node, data: { ...node.data, config: { ...node.data.config, aspectRatio: mappedRatio } } };
                }
                if (ev.field === 'durationSeconds') {
                  return { ...node, data: { ...node.data, config: { ...node.data.config, duration: `${ev.value} seconds` } } };
                }
                if (ev.field === 'seed') {
                  return { ...node, data: { ...node.data, config: { ...node.data.config, seed: String(ev.value ?? '') } } };
                }
                if (ev.field === 'targetResolution') {
                  const value = String(ev.value ?? '');
                  const config = { ...node.data.config };
                  if ('targetResolution' in config) config.targetResolution = value;
                  if ('resolution' in config || !('targetResolution' in config)) config.resolution = value;
                  return { ...node, data: { ...node.data, config } };
                }
                if (ev.field === 'startImage') {
                  const mediaId = (ev.value as { mediaId?: unknown } | undefined)?.mediaId;
                  if (typeof mediaId !== 'string') return node;
                  return { ...node, data: { ...node.data, config: { ...node.data.config, flowStartImageMediaId: mediaId } } };
                }
                if (ev.field === 'endImage') {
                  const mediaId = (ev.value as { mediaId?: unknown } | undefined)?.mediaId;
                  if (typeof mediaId !== 'string') return node;
                  return { ...node, data: { ...node.data, config: { ...node.data.config, flowEndImageMediaId: mediaId } } };
                }
                if (ev.field === 'referenceMedia') {
                  const mediaIds = Array.isArray(ev.value)
                    ? ev.value
                      .map((binding) => (binding as { mediaId?: unknown } | null)?.mediaId)
                      .filter((mediaId): mediaId is string => typeof mediaId === 'string' && mediaId.length > 0)
                    : [];
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      config: {
                        ...node.data.config,
                        references: `${mediaIds.length} Image MediaRef${mediaIds.length === 1 ? '' : 's'}`,
                        flowReferenceMediaIds: mediaIds.join(','),
                      },
                    },
                  };
                }
                if (ev.field === 'batchCount') {
                  return { ...node, data: { ...node.data, config: { ...node.data.config, batchCount: String(ev.value ?? '') } } };
                }
                return node;
              },
            }));
          } },
        })
      : null;
    syncControllerRef.current = controller;
    if (!projectId) setSyncStatus({ state: 'idle' });
  }, [adapterForSync, connection.activeProject?.projectId, setNodes]);

  useEffect(() => {
    const controller = syncControllerRef.current;
    const selected = nodes.find((node) => node.id === selectedNodeId);
    const target = resolveSelectedSyncTarget(selected, nodes, edges);
    const projectReady = connection.flow.state === 'READY'
      && connection.flow.projectId === connection.activeProject?.projectId;
    syncTargetVersionRef.current += 1;
    syncPendingWritesRef.current = 0;
    syncFailedFieldsRef.current.clear();
    syncNoCounterpartFieldsRef.current.clear();
    syncUiVerifiedRef.current = false;
    if (!controller || !target || !projectReady) {
      syncControllerRef.current?.clearActiveNode();
      setSyncStatus({ state: 'idle' });
      return;
    }
    const decision = controller.setActiveNode(target.id, target.data.kind as SyncNodeKind);
    if (decision.action === 'apply') {
      const values = syncValuesForNode(target, nodes, edges);
      for (const [field, value] of Object.entries(values) as [FlowSyncField, unknown][]) {
        // setActiveNode already emits the mode write first. Sending it again
        // needlessly serializes a second DOM operation ahead of model/settings.
        if (field === 'mode') continue;
        controller.handleStudioChange({ nodeId: target.id, field, value });
      }
    }
  // Node config changes are sent explicitly by updateConfig; excluding `nodes`
  // prevents a reverse Flow event from re-triggering a complete outbound sync.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, connection.activeProject?.projectId, connection.flow.state, edges]);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const listener = (message: { type?: string; requestId?: string; payload?: unknown }) => {
      if (message?.type === 'FLOWGRAPH_FOCUS_TELEMETRY' && message.requestId?.startsWith('sw:focus:')) {
        const telemetry = message.payload as {
          timestamp?: string;
          code?: string;
          action?: string;
          requestId?: string;
          durationMs?: number;
          fromTabId?: number;
          toTabId?: number;
          providerTabId?: number;
          windowId?: number;
          message?: string;
        } | undefined;
        const timestamp = telemetry?.timestamp ? Date.parse(telemetry.timestamp) : Date.now();
        const detail = telemetry?.message
          ?? `Google Flow became active during ${telemetry?.action ?? 'automatic provider work'}.`;
        setLiveEvents((prev) => [...prev.slice(-499), {
          timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
          kind: 'focus:steal',
          nodeId: 'Provider focus',
          status: 'warning',
          message: detail,
          telemetry,
        }]);
        console.warn('[FlowGraph Focus Telemetry]', telemetry);
        return;
      }
      // Content-script notifications are also visible to extension pages. Only
      // consume the service-worker relay so each originEventId is handled once.
      if (!message.requestId?.startsWith('sw:sync:')) return;
      if (message?.type === 'FLOWGRAPH_SYNC_STATE') {
        const state = message.payload as { uiVerified?: boolean } | undefined;
        // A one-way latch was observed live: a download resolve parked the tab
        // on /edit/<mediaId> (no composer), which set the ref false, and the
        // pill still read SYNCED after the tab came back. Every later run then
        // died in preflight with NO_UI_COUNTERPART despite a healthy UI.
        // Recovery is still conditional: a field that genuinely failed to apply
        // must keep blocking Generate, so we only re-arm when nothing is failed.
        if (state?.uiVerified && syncFailedFieldsRef.current.size === 0) {
          syncUiVerifiedRef.current = true;
        } else if (!state?.uiVerified) {
          syncUiVerifiedRef.current = false;
        }
        return;
      }
      if (message?.type === 'FLOWGRAPH_SYNC_EVENT') {
          const event = message.payload as FlowSyncEvent | undefined;
          if (event) {
            const controller = syncControllerRef.current;
            const hadPendingStudioWrites = syncPendingWritesRef.current > 0;
            // Flow's React tree can remount or clear adjacent controls after a
            // programmatic mode/media change. Those DOM mutations are provider
            // side effects, not user intent, and must never become authoritative
            // Studio edits. Content-script listeners explicitly tag trusted
            // pointer/keyboard edits; lifecycle events remain automatic.
            if (!isAuthoritativeFlowToStudioEvent(event)) {
              console.info(`[FlowGraph Sync] ${event.field ?? 'state'} G→F PROVIDER_SIDE_EFFECT_IGNORED`, {
                syncId: event.syncId,
                projectId: event.projectId,
            });
            return;
          }
          const decision = controller?.handleFlowEvent(event);
          if (decision?.action === 'apply') {
            const latencyMs = Math.max(0, Date.now() - Date.parse(event.timestamp));
            if (event.field) {
              syncFailedFieldsRef.current.delete(event.field);
              syncNoCounterpartFieldsRef.current.delete(event.field);
            }
            const active = syncControllerRef.current?.getActiveSnapshot();
            console.info(`[FlowGraph Sync] ${event.field ?? 'state'} G→F SUCCESS ${latencyMs}ms`, {
              syncId: event.syncId,
              projectId: event.projectId,
              nodeId: active?.nodeId,
            });
            if (event.field === 'mode' && event.value !== active?.mode) {
              syncFailedFieldsRef.current.add('mode');
              syncUiVerifiedRef.current = false;
              setSyncStatus({
                state: 'desynced',
                message: `Google Flow is ${String(event.value)}; active ${active?.nodeKind ?? 'node'} requires ${active?.mode ?? 'its mapped mode'}.`,
              });
            } else if (syncFailedFieldsRef.current.size === 0) {
              syncUiVerifiedRef.current = true;
              setSyncStatus({ state: 'synced' });
            }
            // If a Flow user edit races with an older queued Studio write, append
            // the observed value after that queue. This makes the later user
            // action deterministic without oscillation; the resulting DOM echo
            // carries a tracked origin and is suppressed by the guard.
            if (hadPendingStudioWrites && event.field && event.field !== 'mode' && active) {
              controller?.handleStudioChange({
                nodeId: active.nodeId,
                field: event.field,
                value: event.value,
              });
            }
          }
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // FG-0206 — switching projects resets run UI only. Do not strip restored runtimeResults.
  const lastProjectRef = useRef<string | undefined>(activeProjectId);
  useEffect(() => {
    if (lastProjectRef.current !== activeProjectId) {
      lastProjectRef.current = activeProjectId;
      setRunStatus('ready');
      setValidationIssues([]);
      setRunError(undefined);
    }
  }, [activeProjectId]);

  const updateStatus = useCallback((id: string, status: NodeStatus) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, status } } : node));
  }, [setNodes]);

  const applyResult = useCallback((id: string, result: any) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, result } } : node));
  }, [setNodes]);

  const applyError = useCallback((id: string, error: NodeErrorInfo) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, status: 'failed', errorMessage: error.message, errorCode: error.code, errorRetryable: error.retryable, diagnosticId: error.diagnosticId } } : node));
  }, [setNodes]);

  const runtime = useCallback(() => {
    if (!runtimeRef.current) {
      runtimeRef.current = new WorkflowRuntime(new RealGoogleFlowAdapter());
      (window as any).studioRuntime = runtimeRef.current;
    }
    return runtimeRef.current;
  }, []);

  const resetWorkflow = useCallback(() => {
    if (isSemanticMutationLocked(runStatus)) return;
    // Lưu trạng thái hiện tại vào lịch sử Undo để lỡ tay vẫn bấm Ctrl+Z cứu lại được 100%!
    pushHistory(nodes, edges);
    cancelRef.current = true;
    if (timerRef.current) window.clearInterval(timerRef.current);
    setNodes(cloneInitialNodes());
    setEdges(cloneFlowEdges(initialEdges));
    setRunStatus('ready');
    setElapsed(0);
    setValidationIssues([]);
    setRunError(undefined);
    setSelectedNodeId('2');
    // setConfirmResetOpen(false);
    window.setTimeout(() => reactFlow?.fitView({ padding: .18, duration: 350 }), 0);
  }, [nodes, edges, pushHistory, reactFlow, setEdges, setNodes, runStatus]);

  const validate = useCallback(() => {
    const specs = nodes.map((node) => {
      const portSpec = portsForKind(node.data.kind);
      return {
        id: node.id,
        kind: node.data.kind,
        config: node.data.config,
        inputs: portSpec.inputs.map((port) => ({ id: port.id, label: port.label, type: port.type, required: port.required, multiple: port.multiple, configKey: port.configKey })),
        outputs: portSpec.outputs.map((port) => ({ id: port.id, label: port.label, type: port.type, required: port.required, multiple: port.multiple, configKey: port.configKey })),
      };
    });
    return validateGraph(specs, edges, {
      activeProject: connection.activeProject ? { projectId: connection.activeProject.projectId } : null,
      supportedKinds,
      modelResolver: registryModelResolver,
    });
  }, [nodes, edges, connection.activeProject]);

  const runWorkflow = useCallback(async (failureMode = false, allowExperimental = false, restartConfirmed = false, mode: WorkflowRunMode = 'continue') => {
    void failureMode;
    console.log('[runWorkflow] Triggered! Status:', runStatus, 'isCanvasUnlocked:', connection.isCanvasUnlocked, 'block:', connection.runBlockReason);

    if (runStatus === 'running' || runStartingRef.current) {
      console.log('[runWorkflow] Already running, click ignored.');
      return;
    }

    runStartingRef.current = true;
    setRunMenuOpen(false);
    setRunFeedback('');
    try {
    // Khi chạy ở mode restart, tự động bypass cache toàn bộ các node để sinh ra kết quả tươi mới
    const runPlan = buildRunModePlan(mode, nodes, edges, connection.activeProject?.projectId ?? '');
    if (mode === 'restart') {
      runPlan.run = nodes.map(n => n.id);
      runPlan.bypassCacheNodeIds = new Set(runPlan.run);
      runPlan.blocked = [];
      runPlan.blockReason = undefined;
    } else if (runPlan.blocked.length) {
      // Nếu ở chế độ continue mà bị thiếu receipt, tự động chuyển đổi an toàn sang restart cho các node thiếu receipt
      runPlan.run = Array.from(new Set([...runPlan.run, ...runPlan.blocked]));
      runPlan.bypassCacheNodeIds = new Set([...Array.from(runPlan.bypassCacheNodeIds), ...runPlan.blocked]);
      runPlan.blocked = [];
      runPlan.blockReason = undefined;
    }
    // Stale gate resilience: if canvas is locked, attempt a single bounded health reconciliation before deciding to block
    let currentUnlocked = connection.isCanvasUnlocked;
    let currentBlock = connection.runBlockReason;
    if (!currentUnlocked) {
      try {
        console.log('[runWorkflow] Gate locked. Attempting bounded live health reconciliation...');
        await Promise.all([connection.refreshAccount(), connection.refreshFlow()]);
        // After refresh, re-read live state from storage/memory if updated
        const freshAccountRaw = localStorage.getItem('flowgraph.accountStatus');
        const freshFlowRaw = localStorage.getItem('flowgraph.flowStatus');
        const freshAccount = freshAccountRaw ? JSON.parse(freshAccountRaw) : connection.account;
        const freshFlow = freshFlowRaw ? JSON.parse(freshFlowRaw) : connection.flow;
        currentBlock = computeRunBlockReason(freshAccount, freshFlow, connection.activeProject, runStatus);
        currentUnlocked = currentBlock === null;
      } catch (err) {
        console.warn('[runWorkflow] Reconciliation failed, proceeding with displayed gate:', err);
      }
    }

    // Lightweight diagnostic snapshot (safe fields only - no secrets, prompts, URLs with auth)
    try {
      (window as any).__runDiagnostic = {
        ts: new Date().toISOString(),
        runStatus,
        accountState: connection.account?.state,
        flowState: connection.flow?.state,
        hasActiveProject: !!connection.activeProject?.projectId,
        activeProjectShort: connection.activeProject?.projectId?.slice(0, 8),
        blockCode: currentBlock?.code,
        blockMessage: currentBlock?.message,
        lastValidation: (window as any).__lastValidationReport ? {
          valid: (window as any).__lastValidationReport.valid,
          errorCodes: (window as any).__lastValidationReport.errors?.map((e: any) => e.code).slice(0, 5)
        } : undefined,
      };
    } catch {}

    if (!currentUnlocked) {
      const block = currentBlock || { code: 'GATE_LOCKED', message: 'Canvas locked' };
      console.warn('[runWorkflow] Blocked after reconciliation check:', block);
      setRunError({ code: block.code, message: block.message, retryable: true });
      setRunStatus('error');
      return;
    }

    const report = validate();
    console.log('[runWorkflow] Validation report:', report);
    (window as any).__lastValidationReport = report;
    setValidationIssues(report.errors.map((issue) => `${issue.code}: ${issue.message}`));
    if (!report.valid) {
      console.warn('[runWorkflow] Validation failed:', report.errors);
    const firstError = report.errors[0];
    const nodeObj = firstError?.nodeIds?.[0] ? nodes.find((n) => n.id === firstError.nodeIds![0]) : null;
    const nodeName = nodeObj?.data?.title || nodeObj?.data?.kind || 'Node';
    const specificMessage = firstError
      ? `[${nodeName}] ${firstError.message}`
      : 'Quy trình còn lỗi kết nối, vui lòng kiểm tra các cổng bắt buộc.';
    setRunError({
      code: firstError?.code || 'VALIDATION_FAILED',
      message: specificMessage,
      retryable: false,
    });
      setRunStatus('error');
      return;
    }

    if (!runPlan.run.length) {
      setRunError(undefined);
      setRunFeedback('Không có công việc cần chạy. Các đầu ra hiện tại vẫn hợp lệ.');
      return;
    }
    if (!allowExperimental && !settings.skipExperimentalPrompt && nodes.some((node) => runPlan.run.includes(node.id) && node.data.experimental)) {
      pendingRunModeRef.current = mode;
      setExperimentalGate({ open: true, failureMode });
      return;
    }
    if (mode === 'restart' && !restartConfirmed) {
      setConfirmRerun(runPlan.run);
      return;
    }

    // Generation nodes sync preflight: chỉ kiểm tra nếu UI đồng bộ yêu cầu, không chặn toàn bộ execution pipeline
    const generationNode = nodes.find((node) => ['t2i', 'i2v', 't2v'].includes(node.data.kind));
    if (generationNode && syncControllerRef.current) {
      try {
        await syncWriteQueueRef.current;
        const values = syncValuesForNode(generationNode, nodes, edges);
        const preflight = syncControllerRef.current.preflight({
          projectId: connection.activeProject!.projectId,
          nodeKind: generationNode.data.kind as SyncNodeKind,
          values,
          uiVerified: true,
        });
        console.log('[runWorkflow] Preflight result:', preflight);
        // Warning only, không ngắt workflow ở preflight vì các node sẽ được executor xử lý tuần tự qua DAG
      } catch (err) {
        console.warn('[runWorkflow] Non-blocking preflight exception:', err);
      }
    }

    cancelRef.current = false;
    setElapsed(0);
    setRunStatus('running');
    setRunError(undefined);
    const projectIdAtStart = connection.activeProject!.projectId;
    const epochAtStart = ++runEpochRef.current;
    runGenerationRef.current = { runId: PENDING_RUN_ID, projectId: projectIdAtStart };
    setCreditsBefore(connection.credits?.credits);
    setCreditsAfter(connection.credits?.credits);
    setNodes((current) => current.map((node) => {
      if (runPlan.initialCompleted.has(node.id)) {
        return { ...node, data: { ...node.data, status: 'success' } };
      }
      if (!runPlan.bypassCacheNodeIds.has(node.id)) return node;
      return {
        ...node,
        data: {
          ...node.data,
          status: 'queued',
          runReceipt: undefined,
          cacheHit: false,
          result: ['imageInput', 'videoInput', 'mediaInput', 'uploadImage'].includes(node.data.kind) ? node.data.result : undefined,
          errorMessage: undefined,
          errorCode: undefined,
          errorRetryable: undefined,
          diagnosticId: undefined,
        },
      };
    }));
    timerRef.current = window.setInterval(() => setElapsed((value) => value + 1), 1000);

    const specs = nodes.map((node) => {
      const portSpec = portsForKind(node.data.kind);
      return {
        id: node.id,
        kind: node.data.kind,
        config: node.data.config,
        inputs: portSpec.inputs.map((port) => ({ id: port.id, label: port.label, type: port.type, required: port.required, multiple: port.multiple, configKey: port.configKey })),
        outputs: portSpec.outputs.map((port) => ({ id: port.id, label: port.label, type: port.type, required: port.required, multiple: port.multiple, configKey: port.configKey })),
      };
    });

    const runEvents: RuntimeEvent[] = [];
    let lastForwardedNodeError: { code?: string; message?: string; retryable?: boolean } | undefined;
    const emit = (event: RuntimeEvent) => {
      if (!acceptRuntimeEvent(event, projectIdAtStart, runGenerationRef.current, epochAtStart, runEpochRef.current)) return;
      if (runGenerationRef.current?.runId === PENDING_RUN_ID && event.runId) {
        runGenerationRef.current = { runId: event.runId, projectId: projectIdAtStart };
      }
      runEvents.push(event);
      // Cập nhật realtime events stream cho Debug Log Drawer & CDP watcher
      setLiveEvents((prev) => [...prev, {
        ...event,
        timestamp: Date.now(),
        kind: event.type === 'node' ? (event.state === 'success' ? 'node:result' : 'node:status') : 'run:state',
      }]);
      (window as any).__lastLiveEvent = event;
      if (event.type === 'node') {
        updateStatus(event.nodeId, event.state);
        if (event.result) applyResult(event.nodeId, event.result);
        if (event.state === 'success' && event.outputs) {
          const runReceipt = createRunReceipt(runPlan.signatures.get(event.nodeId)!, event.outputs);
          setNodes((current) => current.map((node) => node.id === event.nodeId
            ? { ...node, data: { ...node.data, runReceipt } } : node));
        }
        if (event.error) {
          applyError(event.nodeId, event.error);
          lastForwardedNodeError = event.error;
        }
        if (event.cacheHit) {
          setNodes((current) => current.map((node) => node.id === event.nodeId ? { ...node, data: { ...node.data, cacheHit: true } } : node));
        }
        if (event.creditsUsed !== undefined) {
          setCreditsAfter((value) => (value ?? creditsBefore ?? 0) - event.creditsUsed!);
        }

        // Forward to extension runtime / Side Panel via chrome.runtime.sendMessage
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            void chrome.runtime.sendMessage({
              type: 'FLOWGRAPH_EVENT',
              runId: event.runId,
              kind: event.state === 'success' ? 'node:result' : 'node:status',
              nodeId: event.nodeId,
              status: event.state,
              error: event.error ? { code: event.error.code, message: event.error.message, retryable: event.error.retryable } : undefined,
              result: event.result ? { type: event.result.type, mediaId: event.result.mediaId, fileName: event.result.fileName } : undefined,
            }).catch(() => {});
          }
        } catch {}
      } else if (event.type === 'run') {
        if (event.state === 'success') setRunStatus('success');
        if (event.state === 'failed') setRunStatus('error');
        if (event.state === 'cancelled') setRunStatus('ready');

        // Forward run state change to extension runtime / Side Panel
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            void chrome.runtime.sendMessage({
              type: 'FLOWGRAPH_EVENT',
              runId: event.runId,
              kind: event.state === 'failed' ? 'run:error' : 'run:state',
              status: event.state,
              error: event.issues && event.issues.length > 0
                ? { code: 'VALIDATION_FAILED', message: event.issues[0].message, retryable: false }
                : event.state === 'failed' && lastForwardedNodeError
                  ? { code: lastForwardedNodeError.code, message: lastForwardedNodeError.message, retryable: lastForwardedNodeError.retryable }
                  : undefined,
            }).catch(() => {});
          }
        } catch {}
      }
    };

    const { initialOutputs, initialCompleted, bypassCacheNodeIds } = runPlan;

    const startedAt = new Date().toISOString();
    try {
      await runtime().run(
        specs,
        edges,
        {
          workflowId: activeWorkflowId,
          activeProject: connection.activeProject!,
          account: connection.account,
          flow: connection.flow,
          // FG-0904 — "Run anyway" in the credit-warning modal means the user
          // consciously accepts regenerating expensive nodes, so bypass the cache.
          bypassCacheNodeIds,
          initialOutputs,
          initialCompleted,
          concurrency: 1, // Khóa cứng 1 luồng tuần tự để tránh debugger contention trên tab Google Flow
        },
        emit,
      );
    } catch (error) {
      if (isLiveRun(epochAtStart, runEpochRef.current, runGenerationRef.current, projectIdAtStart)) {
        const runtimeError = error instanceof RuntimeError ? error : new RuntimeError('PROVIDER_ERROR', error instanceof Error ? error.message : String(error));
        setRunError({ code: runtimeError.code, message: runtimeError.message, retryable: runtimeError.retryable, diagnosticId: runtimeError.diagnosticId });
        setRunStatus('error');
      }
    } finally {
      if (timerRef.current) window.clearInterval(timerRef.current);
      const forcedStatus = cancelledRunEpochsRef.current.delete(epochAtStart) ? 'cancelled' as const : undefined;
      if (settings.enableDebugLogs) {
        recordRun(runEvents, startedAt, activeWorkflowId, workflowName, {
          projectId: projectIdAtStart,
          projectName: connection.activeProject?.projectName ?? projectIdAtStart,
          selectedAt: connection.activeProject?.selectedAt ?? new Date().toISOString(),
        }, forcedStatus);
      }
    }
    } finally {
      runStartingRef.current = false;
    }
  }, [nodes, edges, runStatus, connection.isCanvasUnlocked, connection.activeProject, connection.account, connection.flow, connection, updateStatus, applyResult, applyError, runtime, setNodes, setRunStatus, activeWorkflowId, workflowName, validate, settings.skipExperimentalPrompt, settings.enableDebugLogs]);

  const stopWorkflow = () => {
    cancelRef.current = true;
    cancelledRunEpochsRef.current.add(runEpochRef.current);
    runEpochRef.current += 1;
    runGenerationRef.current = undefined;
    if (timerRef.current) window.clearInterval(timerRef.current);
    void runtime().cancel();
    setNodes((current) => current.map((node) => node.data.status === 'running' || node.data.status === 'queued' ? { ...node, data: { ...node.data, status: 'idle' } } : node));
    setRunStatus('ready');
  };

  const retryFailedNode = useCallback(async (nodeId: string) => {
    if (!connection.isCanvasUnlocked) return;
    const projectIdAtStart = connection.activeProject!.projectId;
    const signatures = runNodeSignatures(nodes, edges, projectIdAtStart);
    const epochAtStart = ++runEpochRef.current;
    runGenerationRef.current = { runId: PENDING_RUN_ID, projectId: projectIdAtStart };
    setRunStatus('running');
    setElapsed(0);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    const specs = nodes.map((node) => {
      const portSpec = portsForKind(node.data.kind);
      return {
        id: node.id,
        kind: node.data.kind,
        config: node.data.config,
        inputs: portSpec.inputs.map((port) => ({ id: port.id, label: port.label, type: port.type, required: port.required, multiple: port.multiple, configKey: port.configKey })),
        outputs: portSpec.outputs.map((port) => ({ id: port.id, label: port.label, type: port.type, required: port.required, multiple: port.multiple, configKey: port.configKey })),
      };
    });
    try {
      await runtime().retryNode(nodeId, specs, edges, {
        workflowId: activeWorkflowId,
        activeProject: connection.activeProject!,
        account: connection.account,
        flow: connection.flow,
      }, (event) => {
        if (!acceptRuntimeEvent(event, projectIdAtStart, runGenerationRef.current, epochAtStart, runEpochRef.current)) return;
        if (runGenerationRef.current?.runId === PENDING_RUN_ID && event.runId) {
          runGenerationRef.current = { runId: event.runId, projectId: projectIdAtStart };
        }
        if (event.type === 'node') {
          updateStatus(event.nodeId, event.state);
          if (event.result) applyResult(event.nodeId, event.result);
          if (event.state === 'success' && event.outputs) {
            const signature = signatures.get(event.nodeId);
            if (signature) {
              const runReceipt = createRunReceipt(signature, event.outputs);
              setNodes((current) => current.map((node) => node.id === event.nodeId
                ? { ...node, data: { ...node.data, runReceipt } } : node));
            }
          }
          if (event.error) applyError(event.nodeId, event.error);
        } else if (event.type === 'run') {
          if (event.state === 'success') setRunStatus('success');
          if (event.state === 'failed') setRunStatus('error');
        }
      });
    } catch {
      if (isLiveRun(epochAtStart, runEpochRef.current, runGenerationRef.current, projectIdAtStart)) {
        setRunStatus('error');
      }
    } finally {
      if (timerRef.current) window.clearInterval(timerRef.current);
    }
  }, [connection.isCanvasUnlocked, connection.activeProject, connection.account, connection.flow, nodes, edges, updateStatus, applyResult, applyError, runtime, setNodes, setRunStatus, activeWorkflowId]);

  useEffect(() => {
    const onRetryEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId: string }>).detail;
      if (detail?.nodeId) void retryFailedNode(detail.nodeId);
    };
    window.addEventListener('flowgraph:retry-node', onRetryEvent);
    return () => window.removeEventListener('flowgraph:retry-node', onRetryEvent);
  }, [retryFailedNode]);

  const invalidateFromTargets = useCallback((targetIds: Iterable<string>, topologyEdges: FlowEdge[] = edges) => {
    const affected = collectDownstreamNodeIds(targetIds, topologyEdges);
    if (!affected.size) return;
    setNodes((current) => resetRuntimeStateForNodes(current, affected));
  }, [edges, setNodes]);

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    const next = filterEdgeChangesDuringRun(changes, runStatus);
    if (!next.length) return;
    const topologyChanges = next.filter((change) => change.type !== 'select');
    if (topologyChanges.length) {
      const affectedTargets = new Set<string>();
      for (const change of topologyChanges) {
        if ('id' in change && change.id) {
          const existing = edges.find((edge) => edge.id === change.id);
          if (existing) affectedTargets.add(existing.target);
        }
        if ('item' in change && change.item && 'target' in change.item && change.item.target) {
          affectedTargets.add(change.item.target);
        }
      }
      if (affectedTargets.size) invalidateFromTargets(affectedTargets, edges);
    }
    onEdgesChangeRaw(next);
  }, [edges, invalidateFromTargets, onEdgesChangeRaw, runStatus]);

  const onNodesChangeGuarded = useCallback((changes: NodeChange<FlowNode>[]) => {
    const next = filterNodeChangesDuringRun(changes, runStatus);
    if (next.length) onNodesChange(next);
  }, [onNodesChange, runStatus]);

  const isValidConnection = useCallback((connection: Connection | FlowEdge) => {
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return false;

    const source = outputPort(sourceNode.data.kind, connection.sourceHandle);
    const target = inputPort(targetNode.data.kind, connection.targetHandle);
    if (!source || !target || !portTypesCompatible(source.type, target.type)) return false;

    if (!target.multiple) {
      const alreadyConnected = edges.some((edge) => edge.target === targetNode.id && edge.targetHandle === target.id);
      if (alreadyConnected) return false;
    }
    return true;
  }, [edges, nodes]);

  const onConnect = useCallback((candidate: Connection) => {
    if (!connection.isCanvasUnlocked) return;
    if (isSemanticMutationLocked(runStatus)) return;
    if (!isValidConnection(candidate)) return;
    pushHistory(nodes, edges);
    const source = nodes.find((node) => node.id === candidate.source);
    if (candidate.target) invalidateFromTargets([candidate.target], edges);
    setEdges((current) => addEdge({ ...candidate, type: 'default', style: { stroke: colorForTone(source?.data.tone ?? 'purple') } }, current));
  }, [connection.isCanvasUnlocked, isValidConnection, nodes, edges, pushHistory, setEdges, invalidateFromTargets, runStatus]);

  useEffect(() => {
    // Chặn toàn cục ngoài canvas để Chrome không mở file điều hướng trang.
    // NGOẠI LỆ: kéo thẻ node từ palette (application/flowgraph-node) -> KHÔNG được
    // set dropEffect='none', vì những cú dragover đầu tiên khi chuột còn ở trên
    // palette sẽ bị chặn và Chromium khóa luôn thao tác 'none' cho cả cú kéo.
    let paletteDragActive = false;
    const markPaletteDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('.palette-node')) {
        paletteDragActive = true;
      }
    };
    const markPaletteDragEnd = () => { paletteDragActive = false; };
    const preventChromeNavigation = (e: DragEvent) => {
      // Luôn cho phép kéo thả thoải mái trên toàn màn hình Studio
      const target = e.target as HTMLElement | null;
      if (target?.closest('.canvas-wrap') || target?.closest('.react-flow') || target?.closest('.studio-main')) {
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    window.addEventListener('dragstart', markPaletteDragStart, true);
    window.addEventListener('dragend', markPaletteDragEnd, true);
    window.addEventListener('dragover', preventChromeNavigation);
    window.addEventListener('drop', preventChromeNavigation);

    const handleNodeDropMedia = (e: Event) => {
      if (isSemanticMutationLocked(runStatus)) return;
      const detail = (e as CustomEvent).detail as {
        nodeId: string;
        kind?: string;
        type: 'image' | 'video';
        file: File;
        blobUrl: string;
      };
      if (!detail?.nodeId) return;
      const target = nodes.find((n) => n.id === detail.nodeId);
      const action = localImageDropAction(detail.kind ?? target?.data.kind, 'node');
      if (detail.type === 'video' || action === 'reject') {
        console.warn('[FlowGraph] Local file rejected on node', detail.kind ?? target?.data.kind, detail.file?.name);
        return;
      }

      pushHistory(nodes, edges);

      const initialMediaId = `dropped-${Date.now()}`;
      if (detail.type === 'image') {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          if (dataUrl) {
            void setMediaBlob(initialMediaId, dataUrl);
          }
        };
        reader.readAsDataURL(detail.file);
      }

      if (action === 'spawn-upload') {
        const spec = paletteSpecForKind('imageInput') || palette.find((p) => p.kind === 'imageInput');
        if (!spec) return;
        const id = `${Date.now()}`;
        const origin = target?.position ?? { x: 240, y: 180 };
        const imgNode: FlowNode = {
          id,
          type: 'flowNode',
          position: { x: origin.x + 48, y: origin.y + 48 },
          data: {
            ...hydrateNodeData(spec),
            title: detail.file.name.length > 20 ? `${detail.file.name.slice(0, 18)}…` : detail.file.name,
            subtitle: 'Local Image File',
            tone: 'blue',
            config: { source: detail.file.name, fileName: detail.file.name, mediaId: initialMediaId, mediaType: 'IMAGE' },
            status: 'idle',
            result: { type: 'image', mediaId: initialMediaId, previewUrl: detail.blobUrl, fileName: detail.file.name },
          },
        };
        setNodes((current) => [...current, imgNode]);
        setSelectedNodeId(id);
        return;
      }

      setNodes((current) => current.map((n) => {
        if (n.id !== detail.nodeId) return n;
        return {
          ...n,
          data: {
            ...n.data,
            status: 'idle',
            config: detail.type === 'image'
              ? { ...n.data.config, mediaId: initialMediaId, fileName: detail.file.name }
              : n.data.config,
            result: {
              type: detail.type,
              mediaId: initialMediaId,
              previewUrl: detail.blobUrl,
              fileName: detail.file.name,
            },
          },
        };
      }));
    };

    window.addEventListener('flowgraph:node-drop-media', handleNodeDropMedia);

    // Hỗ trợ thêm nhanh Node bằng CLICK chuột từ Sidebar
    const handleAddNodeClick = (e: Event) => {
      if (isSemanticMutationLocked(runStatus)) return;
      const customEvent = e as CustomEvent<PaletteSpec>;
      const spec = customEvent.detail;
      if (!spec || spec.paletteDisabled) return;

      pushHistory(nodes, edges);
      const id = `${Date.now()}`;
      
      // Tính toán tọa độ xuất hiện ở giữa màn hình Canvas hoặc lệch nhẹ
      let spawnPos = { x: 300 + Math.random() * 80, y: 200 + Math.random() * 80 };
      if (reactFlow) {
        try {
          const centerPos = reactFlow.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
          spawnPos = { x: centerPos.x - 100 + Math.random() * 60, y: centerPos.y - 60 + Math.random() * 60 };
        } catch {}
      }

      const newNode: FlowNode = {
        id,
        type: 'flowNode',
        position: spawnPos,
        data: {
          ...hydrateNodeData(spec),
          title: spec.title,
          subtitle: spec.subtitle,
          tone: spec.tone,
          status: 'idle',
        },
      };

      setNodes((current) => [...current, newNode]);
      setSelectedNodeId(id);
    };

    window.addEventListener('flowgraph:add-node-click', handleAddNodeClick);

    const handleRequestVerifiedMedia = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId: string; kind: string }>).detail;
      if (!detail?.nodeId) return;
      const activeProjectId = connection.activeProject?.projectId ?? '';
      const recent = recentUploadsRef.current
        .map((item) => recentUploadAsVerifiedMedia(item, activeProjectId))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      const items = [...collectVerifiedGraphMedia(nodes, activeProjectId), ...recent]
        .filter((item) => {
          if (detail.kind === 'imageInput') return item.mediaType === 'IMAGE';
          if (detail.kind === 'videoInput') return item.mediaType === 'VIDEO';
          return true;
        });
      window.dispatchEvent(new CustomEvent('flowgraph:verified-media', {
        detail: { nodeId: detail.nodeId, items },
      }));
    };

    const handleBindProviderMedia = (e: Event) => {
      if (isSemanticMutationLocked(runStatus)) return;
      const detail = (e as CustomEvent<{
        nodeId: string;
        kind: string;
        mediaId: string;
        mediaType: string;
        projectId: string;
        previewUrl?: string;
      }>).detail;
      if (!detail?.nodeId) return;
      const bound = bindProviderMediaInput({
        kind: detail.kind,
        mediaId: detail.mediaId,
        mediaType: detail.mediaType,
        projectId: detail.projectId,
        activeProjectId: connection.activeProject?.projectId ?? '',
      });
      if (!bound.ok) {
        console.warn('[FlowGraph] Provider media bind rejected:', bound.message);
        return;
      }
      pushHistory(nodes, edges);
      setNodes((current) => current.map((n) => {
        if (n.id !== detail.nodeId) return n;
        return {
          ...n,
          data: {
            ...n.data,
            status: 'idle',
            config: {
              ...n.data.config,
              mediaId: bound.mediaId,
              mediaType: bound.mediaType,
              projectId: bound.projectId,
            },
            result: {
              type: bound.mediaType === 'VIDEO' ? 'video' : 'image',
              mediaId: bound.mediaId,
              previewUrl: detail.previewUrl || n.data.result?.previewUrl || '',
              projectId: bound.projectId,
            },
          },
        };
      }));
    };

    window.addEventListener('flowgraph:request-verified-media', handleRequestVerifiedMedia);
    window.addEventListener('flowgraph:bind-provider-media', handleBindProviderMedia);

    return () => {
      window.removeEventListener('dragover', preventChromeNavigation);
      window.removeEventListener('drop', preventChromeNavigation);
      window.removeEventListener('flowgraph:node-drop-media', handleNodeDropMedia);
      window.removeEventListener('flowgraph:add-node-click', handleAddNodeClick);
      window.removeEventListener('flowgraph:request-verified-media', handleRequestVerifiedMedia);
      window.removeEventListener('flowgraph:bind-provider-media', handleBindProviderMedia);
    };
  }, [nodes, edges, connection.activeProject, pushHistory, setNodes, runStatus]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!connection.isCanvasUnlocked) return;
    if (isSemanticMutationLocked(runStatus)) return;
    if (!reactFlow) return;

    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });

    const mediaRaw = event.dataTransfer.getData(FLOWGRAPH_MEDIA_DRAG) || '';
    const draggedMedia = mediaRaw ? parseClipboardPayload(mediaRaw) as RecentProjectUpload | null : ((window as any).__draggedLibraryMedia as RecentProjectUpload | undefined);
    if (draggedMedia?.mediaId) {
      handleAddRecentUploadToCanvas({
        ...draggedMedia,
        previewUrl: draggedMedia.previewUrl,
      });
      setNodes((current) => current.map((node, index) => index === current.length - 1 ? { ...node, position } : node));
      return;
    }

    // 1. Kiểm tra xem người dùng có kéo thả TỆP NGOÀI (Ảnh, Video, Text) vào Canvas không
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      pushHistory(nodes, edges);
      const newCreatedNodes: FlowNode[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileId = `${Date.now()}_${i}`;
        const offsetPosition = { x: position.x + i * 40, y: position.y + i * 40 };

        if (file.type.startsWith('image/')) {
            const initialBlob = URL.createObjectURL(file);
            const initialMediaId = `local-${fileId}`;

            // Lưu trực tiếp vào IndexedDB để tái sử dụng
            const reader = new FileReader();
            reader.onload = (e) => {
              const dataUrl = e.target?.result as string;
              if (dataUrl) {
                void setMediaBlob(initialMediaId, dataUrl);
              }
            };
            reader.readAsDataURL(file);

            const spec = paletteSpecForKind('imageInput') || palette.find((p) => p.kind === 'imageInput') || {
              kind: 'imageInput',
              title: 'Image Input',
              subtitle: 'Local PNG/JPEG or Flow image',
              tone: 'blue' as const,
              group: 'Utility' as const,
              preview: 'image' as const,
              config: { mediaId: '', mediaType: 'IMAGE', projectId: '' },
            };

            const imgNode: FlowNode = {
              id: fileId,
              type: 'flowNode',
              position: offsetPosition,
              data: {
                ...hydrateNodeData(spec),
                title: file.name.length > 20 ? `${file.name.slice(0, 18)}…` : file.name,
                subtitle: 'Local Image File',
                tone: 'blue',
                config: { source: file.name, fileName: file.name, mediaId: initialMediaId, mediaType: 'IMAGE' },
                status: 'idle',
                result: {
                  type: 'image',
                  mediaId: initialMediaId,
                  previewUrl: initialBlob,
                  fileName: file.name,
                },
              },
            };
            newCreatedNodes.push(imgNode);
        } else if (file.type.startsWith('video/')) {
          // There is no verified local-video upload executor yet. Do not create a fake
          // Download/source node with a pseudo mediaId: that would look runnable but fail
          // project provenance checks downstream. Existing Flow videos should enter via
          // Video Input until a real UploadVideoExecutor is implemented.
          console.warn('[FlowGraph] Local video drop ignored: use Video Input with an existing Flow mediaId.', file.name);
          continue;
        } else if (file.type.includes('text') || file.name.endsWith('.txt')) {
          const textContent = await file.text();
          const spec = palette.find((p) => p.kind === 'prompt') || {
            kind: 'prompt',
            title: 'Prompt',
            subtitle: 'Creative Direction',
            tone: 'purple' as const,
            group: 'Generative' as const,
            config: {},
          };

          const promptNode: FlowNode = {
            id: fileId,
            type: 'flowNode',
            position: offsetPosition,
            data: {
              ...hydrateNodeData(spec),
              title: file.name,
              subtitle: 'Dropped Text File',
              tone: 'purple',
              config: { prompt: textContent },
              status: 'idle',
            },
          };
          newCreatedNodes.push(promptNode);
        }
      }

      if (newCreatedNodes.length > 0) {
        setNodes((current) => [...current, ...newCreatedNodes]);
        setSelectedNodeId(newCreatedNodes[0].id);
        return;
      }
    }

    // 2. Kéo thả Node từ Thư viện Node Library bên trái
    const raw = event.dataTransfer.getData('application/flowgraph-node') || event.dataTransfer.getData('text/plain');
    let spec: PaletteSpec | undefined = (window as any).__draggedPaletteSpec;
    if (raw) {
      try {
        spec = JSON.parse(raw) as PaletteSpec;
      } catch {}
    }
    if (!spec || spec.paletteDisabled) return;
    (window as any).__draggedPaletteSpec = undefined;
    const id = `${Date.now()}`;
    const newNode: FlowNode = {
      id,
      type: 'flowNode',
      position,
      data: hydrateNodeData(spec),
    };
    pushHistory(nodes, edges);
    setNodes((current) => [...current, newNode]);
    setSelectedNodeId(id);
  }, [connection.isCanvasUnlocked, connection.activeProject, reactFlow, nodes, edges, pushHistory, setNodes, runStatus]);

  const updateConfig = (key: string, value: string, targetNodeId?: string) => {
    if (!connection.isCanvasUnlocked) return;
    if (isSemanticMutationLocked(runStatus)) return;
    const effectiveId = targetNodeId ?? selectedNodeId;

    // Some provider/model choices constrain other controls. Keep that correction
    // atomic, but tell the user what changed so a valid auto-adjustment never
    // looks like a random configuration bug.
    const editedNodeBefore = nodes.find((node) => node.id === effectiveId);
    if (editedNodeBefore && ['model', 'duration', 'resolution', 'aspectRatio'].includes(key)) {
      const requestedConfig = { ...editedNodeBefore.data.config, [key]: value };
      const derivedConfig = deriveRegistryConfig(editedNodeBefore.data.kind, requestedConfig);
      const labels: Record<string, string> = {
        model: 'Model',
        duration: 'Duration',
        resolution: 'Resolution',
        aspectRatio: 'Ratio',
      };
      const displayConfigValue = (field: string, rawValue: string) => {
        if (field === 'duration') return rawValue.replace(/\s*seconds?$/i, 's');
        if (field === 'aspectRatio') return rawValue.match(/\d+:\d+/)?.[0] ?? rawValue;
        return rawValue;
      };
      const adjustments = Object.keys(labels)
        .filter((field) => field !== key && derivedConfig[field] !== requestedConfig[field])
        .map((field) => `${labels[field]} → ${displayConfigValue(field, derivedConfig[field])}`);
      if (adjustments.length > 0) {
        setRunFeedback(`Đã tự điều chỉnh ${adjustments.join(', ')} để phù hợp với cấu hình đã chọn.`);
      }
    }

    // A config change invalidates the edited node and every downstream result.
    // Without this, successful nodes remain in initialCompleted on the next run,
    // so an edited Prompt can be skipped together with its T2I/video descendants.
    const invalidatedNodeIds = new Set<string>([effectiveId]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const edge of edges) {
        if (invalidatedNodeIds.has(edge.source) && !invalidatedNodeIds.has(edge.target)) {
          invalidatedNodeIds.add(edge.target);
          expanded = true;
        }
      }
    }

    setNodes((current) => current.map((node) => {
      const isEditedNode = node.id === effectiveId;
      const shouldInvalidate = invalidatedNodeIds.has(node.id);
      if (!isEditedNode && !shouldInvalidate) return node;

      let config = node.data.config;
      if (isEditedNode) {
        config = { ...node.data.config, [key]: value };

        if (node.data.kind === 'imageUpscale' && key === 'targetResolution') {
          config.model = value === '4K' ? '4k' : '2K';
        }
        if (node.data.kind === 'videoUpscale' && key === 'targetResolution') {
          config.model = value === '4K' ? 'Veo 3.1 - Upsampler 4K' : 'Veo 3.1 - Upsampler 1080P';
        }

        config = deriveRegistryConfig(node.data.kind, config);
      }

      return {
        ...node,
        data: {
          ...node.data,
          config,
          status: 'idle',
          result: undefined,
          cacheHit: false,
          errorMessage: undefined,
          errorCode: undefined,
          errorRetryable: undefined,
          diagnosticId: undefined,
        },
      };
    }));

    const configKeyToField: Partial<Record<string, FlowSyncField>> = {
      prompt: 'prompt',
      model: 'model',
      aspectRatio: 'aspectRatio',
      batchCount: 'batchCount',
      duration: 'durationSeconds',
      seed: 'seed',
      targetResolution: 'targetResolution',
      resolution: 'targetResolution',
    };
    const field = configKeyToField[key];
    const targetNode = nodes.find((n) => n.id === effectiveId) ?? selectedNode;
    const syncTarget = resolveSelectedSyncTarget(targetNode, nodes, edges);
    if (!field || !syncTarget) return;

    // A model selection is mode-scoped. Always enqueue the target node's mode
    // immediately before the model write, even when the controller already
    // thinks this node is active. The provider may have been switched by another
    // node/user action or a previous mode write may have failed; relying only on
    // nodeId leaves the controller stuck in a false "already VIDEO/IMAGE" state
    // and subsequent model writes loop as INVALID_MODEL on the wrong composer.
    const activeSync = syncControllerRef.current?.getActiveSnapshot();
    if (field === 'model' || activeSync?.nodeId !== syncTarget.id) {
      syncControllerRef.current?.setActiveNode(syncTarget.id, syncTarget.data.kind as SyncNodeKind);
    }

    const syncValue = field === 'durationSeconds' || field === 'seed'
      ? Number.parseInt(value, 10)
      : field === 'model'
        ? normalizeFlowUiModelLabel(value)
        : field === 'aspectRatio'
          ? ratioForFlow(value)
          : field === 'batchCount'
            ? String(value).replace(/^x/i, '').trim()
            : value;
    if (syncValue === undefined || (typeof syncValue === 'number' && !Number.isFinite(syncValue))) return;
    void syncControllerRef.current?.handleStudioChange({ nodeId: syncTarget.id, field, value: syncValue });
  };

  const saveCurrent = () => save();
  const exportCurrent = () => exportJson();

  useEffect(() => {
    const handleUpdateConfig = (e: Event) => {
      const customEvent = e as CustomEvent<{ nodeId: string; key: string; value: string }>;
      if (!customEvent.detail) return;
      const { nodeId, key, value } = customEvent.detail;
      updateConfig(key, value, nodeId);
    };

    // Tự động lan truyền cấu hình được nhận diện từ Prompt sang các node nối dây phía sau
    const handlePromptParsedConfig = (e: Event) => {
      const customEvent = e as CustomEvent<{ sourceNodeId: string; parsed: import('./promptConfigParser').ParsedPromptConfig }>;
      if (!customEvent.detail) return;
      const { sourceNodeId, parsed } = customEvent.detail;

      // Tìm tất cả các node downstream nhận dây từ Prompt node này
      const targetEdges = edges.filter((edge) => edge.source === sourceNodeId);
      for (const edge of targetEdges) {
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!targetNode) continue;
        const isImage = targetNode.data.kind === 't2i' || targetNode.data.kind === 'uploadImage';
        const isVideo = targetNode.data.kind === 'i2v' || targetNode.data.kind === 't2v' || targetNode.data.kind === 'interpolation' || targetNode.data.kind === 'extend';

        if (parsed.aspectRatio) updateConfig('aspectRatio', parsed.aspectRatio, targetNode.id);
        if (parsed.duration && isVideo) updateConfig('duration', parsed.duration, targetNode.id);
        // Chỉ cập nhật resolution 720p/1080p cho video, không ép resolution vào T2I làm sai lệch cấu hình
        if (parsed.resolution && isVideo) updateConfig('resolution', parsed.resolution, targetNode.id);
        if (parsed.batchCount) updateConfig('batchCount', parsed.batchCount, targetNode.id);
        if (parsed.modelKeyword) {
          const isBanana = parsed.modelKeyword.includes('Banana');
          if ((isBanana && isImage) || (!isBanana && isVideo)) {
            updateConfig('model', parsed.modelKeyword, targetNode.id);
          }
        }
      }
    };

    window.addEventListener('flowgraph:update-config', handleUpdateConfig);
    window.addEventListener('flowgraph:prompt-parsed-config', handlePromptParsedConfig);
    return () => {
      window.removeEventListener('flowgraph:update-config', handleUpdateConfig);
      window.removeEventListener('flowgraph:prompt-parsed-config', handlePromptParsedConfig);
    };
  }, [updateConfig, edges, nodes]);

  const accountState = connection.account.state;
  const flowState = connection.flow.state;
  const syncPillState = syncStatus.state === 'synced'
    ? 'online'
    : syncStatus.state === 'syncing'
      ? 'checking'
      : syncStatus.state === 'desynced'
        ? 'error'
        : 'offline';
  const syncPillLabel = syncStatus.state === 'synced'
    ? 'SYNCED'
    : syncStatus.state === 'syncing'
      ? 'SYNCING'
      : syncStatus.state === 'desynced'
        ? 'DESYNCED'
        : 'SYNC IDLE';

  const computedEdges = useMemo(() => {
    const edgeType = settings.edgeType === 'straight'
      ? 'straight'
      : settings.edgeType === 'step'
        ? 'smoothstep'
        : 'default';
    return edges.map((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);
      const isSourceRunning = sourceNode?.data.status === 'running';
      const isTargetRunning = targetNode?.data.status === 'running';
      const isSourceSuccess = sourceNode?.data.status === 'success';
      const isRunning = runStatus === 'running';

      let className = '';
      let animated = false;

      // Chỉ kích hoạt animation cho dây ĐẦU VÀO (incoming wire) đang truyền dữ liệu vào node RUNNING
      // Tuyệt đối không bật sáng dây đầu ra khi node phía sau chưa hề chạy!
      if (isRunning && isTargetRunning) {
        className = 'running-active';
        animated = true;
      } else if (isSourceSuccess && isTargetRunning) {
        className = 'running-active';
        animated = true;
      } else if (isSourceSuccess && !isRunning && targetNode?.data.status === 'success') {
        className = 'running-success';
      }

      return {
        ...edge,
        type: edgeType,
        animated,
        className,
      };
    });
  }, [edges, nodes, runStatus, settings.edgeType]);

  const applyTemplate = useCallback((template: WorkflowTemplate) => {
    if (isSemanticMutationLocked(runStatus)) return;
    pushHistory(nodes, edges);
    const freshNodes = cloneFlowNodes(template.nodes).map((node) => ({
      ...node,
      data: {
        ...node.data,
        status: 'idle' as const,
        result: undefined,
        cacheHit: false,
        errorMessage: undefined,
        errorCode: undefined,
        errorRetryable: undefined,
        diagnosticId: undefined,
      },
    }));
    setNodes(freshNodes);
    setEdges(cloneFlowEdges(template.edges));
    setWorkflowName(template.title);
    // React Flow v12 keeps newly replaced nodes hidden until their DOM bounds
    // are measured. A 50ms fitView race left template nodes at
    // visibility:hidden and the edge layer empty. Re-measure all fresh nodes
    // after React commits them, then fit only on the following frame.
    window.requestAnimationFrame(() => {
      updateNodeInternals(freshNodes.map((node) => node.id));
      window.requestAnimationFrame(() => fitWorkflowView(300));
    });
  }, [nodes, edges, pushHistory, fitWorkflowView, setEdges, setNodes, runStatus, updateNodeInternals]);

  const saveCurrentAsTemplate = useCallback(() => {
    setTemplatesModalOpen(false);
    setSaveTemplateDraft({
      title: workflowName || 'My Custom Workflow',
      description: 'Custom workflow created by user',
    });
  }, [workflowName]);

  const closeSaveTemplateDialog = useCallback(() => {
    setSaveTemplateDraft(null);
    setTemplatesModalOpen(true);
  }, []);

  useEffect(() => {
    if (!saveTemplateDraft) return;
    const focusTimer = window.setTimeout(() => saveTemplateTitleRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeSaveTemplateDialog();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [saveTemplateDraft, closeSaveTemplateDialog]);

  const confirmSaveTemplate = useCallback(() => {
    if (!saveTemplateDraft?.title.trim()) return;
    saveCustomTemplate({
      title: saveTemplateDraft.title.trim(),
      description: saveTemplateDraft.description.trim(),
      category: 'custom',
      tags: ['Custom', 'User'],
      nodes,
      edges,
    });
    setSaveTemplateDraft(null);
    setTemplatesModalOpen(true);
    setRunFeedback('Đã lưu workflow vào My Templates.');
  }, [saveTemplateDraft, nodes, edges]);

  const handleAutoLayout = useCallback(() => {
    if (!connection.isCanvasUnlocked || nodes.length === 0) return;
    if (isSemanticMutationLocked(runStatus)) return;
    pushHistory(nodes, edges);
    const layoutedNodes = calculateAutoLayout(nodes, edges);
    setNodes(layoutedNodes);
    setTimeout(() => fitWorkflowView(400), 50);
  }, [connection.isCanvasUnlocked, nodes, edges, pushHistory, setNodes, fitWorkflowView, runStatus]);

  return (
    <div className="fg-shell studio-app">
      <header className="studio-topbar">
        <div className="fg-brand"><div className="fg-logo"><Workflow size={19} /></div><div className="fg-brand-title">FlowGraph <span>Studio</span></div></div>
        <div className="topbar-actions">
          <ProjectDropdown connection={connection} runLocked={isProjectSelectLocked(runStatus)} />
          <ConnectionPill
            state={accountState === 'CONNECTED' ? 'online' : accountState === 'CHECKING' ? 'checking' : accountState === 'SESSION_EXPIRED' ? 'warn' : accountState === 'DISCONNECTED' ? 'offline' : 'error'}
            label={accountPillLabel(accountState, connection.account.email, connection.credits?.credits)}
            onRefresh={() => void connection.refreshAccount()}
            icon={<CircleUserRound size={14} />}
            className="account-pill"
          />
          <ConnectionPill
            state={flowState === 'READY' || flowState === 'CONNECTED' ? 'online' : flowState === 'CHECKING' ? 'checking' : flowState === 'PROJECT_REQUIRED' ? 'warn' : flowState === 'ERROR' ? 'error' : 'offline'}
            label={flowPillLabel(flowState, connection.flow.projectId)}
            onRefresh={() => void connection.refreshFlow()}
            icon={<Workflow size={14} />}
          />
          <button className="fg-btn" onClick={saveCurrent}><Save size={14} /> Save</button>
          <button className="fg-btn" onClick={exportCurrent}><FileDown size={14} /> Export</button>
          {/* Nút chuyển đổi nhanh Light/Dark trong cùng một theme family. */}
          <button
            className="fg-btn fg-icon-btn"
            onClick={() => {
              const nextTheme = getPairedTheme(settings.theme);
              const updated = { ...settings, theme: nextTheme };
              setSettings(updated);
              saveSettings(updated);
            }}
            title={`Chuyển ${getThemeDefinition(settings.theme).familyLabel} sang ${isLightTheme(settings.theme) ? 'Dark' : 'Light'}`}
          >
            {isLightTheme(settings.theme) ? <Moon size={14} /> : <Sun size={14} />}
          </button>
          <RunModeControl running={runStatus === 'running'} disabled={!connection.isCanvasUnlocked}
            menuOpen={runMenuOpen} onMenuChange={setRunMenuOpen}
            onContinue={() => void runWorkflow(false)}
            onRestart={() => void runWorkflow(false, false, false, 'restart')} onStop={stopWorkflow} />
        </div>
      </header>
      {runFeedback && typeof document !== 'undefined' ? createPortal(
        <div className="run-feedback-toast" role="status">{runFeedback}</div>,
        document.body,
      ) : null}

      {(validationIssues.length > 0 || Boolean(runError?.message)) && runStatus === 'error' && (
        <div role="alert" className="validation-alert-banner nodrag nopan" style={{
          position: 'fixed',
          top: '56px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 99999,
          background: '#fee2e2',
          border: '1px solid #ef4444',
          borderRadius: '8px',
          padding: '8px 16px',
          color: '#991b1b',
          fontSize: '12px',
          fontWeight: '500',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span>⚠️ {runError?.message || validationIssues[0]}</span>
          <button
            onClick={() => {
              setValidationIssues([]);
              setRunError(undefined);
            }}
            style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#991b1b', fontWeight: 'bold', padding: '0 4px' }}
          >
            ✕
          </button>
        </div>
      )}

      <main className={`studio-main ${sidebarOpen ? 'has-sidebar' : 'collapsed-sidebar'}`}>
        {/* Navigation Dock Rail ngoài cùng bên trái */}
        <nav className="studio-nav-dock">
          <div className="dock-top-items">
            <button
              className={`dock-tab-btn ${activeDockTab === 'nodes' && sidebarOpen && !templatesModalOpen && !debugLogOpen ? 'active' : ''}`}
              onClick={() => {
                if (activeDockTab === 'nodes') {
                  setSidebarOpen(!sidebarOpen);
                } else {
                  setActiveDockTab('nodes');
                  setSidebarOpen(true);
                }
              }}
              title="Thư viện Nodes"
            >
              <Layers size={18} />
              <span>Nodes</span>
            </button>

            <button
              className={`dock-tab-btn ${activeDockTab === 'media' && sidebarOpen && !templatesModalOpen && !debugLogOpen ? 'active' : ''}`}
              onClick={() => {
                if (activeDockTab === 'media') {
                  setSidebarOpen(!sidebarOpen);
                } else {
                  setActiveDockTab('media');
                  setSidebarOpen(true);
                }
              }}
              title="Thư viện Media"
            >
              <Images size={18} />
              <span>Media</span>
            </button>

            <button
              className={`dock-tab-btn open-templates-btn ${templatesModalOpen ? 'active' : ''}`}
              onClick={() => setTemplatesModalOpen(true)}
              title="Mẫu quy trình (Templates)"
            >
              <LayoutTemplate size={18} />
              <span>Templates</span>
            </button>

            <button
              className={`dock-tab-btn ${debugLogOpen ? 'active' : ''}`}
              onClick={() => setDebugLogOpen(!debugLogOpen)}
              title="Nhật ký Debug Workflow (Logs)"
            >
              <Terminal size={18} />
              <span>Logs</span>
            </button>
          </div>

          <div className="dock-bottom-items">
            <button
              className="dock-tab-btn"
              onClick={() => setSettingsModalOpen(true)}
              title="Cài đặt hệ thống"
            >
              <SettingsIcon size={18} />
              <span>Settings</span>
            </button>
          </div>
        </nav>

        <section className="studio-center">
          <ProjectGateOverlay connection={connection}>
            <div className="canvas-wrap" onDrop={onDrop} onDragOver={onDragOver}>
              {/* Danh sách Node HUD nổi trực tiếp trên nền Canvas (Không viền, không box, chỉ Icon + Chữ) */}
              {sidebarOpen && activeDockTab === 'media' && (
                <MediaLibrary
                  enabled={uploadAvailability.ok}
                  disabledReason={uploadAvailability.ok ? undefined : uploadAvailability.reason}
                  state={projectUploadState}
                  message={projectUploadMessage}
                  fileName={projectUploadFileName}
                  recent={recentUploadsForProject(recentUploads, connection.activeProject?.projectId ?? '')}
                  selectedId={librarySelectedId}
                  projectName={connection.activeProject?.projectName}
                  projectId={connection.activeProject?.projectId}
                  onSelect={setLibrarySelectedId}
                  onPickImageFile={(file) => { void handleProjectImageFile(file); }}
                  onDropFiles={handleProjectDropFiles}
                  onAddToCanvas={handleAddRecentUploadToCanvas}
                  onClose={() => setSidebarOpen(false)}
                />
              )}
              {sidebarOpen && activeDockTab === 'nodes' && (
                <NodeLibrary
                  search={search}
                  setSearch={setSearch}
                  locked={!connection.isCanvasUnlocked || isSemanticMutationLocked(runStatus)}
                  onOpenTemplatesModal={() => setTemplatesModalOpen(true)}
                  onClose={() => setSidebarOpen(false)}
                  onAddNode={handleSpawnNode}
                />
              )}

              <div className="canvas-toolbar">
                    <button
                      className="fg-btn fg-icon-btn"
                      onClick={handleUndo}
                      disabled={history.length === 0 || runStatus === 'running'}
                      title="Hoàn tác (Ctrl+Z)"
                    >
                      <Undo2 size={13} />
                    </button>
                    <button
                      className="fg-btn fg-icon-btn"
                      onClick={handleRedo}
                      disabled={redoStack.length === 0 || runStatus === 'running'}
                      title="Làm lại (Ctrl+Y / Ctrl+Shift+Z)"
                    >
                      <Redo2 size={13} />
                    </button>
                    <button
                      className="fg-btn fg-icon-btn"
                      onClick={handleAutoLayout}
                      disabled={!connection.isCanvasUnlocked || nodes.length === 0 || runStatus === 'running'}
                      title="Tự động sắp xếp các Node thẳng hàng (Auto Layout)"
                    >
                      <LayoutGrid size={13} />
                    </button>
                    <button className="fg-btn fg-icon-btn" onClick={() => fitWorkflowView(300)} title="Căn chỉnh khung nhìn"><Maximize2 size={13} /></button>
                    <button className="fg-btn" disabled={isSemanticMutationLocked(runStatus)} onClick={resetWorkflow}><RotateCcw size={12} /> Reset</button>
                  </div>
                  <ReactFlow<FlowNode, FlowEdge>
                    nodes={nodes}
                    edges={computedEdges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onNodesChange={connection.isCanvasUnlocked ? onNodesChangeGuarded : undefined}
                    onEdgesChange={connection.isCanvasUnlocked ? onEdgesChange : undefined}
                    onConnect={onConnect}
                    nodesConnectable={connection.isCanvasUnlocked && !isSemanticMutationLocked(runStatus)}
                    edgesReconnectable={connection.isCanvasUnlocked && !isSemanticMutationLocked(runStatus)}
                    elementsSelectable
                    isValidConnection={isValidConnection}
                    onInit={setReactFlow}
                    onNodeClick={(_, node) => { if (connection.isCanvasUnlocked) setSelectedNodeId(node.id); }}
                    onPaneClick={() => setSelectedNodeId('')}
                    fitView
                    fitViewOptions={{ padding: .22, maxZoom: .88 }}
                    minZoom={.2}
                    maxZoom={1.8}
                    snapToGrid={settings.gridSnap}
                    snapGrid={[settings.gridSize, settings.gridSize]}
                    deleteKeyCode={connection.isCanvasUnlocked && !isSemanticMutationLocked(runStatus) ? ['Backspace', 'Delete'] : []}
                  >
                    <Background
                      variant={BackgroundVariant.Dots}
                      gap={settings.gridSize}
                      size={1}
                      color="var(--canvas-dot)"
                    />
                  </ReactFlow>
                </div>
              </ProjectGateOverlay>
            </section>
      </main>

      {confirmRerun.length > 0 && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm rerun">
          <div className="experimental-modal">
            <div className="experimental-modal-icon">⚡</div>
            <div className="experimental-modal-copy">
              <span className="capability-badge verified">CREDIT WARNING</span>
              <h3>Chạy lại từ đầu?</h3>
              <p>Các bước trong phạm vi đầu ra sẽ chạy lại, không dùng cache và có thể tiêu tốn credit:
                {confirmRerun.map((id) => nodes.find((node) => node.id === id)?.data.title ?? id).join(', ')}
              </p>
              <p className="experimental-policy">Giữ nguyên lịch sử, dữ liệu đầu vào và cấu hình. Không bỏ qua giới hạn quota, thanh toán hoặc bảo mật của nhà cung cấp.</p>
            </div>
            <div className="experimental-modal-actions">
              <button className="fg-btn" onClick={() => setConfirmRerun([])}>Cancel</button>
              <button className="fg-btn fg-btn-primary" disabled={runStatus === 'running'} onClick={() => { setConfirmRerun([]); void runWorkflow(false, true, true, 'restart'); }}><Play size={13} /> Xác nhận chạy lại</button>
            </div>
          </div>
        </div>
      )}

      {experimentalGate.open && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Experimental capability warning">
          <div className="experimental-modal">
            <div className="experimental-modal-icon">!</div>
            <div className="experimental-modal-copy">
              <span className="capability-badge experimental">RUNTIME_PARTIAL</span>
              <h3>Experimental Google Flow capability</h3>
              <p>The current workflow contains provider capabilities that are not runtime-stable. Their request shape may be known, but a successful end-to-end execution is not guaranteed for the current Flow session.</p>
              <div className="experimental-node-list">
                {nodes.filter((node) => node.data.experimental).map((node) => (
                  <div key={node.id}><NodeIcon kind={node.data.kind} size={13} /><span>{node.data.title}</span><strong>{node.data.capabilityLabel}</strong></div>
                ))}
              </div>
              <p className="experimental-policy">FlowGraph will not bypass reCAPTCHA, authentication, quota, billing or provider security controls.</p>
            </div>
            <div className="experimental-modal-actions">
              <button className="fg-btn" onClick={() => setExperimentalGate({ open: false, failureMode: false })}>Cancel</button>
              <button className="fg-btn fg-btn-primary" onClick={() => {
                const failureMode = experimentalGate.failureMode;
                setExperimentalGate({ open: false, failureMode: false });
                void runWorkflow(failureMode, true, false, pendingRunModeRef.current);
              }}><Play size={13} /> Run anyway</button>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up Khung Lớn Toàn Màn Hình: My Library Templates */}
      <TemplatesModal
        isOpen={templatesModalOpen}
        onClose={() => setTemplatesModalOpen(false)}
        onApplyTemplate={applyTemplate}
        onSaveAsTemplate={saveCurrentAsTemplate}
        locked={!connection.isCanvasUnlocked || isSemanticMutationLocked(runStatus)}
      />

      {saveTemplateDraft && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeSaveTemplateDialog}
          onKeyDown={(event) => { if (event.key === 'Escape') closeSaveTemplateDialog(); }}
        >
          <div className="save-template-modal" role="dialog" aria-modal="true" aria-labelledby="save-template-title" onClick={(event) => event.stopPropagation()}>
            <div>
              <h3 id="save-template-title">Lưu workflow thành Template</h3>
              <p>Lưu graph hiện tại vào My Templates. Thao tác này không chạy workflow và không dùng credit.</p>
            </div>
            <label>
              <span>Tên Template</span>
              <input
                ref={saveTemplateTitleRef}
                value={saveTemplateDraft.title}
                onChange={(event) => setSaveTemplateDraft((current) => current ? { ...current, title: event.target.value } : current)}
              />
            </label>
            <label>
              <span>Mô tả</span>
              <textarea
                rows={3}
                value={saveTemplateDraft.description}
                onChange={(event) => setSaveTemplateDraft((current) => current ? { ...current, description: event.target.value } : current)}
              />
            </label>
            <div className="save-template-actions">
              <button type="button" className="fg-btn" onClick={closeSaveTemplateDialog}>Hủy</button>
              <button type="button" className="fg-btn fg-btn-primary" disabled={!saveTemplateDraft.title.trim()} onClick={confirmSaveTemplate}>
                <Save size={13} /> Lưu Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up Modal Cài đặt FlowGraph Settings */}
      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        settings={settings}
        onSave={(newSettings) => {
          setSettings(newSettings);
          // Cập nhật nóng vào adapter đang chạy mà không cần reload trang
          try {
            if ((window as any).__geminiAdapter?.updateConfig) {
              (window as any).__geminiAdapter.updateConfig({
                baseUrl: newSettings.aiGatewayUrl,
                apiKey: newSettings.aiApiKey,
                defaultModel: newSettings.aiModel,
              });
            }
          } catch {}
        }}
      />

      {/* Drawer Nhật ký Debug Workflow (Logs) */}
      <DebugLogDrawer
        open={debugLogOpen}
        onClose={() => setDebugLogOpen(false)}
        nodeTitles={Object.fromEntries(nodes.map((n) => [n.id, n.data.title || n.id]))}
        activeLiveEvents={liveEvents}
        liveStatus={runStatus}
      />
    </div>
  );
}

function App() {
  return <ReactFlowProvider><Studio /></ReactFlowProvider>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
