import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
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
  User,
  Copy,
  Workflow,
  X,
} from 'lucide-react';
import type { FlowNode, FlowNodeData, NodeMediaResult } from './model';
import {
  modelFamilyOptions,
  durationOptions,
  aspectRatioOptions,
  videoResolutionOptions,
} from './flowModelRegistry';
import { portsForKind, portTypeClass } from './ports';

import { getPresentationSpec, isVideoPresentationNode } from './nodePresentationSpec';
import {
  VIDEO_DURATION_OPTIONS,
  VIDEO_UPSCALE_RESOLUTIONS,
  formatPlayerTimestamp,
  computeEstimatedCredits,
  gatewayModelOptions,
} from './nodeUiContracts';
import {
  PROVIDER_MEDIA_CTA,
  UPLOAD_BROWSE_COPY,
  UPLOAD_DROP_COPY,
  UPLOAD_READY_COPY,
  classifyLocalFile,
  isProviderInputKind,
  shouldShowProviderSuccessBadge,
  shortMediaId,
  mediaNodeSettingsRows,
  type VerifiedGraphMedia,
} from './mediaInputUi';
import { isLocalMediaKey } from '../../runtime/mediaProvenance';
import { RealGoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { playVerified, recoverExactVideo, shouldRecoverVideoSource } from './videoPlaybackRecovery';

function NodeIcon({ kind, size = 13 }: { kind: string; size?: number }) {
  const spec = getPresentationSpec(kind);
  const IconComp = spec.icon;
  return <IconComp size={size} />;
}

function inferredResult(data: FlowNodeData): any {
  if ((data.result as any)?.text) return data.result;
  if (data.result?.previewUrl) {
    const r = data.result;
    const withProj = (!r.projectId && data.config?.projectId) ? { ...r, projectId: data.config.projectId } : r;
    return withProj;
  }
  const previewUrl = data.config.resultUrl ?? data.config.previewUrl ?? data.config.outputUrl;
  const mediaId = data.result?.mediaId ?? data.config.mediaId;
  const explicitType = data.config.resultType?.toLowerCase();
  if (data.result?.mediaId) {
    return {
      type: explicitType === 'video' || data.preview === 'video' || isVideoPresentationNode(data.kind) ? 'video' : 'image',
      previewUrl: data.result.previewUrl || previewUrl || '',
      mediaId: data.result.mediaId,
      mimeType: data.result.mimeType,
      fileName: data.result.fileName,
      projectId: data.result?.projectId ?? data.config?.projectId,
    };
  }
  if (!previewUrl) return undefined;
  return {
    type: explicitType === 'video' || data.preview === 'video' || isVideoPresentationNode(data.kind) ? 'video' : 'image',
    previewUrl,
    mediaId,
    mimeType: data.config.mimeType,
    fileName: data.config.fileName,
    projectId: data.config.projectId,
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
  label?: string;
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
  label = '',
}: CustomComboboxProps) {
  const open = activeId === id;
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const dropRef = React.useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = React.useState({ top: 0, left: 0, width: 180, maxHeight: 220 });

  const place = React.useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportPad = 8;
    const gap = 6;
    const width = Math.min(
      Math.max(rect.width, 180),
      Math.max(180, window.innerWidth - viewportPad * 2),
    );
    const left = Math.min(
      Math.max(viewportPad, rect.left),
      Math.max(viewportPad, window.innerWidth - width - viewportPad),
    );
    const desiredHeight = Math.min(220, Math.max(42, options.length * 34 + 12));
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportPad);
    const spaceAbove = Math.max(0, rect.top - gap - viewportPad);
    const openBelow = spaceBelow >= Math.min(desiredHeight, 128) || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(72, Math.min(220, openBelow ? spaceBelow : spaceAbove));
    const renderedHeight = Math.min(desiredHeight, maxHeight);
    const top = openBelow
      ? rect.bottom + gap
      : Math.max(viewportPad, rect.top - gap - renderedHeight);
    const next = { top, left, width, maxHeight };
    setCoords((previous) => (
      Math.abs(previous.top - next.top) < 0.25
      && Math.abs(previous.left - next.left) < 0.25
      && Math.abs(previous.width - next.width) < 0.25
      && Math.abs(previous.maxHeight - next.maxHeight) < 0.25
        ? previous
        : next
    ));
  }, [options.length]);

  React.useLayoutEffect(() => {
    if (!open) return;
    place();
    let animationFrame = 0;
    // React Flow pans/zooms by changing the viewport CSS transform. That does
    // not emit window scroll/resize events, so a body-portal dropdown otherwise
    // keeps stale screen coordinates. Follow the anchor while the menu is open;
    // React bails out when the computed placement has not changed.
    const followAnchor = () => {
      place();
      animationFrame = window.requestAnimationFrame(followAnchor);
    };
    animationFrame = window.requestAnimationFrame(followAnchor);
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || dropRef.current?.contains(target)) return;
      onToggle(null);
    };
    const onReposition = () => place();
    // Capture phase is intentional: React Flow nodes stop mousedown bubbling so
    // canvas pans and comboboxes in other nodes would otherwise leave this body
    // portal open. Capture lets every open combobox observe the outside press
    // before the node/pane consumes it, while its own anchor/dropdown is ignored.
    document.addEventListener('mousedown', handleClickOutside, true);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    document.addEventListener('wheel', onReposition, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('mousedown', handleClickOutside, true);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      document.removeEventListener('wheel', onReposition, true);
    };
  }, [open, onToggle, place]);

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const [activeIndex, setActiveIndex] = React.useState(selectedIndex);
  const currentOption = options[selectedIndex] ?? options[0];

  React.useEffect(() => {
    if (open) setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  const commitActiveOption = () => {
    const option = options[activeIndex];
    if (!option) return;
    onChange(option.value);
    onToggle(null);
  };

  return (
    <div
      ref={wrapRef}
      className={`custom-combobox-wrap ${wrapClass} ${open ? 'is-open' : ''} nodrag nopan nowheel`}
      data-label={label || title}
      title={title}
      role="combobox"
      tabIndex={0}
      aria-label={label || title || 'Select option'}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={`${id}-listbox`}
      aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(open ? null : id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (open) {
            e.preventDefault();
            onToggle(null);
          }
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          if (!open) {
            onToggle(id);
            return;
          }
          const delta = e.key === 'ArrowDown' ? 1 : -1;
          setActiveIndex((index) => (index + delta + options.length) % Math.max(options.length, 1));
          return;
        }
        if (e.key === 'Home' && open) {
          e.preventDefault();
          setActiveIndex(0);
          return;
        }
        if (e.key === 'End' && open) {
          e.preventDefault();
          setActiveIndex(Math.max(0, options.length - 1));
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          if (open) commitActiveOption();
          else onToggle(id);
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {icon && <div className="custom-combobox-icon">{icon}</div>}
      <span className="custom-combobox-label">{currentOption?.label ?? value}</span>
      <ChevronDown size={9} className="custom-combobox-caret" />

      {open && createPortal(
        <div
          ref={dropRef}
          id={`${id}-listbox`}
          role="listbox"
          aria-label={label || title || 'Options'}
          className="custom-combobox-dropdown flowgraph-combobox-portal nodrag nopan nowheel"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: coords.width,
            maxHeight: coords.maxHeight,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {options.map((opt, index) => (
            <div
              key={opt.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={opt.value === value}
              className={`custom-combobox-option ${opt.value === value ? 'selected' : ''} ${index === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={(e) => {
                e.stopPropagation();
                setActiveIndex(index);
                onChange(opt.value);
                onToggle(null);
              }}
            >
              <span>{opt.label}</span>
            </div>
          ))}
        </div>,
        document.body,
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
    .replace('Nano Banana Pro', 'Banana Pro')
    .replace('Nano Banana 2', 'Banana 2');
}

function shortAspect(value?: string) {
  if (!value) return undefined;
  return value.match(/\d+:\d+/)?.[0] ?? value;
}

function shortTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/^Text to Image.*$/i, 'T2I')
    .replace(/^Text to Video.*$/i, 'T2V')
    .replace(/^Image to Video.*$/i, 'I2V')
    .replace(/^Gemini Enhance.*$/i, 'Gemini')
    .replace(/^Upload Image.*$/i, 'Upload')
    .replace(/^Video Upscale.*$/i, 'Upscale')
    .replace(/^Image Upscale.*$/i, 'Upscale')
    .replace(/^Interpolation.*$/i, 'Smooth')
    .replace(/^Extend Video.*$/i, 'Extend')
    .replace(/^Reference Video.*$/i, 'Ref Motion')
    .replace(/^Character Create.*$/i, 'Character')
    .replace(/^Character Assign.*$/i, 'Assign')
    .replace(/^Mô Tả Cảnh.*$/i, 'Scene Prompt')
    .replace(/^Tạo Cảnh.*$/i, 'Start-End Frame')
    .replace(/^Prompt Gốc.*$/i, 'Source Prompt')
    .replace(/^Ref · Bối Cảnh.*$/i, 'Scene Reference')
    .replace(/^Ref · Nhân Vật A.*$/i, 'Character Reference A')
    .replace(/^Ref · Nhân Vật B.*$/i, 'Character Reference B');
}

// Helper to compute registry-backed estimated credits lives in nodeUiContracts.ts

import { getMediaBlob, setMediaBlob } from './mediaStorage';

function SafeVideoPlayer({
  src,
  posterUrl,
  mediaId,
  isPlaying,
  onEnded,
  onClock,
  videoRef,
  onError,
  onCanPlay,
  sourceToken,
}: {
  src: string;
  posterUrl?: string;
  mediaId?: string;
  isPlaying: boolean;
  onEnded: () => void;
  onClock?: (current: number, duration: number, sourceToken: string) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  onError: (sourceToken: string) => void;
  onCanPlay: (sourceToken: string) => void;
  sourceToken: string;
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
        onError={() => onError(sourceToken)}
        onCanPlay={() => onCanPlay(sourceToken)}
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          onClock?.(video.currentTime || 0, video.duration || 0, sourceToken);
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          onClock?.(video.currentTime || 0, video.duration || 0, sourceToken);
        }}
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
      <div className="placeholder-art empty-media-well" aria-hidden="true">
        <span className="empty-media-copy">No photo available</span>
      </div>
    );
  }

  const finalSrc = blobUrl || (src && !src.includes('/asb/') && !src.includes('ZHVtbXk=') ? src : '');
  if (!finalSrc) {
    return (
      <div className="placeholder-art empty-media-well" aria-hidden="true">
        <span className="empty-media-copy">No photo available</span>
      </div>
    );
  }

  return <img src={finalSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

import { parseConfigFromPrompt } from './promptConfigParser';

export default function WorkflowNode({ id, data, selected }: NodeProps<FlowNode>) {
  const result = inferredResult(data);
  const spec = getPresentationSpec(data.kind);
  const archetype = spec.archetype;
  const isVideoNode = isVideoPresentationNode(data.kind);
  const isPrompt = archetype === 'prompt';
  const isGemini = archetype === 'gemini';
  const isCharacter = archetype === 'character-card';
  const isDownload = archetype === 'download';
  const isImageUpscale = data.kind === 'imageUpscale';
  const isLogicOrUtility = archetype === 'logic' || archetype === 'utility';

  // Trạng thái Thu Gọn / Mở Rộng Node Siêu Tối Giản
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeComboboxId, setActiveComboboxId] = useState<string | null>(null);
  const setGlobalComboboxId = React.useCallback((next: string | null) => {
    window.dispatchEvent(new CustomEvent('flowgraph:combobox-open', { detail: { id: next } }));
    setActiveComboboxId(next);
  }, []);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [verifiedMedia, setVerifiedMedia] = useState<VerifiedGraphMedia[]>([]);
  const [manualMediaId, setManualMediaId] = useState('');
  const [manualProjectId, setManualProjectId] = useState('');
  const [manualMediaType, setManualMediaType] = useState<'IMAGE' | 'VIDEO'>(data.kind === 'videoInput' ? 'VIDEO' : 'IMAGE');
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const nodeRootRef = React.useRef<HTMLDivElement | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const isUploadImage = data.kind === 'uploadImage' || data.kind === 'imageInput';
  const isProviderInput = isProviderInputKind(data.kind);
  const stagedLocal = Boolean(result?.mediaId && isLocalMediaKey(result.mediaId));

  React.useEffect(() => {
    const handleToggle = (e: Event) => {
      const customEvent = e as CustomEvent<{ nodeId: string; open?: boolean }>;
      if (customEvent.detail?.nodeId === id) {
        setGlobalComboboxId(customEvent.detail.open ? `${id}-model` : null);
      }
    };
    window.addEventListener('flowgraph:toggle-settings', handleToggle);
    return () => window.removeEventListener('flowgraph:toggle-settings', handleToggle);
  }, [id, setGlobalComboboxId]);

  React.useEffect(() => {
    const handleGlobalCombobox = (e: Event) => {
      const nextId = (e as CustomEvent<{ id: string | null }>).detail?.id ?? null;
      if (nextId === null || !nextId.startsWith(`${id}-`)) {
        setActiveComboboxId(null);
      } else {
        setActiveComboboxId(nextId);
      }
    };
    window.addEventListener('flowgraph:combobox-open', handleGlobalCombobox);
    return () => window.removeEventListener('flowgraph:combobox-open', handleGlobalCombobox);
  }, [id]);

  React.useEffect(() => {
    const onVerified = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId: string; items: VerifiedGraphMedia[] }>).detail;
      if (detail?.nodeId === id) setVerifiedMedia(detail.items ?? []);
    };
    window.addEventListener('flowgraph:verified-media', onVerified);
    return () => window.removeEventListener('flowgraph:verified-media', onVerified);
  }, [id]);

  // React Flow caches handle geometry. Any node reflow (ratio, collapse, media/footer
  // changes) must invalidate that cache or edges remain attached to stale coordinates.
  React.useLayoutEffect(() => {
    const root = nodeRootRef.current;
    if (!root) return;
    let frame = 0;
    const refresh = () => {
      updateNodeInternals(id);
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => updateNodeInternals(id));
    };
    refresh();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refresh) : null;
    observer?.observe(root);
    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [id, updateNodeInternals]);

  const availableModels = modelFamilyOptions(data.kind, data.config).length
    ? modelFamilyOptions(data.kind, data.config)
    : isVideoNode
      ? ['Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality']
      : ['🍌 Nano Banana Pro', '🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite'];

  const registryRatios = aspectRatioOptions(data.kind, data.config)
    .map((ratio) => shortAspect(ratio) ?? ratio)
    .filter((ratio, index, all) => all.indexOf(ratio) === index);
  const availableRatios = registryRatios.length
    ? registryRatios
    : isVideoNode
      ? ['16:9', '9:16']
      : ['16:9', '4:3', '1:1', '3:4', '9:16'];
  const registryDurations = durationOptions(data.kind, data.config);
  const availableDurations = registryDurations.length ? registryDurations : [...VIDEO_DURATION_OPTIONS];
  const registryResolutions = videoResolutionOptions(data.kind, data.config);
  const availableResolutions = registryResolutions.length ? registryResolutions : ['720p', '360p'];
  const availableBatches = ['1', '2', '3', '4'];
  const estimatedCost = computeEstimatedCredits(data.kind, data.config);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackClock, setPlaybackClock] = useState({ current: 0, duration: 0 });
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [recoveredVideoSource, setRecoveredVideoSource] = useState<{
    identity: string;
    url: string;
    generation: number;
  } | null>(null);
  const [playbackMessage, setPlaybackMessage] = useState('Video playback not verified');
  const [recoveryStatus, setRecoveryStatus] = useState<'idle' | 'recovering' | 'recovered' | 'failed'>('idle');
  const [playbackVerified, setPlaybackVerified] = useState(false);
  const recoveryGeneration = React.useRef(0);
  const playAttemptGeneration = React.useRef(0);
  const currentPlaybackIdentity = React.useRef('');
  const currentPlaybackSourceToken = React.useRef('');
  const lastTimeRef = React.useRef(0);
  const recoveryStatusRef = React.useRef<'idle' | 'recovering' | 'recovered' | 'failed'>('idle');
  React.useEffect(() => { recoveryStatusRef.current = recoveryStatus; }, [recoveryStatus]);
  const playbackIdentity = `${result?.projectId || ''}:${result?.mediaId || ''}:${result?.previewUrl || ''}`;
  const recoveredVideoUrl = recoveredVideoSource?.identity === playbackIdentity ? recoveredVideoSource.url : '';
  const playbackSourceGeneration = recoveredVideoSource?.identity === playbackIdentity
    ? recoveredVideoSource.generation
    : 0;
  const playbackSourceToken = `${playbackIdentity}:${playbackSourceGeneration}:${recoveredVideoUrl ? 'recovered' : 'initial'}`;
  currentPlaybackSourceToken.current = playbackSourceToken;
  React.useEffect(() => {
    currentPlaybackIdentity.current = playbackIdentity;
    setRecoveredVideoSource(null);
    setIsPlaying(false);
    setPlaybackClock({ current: 0, duration: 0 });
    setPlaybackMessage('Video playback not verified');
    setRecoveryStatus('idle');
    recoveryStatusRef.current = 'idle';
    setPlaybackVerified(false);
    recoveryGeneration.current = 0;
    playAttemptGeneration.current += 1;
    lastTimeRef.current = 0;
  }, [playbackIdentity]);
  React.useEffect(() => {
    currentPlaybackSourceToken.current = playbackSourceToken;
    lastTimeRef.current = 0;
    setPlaybackClock({ current: 0, duration: 0 });
    setPlaybackVerified(false);
    playAttemptGeneration.current += 1;
  }, [playbackSourceToken]);
  const recoverPlayback = async (refresh = false) => {
    setIsPlaying(false);
    setPlaybackVerified(false);
    playAttemptGeneration.current += 1;
    const status = recoveryStatusRef.current;
    if ((status !== 'idle' && status !== 'failed') || !result?.mediaId || !result?.projectId) {
      setPlaybackMessage('Video unavailable. Open this exact clip in Flow; no new generation was started.');
      return;
    }
    const gen = ++recoveryGeneration.current;
    const identity = playbackIdentity;
    const currentSource = recoveredVideoUrl || result.previewUrl || '';
    recoveryStatusRef.current = 'recovering';
    setRecoveryStatus('recovering');
    setPlaybackMessage(refresh ? 'Refreshing exact video…' : 'Recovering exact video…');
    try {
      const adapter = new RealGoogleFlowAdapter();
      const url = await recoverExactVideo(
        result.mediaId,
        result.projectId,
        (payload) => adapter.waitForMedia(payload),
        refresh,
      );
      if (recoveryGeneration.current !== gen || currentPlaybackIdentity.current !== identity) return;
      if (!refresh && url === currentSource) throw new Error('Unchanged source');
      setRecoveredVideoSource({ identity, url, generation: gen });
      recoveryStatusRef.current = 'recovered';
      setRecoveryStatus('recovered');
      setPlaybackMessage('Video ready — press play to verify');
      setPlaybackVerified(false);
    } catch {
      if (recoveryGeneration.current === gen && currentPlaybackIdentity.current === identity) {
        recoveryStatusRef.current = 'failed';
        setRecoveryStatus('failed');
        setPlaybackMessage('Cannot recover exact video. Retry to refresh this clip from Flow; no generation was started.');
      }
    }
  };
  const handleRetryRecovery = (e: React.MouseEvent) => {
    e.stopPropagation();
    void recoverPlayback(true);
  };

  React.useEffect(() => {
    if (
      result?.type !== 'video'
      || !result.mediaId
      || !result.projectId
      || recoveredVideoUrl
      || recoveryStatusRef.current !== 'idle'
      || !shouldRecoverVideoSource(result.previewUrl)
    ) return;
    void recoverPlayback(false);
  }, [playbackIdentity, recoveredVideoUrl, result?.type, result?.mediaId, result?.projectId, result?.previewUrl]);

  // Committed clock handler: only verifies the currently mounted source after
  // real timeline progress. Metadata/canplay and stale-source events never count.
  const handleClock = (current: number, duration: number, sourceToken: string) => {
    if (sourceToken !== currentPlaybackSourceToken.current) return;
    const prev = lastTimeRef.current;
    setPlaybackClock({ current, duration });
    const video = videoRef.current;
    if (video && !video.paused && current > prev + 0.05 && current > 0) {
      setPlaybackVerified(true);
      setPlaybackMessage((message) => (
        !message
        || message === 'Video playback not verified'
        || message.includes('Recovering')
        || message.includes('Refreshing')
        || message.includes('Checking')
          ? ''
          : message
      ));
    }
    lastTimeRef.current = Math.max(lastTimeRef.current, current);
  };

  const visibleInputs = portsForKind(data.kind).inputs
    .filter((port) => port.connectable !== false)
    // UX rule: Prompt is always the lowest input port when a node has multiple inputs.
    .sort((a, b) => Number(a.id === 'prompt') - Number(b.id === 'prompt'));
  const visibleOutputs = portsForKind(data.kind).outputs.filter((port) => port.connectable !== false);
  const showNodeTools = spec.isMediaHolder || spec.controls.length > 0 || isGemini;
  const configuredPreviewAspect = (shortAspect(data.config.aspectRatio) || '16:9').replace(':', ' / ');
  // The media surface must represent the configured output ratio. React Flow geometry
  // is refreshed by the ResizeObserver above, so changing 16:9 -> 9:16/1:1/etc.
  // resizes the node and keeps ports/edges attached to the new bounds.
  const previewAspect = configuredPreviewAspect;
  const emptyMediaCopy = data.kind === 'preview'
    ? 'Connect a branch to run'
    : data.kind === 'videoInput'
    ? 'Choose existing Flow video'
    : ['download', 'mediaInput'].includes(data.kind)
    ? 'No media available'
    : isVideoNode
      ? 'No video available'
      : 'No photo available';
  const portTop = (index: number, count: number, side: 'in' | 'out') => {
    if (count <= 1) return spec.isMediaHolder && side === 'out' ? '27%' : '50%';
    // Keep connector spacing invariant when the media surface changes aspect ratio.
    // The old percentage-based distribution stretched 3 ports from ~53px apart at
    // 16:9 to ~166px apart at 9:16. Centre the group, but keep a fixed 53px pitch.
    const PORT_PITCH_PX = 53;
    const offsetPx = (index - (count - 1) / 2) * PORT_PITCH_PX;
    if (Math.abs(offsetPx) < 0.001) return '50%';
    return `calc(50% ${offsetPx > 0 ? '+' : '-'} ${Math.abs(offsetPx)}px)`;
  };

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (video && (recoveredVideoUrl || result?.previewUrl)) {
      if (isPlaying) {
        playAttemptGeneration.current += 1;
        video.pause();
        setIsPlaying(false);
      } else {
        const identity = playbackIdentity;
        const sourceToken = playbackSourceToken;
        const attempt = ++playAttemptGeneration.current;
        setPlaybackMessage('Checking playback…');
        void playVerified(video).then((playing) => {
          if (
            currentPlaybackIdentity.current !== identity
            || currentPlaybackSourceToken.current !== sourceToken
            || playAttemptGeneration.current !== attempt
          ) return;
          setIsPlaying(playing);
          if (playing) {
            setPlaybackVerified(true);
            setPlaybackMessage('');
          } else {
            setPlaybackVerified(false);
            setPlaybackMessage('Playback did not advance. Retry to refresh this exact clip from Flow.');
          }
        });
      }
    } else {
      playAttemptGeneration.current += 1;
      setIsPlaying(false);
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
      ref={nodeRootRef}
      className={`flow-card-stitch media-first-node archetype-${archetype} ${spec.isMediaHolder ? 'has-media-surface' : 'has-text-surface'} ${data.kind} ${data.tone} ${selected ? 'selected' : ''} ${data.status === 'running' && !result?.mediaId ? 'running' : ''} ${data.status === 'failed' ? 'error' : ''} ${isCollapsed ? 'collapsed-node' : ''}`}
    >
      {/* Dedicated drag contact: large hit target, tiny visual point at the top-right corner. */}
      <div className="node-drag-point" title="Drag node" aria-label="Drag node" />

      {/* 1. Header Siêu Tối Giản */}
      <div className="flow-card-header">
        <div className="card-header-left">
          <span className={`card-icon-wrap ${data.tone}`}>
            <NodeIcon kind={data.kind} size={13} />
          </span>
          <strong className="card-title">
            {data.kind === 'download' ? (result?.type === 'image' ? 'Output' : 'Output Video') : data.kind === 'preview' ? 'Output Preview' : (data.title || data.kind)}
          </strong>
        </div>

        <div className="card-header-right">
          {shouldShowProviderSuccessBadge({ status: data.status, mediaId: result?.mediaId }) ? (
            <span className="badge-stitch completed" title="Đã hoàn thành">
              <CheckCircle2 size={10} />
            </span>
          ) : data.status === 'running' && !result?.mediaId ? (
            <span className="badge-stitch running" title="Đang xử lý">
              <Clock3 size={10} />
            </span>
          ) : data.status === 'failed' ? (
            <span className="badge-stitch failed" title="Lỗi">
              <X size={10} />
            </span>
          ) : null}

          {/* Nút Thu gọn / Mở rộng Node */}
          <button
            className="node-collapse-btn nodrag nopan"
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed((prev) => !prev);
            }}
            title={isCollapsed ? 'Mở rộng cấu hình' : 'Thu gọn node'}
          >
            <ChevronDown size={11} className={`collapse-arrow ${isCollapsed ? 'is-collapsed' : ''}`} />
          </button>
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
              const parsed = parseConfigFromPrompt(newPrompt);
              if (parsed.aspectRatio) dispatchUpdate('aspectRatio', parsed.aspectRatio);
              if (parsed.duration) dispatchUpdate('duration', parsed.duration);
              if (parsed.resolution) dispatchUpdate('resolution', parsed.resolution);
              if (parsed.batchCount) dispatchUpdate('batchCount', parsed.batchCount);
              if (parsed.modelKeyword) dispatchUpdate('model', parsed.modelKeyword);
              window.dispatchEvent(new CustomEvent('flowgraph:prompt-parsed-config', {
                detail: { sourceNodeId: id, parsed }
              }));
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Nhập prompt sáng tạo"
          />
        ) : isGemini ? (
          /* Specialized UI cho Gemini Enhance: Text Box hiển thị prompt điện ảnh đã mở rộng */
          <div className="gemini-enhance-body nodrag nopan">
            <div className="gemini-text-header">
              <span className="gemini-badge">Prompt Điện Ảnh (8K)</span>
              {(data.result as any)?.text && (
                <button
                  className="gemini-copy-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText((data.result as any).text || '');
                  }}
                  title="Sao chép prompt đã mở rộng"
                >
                  <Copy size={11} /> Copy
                </button>
              )}
            </div>
            <textarea
              className="gemini-output-textarea nodrag nopan"
              readOnly
              value={(data.result as any)?.text || data.config.prompt || 'Đang đợi input prompt từ node trước để viết lại...'}
              placeholder="Prompt sau khi enhance qua model AI Gateway sẽ hiển thị tại đây..."
            />
          </div>
        ) : isCharacter ? (
          /* Specialized UI cho Character: Hiển thị thuần túy hình ảnh Character DNA (ảnh chân dung đầu ra) */
          <div className="character-dna-visual-body nodrag nopan">
            <div className="character-dna-image-card">
              {result?.previewUrl || result?.mediaId ? (
                <SafeImage
                  src={result.previewUrl || ''}
                  mediaId={result.mediaId}
                  alt={data.config.displayName || data.title || 'Character DNA'}
                />
              ) : (
                <div className="placeholder-art empty-media-well" aria-hidden="true">
                  <span className="empty-media-copy">No photo available</span>
                </div>
              )}
              {data.config.characterId ? (
              <div className="character-dna-overlay-info">
                <span className="character-dna-id-chip">{data.config.characterId}</span>
                {data.config.displayName ? <span className="character-dna-name-label">{data.config.displayName}</span> : null}
              </div>
              ) : null}
            </div>
          </div>
        ) : isLogicOrUtility ? (
          /* Specialized UI cho Logic & Utility: Hoàn toàn không dùng Media Preview khung đen */
          <div className="logic-utility-node-body nodrag nopan">
            {data.kind === 'delay' ? (
              <div className="compact-delay-body">
                <span className="delay-timer-icon">⏱</span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className="delay-input-box nodrag nopan"
                  value={data.config.delaySeconds ?? 2.0}
                  onChange={(e) => dispatchUpdate('delaySeconds', e.target.value)}
                  title="Thời gian chờ (giây)"
                />
                <span className="delay-unit">s</span>
              </div>
            ) : data.kind === 'note' ? (
              <div className="compact-note-body">
                <textarea
                  className="note-text-area nodrag nopan"
                  placeholder="Ghi chú công việc..."
                  value={data.config.note || ''}
                  onChange={(e) => dispatchUpdate('note', e.target.value)}
                />
              </div>
            ) : data.kind === 'condition' ? (
              <div className="compact-condition-body">
                <span className="condition-expr-label">{data.config.conditionExpression || 'inputs.value === true'}</span>
                <div className="condition-status-chips">
                  <span className="chip-true">TRUE</span>
                  <span className="chip-false">FALSE</span>
                </div>
              </div>
            ) : data.kind === 'cancelGeneration' ? (
              <div className="compact-cancel-body">
                <button
                  className="cancel-action-btn"
                  title="Hủy bỏ tác vụ sinh đang chạy"
                  onClick={() => {
                    try {
                      if (typeof (window as any).studioRuntime?.cancel === 'function') {
                        void (window as any).studioRuntime.cancel();
                      }
                      window.dispatchEvent(new CustomEvent('flowgraph:cancel-run'));
                    } catch {}
                  }}
                >
                  <span>Cancel Active Task</span>
                </button>
              </div>
            ) : (
              <div className="compact-utility-body">
                <span className="utility-label">{data.title || data.kind}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="media-preview-container" style={{ aspectRatio: previewAspect }}>
            {result?.type === 'video' || (isVideoNode && result?.type !== 'image') ? (
              <div className="video-player-preview">
                {recoveredVideoUrl || result?.previewUrl ? (
                  <SafeVideoPlayer
                    key={playbackSourceToken}
                    src={recoveredVideoUrl || result.previewUrl}
                    sourceToken={playbackSourceToken}
                    posterUrl={data.config?.thumbnailUrl || data.config?.posterUrl}
                    mediaId={result.mediaId}
                    isPlaying={isPlaying}
                    onEnded={() => {
                      playAttemptGeneration.current += 1;
                      setIsPlaying(false);
                    }}
                    onClock={handleClock}
                    videoRef={videoRef}
                    onError={(eventSourceToken) => {
                      if (eventSourceToken !== currentPlaybackSourceToken.current) return;
                      const status = recoveryStatusRef.current;
                      if (status === 'idle') {
                        void recoverPlayback(false);
                      } else if (status === 'recovered') {
                        playAttemptGeneration.current += 1;
                        setIsPlaying(false);
                        setPlaybackVerified(false);
                        recoveryStatusRef.current = 'failed';
                        setRecoveryStatus('failed');
                        setPlaybackMessage('Recovered source failed to play. Retry to refresh this exact clip from Flow.');
                      }
                    }}
                    onCanPlay={(eventSourceToken) => {
                      if (eventSourceToken !== currentPlaybackSourceToken.current) return;
                      // canplay is readiness only. Positive verification requires timeline progress.
                    }}
                  />
                ) : (
                  <div className="placeholder-art empty-media-well" aria-hidden="true">
                    <span className="empty-media-copy">{emptyMediaCopy}</span>
                  </div>
                )}
                {recoveredVideoUrl || result?.previewUrl ? (
                <div className={`player-overlay ${isPlaying ? 'is-playing' : ''}`} onClick={togglePlay}>
                  {!isPlaying && (
                    <button className="play-button-glass" onClick={togglePlay} title="Phát video">
                      <Play size={18} fill="white" />
                    </button>
                  )}
                  <div className="player-meta-bottom">
                    <span className="timestamp" role="status">{playbackMessage || formatPlayerTimestamp(playbackClock.current, playbackClock.duration)}</span>
                    {(recoveryStatus === "failed" || (playbackMessage || "").includes("retry")) && (
                      <button className="retry-recovery-btn nodrag nopan" onClick={handleRetryRecovery} title="Retry exact video recovery" style={{marginLeft:"4px", fontSize:"9px", padding:"1px 3px", background:"transparent", border:"1px solid currentColor", color:"inherit", cursor:"pointer", verticalAlign:"middle"}}>Retry</button>
                    )}
                    <span className="expand-icon" onClick={handleOpenClick} title="Toàn màn hình">
                      <Maximize2 size={11} />
                    </span>
                  </div>
                </div>
                ) : null}
                {isProviderInput ? (
                  <div className="provider-media-hud nodrag nopan">
                    {data.config.mediaId && !isLocalMediaKey(data.config.mediaId) ? (
                      <div className="provider-media-meta">
                        <span>{String(data.config.mediaType || result?.type || '').toUpperCase() || 'MEDIA'}</span>
                        <span title={data.config.mediaId}>{shortMediaId(data.config.mediaId)}</span>
                        <span title={data.config.projectId}>{shortMediaId(data.config.projectId || '')}</span>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="provider-media-cta"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMediaPickerOpen((open) => !open);
                        window.dispatchEvent(new CustomEvent('flowgraph:request-verified-media', {
                          detail: { nodeId: id, kind: data.kind },
                        }));
                      }}
                    >
                      {PROVIDER_MEDIA_CTA}
                    </button>
                    {mediaPickerOpen ? (
                      <div className="provider-media-picker" onMouseDown={(e) => e.stopPropagation()}>
                        {verifiedMedia.length === 0 ? (
                          <span className="provider-media-empty">No verified Flow media on this graph yet.</span>
                        ) : verifiedMedia.map((item) => (
                          <button
                            key={`${item.sourceNodeId}-${item.mediaId}`}
                            type="button"
                            className="provider-media-item"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.dispatchEvent(new CustomEvent('flowgraph:bind-provider-media', {
                                detail: {
                                  nodeId: id,
                                  kind: data.kind,
                                  mediaId: item.mediaId,
                                  mediaType: item.mediaType,
                                  projectId: item.projectId,
                                  previewUrl: item.previewUrl,
                                },
                              }));
                              setMediaPickerOpen(false);
                            }}
                          >
                            {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span className="provider-media-thumb" />}
                            <span>{item.mediaType}</span>
                            <span>{shortMediaId(item.mediaId)}</span>
                            <span>{shortMediaId(item.projectId)}</span>
                          </button>
                        ))}
                        <input
                          className="provider-media-field"
                          placeholder="mediaId"
                          value={manualMediaId}
                          onChange={(e) => setManualMediaId(e.target.value)}
                        />
                        <input
                          className="provider-media-field"
                          placeholder="projectId"
                          value={manualProjectId}
                          onChange={(e) => setManualProjectId(e.target.value)}
                        />
                        <button
                          type="button"
                          className="provider-media-cta"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.dispatchEvent(new CustomEvent('flowgraph:bind-provider-media', {
                              detail: {
                                nodeId: id,
                                kind: data.kind,
                                mediaId: manualMediaId,
                                mediaType: data.kind === 'videoInput' ? 'VIDEO' : 'IMAGE',
                                projectId: manualProjectId,
                              },
                            }));
                          }}
                        >
                          Bind
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                className="image-preview-wrap"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e) => {
                  const files = Array.from(e.dataTransfer.files);
                  const video = files.find((f) => classifyLocalFile(f) === 'video');
                  const img = files.find((f) => classifyLocalFile(f) === 'image');
                  if (video && !img) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.dispatchEvent(new CustomEvent('flowgraph:local-video-rejected', {
                      detail: { nodeId: id, fileName: video.name },
                    }));
                    return;
                  }
                  if (img) {
                    e.preventDefault();
                    e.stopPropagation();
                    const blobUrl = URL.createObjectURL(img);
                    window.dispatchEvent(new CustomEvent('flowgraph:node-drop-media', {
                      detail: { nodeId: id, kind: data.kind, type: 'image', file: img, blobUrl },
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
                  <div className="placeholder-art empty-media-well">
                    {isUploadImage ? (
                      <div className="upload-drop-cta nodrag nopan">
                        <span className="empty-media-copy">{UPLOAD_DROP_COPY}</span>
                        <button
                          type="button"
                          className="upload-browse-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                        >
                          {UPLOAD_BROWSE_COPY}
                        </button>
                      </div>
                    ) : (
                      <span className="empty-media-copy">{emptyMediaCopy}</span>
                    )}
                  </div>
                )}
                {isUploadImage && stagedLocal ? (
                  <div className="upload-ready-bar nodrag nopan">
                    <span className="upload-ready-name">{data.config.fileName || result?.fileName || 'image'}</span>
                    <span className="upload-ready-status">{UPLOAD_READY_COPY}</span>
                  </div>
                ) : null}
                {data.kind === 'preview' && result?.mediaId && !isLocalMediaKey(result.mediaId) ? (
                  <div className="upload-ready-bar nodrag nopan">
                    <span>{String(result.type || '').toUpperCase() || 'MEDIA'}</span>
                    <span title={result.mediaId}>{shortMediaId(result.mediaId)}</span>
                    {result.projectId ? <span title={result.projectId}>{shortMediaId(result.projectId)}</span> : null}
                  </div>
                ) : null}
                {isProviderInput ? (
                  <div className="provider-media-hud nodrag nopan">
                    {data.config.mediaId && !isLocalMediaKey(data.config.mediaId) ? (
                      <div className="provider-media-meta">
                        <span>{String(data.config.mediaType || result?.type || '').toUpperCase() || 'MEDIA'}</span>
                        <span title={data.config.mediaId}>{shortMediaId(data.config.mediaId)}</span>
                        <span title={data.config.projectId}>{shortMediaId(data.config.projectId || '')}</span>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="provider-media-cta"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMediaPickerOpen((open) => !open);
                        window.dispatchEvent(new CustomEvent('flowgraph:request-verified-media', {
                          detail: { nodeId: id, kind: data.kind },
                        }));
                      }}
                    >
                      {PROVIDER_MEDIA_CTA}
                    </button>
                    {mediaPickerOpen ? (
                      <div className="provider-media-picker" onMouseDown={(e) => e.stopPropagation()}>
                        {verifiedMedia.length === 0 ? (
                          <span className="provider-media-empty">No verified Flow media on this graph yet.</span>
                        ) : verifiedMedia.map((item) => (
                          <button
                            key={`${item.sourceNodeId}-${item.mediaId}`}
                            type="button"
                            className="provider-media-item"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.dispatchEvent(new CustomEvent('flowgraph:bind-provider-media', {
                                detail: {
                                  nodeId: id,
                                  kind: data.kind,
                                  mediaId: item.mediaId,
                                  mediaType: item.mediaType,
                                  projectId: item.projectId,
                                  previewUrl: item.previewUrl,
                                },
                              }));
                              setMediaPickerOpen(false);
                            }}
                          >
                            {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span className="provider-media-thumb" />}
                            <span>{item.mediaType}</span>
                            <span>{shortMediaId(item.mediaId)}</span>
                            <span>{shortMediaId(item.projectId)}</span>
                          </button>
                        ))}
                        <input
                          className="provider-media-field"
                          placeholder="mediaId"
                          value={manualMediaId}
                          onChange={(e) => setManualMediaId(e.target.value)}
                        />
                        <input
                          className="provider-media-field"
                          placeholder="projectId"
                          value={manualProjectId}
                          onChange={(e) => setManualProjectId(e.target.value)}
                        />
                        {data.kind === 'mediaInput' ? (
                          <div className="provider-media-meta">
                            <button type="button" className="provider-media-cta" onClick={(e) => { e.stopPropagation(); setManualMediaType('IMAGE'); }}>IMAGE</button>
                            <button type="button" className="provider-media-cta" onClick={(e) => { e.stopPropagation(); setManualMediaType('VIDEO'); }}>VIDEO</button>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="provider-media-cta"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.dispatchEvent(new CustomEvent('flowgraph:bind-provider-media', {
                              detail: {
                                nodeId: id,
                                kind: data.kind,
                                mediaId: manualMediaId,
                                mediaType: data.kind === 'videoInput' ? 'VIDEO' : data.kind === 'mediaInput' ? manualMediaType : 'IMAGE',
                                projectId: manualProjectId,
                              },
                            }));
                          }}
                        >
                          Bind
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {isUploadImage ? (
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="upload-file-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      if (classifyLocalFile(file) !== 'image') {
                        window.dispatchEvent(new CustomEvent('flowgraph:local-file-rejected', {
                          detail: { nodeId: id, fileName: file.name, reason: 'not-image' },
                        }));
                        return;
                      }
                      const blobUrl = URL.createObjectURL(file);
                      window.dispatchEvent(new CustomEvent('flowgraph:node-drop-media', {
                        detail: { nodeId: id, kind: data.kind, type: 'image', file, blobUrl },
                      }));
                    }}
                  />
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Footer: Tuyệt đối chỉ hiển thị controls phù hợp theo spec của archetype hoặc node Download */}
      {(isDownload || spec.controls.length > 0) && !isPrompt && !isCharacter && (
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
          ) : isGemini ? (
            /* Footer chuyên biệt cho Gemini */
            <div className="inline-combobox-toolbar nodrag nopan">
              <CustomCombobox
                id={`${id}-model`}
                activeId={activeComboboxId}
                onToggle={setGlobalComboboxId}
                wrapClass="model-wrap"
                title="Chọn Model AI Gateway"
                label="Model"
                icon={<Box size={11} className="model-icon" />}
                value={data.config.model || 'cx/gpt-5.6-luna'}
                options={gatewayModelOptions(
                  typeof localStorage === 'undefined' ? null : localStorage.getItem('flowgraph.aiModels.v1'),
                )}
                onChange={(val) => dispatchUpdate('model', val)}
              />
              <CustomCombobox
                id={`${id}-style`}
                activeId={activeComboboxId}
                onToggle={setGlobalComboboxId}
                wrapClass="aspect-wrap"
                title="Phong cách AI"
                label="Style"
                icon={<Sparkles size={10} />}
                value={data.config.style || 'AUTO'}
                options={[
                  { value: 'AUTO', label: 'Tự động (Auto)' },
                  { value: 'CINEMATIC', label: 'Điện ảnh' },
                  { value: 'ANIME', label: 'Anime / Manga' },
                  { value: 'PHOTOREALISTIC', label: 'Ảnh chụp thật' },
                ]}
                onChange={(val) => dispatchUpdate('style', val)}
              />
            </div>
          ) : data.kind === 'videoConcat' ? (
            /* Footer chuyên biệt cho Stitch / Timeline */
            <div className="inline-combobox-toolbar nodrag nopan">
              <CustomCombobox
                id={`${id}-transition`}
                activeId={activeComboboxId}
                onToggle={setGlobalComboboxId}
                wrapClass="res-wrap"
                title="Kiểu chuyển cảnh giữa các clip"
                label="Transition"
                icon={<Maximize2 size={10} />}
                value={data.config.transition || 'crossfade'}
                options={[
                  { value: 'crossfade', label: 'Cross-fade (0.5s)' },
                  { value: 'crossfade_1s', label: 'Cross-fade (1.0s)' },
                  { value: 'cut', label: 'Hard Cut' },
                ]}
                onChange={(val) => dispatchUpdate('transition', val)}
              />
            </div>
          ) : isImageUpscale || data.kind === 'videoUpscale' ? (
            /* Footer chuyên biệt cho Upscale */
            <div className="inline-combobox-toolbar nodrag nopan">
              <CustomCombobox
                id={`${id}-res`}
                activeId={activeComboboxId}
                onToggle={setGlobalComboboxId}
                wrapClass="res-wrap"
                title="Độ phân giải mục tiêu"
                label="Resolution"
                icon={<Maximize2 size={10} />}
                value={data.config.targetResolution || (data.kind === 'videoUpscale' ? '1080p' : '4K')}
                options={
                  data.kind === 'videoUpscale'
                    ? VIDEO_UPSCALE_RESOLUTIONS.map((value) => ({ value, label: value === '4K' ? '4K UHD' : '1080p FHD' }))
                    : [{ value: '2K', label: 'Nâng cấp 2K' }, { value: '4K', label: 'Nâng cấp 4K' }]
                }
                onChange={(val) => dispatchUpdate('targetResolution', val)}
              />
            </div>
          ) : (
            <div className="inline-combobox-toolbar nodrag nopan">
              {/* Chỉ render các combobox được khai báo rõ trong spec.controls */}
              {spec.controls.includes('model') && (
                <CustomCombobox
                  id={`${id}-model`}
                  activeId={activeComboboxId}
                  onToggle={setGlobalComboboxId}
                  wrapClass="model-wrap"
                  title="Chọn Mô hình AI"
                  label="Model"
                  icon={<Box size={11} className="model-icon" />}
                  value={data.config.model || (data.kind === 't2i' ? '🍌 Nano Banana 2' : 'Omni 1.1 Flash')}
                  options={availableModels.map((m) => ({ value: m, label: compactModel(m) ?? m }))}
                  onChange={(val) => dispatchUpdate('model', val)}
                />
              )}

              {spec.controls.includes('duration') && (
                <CustomCombobox
                  id={`${id}-duration`}
                  activeId={activeComboboxId}
                  onToggle={setGlobalComboboxId}
                  wrapClass="duration-wrap"
                  title="Thời lượng video"
                  label="Duration"
                  icon={<Clock3 size={10} />}
                  value={data.config.duration || '8 seconds'}
                  options={availableDurations.map((d) => ({ value: d, label: d.replace(' seconds', 's') }))}
                  onChange={(val) => dispatchUpdate('duration', val)}
                />
              )}

              {spec.controls.includes('resolution') && (
                <CustomCombobox
                  id={`${id}-resolution`}
                  activeId={activeComboboxId}
                  onToggle={setGlobalComboboxId}
                  wrapClass="res-wrap"
                  title="Độ phân giải"
                  label="Resolution"
                  value={data.config.resolution || '720p'}
                  options={availableResolutions.map((res) => ({ value: res, label: res }))}
                  onChange={(val) => dispatchUpdate('resolution', val)}
                />
              )}

              {spec.controls.includes('aspectRatio') && (
                <CustomCombobox
                  id={`${id}-aspectRatio`}
                  activeId={activeComboboxId}
                  onToggle={setGlobalComboboxId}
                  wrapClass="aspect-wrap"
                  title="Tỷ lệ khung hình"
                  label="Ratio"
                  icon={<Square size={10} />}
                  value={shortAspect(data.config.aspectRatio) || '16:9'}
                  options={availableRatios.map((r) => ({ value: r, label: r }))}
                  onChange={(val) => dispatchUpdate('aspectRatio', val)}
                />
              )}

              {spec.controls.includes('batch') && (
                <CustomCombobox
                  id={`${id}-batchCount`}
                  activeId={activeComboboxId}
                  onToggle={setGlobalComboboxId}
                  wrapClass="batch-wrap"
                  title="Số lượng tạo"
                  label="Batch"
                  value={data.config.batchCount || '1'}
                  options={availableBatches.map((b) => ({ value: b, label: `x${b}` }))}
                  onChange={(val) => dispatchUpdate('batchCount', val)}
                />
              )}
            </div>
          )}
        </div>
      )}

      {showNodeTools && (
        <div className="node-side-tools nodrag nopan" aria-label="Node tools">
          {spec.isMediaHolder && (
            <button
              className="node-side-tool zoom-tool"
              onClick={handleOpenClick}
              disabled={!result?.previewUrl}
              title={result?.previewUrl ? 'Zoom media' : 'Media chưa sẵn sàng'}
              aria-label="Zoom media"
            >
              <Maximize2 size={15} />
            </button>
          )}
          <button
            className={`node-side-tool settings-tool ${showAdvancedSettings ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowAdvancedSettings((value) => !value);
            }}
            title="Node settings"
            aria-label="Node settings"
          >
            <Settings2 size={15} />
            <span>Settings</span>
          </button>
        </div>
      )}

      {showAdvancedSettings && (
        <div
          className="node-advanced-popover nodrag nopan"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="node-advanced-popover-head">
            <strong>Node settings</strong>
            <button
              className="node-advanced-close"
              onClick={() => setShowAdvancedSettings(false)}
              aria-label="Close settings"
            >
              <X size={13} />
            </button>
          </div>
          <div className="node-advanced-row">
            <span>Type</span>
            <strong>{shortTitle(data.title || data.kind)}</strong>
          </div>
          {data.config.serviceTier ? (
            <div className="node-advanced-row">
              <span>Tier</span>
              <strong>{data.config.serviceTier.replace('SERVICE_TIER_', '')}</strong>
            </div>
          ) : null}
          {estimatedCost !== 'Unavailable' ? (
            <div className="node-advanced-row">
              <span>Credits</span>
              <strong>{estimatedCost}</strong>
            </div>
          ) : null}
          <div className="node-advanced-row">
            <span>Status</span>
            <strong>{data.status}</strong>
          </div>
          {mediaNodeSettingsRows({ kind: data.kind, status: data.status, config: data.config, result }).map((row) => (
            <div key={`${row.label}-${row.value}`} className="node-advanced-row">
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Dynamic typed ports live outside the visual surface. */}
      <div className="dynamic-port-strip">
        {/* Left Inputs */}
        {visibleInputs.map((port, idx) => (
          <div key={port.id} className="port-anchor-wrap in" style={{ top: portTop(idx, visibleInputs.length, 'in') }}>
            <Handle
              type="target"
              position={Position.Left}
              id={port.id}
              className={`stitch-port-handle in ${portTypeClass(port.type)}`}
              title={port.note}
            />
            <span className="port-badge-tag in" title={port.note}>
              {port.label}
            </span>
          </div>
        ))}

        {/* Right Outputs */}
        {visibleOutputs.map((port, idx) => (
          <div key={port.id} className="port-anchor-wrap out" style={{ top: portTop(idx, visibleOutputs.length, 'out') }}>
            <span className="port-badge-tag out" title={port.note}>
              {port.label}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              className={`stitch-port-handle out ${portTypeClass(port.type)}`}
              title={port.note}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export { NodeIcon };
