import React, { useState } from 'react';
import { Handle, Position, useNodeConnections, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  Clock3,
  Download,
  ExternalLink,
  Film,
  Image,
  Maximize2,
  MessageSquareText,
  MoreHorizontal,
  Play,
  RotateCcw,
  Sparkles,
  Workflow,
  Box,
  Square,
  CheckCircle2,
} from 'lucide-react';
import type { FlowNode, FlowNodeData, NodeMediaResult } from './model';
import { portTypeClass, portsForKind, type NodePortDefinition } from './ports';

function NodeIcon({ kind, size = 13 }: { kind: string; size?: number }) {
  if (kind === 'prompt') return <MessageSquareText size={size} />;
  if (kind === 'gemini') return <Sparkles size={size} />;
  if (kind === 't2i') return <Image size={size} />;
  if (kind === 'download') return <Download size={size} />;
  if (kind === 'i2v' || kind === 't2v' || kind === 'extend' || kind === 'interpolation' || kind === 'reference') return <Film size={size} />;
  return <Workflow size={size} />;
}

function inferredResult(data: FlowNodeData): NodeMediaResult | undefined {
  if (data.result?.previewUrl) return data.result;
  const previewUrl = data.config.resultUrl ?? data.config.previewUrl ?? data.config.outputUrl;
  const mediaId = data.result?.mediaId ?? data.config.mediaId;
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

export default function WorkflowNode({ id, data, selected }: NodeProps<FlowNode>) {
  const result = inferredResult(data);
  const isPrompt = data.kind === 'prompt';
  const isT2I = data.kind === 't2i';
  const isI2V = data.kind === 'i2v' || data.kind === 't2v';
  const isDownload = data.kind === 'download';
  const [selectedSize, setSelectedSize] = useState<'S' | 'M' | 'L'>('M');

  const onRetry = (nodeId: string) => {
    window.dispatchEvent(new CustomEvent('flowgraph:retry-node', { detail: { nodeId } }));
  };

  const handleDownloadClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (result?.previewUrl) {
      const a = document.createElement('a');
      a.href = result.previewUrl;
      a.download = result.fileName ?? 'flowgraph-video.mp4';
      a.click();
    }
  };

  const handleOpenClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (result?.previewUrl) {
      window.open(result.previewUrl, '_blank');
    }
  };

  return (
    <div
      className={`flow-card-stitch ${data.kind} ${data.tone} ${selected ? 'selected' : ''} ${data.status === 'running' ? 'running' : ''} ${data.status === 'failed' ? 'error' : ''}`}
    >
      {/* 1. Header */}
      <div className="flow-card-header">
        <div className="card-header-left">
          <span className={`card-icon-wrap ${data.tone}`}>
            <NodeIcon kind={data.kind} size={14} />
          </span>
          <strong className="card-title">
            {data.kind === 'download' ? 'Final Video' : data.title}
          </strong>
        </div>

        <div className="card-header-right">
          {isPrompt ? (
            <span className={`prompt-dot ${data.status === 'running' ? 'running' : 'active'}`} />
          ) : data.status === 'success' || (isDownload && result) ? (
            <span className="badge-stitch completed">
              <CheckCircle2 size={10} /> COMPLETED
            </span>
          ) : data.status === 'running' ? (
            <span className="badge-stitch running">RUNNING</span>
          ) : data.status === 'failed' ? (
            <span className="badge-stitch failed">ERROR</span>
          ) : (
            <span className="badge-stitch ready">READY</span>
          )}
          {!isPrompt && <button className="kebab-btn"><MoreHorizontal size={13} /></button>}
        </div>
      </div>

      {/* 2. Media or Prompt Body */}
      <div className="flow-card-body">
        {isPrompt ? (
          <div className="prompt-text-box">
            {data.config.prompt || 'A futuristic sports car driving on a wet neon-lit street at night, cinematic, ultra realistic.'}
          </div>
        ) : (
          <div className="media-preview-container">
            {result?.type === 'video' || isI2V || isDownload ? (
              <div className="video-player-preview">
                {result?.previewUrl ? (
                  <video src={result.previewUrl} muted playsInline preload="metadata" />
                ) : (
                  <div className="placeholder-art car-bg">
                    <span className="mock-car-glow" />
                  </div>
                )}
                <div className="player-overlay">
                  <button className="play-button-glass">
                    <Play size={18} fill="white" />
                  </button>
                  <div className="player-meta-bottom">
                    <span className="timestamp">0:00 / 0:08</span>
                    <Maximize2 size={11} className="expand-icon" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="image-preview-wrap">
                {result?.previewUrl ? (
                  <img src={result.previewUrl} alt="Generated Preview" />
                ) : (
                  <div className="placeholder-art car-bg">
                    <span className="mock-car-glow" />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Footer Toolbar / Actions */}
      {!isPrompt && (
        <div className="flow-card-footer">
          {isDownload ? (
            <div className="download-actions-toolbar">
              <button className="btn-stitch-primary" onClick={handleDownloadClick}>
                <Download size={13} /> Download
              </button>
              <button className="btn-stitch-secondary" onClick={handleOpenClick}>
                <ExternalLink size={12} /> Open
              </button>
              <button className="btn-stitch-icon">
                <MoreHorizontal size={13} />
              </button>
            </div>
          ) : (
            <div className="config-meta-toolbar">
              <div className="meta-item model-selector" title="Model">
                <Box size={11} />
                <span>{compactModel(data.config.model) || (isT2I ? 'Nano Banana 2' : 'Omni Flash')}</span>
              </div>
              {isT2I && (
                <div className="size-segmented-control batch-control" title="Số lượng tạo">
                  {(['1', '2', '3', '4'] as const).map((b) => (
                    <button
                      key={b}
                      className={(data.config.batchCount || '1') === b ? 'active' : ''}
                      title={`Tạo x${b}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        window.dispatchEvent(new CustomEvent('flowgraph:update-config', { detail: { nodeId: id, key: 'batchCount', value: b } }));
                      }}
                    >
                      x{b}
                    </button>
                  ))}
                </div>
              )}
              {isI2V && (
                <>
                  <div className="size-segmented-control mode-control" title="Chế độ tạo video">
                    {(['Thành phần', 'Khung hình'] as const).map((m) => (
                      <button
                        key={m}
                        className={(data.config.mode || 'Thành phần') === m ? 'active' : ''}
                        title={`Chế độ: ${m}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          window.dispatchEvent(new CustomEvent('flowgraph:update-config', { detail: { nodeId: id, key: 'mode', value: m } }));
                        }}
                      >
                        {m === 'Thành phần' ? '🧩 Thành phần' : '🔲 Khung hình'}
                      </button>
                    ))}
                  </div>
                  <div className="size-segmented-control duration-control" title="Thời lượng video">
                    {(['4s', '6s', '8s', '10s'] as const).map((d) => (
                      <button
                        key={d}
                        className={(data.config.duration?.replace(' seconds', 's') || '8s') === d ? 'active' : ''}
                        title={`Thời lượng: ${d}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          window.dispatchEvent(new CustomEvent('flowgraph:update-config', { detail: { nodeId: id, key: 'duration', value: d.replace('s', ' seconds') } }));
                        }}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <div className="size-segmented-control res-control" title="Độ phân giải">
                    {(['720p', '360p'] as const).map((res) => (
                      <button
                        key={res}
                        className={(data.config.resolution || '720p') === res ? 'active' : ''}
                        title={`Độ phân giải: ${res}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          window.dispatchEvent(new CustomEvent('flowgraph:update-config', { detail: { nodeId: id, key: 'resolution', value: res } }));
                        }}
                      >
                        {res}
                      </button>
                    ))}
                  </div>
                  <div className="size-segmented-control batch-control" title="Số lượng tạo">
                    {(['1', '2', '3', '4'] as const).map((b) => (
                      <button
                        key={b}
                        className={(data.config.batchCount || '1') === b ? 'active' : ''}
                        title={`Tạo x${b}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          window.dispatchEvent(new CustomEvent('flowgraph:update-config', { detail: { nodeId: id, key: 'batchCount', value: b } }));
                        }}
                      >
                        x{b}
                      </button>
                    ))}
                  </div>
                  <div className="meta-item cost-pill" title="Chi phí tín dụng">
                    <span>Quá trình tạo sẽ tốn <u>{data.config.costCredits || '12'} tín dụng</u></span>
                  </div>
                </>
              )}
              {isT2I && (
                <div className="size-segmented-control ratio-control">
                  {(['16:9', '4:3', '1:1', '3:4', '9:16'] as const).map((r) => (
                    <button
                      key={r}
                      className={(shortAspect(data.config.aspectRatio) || '16:9') === r ? 'active' : ''}
                      title={`Tỷ lệ ${r}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        window.dispatchEvent(new CustomEvent('flowgraph:update-config', { detail: { nodeId: id, key: 'aspectRatio', value: r } }));
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
              {isI2V && (
                <div className="size-segmented-control ratio-control">
                  {(['16:9', '9:16'] as const).map((r) => (
                    <button
                      key={r}
                      className={(shortAspect(data.config.aspectRatio) || '16:9') === r ? 'active' : ''}
                      title={`Tỷ lệ ${r}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        window.dispatchEvent(new CustomEvent('flowgraph:update-config', { detail: { nodeId: id, key: 'aspectRatio', value: r } }));
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. Handles (Ports) */}
      {!isPrompt && (
        <Handle
          type="target"
          position={Position.Left}
          id={isT2I ? 'prompt' : isI2V ? 'image' : 'media'}
          className={`stitch-port-handle in ${data.tone}`}
        />
      )}
      {!isDownload && (
        <Handle
          type="source"
          position={Position.Right}
          id={isPrompt ? 'prompt' : isT2I ? 'image' : 'video'}
          className={`stitch-port-handle out ${data.tone}`}
        />
      )}
    </div>
  );
}

export { NodeIcon };
