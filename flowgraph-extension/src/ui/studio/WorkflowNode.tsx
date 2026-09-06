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

const IMAGE_MODELS = ['🍌 Nano Banana Pro', '🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite'];
const VIDEO_MODELS = ['Omni 1.1 Flash', 'Veo 3.1 – Lite', 'Veo 3.1 – Fast', 'Veo 3.1 – Quality'];
const ASPECT_RATIOS_IMAGE = ['16:9', '4:3', '1:1', '3:4', '9:16'];
const ASPECT_RATIOS_VIDEO = ['16:9', '9:16'];
const DURATIONS = ['4s', '6s', '8s', '10s'];
const RESOLUTIONS = ['720p', '360p'];
const BATCH_COUNTS = ['1', '2', '3', '4'];

export default function WorkflowNode({ id, data, selected }: NodeProps<FlowNode>) {
  const result = inferredResult(data);
  const isPrompt = data.kind === 'prompt';
  const isT2I = data.kind === 't2i';
  const isI2V = data.kind === 'i2v' || data.kind === 't2v';
  const isInterpolation = data.kind === 'interpolation';
  const isVideoNode = isI2V || isInterpolation;
  const isDownload = data.kind === 'download';

  const [showSettingsModal, setShowSettingsModal] = useState(false);
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
          {!isPrompt && !isDownload && (
            <button
              className="kebab-btn"
              title="Cài đặt cấu hình"
              onClick={(e) => {
                e.stopPropagation();
                setShowSettingsModal(!showSettingsModal);
              }}
            >
              <Settings2 size={12} />
            </button>
          )}
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
            <div
              className="config-meta-toolbar-compact"
              onClick={(e) => {
                e.stopPropagation();
                setShowSettingsModal(!showSettingsModal);
              }}
              title="Click để mở cài đặt tham số"
            >
              <div className="meta-pill model" title="Mô hình đang chọn">
                <Box size={11} />
                <span>{compactModel(data.config.model) || (isT2I ? 'Nano Banana 2' : 'Omni 1.1 Flash')}</span>
                <ChevronDown size={10} className="dropdown-caret" />
              </div>
              {isVideoNode && (
                <div className="meta-pill duration" title="Thời lượng">
                  <Clock3 size={10} />
                  <span>{data.config.duration?.replace(' seconds', 's') || '8s'}</span>
                </div>
              )}
              {isVideoNode && (
                <div className="meta-pill res" title="Độ phân giải">
                  <span>{data.config.resolution || '720p'}</span>
                </div>
              )}
              <div className="meta-pill aspect" title="Tỷ lệ khung hình">
                <Square size={10} />
                <span>{shortAspect(data.config.aspectRatio) || '16:9'}</span>
              </div>
              <div className="meta-pill batch" title="Số lượng tạo">
                <span>x{data.config.batchCount || '1'}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Settings Popup Modal */}
      {showSettingsModal && (
        <div className="node-settings-popup" onClick={(e) => e.stopPropagation()}>
          <div className="popup-header">
            <div className="popup-tabs">
              <span className={`popup-tab ${isT2I ? 'active' : ''}`}>
                <Image size={11} /> Hình ảnh
              </span>
              <span className={`popup-tab ${isVideoNode ? 'active' : ''}`}>
                <Film size={11} /> Video
              </span>
            </div>
            <button className="popup-close-btn" onClick={() => setShowSettingsModal(false)}>
              <X size={12} />
            </button>
          </div>

          <div className="popup-body">
            {/* Mode selection for Video */}
            {isVideoNode && (
              <div className="popup-row">
                <span className="row-label">Chế độ</span>
                <div className="popup-segmented">
                  {(['Khung hình', 'Thành phần'] as const).map((m) => (
                    <button
                      key={m}
                      className={(data.config.mode || (isInterpolation ? 'Khung hình' : 'Thành phần')) === m ? 'active' : ''}
                      onClick={() => dispatchUpdate('mode', m)}
                    >
                      {m === 'Khung hình' ? '🔲 Khung hình' : '🧩 Thành phần'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Model Selector Dropdown */}
            <div className="popup-row">
              <span className="row-label">Mô hình AI</span>
              <select
                className="popup-select"
                value={data.config.model || (isT2I ? '🍌 Nano Banana 2' : 'Omni 1.1 Flash')}
                onChange={(e) => dispatchUpdate('model', e.target.value)}
              >
                {(isT2I ? IMAGE_MODELS : VIDEO_MODELS).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* Start/End Image Model for Interpolation */}
            {isInterpolation && (
              <div className="popup-row">
                <span className="row-label">Model khung hình</span>
                <select
                  className="popup-select"
                  value={data.config.imageModel || '🍌 Nano Banana 2'}
                  onChange={(e) => dispatchUpdate('imageModel', e.target.value)}
                >
                  {IMAGE_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Aspect Ratio */}
            <div className="popup-row">
              <span className="row-label">Tỷ lệ khung hình</span>
              <div className="popup-segmented">
                {(isT2I ? ASPECT_RATIOS_IMAGE : ASPECT_RATIOS_VIDEO).map((r) => (
                  <button
                    key={r}
                    className={(shortAspect(data.config.aspectRatio) || '16:9') === r ? 'active' : ''}
                    onClick={() => dispatchUpdate('aspectRatio', r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Resolution (for Video) */}
            {isVideoNode && (
              <div className="popup-row">
                <span className="row-label">Độ phân giải</span>
                <div className="popup-segmented">
                  {RESOLUTIONS.map((res) => (
                    <button
                      key={res}
                      className={(data.config.resolution || '720p') === res ? 'active' : ''}
                      onClick={() => dispatchUpdate('resolution', res)}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Duration (for Video) */}
            {isVideoNode && (
              <div className="popup-row">
                <span className="row-label">Thời lượng</span>
                <div className="popup-segmented">
                  {DURATIONS.map((d) => (
                    <button
                      key={d}
                      className={(data.config.duration?.replace(' seconds', 's') || '8s') === d ? 'active' : ''}
                      onClick={() => dispatchUpdate('duration', d.replace('s', ' seconds'))}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Batch Count Multiplier */}
            <div className="popup-row">
              <span className="row-label">Số lượng tạo</span>
              <div className="popup-segmented">
                {BATCH_COUNTS.map((b) => (
                  <button
                    key={b}
                    className={(data.config.batchCount || '1') === b ? 'active' : ''}
                    onClick={() => dispatchUpdate('batchCount', b)}
                  >
                    x{b}
                  </button>
                ))}
              </div>
            </div>

            {/* Cost note */}
            <div className="popup-cost-note">
              Quá trình tạo sẽ tốn <u>{data.config.costCredits || (isT2I ? '0' : '12')} tín dụng</u>
            </div>
          </div>
        </div>
      )}

      {/* 5. Handles (Ports) */}
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
