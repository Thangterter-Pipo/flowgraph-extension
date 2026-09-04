import React from 'react';
import { Handle, Position, useNodeConnections, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  Ban,
  Clock3,
  Crop,
  Download,
  Film,
  Image,
  List,
  Maximize2,
  MessageSquareText,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Split,
  StickyNote,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  Workflow,
} from 'lucide-react';
import type { FlowNode, FlowNodeData, NodeMediaResult } from './model';
import { portTypeClass, portsForKind, type NodePortDefinition } from './ports';

function NodeIcon({ kind, size = 14 }: { kind: string; size?: number }) {
  if (kind === 'prompt') return <MessageSquareText size={size} />;
  if (kind === 'gemini') return <Sparkles size={size} />;
  if (kind === 't2i') return <Image size={size} />;
  if (kind === 'uploadImage') return <Upload size={size} />;
  if (kind === 'imageTransform') return <Crop size={size} />;
  if (kind === 'imageUpscale' || kind === 'videoUpscale') return <Maximize2 size={size} />;
  if (kind === 'cancelGeneration') return <Ban size={size} />;
  if (kind === 'likenessCheck') return <UserCheck size={size} />;
  if (kind === 'likenessList') return <List size={size} />;
  if (kind === 'characterAssign') return <UserPlus size={size} />;
  if (kind === 'characterCreate') return <Users size={size} />;
  if (kind === 'creationAgent') return <Settings2 size={size} />;
  if (kind === 'download') return <Download size={size} />;
  if (kind === 'condition') return <Split size={size} />;
  if (kind === 'delay') return <Clock3 size={size} />;
  if (kind === 'note') return <StickyNote size={size} />;
  if (kind === 'i2v' || kind === 't2v' || kind === 'extend' || kind === 'interpolation' || kind === 'reference') return <Film size={size} />;
  return <Workflow size={size} />;
}

function statusLabel(status: FlowNodeData['status']) {
  if (status === 'idle') return 'Ready';
  if (status === 'failed') return 'Error';
  return status;
}

function inferredResult(data: FlowNodeData): NodeMediaResult | undefined {
  if (data.result?.previewUrl) return data.result;
  const previewUrl = data.config.resultUrl ?? data.config.previewUrl ?? data.config.outputUrl;
  const mediaId = data.result?.mediaId ?? data.config.mediaId;
  // The content-script can only read an opaque redirect from page JS, so the
  // runtime persists mediaId without a signed URL. Synthesize the same raw
  // getMediaUrlRedirect endpoint the Flow UI uses for tiles so the node card
  // still renders the result instead of showing "No result yet".
  const fallbackUrl = mediaId
    ? `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(mediaId)}`
    : undefined;
  const resolvedPreviewUrl = previewUrl ?? fallbackUrl;
  if (!resolvedPreviewUrl) return undefined;
  const explicitType = data.config.resultType?.toLowerCase();
  return {
    type: explicitType === 'video' || data.preview === 'video' ? 'video' : 'image',
    previewUrl: resolvedPreviewUrl,
    mediaId,
    mimeType: data.config.mimeType,
    fileName: data.config.fileName,
  };
}

function compactModel(value?: string) {
  if (!value) return undefined;
  return value.replace('🍌 ', '').replace('SERVICE_TIER_', '').replace(' (NARWHAL)', '').replace(' (Landscape)', '').replace(' (Portrait)', '');
}

function shortAspect(value?: string) {
  if (!value) return undefined;
  return value.match(/\d+:\d+/)?.[0] ?? value;
}

function technicalSummary(data: FlowNodeData) {
  const c = data.config;
  const values: Array<string | undefined> = [];

  // Canvas only keeps dynamic settings that help identify the actual generation.
  // Capability descriptions, media types and input/output meanings already live in
  // the header, preview and typed ports, so repeating them here adds noise.
  if (data.kind === 't2i' || data.kind === 'characterCreate') {
    values.push(compactModel(c.model), shortAspect(c.aspectRatio));
  } else if (['t2v', 'i2v', 'extend', 'interpolation', 'reference'].includes(data.kind)) {
    values.push(compactModel(c.model), c.duration, shortAspect(c.aspectRatio), c.estimatedCredits);
  } else if (data.kind === 'imageUpscale' || data.kind === 'videoUpscale') {
    values.push(c.targetResolution, c.estimatedCredits);
  } else if (data.kind === 'imageTransform') {
    values.push(c.transform, shortAspect(c.aspectRatio));
  } else if (data.kind === 'delay') {
    values.push(c.duration);
  }

  return values.filter((value): value is string => Boolean(value && value !== 'Unavailable')).slice(0, 4);
}

function MediaResultPreview({ result }: { result: NodeMediaResult }) {
  return (
    <div className={`node-result-media ${result.type}`}>
      {result.type === 'image' ? (
        <img src={result.previewUrl} alt="Generated result" draggable={false} />
      ) : (
        <>
          <video src={result.previewUrl} muted playsInline preload="metadata" />
          <span className="node-video-indicator"><Play size={12} fill="currentColor" /></span>
        </>
      )}
    </div>
  );
}

function MainBody({ data }: { data: FlowNodeData }) {
  const result = inferredResult(data);
  const summary = technicalSummary(data);

  if (data.kind === 'prompt') return <div className="node-prompt-compact">{data.config.prompt ?? 'Empty prompt'}</div>;

  return (
    <>
      {result ? (
        <MediaResultPreview result={result} />
      ) : data.preview ? (
        <div className={`node-result-empty ${data.status === 'running' ? 'running' : ''}`}>
          {data.status === 'failed' ? <AlertTriangle size={18} /> : <NodeIcon kind={data.kind} size={18} />}
          <span>{data.status === 'running' ? 'Generating…' : data.status === 'failed' ? 'Generation failed' : 'No result yet'}</span>
        </div>
      ) : null}
      {summary.length > 0 && <div className="node-summary-line" title={summary.join(' · ')}>{summary.join(' · ')}</div>}
    </>
  );
}

function NodeErrorFooter({ nodeId, data, onRetry }: { nodeId: string; data: FlowNodeData; onRetry?: (nodeId: string) => void }) {
  if (data.status !== 'failed' || !data.errorCode) return null;
  return (
    <div className="node-error-footer" title={`${data.errorCode} — ${data.errorMessage ?? ''}${data.diagnosticId ? ` · ${data.diagnosticId}` : ''}`}>
      <span className="node-error-code">{data.errorCode}</span>
      <span className="node-error-message">{data.errorMessage ?? 'Provider error'}</span>
      {data.errorRetryable && onRetry && (
        <button className="node-error-retry" onClick={(event) => { event.stopPropagation(); onRetry(nodeId); }} title="Retry this node (upstream results are reused)">
          <RotateCcw size={10} /> Retry
        </button>
      )}
    </div>
  );
}

type PortState = 'empty' | 'connected' | 'ready' | 'required-missing';

function PortRow({ nodeId, data, port, side }: { nodeId: string; data: FlowNodeData; port: NodePortDefinition; side: 'input' | 'output' }) {
  const connections = useNodeConnections({
    id: nodeId,
    handleType: side === 'input' ? 'target' : 'source',
    handleId: port.id,
  });
  const configured = port.configKey ? Boolean(data.config[port.configKey]) : false;
  const result = inferredResult(data);
  let state: PortState = 'empty';

  if (side === 'input') {
    if (configured) state = 'ready';
    else if (connections.length) state = 'connected';
    else if (port.required) state = 'required-missing';
  } else if (data.kind === 'prompt' && port.type === 'PROMPT' && data.config.prompt) {
    state = 'ready';
  } else if (result || data.status === 'success') {
    state = 'ready';
  } else if (connections.length) {
    state = 'connected';
  }

  const typeLabel = `${port.type}${port.multiple ? '[]' : ''}`;
  const connectable = port.connectable !== false;

  return (
    <div className={`node-port-row ${side} port-state-${state} ${portTypeClass(port.type)}`} title={`${port.label}: ${typeLabel}${port.required ? ' · required' : ' · optional'}`}>
      {side === 'input' && connectable && <Handle id={port.id} type="target" position={Position.Left} className={`typed-port-handle ${portTypeClass(port.type)}`} />}
      <span className="node-port-type">{port.role ? `${port.role}: ` : ''}{typeLabel}</span>
      {side === 'output' && connectable && <Handle id={port.id} type="source" position={Position.Right} className={`typed-port-handle ${portTypeClass(port.type)}`} />}
    </div>
  );
}

function PortStrip({ nodeId, data }: { nodeId: string; data: FlowNodeData }) {
  const spec = portsForKind(data.kind);
  if (!spec.inputs.length && !spec.outputs.length) return null;
  return (
    <div className="node-port-strip">
      <div className="node-port-column input-column">
        <div className="node-port-heading">IN</div>
        {spec.inputs.length ? spec.inputs.map((port) => <PortRow key={port.id} nodeId={nodeId} data={data} port={port} side="input" />) : <span className="node-port-none">—</span>}
      </div>
      <div className="node-port-column output-column">
        <div className="node-port-heading">OUT</div>
        {spec.outputs.length ? spec.outputs.map((port) => <PortRow key={port.id} nodeId={nodeId} data={data} port={port} side="output" />) : <span className="node-port-none">—</span>}
      </div>
    </div>
  );
}

export default function WorkflowNode({ id, data, selected }: NodeProps<FlowNode>) {
  const onRetry = (nodeId: string) => {
    // React Flow nodes are rendered outside our component tree; dispatch through window
    // so the Studio can own retry semantics without threading callbacks through XYFlow.
    window.dispatchEvent(new CustomEvent('flowgraph:retry-node', { detail: { nodeId } }));
  };
  return (
    <div className={`flow-node compact-node typed-node ${data.tone} ${selected ? 'selected' : ''} ${data.status === 'failed' ? 'error' : ''} ${data.status === 'running' ? 'running' : ''}`}>
      <div className="flow-node-header compact-header">
        <span className={`node-title-icon ${data.tone}`}><NodeIcon kind={data.kind} /></span>
        <span className="flow-node-title">{data.title}</span>
        {data.experimental && <span className="exp-tag">EXP</span>}
        <span className={`flow-node-status ${data.status}`}>{statusLabel(data.status)}</span>
      </div>
      <div className="flow-node-body compact-body"><MainBody data={data} /><PortStrip nodeId={id} data={data} /></div>
      <NodeErrorFooter nodeId={id} data={data} onRetry={onRetry} />
    </div>
  );
}

export { NodeIcon };
