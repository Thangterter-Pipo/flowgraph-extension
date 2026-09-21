import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { CheckCircle2, Clock3, X } from 'lucide-react';
import { getPresentationSpec } from '../../nodePresentationSpec';
import { portsForKind, portTypeClass } from '../../ports';
import { shouldShowProviderSuccessBadge } from '../../mediaInputUi';

/**
 * Thuộc tính của khung chứa Node cơ bản (BaseNodeContainerProps)
 */
export interface BaseNodeContainerProps {
  id: string; // Mã định danh duy nhất của Node
  kind: string; // Loại Node (vd: t2v, i2v, prompt, download...)
  title: string; // Tiêu đề hiển thị trên Header
  tone: string; // Tông màu giao diện
  status: string; // Trạng thái chạy (idle, running, success, failed)
  mediaId?: string; // ID media kết quả nếu có
  selected?: boolean; // Node có đang được chọn trên Canvas hay không
  isCollapsed?: boolean; // Node có đang ở trạng thái thu gọn hay không
  onToggleCollapse?: () => void; // Hàm chuyển đổi trạng thái thu gọn
  nodeRootRef?: React.Ref<HTMLDivElement>; // Ref trỏ tới phần tử DOM gốc của Node
  children: React.ReactNode; // Nội dung thân Node (Prompt, Preview, Controls...)
  footer?: React.ReactNode; // Khung công cụ chân Node (Combobox, buttons...)
  tools?: React.ReactNode; // Công cụ phụ bên hông Node (Settings, Zoom...)
  popover?: React.ReactNode; // Khung cài đặt nâng cao popover
}

/**
 * Component hiển thị Icon đại diện cho từng loại Node
 */
export function NodeIcon({ kind, size = 13 }: { kind: string; size?: number }) {
  const spec = getPresentationSpec(kind);
  const IconComp = spec.icon;
  return <IconComp size={size} />;
}

/**
 * Khung chứa chuẩn (Base Canvas Node Container)
 * Đảm nhiệm render Header, Status Badges, Handles nối dây và hiệu ứng bo viền sáng.
 */
export function BaseNodeContainer({
  id,
  kind,
  title,
  tone,
  status,
  mediaId,
  selected = false,
  isCollapsed = false,
  onToggleCollapse,
  nodeRootRef,
  children,
  footer,
  tools,
  popover,
}: BaseNodeContainerProps) {
  const spec = getPresentationSpec(kind);
  const archetype = spec.archetype;
  
  // Lọc và sắp xếp danh sách các cổng kết nối (Ports) đầu vào và đầu ra
  const visibleInputs = portsForKind(kind).inputs
    .filter((port: any) => port.connectable !== false)
    .sort((a: any, b: any) => Number(a.id === 'prompt') - Number(b.id === 'prompt'));
  const visibleOutputs = portsForKind(kind).outputs.filter((port: any) => port.connectable !== false);

  // Tính toán vị trí chiều cao (top %) cho từng chốt nối dây trên thân Node
  const portTop = (index: number, count: number, side: 'in' | 'out') => {
    if (count <= 1) return spec.isMediaHolder && side === 'out' ? '27%' : '50%';
    const PORT_PITCH_PX = 53;
    const offsetPx = (index - (count - 1) / 2) * PORT_PITCH_PX;
    if (Math.abs(offsetPx) < 0.001) return '50%';
    return `calc(50% ${offsetPx > 0 ? '+' : '-'} ${Math.abs(offsetPx)}px)`;
  };

  return (
    <div
      ref={nodeRootRef}
      className={`flow-card-stitch media-first-node archetype-${archetype} ${spec.isMediaHolder ? 'has-media-surface' : 'has-text-surface'} ${kind} ${tone} ${selected ? 'selected' : ''} ${status === 'running' && !mediaId ? 'running' : ''} ${status === 'failed' ? 'error' : ''} ${isCollapsed ? 'collapsed-node' : ''}`}
    >
      {/* Nút điểm chốt kéo thả Node */}
      <div className="node-drag-point" title="Kéo thả node" aria-label="Kéo thả node" />

      {/* 1. Thanh tiêu đề Header */}
      <div className="flow-card-header">
        <div className="card-header-left">
          <span className={`card-icon-wrap ${tone}`}>
            <NodeIcon kind={kind} size={13} />
          </span>
          <strong className="card-title">
            {kind === 'download' ? (title || 'Output Video') : kind === 'preview' ? 'Output Preview' : (title || kind)}
          </strong>
        </div>

        <div className="card-header-right">
          {/* Huy hiệu hiển thị trạng thái thực thi */}
          {shouldShowProviderSuccessBadge({ status: status as any, mediaId }) ? (
            <span className="badge-stitch completed" title="Đã hoàn thành">
              <CheckCircle2 size={10} />
            </span>
          ) : status === 'running' && !mediaId ? (
            <span className="badge-stitch running" title="Đang xử lý">
              <Clock3 size={10} />
            </span>
          ) : status === 'failed' ? (
            <span className="badge-stitch failed" title="Lỗi">
              <X size={10} />
            </span>
          ) : null}

          {/* Nút thu gọn hoặc mở rộng Node */}
          {onToggleCollapse && (
            <button
              className="node-collapse-btn nodrag nopan"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse();
              }}
              title={isCollapsed ? 'Mở rộng cấu hình' : 'Thu gọn node'}
            >
              <span className={`collapse-arrow ${isCollapsed ? 'is-collapsed' : ''}`}>▼</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Thân Node (Body) */}
      <div className="flow-card-body">
        {children}
      </div>

      {/* 3. Chân Node (Footer controls) */}
      {footer}

      {/* 4. Công cụ phụ bên hông (Side Tools) */}
      {tools}

      {/* 5. Cửa sổ cài đặt nâng cao Popover */}
      {popover}

      {/* 6. Dải chốt nối dây năng động (Dynamic Handles) */}
      <div className="dynamic-port-strip">
        {/* Cổng vào (Inputs bên trái) */}
        {visibleInputs.map((port: any, idx: number) => (
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

        {/* Cổng ra (Outputs bên phải) */}
        {visibleOutputs.map((port: any, idx: number) => (
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
