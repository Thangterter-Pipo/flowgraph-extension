import React, { useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Play, Search, Upload, X } from 'lucide-react';
import {
  MEDIA_ADD_TITLE,
  MEDIA_AUDIO_COMING_SOON,
  MEDIA_DROP_COPY,
  MEDIA_EMPTY_HINT,
  MEDIA_EMPTY_TITLE,
  MEDIA_SESSION_LABEL,
  MEDIA_TAB_TITLE,
  PROJECT_UPLOAD_VIDEO_DISABLED,
  compactProjectLabel,
  filterSessionMedia,
  sessionMediaInspector,
  type ProjectUploadState,
  type RecentProjectUpload,
  type SessionMediaFilter,
} from './projectMediaUploadUi';
import { FLOWGRAPH_MEDIA_CLIP, FLOWGRAPH_MEDIA_DRAG } from './studioClipboard';

export function MediaLibrary({
  enabled,
  disabledReason,
  state,
  message,
  fileName,
  recent,
  selectedId,
  projectName,
  projectId,
  onSelect,
  onPickImageFile,
  onDropFiles,
  onAddToCanvas,
  onClose,
}: {
  enabled: boolean;
  disabledReason?: string;
  state: ProjectUploadState;
  message?: string;
  fileName?: string;
  recent: RecentProjectUpload[];
  selectedId?: string;
  projectName?: string;
  projectId?: string;
  onSelect: (id: string) => void;
  onPickImageFile: (file: File) => void;
  onDropFiles: (files: File[]) => void;
  onAddToCanvas?: (item: RecentProjectUpload) => void;
  onClose?: () => void;
}) {
  const imagePickerRef = useRef<HTMLInputElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SessionMediaFilter>('all');
  const projectLabel = compactProjectLabel(projectName, projectId);
  const visible = useMemo(() => filterSessionMedia(recent, { query, kind }), [recent, query, kind]);
  const selected = recent.find((item) => item.id === selectedId);
  const inspector = selected ? sessionMediaInspector(selected) : null;
  const uploading = state === 'uploading' || state === 'validating';

  const startDrag = (event: React.DragEvent, item: RecentProjectUpload) => {
    setDraggingId(item.id);
    (window as any).__draggedLibraryMedia = item;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(FLOWGRAPH_MEDIA_DRAG, JSON.stringify(item));
    event.dataTransfer.setData(FLOWGRAPH_MEDIA_CLIP, JSON.stringify({ type: FLOWGRAPH_MEDIA_CLIP, item }));
    event.dataTransfer.setData('text/plain', item.fileName || item.mediaId);
  };

  return (
    <aside className="node-library modern-sidebar media-library-sidebar">
      <div className="sidebar-modern-header">
        <div className="media-library-heading">
          <span className="sidebar-modern-title">{MEDIA_TAB_TITLE}</span>
          {projectLabel ? <em className="media-library-project">{projectLabel}</em> : null}
        </div>
        {onClose ? (
          <button className="sidebar-close-btn" onClick={onClose} title="Thu gọn" aria-label="Thu gọn Media Library">
            <X size={15} />
          </button>
        ) : null}
      </div>

      <div className="media-library-search">
        <Search size={13} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recent media"
        />
      </div>
      <div className="media-library-filters">
        {([
          ['all', 'All'],
          ['IMAGE', 'Images'],
          ['VIDEO', 'Videos'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`filter-pill-btn ${kind === id ? 'active' : ''}`}
            onClick={() => setKind(id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="filter-pill-btn is-disabled"
          disabled
          title={MEDIA_AUDIO_COMING_SOON}
        >
          Audio
        </button>
      </div>

      <div className="media-add-panel">
        <div className="media-add-title">{MEDIA_ADD_TITLE}</div>
        <div
          className={`media-add-drop ${enabled ? '' : 'is-disabled'} ${uploading ? 'is-uploading' : ''}`}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = enabled && !uploading ? 'copy' : 'none'; }}
          onDrop={(e) => {
            e.preventDefault();
            if (!enabled || uploading) return;
            onDropFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <Upload size={14} />
          <span>{uploading ? 'Uploading…' : MEDIA_DROP_COPY}</span>
          {uploading ? <span className="media-add-progress" aria-hidden="true" /> : null}
        </div>
        <div className="media-add-actions">
          <button
            type="button"
            className="project-upload-btn"
            disabled={!enabled || uploading}
            onClick={() => imagePickerRef.current?.click()}
          >
            Image
          </button>
          <button type="button" className="project-upload-btn is-disabled" disabled title={PROJECT_UPLOAD_VIDEO_DISABLED}>
            Video
          </button>
        </div>
        <div className="media-add-notes">
          <span>{PROJECT_UPLOAD_VIDEO_DISABLED}</span>
        </div>
        <input
          ref={imagePickerRef}
          type="file"
          accept="image/png,image/jpeg"
          className="upload-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onPickImageFile(file);
          }}
        />
        {!enabled ? <div className="project-upload-hint">{disabledReason}</div> : null}
        {state !== 'idle' && !uploading ? (
          <div className={`project-upload-status is-${state}`}>
            {fileName ? <span>{fileName}</span> : null}
            <span>{message}</span>
          </div>
        ) : null}
      </div>

      <div className="media-library-section-label">{MEDIA_SESSION_LABEL}</div>
      <div className="media-library-grid">
        {visible.length === 0 ? (
          <div className="media-library-empty">
            <strong>{MEDIA_EMPTY_TITLE}</strong>
            <span>{MEDIA_EMPTY_HINT}</span>
            <em>{PROJECT_UPLOAD_VIDEO_DISABLED}</em>
          </div>
        ) : visible.map((item) => {
          const label = item.fileName || sessionMediaInspector(item).fileName;
          return (
            <button
              key={item.id}
              type="button"
              className={`media-library-card ${selectedId === item.id ? 'is-selected' : ''} ${draggingId === item.id ? 'is-dragging' : ''}`}
              draggable
              onClick={() => onSelect(item.id)}
              onDoubleClick={() => onAddToCanvas?.(item)}
              onDragStart={(event) => startDrag(event, item)}
              onDragEnd={() => {
                setDraggingId(null);
                (window as any).__draggedLibraryMedia = null;
              }}
              title="Kéo ra canvas · Ctrl+C/X"
            >
              <span className="media-library-thumb">
                {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span className="project-upload-thumb" />}
                {item.mediaType === 'VIDEO' ? <Play size={12} className="media-library-play" /> : <ImageIcon size={11} className="media-library-type-icon" />}
              </span>
              <span className="media-library-card-meta">
                <strong>{item.mediaType === 'VIDEO' ? 'Video' : 'Image'}</strong>
                <em>{label}</em>
              </span>
            </button>
          );
        })}
      </div>

      {inspector && selected ? (
        <div className="media-library-inspector">
          <div><span>Name</span><strong>{inspector.fileName}</strong></div>
          <div><span>Type</span><strong>{inspector.type}</strong></div>
          <div><span>Media</span><strong title={selected.mediaId}>{inspector.mediaId}</strong></div>
          <div><span>Project</span><strong title={selected.projectId}>{inspector.projectId}</strong></div>
          {onAddToCanvas ? (
            <button type="button" className="project-upload-btn" onClick={() => onAddToCanvas(selected)}>
              Add to canvas
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
