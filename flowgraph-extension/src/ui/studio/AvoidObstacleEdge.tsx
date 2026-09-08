import React from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

/**
 * Clean Non-Intersecting Bézier Edge
 * Khi các Node được sắp xếp theo cấu trúc đối xứng Fork-Join (Diamond Layout):
 * - Dây Start Image đi từ trên uốn cong nhẹ nhàng xuống cổng Start
 * - Dây End Image đi từ dưới uốn cong nhẹ nhàng lên cổng End
 * - Dây Scene Prompt đi thẳng tắp qua hành lang trống ở giữa vào cổng Prompt
 * Tuyệt đối né 100% tất cả các Node trên Canvas!
 */
export function AvoidObstacleEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
  } = props;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.35,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={style}
      markerEnd={markerEnd}
    />
  );
}
