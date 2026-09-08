import React from 'react';
import { BaseEdge, type EdgeProps } from '@xyflow/react';

/**
 * Smart Orthogonal / Rounded Avoidance Edge
 * Tự động tính toán đường dây vòng ra ngoài né node trung gian:
 * - Nếu dây xuất phát từ một node ở tầng dưới (như Mô Tả Cảnh có sourceY > 600)
 *   và đích đến là tầng trên (targetY < 400) cách nhau qua node trung gian:
 *   Đường dây sẽ đi ngang ra -> vòng xuống phía dưới đáy của node trung gian -> uốn cong mượt mà đi lên đích!
 * - Nhờ vậy sợi dây hoàn toàn liền mạch, không bị đâm xuyên qua thân node hay bị cắt khúc!
 */
export function AvoidObstacleEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    style = {},
    markerEnd,
  } = props;

  const dx = targetX - sourceX;
  const dy = targetY - sourceY;

  // Trường hợp 1: Dây dốc lớn từ dưới lên trên (như từ Mô Tả Cảnh Y:800 lên Tạo Cảnh Y:260)
  // Đi vòng xuống dưới và bọc ra ngoài khoảng trống giữa 2 cột node
  if (dy < -200 && dx > 200) {
    // Đi ngang một đoạn từ source -> vòng xuống thấp hơn đáy node -> uốn lượn lên target
    const bottomDropY = Math.max(sourceY + 45, 820);
    const midX = sourceX + dx * 0.42;

    const path = `M ${sourceX} ${sourceY} 
                 C ${sourceX + 80} ${sourceY}, ${sourceX + 120} ${bottomDropY}, ${midX} ${bottomDropY}
                 C ${midX + 120} ${bottomDropY}, ${targetX - 100} ${targetY + 120}, ${targetX} ${targetY}`;

    return (
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerEnd={markerEnd}
      />
    );
  }

  // Trường hợp 2: Dây uốn mượt thông thường (Bézier tự nhiên với curvature chuẩn)
  const curvature = Math.abs(dy) > 100 ? 0.38 : 0.25;
  const hx1 = sourceX + dx * curvature;
  const hx2 = targetX - dx * curvature;

  const path = `M ${sourceX} ${sourceY} C ${hx1} ${sourceY}, ${hx2} ${targetY}, ${targetX} ${targetY}`;

  return (
    <BaseEdge
      id={id}
      path={path}
      style={style}
      markerEnd={markerEnd}
    />
  );
}
