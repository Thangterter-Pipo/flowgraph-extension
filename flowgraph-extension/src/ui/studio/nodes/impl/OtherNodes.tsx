import React from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FlowNode } from '../../model';
import WorkflowNode from '../../WorkflowNode';

export function PromptNode(props: NodeProps<FlowNode>) {
  return <WorkflowNode {...props} />;
}

export function GeminiNode(props: NodeProps<FlowNode>) {
  return <WorkflowNode {...props} />;
}

export function ImageGenNode(props: NodeProps<FlowNode>) {
  return <WorkflowNode {...props} />;
}

export function CharacterNode(props: NodeProps<FlowNode>) {
  return <WorkflowNode {...props} />;
}

export function StitchNode(props: NodeProps<FlowNode>) {
  return <WorkflowNode {...props} />;
}

export function OutputNode(props: NodeProps<FlowNode>) {
  return <WorkflowNode {...props} />;
}
