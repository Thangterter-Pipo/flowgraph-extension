import React from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FlowNode } from '../model';
import WorkflowNode from '../WorkflowNode';
import {
  TextToVideoNode,
  ImageToVideoNode,
  ExtendVideoNode,
  InterpolationNode,
  ReferenceVideoNode,
} from './impl/video/VideoNodes';

export const nodeTypes: Record<string, React.ComponentType<NodeProps<any>>> = {
  flowNode: WorkflowNode,
  prompt: WorkflowNode as any,
  t2i: WorkflowNode as any,
  t2v: TextToVideoNode as any,
  i2v: ImageToVideoNode as any,
  extend: ExtendVideoNode as any,
  interpolation: InterpolationNode as any,
  reference: ReferenceVideoNode as any,
  videoConcat: WorkflowNode as any,
  download: WorkflowNode as any,
  preview: WorkflowNode as any,
  gemini: WorkflowNode as any,
  characterCreate: WorkflowNode as any,
};
