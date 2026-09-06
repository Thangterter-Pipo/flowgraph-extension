import React, { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Box,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  Film,
  Image,
  Maximize2,
  MessageSquareText,
  MoreHorizontal,
  Play,
  Settings2,
  Sparkles,
  Square,
  Workflow,
  X,
} from 'lucide-react';
import type { FlowNode, FlowNodeData, NodeMediaResult } from './model';
import {
  modelFamilyOptions,
  durationOptions,
  aspectRatioOptions,
  resolveVariant,
} from './flowModelRegistry';
import { portsForKind, portTypeClass } from './ports';

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

// Helper to compute registry-backed estimated credits
function computeEstimatedCredits(kind: string, config: Record<string, string>): string {
  if (kind === 't2i') return '0';
  const variant = resolveVariant(kind, config);
  if (!variant) return '12';
  const tier = (config.serviceTier as any) || 'SERVICE_TIER_INTERMEDIATE';
  const cost = variant.creditMapping[tier as keyof typeof variant.creditMapping];
  if (typeof cost === 'number') {
    const batch = Number.parseInt(config.batchCount || '1', 10) || 1;
    return String(cost * batch);
  }
  return '12';
}

function SafeImage({ src, alt }: { src: string; alt: string }) {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    if (!src) {
      setBlobUrl(null);
      return;
    }
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      setBlobUrl(src);
      return;
    }
    fetch(src)
      .then((res) => res.blob())
      .then((blob) => {
        if (active) {
          setBlobUrl(URL.createObjectURL(blob));
        }
      })
      .catch(() => {
        if (active) setBlobUrl(src);
      });
    return () => {
      active = false;
    };
  }, [src]);

  return <img src={blobUrl || src} alt={alt} />;
}

export default function WorkflowNode({ id, data, selected }: NodeProps<FlowNode>) {
  const result = inferredResult(data);
  const isPrompt = data.kind === 'prompt';
  const isT2I = data.kind === 't2i';
  const isI2V = data.kind === 'i2v' || data.kind === 't2v';
  const isInterpolation = data.kind === 'interpolation';
  const isVideoNode = isI2V || isInterpolation;
  const isDownload = data.kind === 'download';

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const popupRef = React.useRef<HTMLDivElement | null>(null);

  // Click-outside listener to dismiss popup
  React.useEffect(() => {
    if (!showSettingsModal) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowSettingsModal(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSettingsModal]);

  React.useEffect(() => {
    const handleToggle = (e: Event) => {
      const customEvent = e as CustomEvent<{ nodeId: string; open?: boolean }>;
      if (customEvent.detail?.nodeId === id) {
        setShowSettingsModal((prev) => (customEvent.detail.open !== undefined ? customEvent.detail.open : !prev));
      }
    };
    window.addEventListener('flowgraph:toggle-settings', handleToggle);
    return () => window.removeEventListener('flowgraph:toggle-settings', handleToggle);
  }, [id]);

  const availableModels = modelFamilyOptions(data.kind, data.config).length
    ? modelFamilyOptions(data.kind, data.config)
    : isVideoNode
      ? ['Omni 1.1 Flash', 'Veo 3.1 – Lite', 'Veo 3.1 – Fast', 'Veo 3.1 – Quality']
      : ['🍌 Nano Banana Pro', '🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite'];

  const availableRatios = isVideoNode ? ['16:9', '9:16'] : ['16:9', '4:3', '1:1', '3:4', '9:16'];
  const availableDurations = ['4s', '6s', '8s', '10s'];
  const availableResolutions = data.config.model?.includes('Veo') ? ['720p'] : ['720p', '360p'];
  const availableBatches = ['1', '2', '3', '4'];
  const estimatedCost = computeEstimatedCredits(data.kind, data.config);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const dispatchUpdate = (key: string, value: string) => {
    window.dispatchEvent(new CustomEvent('flowgraph:update-config', { detail: { nodeId: id, key, value } }));
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
          {/* Controls button in header removed - replaced by direct inline comboboxes in footer */}
        </div>
      </div>

      {/* 2. Media or Prompt Body */}
      <div className="flow-card-body">
        {isPrompt ? (
          <textarea
            className="prompt-textarea nodrag nopan"
            rows={3}
            value={data.config.prompt ?? ''}
            placeholder="Nhập nội dung mô tả prompt tại đây..."
            onChange={(e) => dispatchUpdate('prompt', e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            title="Nhập prompt sáng tạo"
          />
        ) : (
          <div className="media-preview-container">
            {result?.type === 'video' || isVideoNode || isDownload ? (
              <div className="video-player-preview">
                {result?.previewUrl ? (
                  <video ref={videoRef} src={result.previewUrl} muted playsInline preload="metadata" onEnded={() => setIsPlaying(false)} />
                ) : (
                  <div className="placeholder-art car-bg">
                    <span className="mock-car-glow" />
                  </div>
                )}
                <div className="player-overlay">
                  <button className="play-button-glass" onClick={togglePlay} title={isPlaying ? 'Tạm dừng' : 'Phát'}>
                    <Play size={18} fill="white" />
                  </button>
                  <div className="player-meta-bottom">
                    <span className="timestamp">{isPlaying ? '0:03 / 0:08' : '0:00 / 0:08'}</span>
                    <span className="expand-icon" onClick={handleOpenClick} title="Toàn màn hình">
                      <Maximize2 size={11} />
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="image-preview-wrap">
                {result?.previewUrl ? (
                  <SafeImage src={result.previewUrl} alt="Generated Preview" />
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

      {/* 3. Footer: Sleek and focused - only essential summary tags */}
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
              <button className="btn-stitch-icon" title="Chi tiết file" onClick={handleOpenClick}>
                <MoreHorizontal size={13} />
              </button>
            </div>
          ) : (
            <div className="inline-combobox-toolbar nodrag nopan">
              {/* 1. Combobox Model */}
              <div className="inline-combobox-wrap model-wrap" title="Chọn Mô hình AI">
                <Box size={11} className="combobox-icon model-icon" />
                <select
                  className="inline-combobox-select model-select"
                  value={data.config.model || (isT2I ? '🍌 Nano Banana 2' : 'Omni 1.1 Flash')}
                  onChange={(e) => dispatchUpdate('model', e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {compactModel(m)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={10} className="combobox-caret" />
              </div>

              {/* Video Extras: Duration & Resolution */}
              {isVideoNode && (
                <div className="inline-combobox-wrap duration-wrap" title="Thời lượng video">
                  <Clock3 size={10} className="combobox-icon" />
                  <select
                    className="inline-combobox-select"
                    value={data.config.duration || '8 seconds'}
                    onChange={(e) => dispatchUpdate('duration', e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {availableDurations.map((d) => (
                      <option key={d} value={d}>
                        {d.replace(' seconds', 's')}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={9} className="combobox-caret" />
                </div>
              )}

              {isVideoNode && (
                <div className="inline-combobox-wrap res-wrap" title="Độ phân giải">
                  <select
                    className="inline-combobox-select"
                    value={data.config.resolution || '720p'}
                    onChange={(e) => dispatchUpdate('resolution', e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {availableResolutions.map((res) => (
                      <option key={res} value={res}>
                        {res}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={9} className="combobox-caret" />
                </div>
              )}

              {/* 2. Combobox Aspect Ratio */}
              <div className="inline-combobox-wrap aspect-wrap" title="Tỷ lệ khung hình">
                <Square size={10} className="combobox-icon" />
                <select
                  className="inline-combobox-select"
                  value={shortAspect(data.config.aspectRatio) || '16:9'}
                  onChange={(e) => dispatchUpdate('aspectRatio', e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {availableRatios.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <ChevronDown size={9} className="combobox-caret" />
              </div>

              {/* 3. Combobox Batch Count */}
              <div className="inline-combobox-wrap batch-wrap" title="Số lượng tạo">
                <select
                  className="inline-combobox-select batch-select"
                  value={data.config.batchCount || '1'}
                  onChange={(e) => dispatchUpdate('batchCount', e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {availableBatches.map((b) => (
                    <option key={b} value={b}>
                      x{b}
                    </option>
                  ))}
                </select>
                <ChevronDown size={9} className="combobox-caret" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Settings Popup Modal removed - replaced by direct inline comboboxes */}

      {/* 5. Dynamic Typed Ports with sleek Port Labels */}
      <div className="dynamic-port-strip">
        {/* Left Inputs */}
        {portsForKind(data.kind).inputs.map((port, idx) => (
          <div key={port.id} className="port-anchor-wrap in" style={{ top: `${38 + idx * 26}px` }}>
            <Handle
              type="target"
              position={Position.Left}
              id={port.id}
              className={`stitch-port-handle in ${portTypeClass(port.type)}`}
              title={`${port.label} (${port.type}${port.required ? ' · bắt buộc' : ''})`}
            />
            <span className="port-badge-tag in" title={port.type}>
              {port.label}
            </span>
          </div>
        ))}

        {/* Right Outputs */}
        {portsForKind(data.kind).outputs.map((port, idx) => (
          <div key={port.id} className="port-anchor-wrap out" style={{ top: `${38 + idx * 26}px` }}>
            <span className="port-badge-tag out" title={port.type}>
              {port.label}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              className={`stitch-port-handle out ${portTypeClass(port.type)}`}
              title={`${port.label} (${port.type})`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export { NodeIcon };
