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
  const explicitType = data.config.resultType?.toLowerCase();
  if (data.result?.mediaId) {
    return {
      type: explicitType === 'video' || data.preview === 'video' ? 'video' : 'image',
      previewUrl: previewUrl || '',
      mediaId: data.result.mediaId,
      mimeType: data.result.mimeType,
      fileName: data.result.fileName,
    };
  }
  if (!previewUrl) return undefined;
  return {
    type: explicitType === 'video' || data.preview === 'video' ? 'video' : 'image',
    previewUrl,
    mediaId,
    mimeType: data.config.mimeType,
    fileName: data.config.fileName,
  };
}

interface CustomComboboxProps {
  id: string;
  activeId: string | null;
  onToggle: (id: string | null) => void;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (val: string) => void;
  icon?: React.ReactNode;
  wrapClass?: string;
  title?: string;
}

function CustomCombobox({
  id,
  activeId,
  onToggle,
  value,
  options,
  onChange,
  icon,
  wrapClass = '',
  title = '',
}: CustomComboboxProps) {
  const open = activeId === id;
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onToggle(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onToggle]);

  const currentOption = options.find((o) => o.value === value) ?? options[0];

  return (
    <div
      ref={ref}
      className={`custom-combobox-wrap ${wrapClass} ${open ? 'is-open' : ''} nodrag nopan`}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(open ? null : id);
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {icon && <div className="custom-combobox-icon">{icon}</div>}
      <span className="custom-combobox-label">{currentOption?.label ?? value}</span>
      <ChevronDown size={9} className="custom-combobox-caret" />

      {open && (
        <div
          className="custom-combobox-dropdown nodrag nopan"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`custom-combobox-option ${opt.value === value ? 'selected' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(opt.value);
                onToggle(null);
              }}
            >
              <span>{opt.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function compactModel(value?: string) {
  if (!value) return undefined;
  return value
    .replace('🍌 ', '')
    .replace('SERVICE_TIER_', '')
    .replace(' (NARWHAL)', '')
    .replace(' (Landscape)', '')
    .replace(' (Portrait)', '')
    .replace('Veo 3.1 - Lite', 'Veo Lite')
    .replace('Veo 3.1 – Lite', 'Veo Lite')
    .replace('Veo 3.1 - Fast', 'Veo Fast')
    .replace('Veo 3.1 – Fast', 'Veo Fast')
    .replace('Veo 3.1 - Quality', 'Veo Quality')
    .replace('Veo 3.1 – Quality', 'Veo Quality')
    .replace('Veo 3.1 - ', 'Veo ')
    .replace('Veo 3.1 – ', 'Veo ')
    .replace('Omni 1.1 Flash', 'Omni')
    .replace('Omni Flash', 'Omni')
    .replace('Nano Banana 2 Lite', 'Banana Lite')
    .replace('Nano Banana 2', 'Banana 2')
    .replace('Nano Banana Pro', 'Banana Pro');
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

import { getMediaBlob, setMediaBlob } from './mediaStorage';

function SafeVideoPlayer({
  src,
  posterUrl,
  mediaId,
  isPlaying,
  onEnded,
  videoRef,
}: {
  src: string;
  posterUrl?: string;
  mediaId?: string;
  isPlaying: boolean;
  onEnded: () => void;
  videoRef: React.RefObject<HTMLVideoElement>;
}) {
  const [blobPoster, setBlobPoster] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    const targetUrl = posterUrl || (src.includes('/asb/') ? src : null);
    if (!targetUrl) return;

    if (targetUrl.startsWith('blob:') || targetUrl.startsWith('data:')) {
      setBlobPoster(targetUrl);
      return;
    }

    fetch(targetUrl)
      .then((res) => res.blob())
      .then((blob) => {
        if (active) setBlobPoster(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (active) setBlobPoster(targetUrl);
      });

    return () => {
      active = false;
    };
  }, [posterUrl, src]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {blobPoster && !isPlaying && (
        <img
          src={blobPoster}
          alt="Video Thumbnail"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 0,
          }}
        />
      )}
      <video
        ref={videoRef}
        src={src}
        controls={isPlaying}
        muted
        playsInline
        preload="metadata"
        onEnded={onEnded}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          position: 'relative',
          zIndex: isPlaying ? 2 : 0,
        }}
      />
    </div>
  );
}

function SafeImage({ src, alt, mediaId }: { src: string; alt: string; mediaId?: string }) {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    setIsLoading(true);
    if (!src && !mediaId) {
      setBlobUrl(null);
      setIsLoading(false);
      return;
    }

    // 1. Nếu là Blob hoặc Data URL cục bộ thật sự (không phải dummy)
    if (src && (src.startsWith('blob:') || (src.startsWith('data:') && !src.includes('ZHVtbXk=')))) {
      setBlobUrl(src);
      setIsLoading(false);
      return;
    }

    // 2. Nếu là local mediaId (ảnh kéo từ máy vào: 'local-...' hoặc 'dropped-...')
    if (mediaId && (mediaId.startsWith('local-') || mediaId.startsWith('dropped-'))) {
      void getMediaBlob(mediaId).then((cached) => {
        if (active) {
          if (cached) setBlobUrl(cached);
          setIsLoading(false);
        }
      });
      return;
    }

    // 3. Nếu có mediaId thật trên Google Flow: Quét DOM của tab Google Flow để lấy link signed token proxy chuẩn xác
    const resolveFromDom = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && mediaId) {
          const tabs = await chrome.tabs.query({ url: '*://flow.google.com/*' });
          const flowTab = tabs[0];
          if (flowTab?.id) {
            const injected = await chrome.scripting.executeScript({
              target: { tabId: flowTab.id },
              func: (id: string) => {
                const img = document.querySelector(`img[src*="${id}"]`)
                  || document.querySelector(`[data-media-id="${id}"] img`)
                  || document.querySelector(`[data-media-id="${id}"]`);
                return img?.getAttribute('src') || (img as any)?.currentSrc || (img as any)?.src || null;
              },
              args: [mediaId],
            });
            const domSrc = injected?.[0]?.result;
            // Hỗ trợ cả Google Flow CDN format:
            // 1) /asb/AB-n...
            // 2) flow-content.google/image/...
            if (domSrc && (domSrc.includes('/asb/AB-n') || domSrc.includes('flow-content.google')) && active) {
              const res = await fetch(domSrc);
              const blob = await res.blob();
              if (active) {
                setBlobUrl(URL.createObjectURL(blob));
                setIsLoading(false);
              }
              return;
            }
          }
        }
      } catch {}

      // Nếu src là URL hợp lệ không phải dạng /asb/<uuid>
      if (src && !src.includes('/asb/') && (src.startsWith('http://') || src.startsWith('https://'))) {
        fetch(src)
          .then((res) => res.blob())
          .then((blob) => {
            if (active) {
              setBlobUrl(URL.createObjectURL(blob));
              setIsLoading(false);
            }
          })
          .catch(() => {
            if (active) {
              setBlobUrl(src);
              setIsLoading(false);
            }
          });
      } else if (active) {
        setIsLoading(false);
      }
    };

    void resolveFromDom();

    return () => {
      active = false;
    };
  }, [src, mediaId]);

  if (!blobUrl && !src) {
    return (
      <div className="placeholder-art car-bg">
        <span className="mock-car-glow" />
      </div>
    );
  }

  const finalSrc = blobUrl || (src && !src.includes('/asb/') && !src.includes('ZHVtbXk=') ? src : '');
  if (!finalSrc) {
    return (
      <div className="placeholder-art car-bg">
        <span className="mock-car-glow" />
      </div>
    );
  }

  return <img src={finalSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

import { parseConfigFromPrompt } from './promptConfigParser';

export default function WorkflowNode({ id, data, selected }: NodeProps<FlowNode>) {
  const result = inferredResult(data);
  const isPrompt = data.kind === 'prompt';
  const isT2I = data.kind === 't2i';
  const isI2V = data.kind === 'i2v' || data.kind === 't2v';
  const isInterpolation = data.kind === 'interpolation';
  const isVideoNode = isI2V || isInterpolation;
  const isDownload = data.kind === 'download';

  // Quản lý trạng thái chỉ cho phép tối đa 1 Combobox mở tại một thời điểm
  const [activeComboboxId, setActiveComboboxId] = useState<string | null>(null);

  React.useEffect(() => {
    const handleToggle = (e: Event) => {
      const customEvent = e as CustomEvent<{ nodeId: string; open?: boolean }>;
      if (customEvent.detail?.nodeId === id) {
        setActiveComboboxId((prev) => (customEvent.detail.open ? `${id}-model` : null));
      }
    };
    window.addEventListener('flowgraph:toggle-settings', handleToggle);
    return () => window.removeEventListener('flowgraph:toggle-settings', handleToggle);
  }, [id]);

  const availableModels = modelFamilyOptions(data.kind, data.config).length
    ? modelFamilyOptions(data.kind, data.config)
    : isVideoNode
      ? ['Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality']
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
    if (videoRef.current && result?.previewUrl) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {
          // Fallback toggle if browser blocks programmatic video playback
          setIsPlaying((prev) => !prev);
        });
      }
    } else {
      setIsPlaying((prev) => !prev);
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
      className={`flow-card-stitch ${data.kind} ${data.tone} ${selected ? 'selected' : ''} ${data.status === 'running' && !result?.mediaId ? 'running' : ''} ${data.status === 'failed' ? 'error' : ''}`}
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
          ) : data.status === 'success' || (result?.mediaId && data.status !== 'running') || (isDownload && result) ? (
            <span className="badge-stitch completed">
              <CheckCircle2 size={10} /> COMPLETED
            </span>
          ) : data.status === 'running' && !result?.mediaId ? (
            <span className="badge-stitch running">RUNNING</span>
          ) : data.status === 'running' && result?.mediaId ? (
            <span className="badge-stitch completed">
              <CheckCircle2 size={10} /> COMPLETED
            </span>
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
            placeholder="Nhập nội dung mô tả prompt tại đây (hỗ trợ tự chỉnh cấu hình: 16:9, 9:16, 8s, 4K, x2, Veo Lite...)"
            onChange={(e) => {
              const newPrompt = e.target.value;
              dispatchUpdate('prompt', newPrompt);

              // Tự động phân tích và dispatch cập nhật cấu hình nếu trong prompt có nhắc tới
              const parsed = parseConfigFromPrompt(newPrompt);
              if (parsed.aspectRatio) dispatchUpdate('aspectRatio', parsed.aspectRatio);
              if (parsed.duration) dispatchUpdate('duration', parsed.duration);
              if (parsed.resolution) dispatchUpdate('resolution', parsed.resolution);
              if (parsed.batchCount) dispatchUpdate('batchCount', parsed.batchCount);
              if (parsed.modelKeyword) dispatchUpdate('model', parsed.modelKeyword);

              // Broadcast sang các downstream connected nodes nếu có
              window.dispatchEvent(new CustomEvent('flowgraph:prompt-parsed-config', {
                detail: { sourceNodeId: id, parsed }
              }));
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Nhập prompt sáng tạo (tự nhận diện tỷ lệ, thời lượng, độ phân giải)"
          />
        ) : (
          <div className="media-preview-container">
            {result?.type === 'video' || isVideoNode || isDownload ? (
              <div className="video-player-preview">
                {result?.previewUrl ? (
                  <SafeVideoPlayer
                    src={result.previewUrl}
                    posterUrl={data.config?.thumbnailUrl || data.config?.posterUrl}
                    mediaId={result.mediaId}
                    isPlaying={isPlaying}
                    onEnded={() => setIsPlaying(false)}
                    videoRef={videoRef}
                  />
                ) : (
                  <div className="placeholder-art car-bg">
                    <span className="mock-car-glow" />
                  </div>
                )}
                <div className={`player-overlay ${isPlaying ? 'is-playing' : ''}`} onClick={togglePlay}>
                  {!isPlaying && (
                    <button className="play-button-glass" onClick={togglePlay} title="Phát video">
                      <Play size={18} fill="white" />
                    </button>
                  )}
                  <div className="player-meta-bottom">
                    <span className="timestamp">{isPlaying ? '0:03 / 0:08' : '0:00 / 0:08'}</span>
                    <span className="expand-icon" onClick={handleOpenClick} title="Toàn màn hình">
                      <Maximize2 size={11} />
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="image-preview-wrap"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const files = Array.from(e.dataTransfer.files);
                  const img = files.find((f) => f.type.startsWith('image/'));
                  if (img) {
                    const blobUrl = URL.createObjectURL(img);
                    window.dispatchEvent(new CustomEvent('flowgraph:node-drop-media', {
                      detail: { nodeId: id, type: 'image', file: img, blobUrl }
                    }));
                  }
                }}
              >
                {result?.previewUrl || result?.mediaId ? (
                  <SafeImage
                    src={result.previewUrl || ''}
                    mediaId={result.mediaId}
                    alt="Generated Preview"
                  />
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
              {/* 1. Custom Combobox Model */}
              <CustomCombobox
                id={`${id}-model`}
                activeId={activeComboboxId}
                onToggle={setActiveComboboxId}
                wrapClass="model-wrap"
                title="Chọn Mô hình AI"
                icon={<Box size={11} className="model-icon" />}
                value={data.config.model || (isT2I ? '🍌 Nano Banana 2' : 'Omni 1.1 Flash')}
                options={availableModels.map((m) => ({ value: m, label: compactModel(m) ?? m }))}
                onChange={(val) => dispatchUpdate('model', val)}
              />

              {/* Video Extras: Duration & Resolution */}
              {isVideoNode && (
                <CustomCombobox
                  id={`${id}-duration`}
                  activeId={activeComboboxId}
                  onToggle={setActiveComboboxId}
                  wrapClass="duration-wrap"
                  title="Thời lượng video"
                  icon={<Clock3 size={10} />}
                  value={data.config.duration || '8 seconds'}
                  options={availableDurations.map((d) => ({ value: d, label: d.replace(' seconds', 's') }))}
                  onChange={(val) => dispatchUpdate('duration', val)}
                />
              )}

              {isVideoNode && (
                <CustomCombobox
                  id={`${id}-resolution`}
                  activeId={activeComboboxId}
                  onToggle={setActiveComboboxId}
                  wrapClass="res-wrap"
                  title="Độ phân giải"
                  value={data.config.resolution || '720p'}
                  options={availableResolutions.map((res) => ({ value: res, label: res }))}
                  onChange={(val) => dispatchUpdate('resolution', val)}
                />
              )}

              {/* 2. Custom Combobox Aspect Ratio */}
              <CustomCombobox
                id={`${id}-aspectRatio`}
                activeId={activeComboboxId}
                onToggle={setActiveComboboxId}
                wrapClass="aspect-wrap"
                title="Tỷ lệ khung hình"
                icon={<Square size={10} />}
                value={shortAspect(data.config.aspectRatio) || '16:9'}
                options={availableRatios.map((r) => ({ value: r, label: r }))}
                onChange={(val) => dispatchUpdate('aspectRatio', val)}
              />

              {/* 3. Custom Combobox Batch Count */}
              <CustomCombobox
                id={`${id}-batchCount`}
                activeId={activeComboboxId}
                onToggle={setActiveComboboxId}
                wrapClass="batch-wrap"
                title="Số lượng tạo"
                value={data.config.batchCount || '1'}
                options={availableBatches.map((b) => ({ value: b, label: `x${b}` }))}
                onChange={(val) => dispatchUpdate('batchCount', val)}
              />
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
