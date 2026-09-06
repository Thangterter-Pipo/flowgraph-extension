import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  CircleUserRound,
  EllipsisVertical,
  FileDown,
  Maximize2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Share2,
  Square,
  Undo2,
  Redo2,
  Workflow,
  X,
} from 'lucide-react';
import '../theme.css';
import WorkflowNode, { NodeIcon } from './WorkflowNode';
import {
  WORKFLOW_SCHEMA_VERSION,
  buildSavedWorkflow,
  persistWorkflow,
  restoreWorkflow,
} from './workflowPersistence';
import {
  cloneInitialNodes,
  hydrateNodeData,
  initialEdges,
  palette,
  type FlowEdge,
  type FlowNode,
  type NodeStatus,
  type PaletteSpec,
  type RunStatus,
} from './model';
import {
  aspectRatioOptions,
  deriveRegistryConfig,
  durationOptions,
  modelFamilyOptions,
  serviceTierOptions,
} from './flowModelRegistry';
import { inputPort, outputPort, portTypeClass, portTypesCompatible, portsForKind } from './ports';
import { useStudioConnection, type ActiveProjectState } from './useStudioConnection';
import { ConnectionPill, ProjectDropdown, ProjectGateOverlay, accountPillLabel, flowPillLabel } from './ProjectGate';
import { RealGoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { WorkflowRuntime, type RuntimeEvent } from '../../runtime/WorkflowRuntime';
import { RuntimeError } from '../../runtime/RuntimeError';
import { validateGraph } from '../../runtime/GraphValidator';
import { supportedKinds } from '../../runtime/executors';
import { FlowSyncController } from '../../shared/sync/FlowSyncController';
import {
  isAuthoritativeFlowToStudioEvent,
  type FlowSyncEvent,
  type FlowSyncField,
} from '../../shared/sync/FlowSyncTypes';
import { getSyncNodeCapability, isSyncGenerationNode, normalizeFlowUiModelLabel, type SyncNodeKind } from '../../shared/sync/SyncCapabilityRegistry';
import FilmWorkspace from './FilmWorkspace';
import AssetWorkspace from './AssetWorkspace';
import StoryboardWorkspace from './StoryboardWorkspace';
import TimelineWorkspace from './TimelineWorkspace';
import RenderWorkspace from './RenderWorkspace';
import ProductionWorkspace from './ProductionWorkspace';
import ContinuityWorkspace from './ContinuityWorkspace';
import { useFilmProject } from './useFilmProject';

export type Workspace = 'flow' | 'production' | 'continuity' | 'shots' | 'assets' | 'storyboard' | 'timeline' | 'render';

function isVideoKind(kind: string): boolean {
  return ['t2v', 'i2v', 'extend', 'interpolation', 'reference'].includes(kind);
}

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

function recordRun(events: RuntimeEvent[], startedAt: string, workflowId: string, workflowName: string, activeProject?: ActiveProjectState) {
  if (!activeProject) return;
  const runEvent = [...events].reverse().find((event): event is Extract<RuntimeEvent, { type: 'run' }> => event.type === 'run');
  const status = runEvent?.type === 'run' ? (runEvent.state === 'validating' ? 'failed' : runEvent.state) : 'failed';
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
  projectBinding?: { projectId: string; projectName: string },
) {
  const save = useCallback(() => {
    persistWorkflow(nodes, edges, workflowId, workflowName, projectBinding);
  }, [nodes, edges, workflowId, workflowName, projectBinding]);

  // Auto-persist on changes so reloading the tab never loses in-flight progress
  useEffect(() => {
    if (!projectBinding?.projectId) return;
    persistWorkflow(nodes, edges, workflowId, workflowName, projectBinding);
  }, [nodes, edges, workflowId, workflowName, projectBinding]);

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

function NodeLibrary({ search, setSearch, locked }: { search: string; setSearch: (value: string) => void; locked: boolean }) {
  const groups = ['Generative', 'Image', 'Video', 'Character', 'Utility'] as const;
  const filtered = palette.filter((node) => `${node.title} ${node.subtitle}`.toLowerCase().includes(search.toLowerCase()));

  const dragStart = (event: React.DragEvent, spec: PaletteSpec) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/flowgraph-node', JSON.stringify(spec));
  };

  return (
    <aside className={`node-library ${locked ? 'node-library-locked' : ''}`}>
      <div className="library-title">NODE LIBRARY</div>
      <div className="library-search"><Search size={14} /><input placeholder="Search nodes..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      {groups.map((group) => (
        <div className="node-group" key={group}>
          <div className={`node-group-name ${group.toLowerCase()}`}>{group.toUpperCase()}</div>
          {filtered.filter((node) => node.group === group).map((node) => (
            <button className="palette-node" draggable={!locked} onDragStart={locked ? undefined : (event) => dragStart(event, node)} key={node.kind}>
              <span className={`palette-icon ${node.tone}`}><NodeIcon kind={node.kind} size={14} /></span>
              <span className="palette-copy"><strong>{node.title}</strong><span>{node.subtitle}</span></span>
              {node.isNew && <span className="new-tag">NEW</span>}
              {node.experimental && <span className="exp-tag">EXP</span>}
            </button>
          ))}
        </div>
      ))}
      <button className="fg-btn" style={{ width: '100%', minHeight: 35, fontSize: 9 }}><Plus size={13} /> Add Custom Node</button>
    </aside>
  );
}

function Inspector({ node, edges, updateConfig, close, locked }: { node?: FlowNode; edges: FlowEdge[]; updateConfig: (key: string, value: string) => void; close: () => void; locked: boolean }) {
  if (!node) {
    return (
      <aside className="inspector">
        <div className="inspector-tabs"><button className="inspector-tab active">Properties</button><button className="inspector-tab">Inputs</button><button className="inspector-tab">Outputs</button></div>
        <div className="empty-inspector"><div><Workflow size={44} color="#6f43aa" /><strong>No node selected</strong><span>Select a node on the canvas to inspect and edit its properties.</span></div></div>
      </aside>
    );
  }

  const data = node.data;
  const entries = Object.entries(data.config);
  const portSpec = portsForKind(data.kind);
  const inputStatus = (portId: string, required?: boolean, configKey?: string) => {
    if (configKey && data.config[configKey]) return 'Ready';
    const count = edges.filter((edge) => edge.target === node.id && edge.targetHandle === portId).length;
    if (count > 0) return `${count} connected`;
    return required ? 'Required' : 'Optional';
  };
  const outputStatus = (portId: string) => {
    if (data.result || data.status === 'success' || (data.kind === 'prompt' && data.config.prompt)) return 'Ready';
    const count = edges.filter((edge) => edge.source === node.id && edge.sourceHandle === portId).length;
    return count > 0 ? `${count} connected` : 'Available';
  };
  const registryKinds = ['t2i', 'characterCreate', 't2v', 'i2v', 'extend', 'interpolation', 'reference', 'imageUpscale', 'videoUpscale'];
  const registryBacked = registryKinds.includes(data.kind);
  const modelOptions = registryBacked
    ? modelFamilyOptions(data.kind, data.config)
    : data.kind === 'gemini'
      ? ['Gemini 2.5 Pro', 'Gemini 2.5 Flash']
      : [];
  const registryDurations = registryBacked ? durationOptions(data.kind, data.config) : [];
  const registryRatios = registryBacked ? aspectRatioOptions(data.kind, data.config) : [];

  const optionMap: Record<string, string[]> = {
    imageModel: ['🍌 Nano Banana Pro', '🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite'],
    model: modelOptions.length
      ? modelOptions
      : isVideoKind(data.kind)
        ? ['Omni 1.1 Flash', 'Veo 3.1 – Lite', 'Veo 3.1 – Fast', 'Veo 3.1 – Quality']
        : ['🍌 Nano Banana Pro', '🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite'],
    serviceTier: serviceTierOptions,
    mode: isVideoKind(data.kind)
      ? ['Thành phần', 'Khung hình']
      : data.kind === 'creationAgent'
        ? ['streamChat', 'Session']
        : ['Extend Forward', 'Edit Video'],
    style: ['Cinematic', 'Realistic', 'Artistic', 'Advertising', 'Anime', 'Custom'],
    aspectRatio: isVideoKind(data.kind) ? ['16:9', '9:16'] : ['16:9', '4:3', '1:1', '3:4', '9:16'],
    resolution: isVideoKind(data.kind)
      ? ['720p', '360p']
      : ['720p'],
    batchCount: ['1', '2', '3', '4'],
    duration: ['4 seconds', '6 seconds', '8 seconds', '10 seconds'],
    frameRate: ['24 fps'],
    format: ['Original media', 'MP4 (1080p)', 'MP4 (720p)'],
    promptSource: ['Input', 'Custom'],
    targetResolution: data.kind === 'imageUpscale'
      ? (modelOptions.includes('4k') ? ['2K', '4K'] : ['2K'])
      : data.kind === 'videoUpscale'
        ? (modelOptions.includes('Veo 3.1 - Upsampler 4K') ? ['1080p', '4K'] : ['1080p'])
        : ['1080p', '4K'],
    nativeAudio: ['Enabled', 'Not declared'],
    motion: ['Auto', 'Subtle', 'Dynamic'],
    usageType: ['ASSET'],
    transform: ['Crop'],
    source: ['Local File'],
    inputFormat: ['PNG / JPEG'],
    mediaSource: ['Input MediaRef', 'Active MediaRef'],
    videoSource: ['Input MediaRef'],
    imageSource: ['Input MediaRef'],
    populateImage: ['Yes', 'No'],
    imageReferenceIndex: ['1', '2', '3'],
  };
  const readonlyKeys = new Set(['usageKey', 'estimatedCredits', 'nativeAudio', 'registrySource', 'flowMode', 'flowStartImageMediaId', 'flowEndImageMediaId']);

  return (
    <aside className={`inspector ${locked ? 'inspector-locked' : ''}`}>
      <div className="inspector-tabs"><button className="inspector-tab active">Settings</button><button className="inspector-tab">Inputs</button><button className="inspector-tab">Outputs</button><button className="inspector-tab" onClick={close}><X size={12} /></button></div>
      <div className="inspector-body">
        <div className="inspector-node-head">
          <span className="inspector-node-icon"><NodeIcon kind={data.kind} size={17} /></span>
          <div><strong>{data.title}</strong><span>Node ID: {node.id}</span></div>
        </div>

        <div className={`capability-card ${data.experimental ? 'experimental' : data.maturity === 'RUNTIME_VERIFIED' ? 'verified' : 'local'}`}>
          <div className="capability-card-head">
            <span className={`capability-badge ${data.experimental ? 'experimental' : data.maturity === 'RUNTIME_VERIFIED' ? 'verified' : 'local'}`}>{data.capabilityLabel}</span>
            {data.isNew && <span className="new-tag">NEW API</span>}
          </div>
          <strong>{data.maturity.replaceAll('_', ' ')}</strong>
          <p>{data.capabilitySummary}</p>
          {data.evidence && <span className="capability-evidence">Evidence: {data.evidence}</span>}
        </div>

        {(portSpec.inputs.length > 0 || portSpec.outputs.length > 0) && (
          <div className="form-section inspector-ports-section">
            <div className="form-section-title">Available ports</div>
            <div className="inspector-port-grid">
              <div>
                <div className="inspector-port-heading">Inputs</div>
                {portSpec.inputs.length ? portSpec.inputs.map((port) => (
                  <div className={`inspector-port-row ${portTypeClass(port.type)}`} key={`in-${port.id}`}>
                    <span><strong>{port.label}{port.required ? '*' : ''}</strong><small>{port.type}{port.multiple ? '[]' : ''}</small></span>
                    <em>{inputStatus(port.id, port.required, port.configKey)}</em>
                  </div>
                )) : <span className="inspector-port-empty">No inputs</span>}
              </div>
              <div>
                <div className="inspector-port-heading">Outputs</div>
                {portSpec.outputs.length ? portSpec.outputs.map((port) => (
                  <div className={`inspector-port-row ${portTypeClass(port.type)}`} key={`out-${port.id}`}>
                    <span><strong>{port.label}</strong><small>{port.type}{port.multiple ? '[]' : ''}</small></span>
                    <em>{outputStatus(port.id)}</em>
                  </div>
                )) : <span className="inspector-port-empty">No outputs</span>}
              </div>
            </div>
          </div>
        )}

        <div className="form-section">
          <div className="form-section-title">Node configuration</div>
          {entries.map(([key, value]) => {
            const options = optionMap[key];
            const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
            if (key === 'prompt' || key === 'note' || key === 'expression' || key === 'customPrompt') {
              return <label key={key}><span className="form-label">{label}</span><textarea className="form-control" value={value} disabled={locked} onChange={(event) => updateConfig(key, event.target.value)} /></label>;
            }
            if (readonlyKeys.has(key)) {
              return <label key={key}><span className="form-label">{label}</span><input className="form-control registry-readonly" value={value} readOnly /></label>;
            }
            if (options) {
              return <label key={key}><span className="form-label">{label}</span><select className="form-control" value={value} disabled={locked} onChange={(event) => updateConfig(key, event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
            }
            return <label key={key}><span className="form-label">{label}</span><input className="form-control" value={value} disabled={locked} onChange={(event) => updateConfig(key, event.target.value)} /></label>;
          })}
        </div>

        {(data.kind === 't2i' || data.kind === 'gemini') && <div className="form-section"><div className="form-section-title">Prompt source</div><div className="segmented"><button className="active">Input</button><button>Custom</button></div></div>}

        {data.preview && <div className="form-section"><div className="form-section-title">Preview (Latest Output)</div><div className="inspector-preview" /></div>}
        {data.experimental && <div className="form-section"><div className="fg-badge running">Experimental node</div><p className="fg-muted" style={{ fontSize: 9, lineHeight: 1.45 }}>This capability is feature-flagged and should not be treated as runtime-stable until provider compatibility is verified.</p></div>}
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

function restoreSavedNodes(): FlowNode[] {
  const projectId = getStoredActiveProjectId();
  return restoreWorkflow(projectId, 'main').nodes;
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
  if (node.data.config.prompt !== undefined) return node.data.config.prompt;
  const edge = edges.find((candidate) => candidate.target === node.id && candidate.targetHandle === 'prompt');
  const source = edge ? nodes.find((candidate) => candidate.id === edge.source) : undefined;
  return source?.data.config.prompt;
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
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(restoreSavedEdges());
  const [selectedNodeId, setSelectedNodeId] = useState<string>(initialSelectedNodeId);
  const [selectedSceneId, setSelectedSceneId] = useState<string>('');
  const [selectedShotId, setSelectedShotId] = useState<string>('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [workspace, setWorkspace] = useState<Workspace>('flow');
  const [search, setSearch] = useState('');
  const [activeWorkflowId, setActiveWorkflowId] = useState('main');
  const [workflowName, setWorkflowName] = useState('FlowGraph V1 Pipeline');
  const [runStatus, setRunStatus] = useState<RunStatus>('ready');
  const [elapsed, setElapsed] = useState(0);
  const [experimentalGate, setExperimentalGate] = useState<{ open: boolean; failureMode: boolean }>({ open: false, failureMode: false });
  const [reactFlow, setReactFlow] = useState<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [runError, setRunError] = useState<NodeErrorInfo | undefined>();
  const [creditsBefore, setCreditsBefore] = useState<number | undefined>();
  const [creditsAfter, setCreditsAfter] = useState<number | undefined>();
  const [confirmRerun, setConfirmRerun] = useState<string[]>([]); // node ids with cached results
  const [syncStatus, setSyncStatus] = useState<{ state: 'idle' | 'syncing' | 'synced' | 'desynced'; message?: string }>({ state: 'idle' });
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
  const { project: filmProject, setProject: setFilmProject } = useFilmProject(connection.activeProject);

  const openShotManager = () => {
    setWorkspace('shots');
  };

  const openShotManagerById = (shotId: string) => {
    setSelectedShotId(shotId);
    setWorkspace('shots');
  };

  const openFlowForShot = () => {
    setWorkspace('flow');
  };

  const nodeTypes = useMemo(() => ({ flowNode: WorkflowNode }), []);
  const { save, exportJson } = useWorkflowPersistence(
    nodes,
    edges,
    activeWorkflowId,
    workflowName,
    connection.activeProject ? { projectId: connection.activeProject.projectId, projectName: connection.activeProject.projectName } : undefined,
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);

  useEffect(() => {
    const activeProject = connection.activeProject;
    if (!activeProject?.projectId) return;
    const restored = restoreWorkflow(activeProject.projectId, 'main');
    setNodes(restored.nodes);
    setEdges(restored.edges);
    setActiveWorkflowId('main');
    setWorkflowName(restored.name ?? `${activeProject.projectName} · FlowGraph`);
    setSelectedNodeId(restored.nodes.find((node) => isSyncGenerationNode(node.data.kind))?.id ?? restored.nodes[0]?.id ?? '');
    setRunStatus('ready');
    setRunError(undefined);
  }, [connection.activeProject?.projectId, connection.activeProject?.projectName, setEdges, setNodes]);

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
            setNodes((current) => {
              const promptEdge = event.field === 'prompt'
                ? edgesRef.current.find((edge) => edge.target === event.nodeId && edge.targetHandle === 'prompt')
                : undefined;
              const writeNodeId = promptEdge?.source ?? event.nodeId;
              return current.map((node) => {
              if (node.id !== writeNodeId) return node;
              if (event.field === 'generationStatus') {
                const status = String((event.value as { status?: unknown } | undefined)?.status ?? '');
                const nodeStatus: NodeStatus = status === 'STARTED'
                  ? 'running'
                  : status === 'FAILED' || status === 'CANCELED'
                    ? 'failed'
                    : node.data.status;
                return { ...node, data: { ...node.data, status: nodeStatus } };
              }
              if (event.field === 'resultMedia') {
                const media = event.value as { mediaId?: unknown; type?: unknown } | undefined;
                if (typeof media?.mediaId !== 'string') return node;
                const type = String(media.type).toUpperCase() === 'IMAGE' ? 'image' as const : 'video' as const;
                return {
                  ...node,
                  data: {
                    ...node.data,
                    status: 'success',
                    result: { type, mediaId: media.mediaId, previewUrl: '' },
                  },
                };
              }
              if (event.field === 'prompt') {
                return { ...node, data: { ...node.data, config: { ...node.data.config, prompt: String(event.value ?? '') } } };
              }
              if (event.field === 'mode') {
                return { ...node, data: { ...node.data, config: { ...node.data.config, flowMode: String(event.value ?? '') } } };
              }
              if (event.field === 'model') {
                const rawModel = String(event.value ?? '');
                const mappedModel = modelFamilyOptions(node.data.kind, node.data.config)
                  .find((candidate) => normalizeFlowUiModelLabel(candidate) === rawModel) ?? rawModel;
                return { ...node, data: { ...node.data, config: { ...node.data.config, model: mappedModel } } };
              }
              if (event.field === 'aspectRatio') {
                const rawRatio = String(event.value ?? '');
                const mappedRatio = aspectRatioOptions(node.data.kind, node.data.config)
                  .find((candidate) => ratioForFlow(candidate) === rawRatio) ?? rawRatio;
                return { ...node, data: { ...node.data, config: { ...node.data.config, aspectRatio: mappedRatio } } };
              }
              if (event.field === 'durationSeconds') {
                return { ...node, data: { ...node.data, config: { ...node.data.config, duration: `${event.value} seconds` } } };
              }
              if (event.field === 'seed') {
                return { ...node, data: { ...node.data, config: { ...node.data.config, seed: String(event.value ?? '') } } };
              }
              if (event.field === 'targetResolution') {
                const value = String(event.value ?? '');
                const config = { ...node.data.config };
                if ('targetResolution' in config) config.targetResolution = value;
                if ('resolution' in config || !('targetResolution' in config)) config.resolution = value;
                return { ...node, data: { ...node.data, config } };
              }
              if (event.field === 'startImage') {
                const mediaId = (event.value as { mediaId?: unknown } | undefined)?.mediaId;
                if (typeof mediaId !== 'string') return node;
                return {
                  ...node,
                  data: {
                    ...node.data,
                    config: { ...node.data.config, flowStartImageMediaId: mediaId },
                  },
                };
              }
              if (event.field === 'endImage') {
                const mediaId = (event.value as { mediaId?: unknown } | undefined)?.mediaId;
                if (typeof mediaId !== 'string') return node;
                return {
                  ...node,
                  data: {
                    ...node.data,
                    config: { ...node.data.config, flowEndImageMediaId: mediaId },
                  },
                };
              }
              if (event.field === 'referenceMedia') {
                const mediaIds = Array.isArray(event.value)
                  ? event.value
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
              return node;
            });
            });
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

  // FG-0206 — switching projects clears project-bound runtime results (V1: Switch & Reset).
  const activeProjectId = connection.activeProject?.projectId;
  const lastProjectRef = useRef<string | undefined>(activeProjectId);
  useEffect(() => {
    if (lastProjectRef.current !== activeProjectId) {
      lastProjectRef.current = activeProjectId;
      setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: 'idle', result: undefined, errorMessage: undefined, errorCode: undefined, errorRetryable: undefined, diagnosticId: undefined } })));
      setRunStatus('ready');
      setValidationIssues([]);
      setRunError(undefined);
    }
  }, [activeProjectId, setNodes]);

  const updateStatus = useCallback((id: string, status: NodeStatus) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, status } } : node));
  }, [setNodes]);

  const applyResult = useCallback((id: string, result: { type: 'image' | 'video'; previewUrl: string; mediaId?: string; workflowId?: string; mimeType?: string; fileName?: string }) => {
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
    cancelRef.current = true;
    if (timerRef.current) window.clearInterval(timerRef.current);
    setNodes(cloneInitialNodes());
    setEdges(initialEdges);
    setRunStatus('ready');
    setElapsed(0);
    setValidationIssues([]);
    setRunError(undefined);
    setSelectedNodeId('2');
    window.setTimeout(() => reactFlow?.fitView({ padding: .18, duration: 350 }), 0);
  }, [reactFlow, setEdges, setNodes]);

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
    });
  }, [nodes, edges, connection.activeProject]);

  const runWorkflow = useCallback(async (failureMode = false, allowExperimental = false, bypassCache = false) => {
    void failureMode;
    if (runStatus === 'running') return;
    if (!connection.isCanvasUnlocked) return;
    if (!allowExperimental && nodes.some((node) => node.data.experimental)) {
      setExperimentalGate({ open: true, failureMode });
      return;
    }

    const report = validate();
    setValidationIssues(report.errors.map((issue) => `${issue.code}: ${issue.message}`));
    if (!report.valid) {
      setRunStatus('error');
      return;
    }

    // FG-0904 — if generation nodes already produced a result this session (cache populated),
    // confirm the rerun because it costs credits.
    const expensive = nodes.filter((node) => ['t2i', 'i2v', 't2v'].includes(node.data.kind) && (node.data.result?.mediaId || node.data.status === 'success'));
    if (expensive.length > 0 && !confirmRerun.length) {
      setConfirmRerun(expensive.map((node) => node.id));
      return;
    }

    const generationNode = nodes.find((node) => ['t2i', 'i2v', 't2v'].includes(node.data.kind));
    if (generationNode && syncControllerRef.current) {
      await syncWriteQueueRef.current;
      const values = syncValuesForNode(generationNode, nodes, edges);
      const preflight = syncControllerRef.current.preflight({
        projectId: connection.activeProject!.projectId,
        nodeKind: generationNode.data.kind as SyncNodeKind,
        values,
        uiVerified: syncUiVerifiedRef.current,
      });
      if (!preflight.ok) {
        const blocker = preflight.blocking[0];
        setRunError({
          code: blocker?.code ?? 'PREFLIGHT_FAILED',
          message: blocker?.message ?? 'Realtime Flow sync preflight failed.',
          retryable: false,
        });
        setRunStatus('error');
        return;
      }
    }

    cancelRef.current = false;
    setElapsed(0);
    setRunStatus('running');
    setRunError(undefined);
    setCreditsBefore(connection.credits?.credits);
    setCreditsAfter(connection.credits?.credits);
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: 'queued', result: undefined, errorMessage: undefined, errorCode: undefined, errorRetryable: undefined, diagnosticId: undefined } })));
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
    const emit = (event: RuntimeEvent) => {
      runEvents.push(event);
      if (event.type === 'node') {
        updateStatus(event.nodeId, event.state);
        if (event.result) applyResult(event.nodeId, event.result);
        if (event.error) applyError(event.nodeId, event.error);
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
              error: event.issues && event.issues.length > 0 ? { code: 'VALIDATION_FAILED', message: event.issues[0].message, retryable: false } : undefined,
            }).catch(() => {});
          }
        } catch {}
      }
    };

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
          bypassCache,
        },
        emit,
      );
    } catch (error) {
      const runtimeError = error instanceof RuntimeError ? error : new RuntimeError('PROVIDER_ERROR', error instanceof Error ? error.message : String(error));
      setRunError({ code: runtimeError.code, message: runtimeError.message, retryable: runtimeError.retryable, diagnosticId: runtimeError.diagnosticId });
      setRunStatus('error');
    } finally {
      if (timerRef.current) window.clearInterval(timerRef.current);
      recordRun(runEvents, startedAt, activeWorkflowId, workflowName, connection.activeProject);
    }
  }, [nodes, edges, runStatus, connection.isCanvasUnlocked, connection.activeProject, connection.account, connection.flow, connection, updateStatus, applyResult, applyError, runtime, setNodes, setRunStatus, activeWorkflowId, workflowName, validate, recordRun]);

  const stopWorkflow = () => {
    cancelRef.current = true;
    if (timerRef.current) window.clearInterval(timerRef.current);
    void runtime().cancel();
    setNodes((current) => current.map((node) => node.data.status === 'running' || node.data.status === 'queued' ? { ...node, data: { ...node.data, status: 'idle' } } : node));
    setRunStatus('ready');
  };

  const retryFailedNode = useCallback(async (nodeId: string) => {
    if (!connection.isCanvasUnlocked) return;
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
        if (event.type === 'node') {
          updateStatus(event.nodeId, event.state);
          if (event.result) applyResult(event.nodeId, event.result);
          if (event.error) applyError(event.nodeId, event.error);
        } else if (event.type === 'run') {
          if (event.state === 'success') setRunStatus('success');
          if (event.state === 'failed') setRunStatus('error');
        }
      });
    } catch (error) {
      setRunStatus('error');
    } finally {
      if (timerRef.current) window.clearInterval(timerRef.current);
    }
  }, [connection.isCanvasUnlocked, connection.activeProject, connection.account, connection.flow, nodes, edges, updateStatus, applyResult, applyError, runtime, setRunStatus, activeWorkflowId]);

  useEffect(() => {
    const onRetryEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId: string }>).detail;
      if (detail?.nodeId) void retryFailedNode(detail.nodeId);
    };
    window.addEventListener('flowgraph:retry-node', onRetryEvent);
    return () => window.removeEventListener('flowgraph:retry-node', onRetryEvent);
  }, [retryFailedNode]);

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
    if (!isValidConnection(candidate)) return;
    const source = nodes.find((node) => node.id === candidate.source);
    setEdges((current) => addEdge({ ...candidate, type: 'default', style: { stroke: colorForTone(source?.data.tone ?? 'purple') } }, current));
  }, [connection.isCanvasUnlocked, isValidConnection, nodes, setEdges]);

  const onDrop = useCallback((event: React.DragEvent) => {
    if (!connection.isCanvasUnlocked) return;
    event.preventDefault();
    if (!reactFlow) return;
    const raw = event.dataTransfer.getData('application/flowgraph-node');
    if (!raw) return;
    const spec = JSON.parse(raw) as PaletteSpec;
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const id = `${Date.now()}`;
    const newNode: FlowNode = {
      id,
      type: 'flowNode',
      position,
      data: hydrateNodeData(spec),
    };
    setNodes((current) => [...current, newNode]);
    setSelectedNodeId(id);
  }, [connection.isCanvasUnlocked, reactFlow, setNodes]);

  const updateConfig = (key: string, value: string, targetNodeId?: string) => {
    if (!connection.isCanvasUnlocked) return;
    const effectiveId = targetNodeId ?? selectedNodeId;
    setNodes((current) => current.map((node) => {
      if (node.id !== effectiveId) return node;
      let config = { ...node.data.config, [key]: value };

      if (node.data.kind === 'imageUpscale' && key === 'targetResolution') {
        config.model = value === '4K' ? '4k' : '2K';
      }
      if (node.data.kind === 'videoUpscale' && key === 'targetResolution') {
        config.model = value === '4K' ? 'Veo 3.1 - Upsampler 4K' : 'Veo 3.1 - Upsampler 1080P';
      }

      config = deriveRegistryConfig(node.data.kind, config);
      return { ...node, data: { ...node.data, config } };
    }));

    const configKeyToField: Partial<Record<string, FlowSyncField>> = {
      prompt: 'prompt',
      model: 'model',
      aspectRatio: 'aspectRatio',
      duration: 'durationSeconds',
      seed: 'seed',
      targetResolution: 'targetResolution',
      resolution: 'targetResolution',
    };
    const field = configKeyToField[key];
    const targetNode = nodes.find((n) => n.id === effectiveId) ?? selectedNode;
    const syncTarget = resolveSelectedSyncTarget(targetNode, nodes, edges);
    if (!field || !syncTarget) return;
    const syncValue = field === 'durationSeconds' || field === 'seed'
      ? Number.parseInt(value, 10)
      : field === 'model'
        ? normalizeFlowUiModelLabel(value)
        : field === 'aspectRatio'
          ? ratioForFlow(value)
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
    window.addEventListener('flowgraph:update-config', handleUpdateConfig);
    return () => window.removeEventListener('flowgraph:update-config', handleUpdateConfig);
  }, [updateConfig]);

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
    return edges.map((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);
      const isSourceRunning = sourceNode?.data.status === 'running';
      const isTargetRunning = targetNode?.data.status === 'running';
      const isSourceSuccess = sourceNode?.data.status === 'success';
      const isRunning = runStatus === 'running';

      let className = '';
      let animated = false;

      if (isRunning && (isSourceRunning || isTargetRunning)) {
        className = 'running-active';
        animated = true;
      } else if (isRunning) {
        className = 'running';
        animated = true;
      } else if (isSourceSuccess) {
        className = 'running-success';
      }

      return {
        ...edge,
        type: 'default', // Bézier curve
        animated,
        className,
      };
    });
  }, [edges, nodes, runStatus]);

  const renderFilmWorkspace = () => {
    if (!filmProject) {
      return (
        <div className="empty-state">
          <Workflow size={48} />
          <h2>Project Required</h2>
          <p>Open or create a Google Flow project to use Film workspaces.</p>
          <button className="fg-btn fg-btn-primary" onClick={() => setWorkspace('flow')}><Workflow size={14} /> Open FlowGraph</button>
        </div>
      );
    }
    switch (workspace) {
      case 'production':
        return <ProductionWorkspace project={filmProject} setProject={setFilmProject} />;
      case 'continuity':
        return <ContinuityWorkspace project={filmProject} setProject={setFilmProject} openShotManager={openShotManagerById} />;
      case 'shots':
        return (
          <FilmWorkspace
            project={filmProject}
            setProject={setFilmProject}
            selectedSceneId={selectedSceneId}
            setSelectedSceneId={setSelectedSceneId}
            selectedShotId={selectedShotId}
            setSelectedShotId={setSelectedShotId}
            openFlowForShot={openFlowForShot}
          />
        );
      case 'assets':
        return (
          <AssetWorkspace
            project={filmProject}
            setProject={setFilmProject}
            selectedAssetId={selectedAssetId}
            setSelectedAssetId={setSelectedAssetId}
            selectedShotId={selectedShotId}
          />
        );
      case 'storyboard':
        return (
          <StoryboardWorkspace
            project={filmProject}
            selectedSceneId={selectedSceneId}
            setSelectedSceneId={setSelectedSceneId}
            selectedShotId={selectedShotId}
            setSelectedShotId={setSelectedShotId}
            openFlowForShot={openFlowForShot}
            openShotManager={openShotManager}
          />
        );
      case 'timeline':
        return <TimelineWorkspace project={filmProject} setProject={setFilmProject} openShotManager={openShotManagerById} />;
      case 'render':
        return <RenderWorkspace project={filmProject} />;
      default:
        return null;
    }
  };

  return (
    <div className="fg-shell studio-app">
      <header className="studio-topbar">
        <div className="fg-brand"><div className="fg-logo"><Workflow size={19} /></div><div className="fg-brand-title">FlowGraph <span>Studio</span></div></div>
        <div className="topbar-center">
          <div className="workflow-title">
            <input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} />
            <span className="fg-version">v1.3</span>
          </div>
        </div>
        <div className="topbar-actions">
          <select
            className="fg-select workspace-select"
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value as Workspace)}
            title="FG-1300 Multi-Workspace Switcher"
          >
            <option value="flow">🎯 FG-1300: FlowGraph Canvas (Full)</option>
            <option value="production">📁 Workspace 1: Project Settings</option>
            <option value="continuity">🔗 Workspace 2: Continuity</option>
            <option value="shots">🎬 Workspace 3: Shots Studio</option>
            <option value="assets">📦 Workspace 4: Assets Library</option>
            <option value="storyboard">📋 Workspace 5: Storyboard</option>
            <option value="timeline">⏱ Workspace 6: Timeline Editor</option>
            <option value="render">🚀 Workspace 7: Render Production</option>
          </select>
          <ProjectDropdown connection={connection} />
          <ConnectionPill
            state={accountState === 'CONNECTED' ? 'online' : accountState === 'CHECKING' ? 'checking' : accountState === 'SESSION_EXPIRED' ? 'warn' : accountState === 'DISCONNECTED' ? 'offline' : 'error'}
            label={accountPillLabel(accountState, connection.account.email)}
            onRefresh={() => void connection.refreshAccount()}
            icon={<CircleUserRound size={14} />}
          />
          <ConnectionPill
            state={flowState === 'READY' || flowState === 'CONNECTED' ? 'online' : flowState === 'CHECKING' ? 'checking' : flowState === 'PROJECT_REQUIRED' ? 'warn' : flowState === 'ERROR' ? 'error' : 'offline'}
            label={flowPillLabel(flowState, connection.flow.projectId)}
            onRefresh={() => void connection.refreshFlow()}
            icon={<Workflow size={14} />}
          />
          <ConnectionPill
            state={syncPillState}
            label={syncPillLabel}
            title={syncStatus.message}
            icon={<Workflow size={14} />}
          />
          {/* Clean Topbar: no fake undo/redo, only real capabilities */}
          <button className="fg-btn" onClick={saveCurrent}><Save size={14} /> Save</button>
          <button className="fg-btn" onClick={exportCurrent}><FileDown size={14} /> Export</button>
          {runStatus === 'running' ? <button className="fg-btn fg-btn-primary" onClick={stopWorkflow}><Square size={13} /> Stop Workflow</button> : <button className="fg-btn fg-btn-primary" disabled={!connection.isCanvasUnlocked} onClick={() => void runWorkflow(false)}><Play size={14} /> Run Workflow</button>}
        </div>
      </header>

      <main className="studio-main">
        {workspace === 'flow' ? (
          <>
            <NodeLibrary search={search} setSearch={setSearch} locked={!connection.isCanvasUnlocked} />

            <section className="studio-center">
              <ProjectGateOverlay connection={connection}>
                <div className="canvas-wrap" onDrop={onDrop} onDragOver={(event) => { if (connection.isCanvasUnlocked) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}>
                  <div className="canvas-toolbar">
                    <button className="fg-btn fg-icon-btn" onClick={() => reactFlow?.fitView({ padding: .18, duration: 300 })}><Maximize2 size={13} /></button>
                    <button className="fg-btn" style={{ minHeight: 29, fontSize: 9 }} onClick={resetWorkflow}><RotateCcw size={12} /> Reset</button>
                  </div>
                  <ReactFlow<FlowNode, FlowEdge>
                    nodes={nodes}
                    edges={computedEdges}
                    nodeTypes={nodeTypes}
                    onNodesChange={connection.isCanvasUnlocked ? onNodesChange : undefined}
                    onEdgesChange={connection.isCanvasUnlocked ? onEdgesChange : undefined}
                    onConnect={onConnect}
                    isValidConnection={isValidConnection}
                    onInit={setReactFlow}
                    onNodeClick={(_, node) => { if (connection.isCanvasUnlocked) setSelectedNodeId(node.id); }}
                    onPaneClick={() => setSelectedNodeId('')}
                    fitView
                    fitViewOptions={{ padding: .18 }}
                    minZoom={.35}
                    maxZoom={1.8}
                    deleteKeyCode={connection.isCanvasUnlocked ? ['Backspace', 'Delete'] : []}
                  >
                    <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#28344a" />
                    <Controls position="bottom-left" showInteractive={false} />
                    <MiniMap position="top-right" pannable zoomable nodeColor={(node) => colorForTone((node.data as FlowNode['data']).tone)} maskColor="rgba(5,9,14,.60)" />
                  </ReactFlow>
                </div>
              </ProjectGateOverlay>
            </section>
          </>
        ) : (
          <div className="film-workspace-full">{renderFilmWorkspace()}</div>
        )}
      </main>

      {confirmRerun.length > 0 && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm rerun">
          <div className="experimental-modal">
            <div className="experimental-modal-icon">⚡</div>
            <div className="experimental-modal-copy">
              <span className="capability-badge verified">CREDIT WARNING</span>
              <h3>Rerun cached nodes?</h3>
              <p>These nodes already produced results that will be replayed from the cache (0 credits). Running anyway regenerates them and may deduct credits:
                {confirmRerun.map((id) => nodes.find((node) => node.id === id)?.data.title ?? id).join(', ')}
              </p>
              <p className="experimental-policy">FlowGraph will not bypass quota, billing or provider security controls.</p>
            </div>
            <div className="experimental-modal-actions">
              <button className="fg-btn" onClick={() => setConfirmRerun([])}>Cancel</button>
              <button className="fg-btn fg-btn-primary" onClick={() => { setConfirmRerun([]); void runWorkflow(false, false, true); }}><Play size={13} /> Run anyway</button>
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
                void runWorkflow(failureMode, true);
              }}><Play size={13} /> Run anyway</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return <ReactFlowProvider><Studio /></ReactFlowProvider>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
