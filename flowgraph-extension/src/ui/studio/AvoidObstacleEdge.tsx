import React from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

/**
 * Standard Smooth Bézier Edge (Trở về đường cong mượt mà tự nhiên tiêu chuẩn của React Flow)
 * Dây luôn nằm ở z-index thấp hơn thân Node (được bảo đảm bởi CSS .react-flow__edges { z-index: 0 }).
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
