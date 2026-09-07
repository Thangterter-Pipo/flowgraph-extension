import React, { useState } from 'react';
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
    <div className="modal-backdrop templates-modal-backdrop" role="dialog" aria-modal="true" aria-label="Templates Library">
      <div className="templates-modal-window">
        {/* Modal Header */}
        <div className="tpl-modal-header">
          <div className="tpl-modal-title">
            <div className="tpl-modal-icon">
              <LayoutTemplate size={20} />
            </div>
            <div>
              <h2>FLOWGRAPH TEMPLATES LIBRARY</h2>
              <p>Khám phá và khởi chạy nhanh các đường ống sản xuất AI điện ảnh chuẩn mực</p>
            </div>
          </div>
          <div className="tpl-header-actions">
            <button
              className="fg-btn fg-btn-primary"
              onClick={onSaveAsTemplate}
              disabled={locked}
            >
              <BookmarkCheck size={14} /> Save Current Graph
            </button>
            <button className="fg-icon-btn close-modal-btn" onClick={onClose} title="Đóng">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Modal Sub-bar: Search & Categories */}
        <div className="tpl-modal-subbar">
          <div className="tpl-search-input-wrap">
            <Search size={15} />
            <input
              placeholder="Tìm kiếm mẫu workflow, hashtags, mô hình (Veo, Omni, Banana)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
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
                    onClick={() => setSelectedTpl(tpl)}
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
                        <Sparkles size={13} /> Khởi Chạy Ngay
                      </button>
                      {tpl.category === 'custom' && (
                        <button
                          className="fg-btn fg-icon-btn tpl-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Xác nhận xóa template '${tpl.title}'?`)) {
                              deleteCustomTemplate(tpl.id);
                              reload();
                            }
                          }}
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
                    <Sparkles size={15} /> Nạp Template Vào Canvas Ngay
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
      </div>
    </div>
  );
}
