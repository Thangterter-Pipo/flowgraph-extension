// NodeLibrary.tsx — Node palette sidebar component.
// Extracted from main.tsx to reduce file size (FG refactor).
// Shows categorized draggable node types, search, filter pills.
import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { NodeIcon } from './WorkflowNode';
import { palette, type PaletteSpec } from './model';

export interface NodeLibraryProps {
  search: string;
  setSearch: (value: string) => void;
  locked: boolean;
  onOpenTemplatesModal?: () => void;
  onAddNode?: (spec: PaletteSpec) => void;
  onClose?: () => void;
}

// 8 standard categories aligned with semantic UX architecture
const CATEGORIES = [
  { id: 'input',     name: 'INPUT',            kinds: ['prompt', 'imageInput', 'videoInput'] },
  { id: 'ai',        name: 'AI & ENHANCEMENT', kinds: ['gemini', 'creationAgent'] },
  { id: 'image',     name: 'IMAGE',            kinds: ['t2i', 'imageUpscale', 'imageTransform', 'storyboardSplit'] },
  { id: 'video',     name: 'VIDEO',            kinds: ['t2v', 'i2v', 'interpolation', 'extend', 'reference', 'videoUpscale', 'videoConcat'] },
  { id: 'character', name: 'CHARACTER',        kinds: ['characterCreate', 'characterAssign', 'likenessCheck', 'likenessList'] },
  { id: 'output',    name: 'OUTPUT',           kinds: ['preview', 'download'] },
  { id: 'logic',     name: 'LOGIC & CONTROL',  kinds: ['condition', 'delay', 'note', 'cancelGeneration', 'sceneGroup'] },
];

export function NodeLibrary({
  search,
  setSearch,
  locked,
  onAddNode,
  onClose,
}: NodeLibraryProps) {
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

  const filterMatches = (node: PaletteSpec): boolean => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || `${node.title} ${node.subtitle} ${node.kind}`.toLowerCase().includes(q);
    if (!matchesSearch) return false;

    if (activeFilter === 'All') return true;
    if (activeFilter === 'Image') return node.group === 'Image' || node.kind.toLowerCase().includes('image') || node.kind === 't2i';
    if (activeFilter === 'Video') return node.group === 'Video' || node.kind.toLowerCase().includes('video') || node.kind === 't2v' || node.kind === 'i2v';
    if (activeFilter === 'Utility') return (node.group as string) === 'Utility' || (node.group as string) === 'Logic' || node.kind === 'prompt';
    return true;
  };

  const dragStart = (event: React.DragEvent, spec: PaletteSpec): void => {
    event.dataTransfer.effectAllowed = 'all';
    (window as unknown as Record<string, unknown>).__draggedPaletteSpec = spec;
    try {
      event.dataTransfer.setData('application/flowgraph-node', JSON.stringify(spec));
      event.dataTransfer.setData('text/plain', JSON.stringify(spec));
    } catch { /* ignore */ }
  };

  return (
    <aside className={`node-library modern-sidebar ${locked ? 'node-library-locked' : ''}`}>
      {/* Header: title + close button */}
      <div className="sidebar-modern-header">
        <span className="sidebar-modern-title">Nodes</span>
        {onClose && (
          <button className="sidebar-close-btn" onClick={onClose} title="Thu gọn danh sách Nodes" aria-label="Thu gọn Node Library">
            <X size={15} />
          </button>
        )}
      </div>

      {/* Search box with ⌘K shortcut */}
      <div className="sidebar-modern-search">
        <Search size={14} className="search-icon-left" />
        <input
          ref={searchRef}
          type="text"
          placeholder="Tìm Node..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filter pills */}
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

      {/* Node list grouped by category */}
      <div className="sidebar-nodes-list">
        {CATEGORIES.map((cat) => {
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
                      title={
                        node.paletteDisabled
                          ? `${node.title} — ${node.subtitle}`
                          : `${node.title} — ${node.subtitle} (Kéo vào Canvas, Click đúp hoặc nhấn Enter để thêm)`
                      }
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
      </div>
    </aside>
  );
}
