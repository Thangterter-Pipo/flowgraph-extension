import React from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FlowNode } from '../../../model';
import WorkflowNode from '../../../WorkflowNode';

export function TextToVideoNode(props: NodeProps<FlowNode>) {
  return <WorkflowNode {...props} />;
}

export function ImageToVideoNode(props: NodeProps<FlowNode>) {
  return <WorkflowNode {...props} />;
}

export function ExtendVideoNode(props: NodeProps<FlowNode>) {
  return <WorkflowNode {...props} />;
}

export function InterpolationNode(props: NodeProps<FlowNode>) {
  return <WorkflowNode {...props} />;
}

export function ReferenceVideoNode(props: NodeProps<FlowNode>) {
  return <WorkflowNode {...props} />;
}
