import React, { useEffect, useRef, useState } from 'react';
import {
  BookmarkCheck,
  BookmarkPlus,
  Compass,
  FileCode2,
  Film,
  Layers,
  LayoutTemplate,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import {
  deleteCustomTemplate,
  loadAllTemplates,
  type WorkflowTemplate,
} from './workflowTemplates';

interface TemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyTemplate: (template: WorkflowTemplate) => void;
  onSaveAsTemplate: () => void;
  locked?: boolean;
}

export function TemplatesModal({
  isOpen,
  onClose,
  onApplyTemplate,
  onSaveAsTemplate,
  locked,
}: TemplatesModalProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [templates, setTemplates] = useState<WorkflowTemplate[]>(() => loadAllTemplates());
  const [selectedTpl, setSelectedTpl] = useState<WorkflowTemplate | null>(() => templates[0] || null);
  const [deleteCandidate, setDeleteCandidate] = useState<WorkflowTemplate | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const deleteCandidateRef = useRef<WorkflowTemplate | null>(null);
  deleteCandidateRef.current = deleteCandidate;

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (deleteCandidateRef.current) setDeleteCandidate(null);
        else onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [role="button"][tabindex="0"]',
      )].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const reload = () => {
    const list = loadAllTemplates();
    setTemplates(list);
    if (selectedTpl && !list.some((t) => t.id === selectedTpl.id)) {
      setSelectedTpl(list[0] || null);
    }
  };

  const filtered = templates.filter((tpl) => {
    const matchesSearch = `${tpl.title} ${tpl.description} ${tpl.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase());
    const matchesCat = selectedCategory === 'all' || tpl.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="modal-backdrop templates-modal-backdrop" role="presentation">
      <div ref={dialogRef} className="templates-modal-window" role="dialog" aria-modal="true" aria-label="Templates Library">
        {/* Modal Header */}
        <div className="tpl-modal-header">
          <div className="tpl-modal-title">
            <div className="tpl-modal-icon">
              <LayoutTemplate size={20} />
            </div>
            <div>
              <h2>FLOWGRAPH TEMPLATES LIBRARY</h2>
              <p>Khám phá và nạp nhanh các workflow AI dựng sẵn vào Canvas</p>
            </div>
          </div>
          <div className="tpl-header-actions">
            <button
              className="fg-btn fg-btn-primary"
              onClick={onSaveAsTemplate}
              disabled={locked}
            >
              <BookmarkCheck size={14} /> Lưu Graph hiện tại
            </button>
            <button className="fg-icon-btn close-modal-btn" onClick={onClose} title="Đóng" aria-label="Đóng Templates Library">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Modal Sub-bar: Search & Categories */}
        <div className="tpl-modal-subbar">
          <div className="tpl-search-input-wrap">
            <Search size={15} />
            <input
              ref={searchRef}
              placeholder="Tìm kiếm mẫu workflow, hashtags, mô hình (Veo, Omni, Banana)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="tpl-category-filters">
            <button
              className={`tpl-cat-btn ${selectedCategory === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('all')}
            >
              <Compass size={13} /> Tất Cả ({templates.length})
            </button>
            <button
              className={`tpl-cat-btn ${selectedCategory === 'cinematic' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('cinematic')}
            >
              <Film size={13} /> Cinematic Master
            </button>
            <button
              className={`tpl-cat-btn ${selectedCategory === 'standard' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('standard')}
            >
              <Layers size={13} /> Standard Pipelines
            </button>
            <button
              className={`tpl-cat-btn ${selectedCategory === 'custom' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('custom')}
            >
              <Zap size={13} /> Mẫu Của Tôi
            </button>
          </div>
        </div>

        {/* Modal Body: Left Grid Cards & Right Live Inspector */}
        <div className="tpl-modal-body">
          {/* Left Grid: Cards Showcase */}
          <div className="tpl-cards-grid">
            {filtered.length === 0 ? (
              <div className="tpl-empty-showcase">
                <BookmarkPlus size={44} color="#65778e" />
                <strong>Không tìm thấy template phù hợp</strong>
                <span>Thử tìm kiếm với từ khóa khác hoặc lưu workflow hiện tại thành mẫu mới.</span>
              </div>
            ) : (
              filtered.map((tpl) => {
                const isSelected = selectedTpl?.id === tpl.id;
                return (
                  <div
                    key={tpl.id}
                    className={`tpl-card-showcase ${isSelected ? 'selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedTpl(tpl)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedTpl(tpl);
                      }
                    }}
                  >
                    <div className="tpl-card-showcase-top">
                      <span className={`tpl-badge ${tpl.category}`}>
                        {tpl.category === 'cinematic' ? 'CINEMATIC' : tpl.category === 'custom' ? 'CUSTOM' : 'STANDARD'}
                      </span>
                      <span className="tpl-node-count">{tpl.nodes.length} Nodes · {tpl.edges.length} Wires</span>
                    </div>

                    <h3 className="tpl-card-showcase-title">{tpl.title}</h3>
                    <p className="tpl-card-showcase-desc">{tpl.description}</p>

                    <div className="tpl-card-showcase-tags">
                      {tpl.tags.map((t) => (
                        <span key={t} className="tpl-tag-pill">#{t}</span>
                      ))}
                    </div>

                    <div className="tpl-card-showcase-foot">
                      <button
                        className="fg-btn fg-btn-primary tpl-launch-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onApplyTemplate(tpl);
                          onClose();
                        }}
                        disabled={locked}
                      >
                        <Sparkles size={13} /> Dùng Template
                      </button>
                      {tpl.category === 'custom' && (
                        <button
                          className="fg-btn fg-icon-btn tpl-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteCandidate(tpl);
                          }}
                          aria-label={`Xóa template ${tpl.title}`}
                          title="Xóa template này"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Panel: Selected Template Inspector & Architecture Details */}
          <div className="tpl-inspector-panel">
            {selectedTpl ? (
              <div className="tpl-inspector-content">
                <div className="tpl-preview-header">
                  <span className={`tpl-badge ${selectedTpl.category}`}>{selectedTpl.category.toUpperCase()}</span>
                  <h3>{selectedTpl.title}</h3>
                  <p>{selectedTpl.description}</p>
                </div>

                <div className="tpl-architecture-spec">
                  <h4>Cấu Trúc Node Pipeline ({selectedTpl.nodes.length} Nodes)</h4>
                  <div className="tpl-node-flow-list">
                    {selectedTpl.nodes.map((node, index) => (
                      <div className="tpl-flow-item" key={node.id}>
                        <div className="tpl-flow-index">{index + 1}</div>
                        <div className="tpl-flow-info">
                          <strong>{node.data.title}</strong>
                          <span>{node.data.subtitle || node.data.kind}</span>
                        </div>
                        <span className={`node-kind-tag ${node.data.tone || 'purple'}`}>
                          {node.data.kind.toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="tpl-inspector-actions">
                  <button
                    className="fg-btn fg-btn-primary tpl-primary-apply-btn"
                    onClick={() => {
                      onApplyTemplate(selectedTpl);
                      onClose();
                    }}
                    disabled={locked}
                  >
                    <Sparkles size={15} /> Nạp vào Canvas
                  </button>
                </div>
              </div>
            ) : (
              <div className="tpl-inspector-empty">
                <Workflow size={48} color="#65778e" />
                <span>Chọn một template bên trái để xem cấu trúc chi tiết</span>
              </div>
            )}
          </div>
        </div>

        {deleteCandidate && (
          <div className="tpl-inline-confirm" role="alertdialog" aria-modal="true" aria-label="Xác nhận xóa template">
            <div>
              <strong>Xóa template “{deleteCandidate.title}”?</strong>
              <span>Thao tác này chỉ xóa template tùy chỉnh đã lưu trên máy.</span>
            </div>
            <div className="tpl-inline-confirm-actions">
              <button type="button" className="fg-btn" onClick={() => setDeleteCandidate(null)}>Hủy</button>
              <button
                type="button"
                className="fg-btn fg-btn-danger"
                onClick={() => {
                  deleteCustomTemplate(deleteCandidate.id);
                  setDeleteCandidate(null);
                  reload();
                }}
              >
                <Trash2 size={13} /> Xóa
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
