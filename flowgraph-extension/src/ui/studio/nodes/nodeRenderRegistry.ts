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
import {
  PromptNode,
  GeminiNode,
  ImageGenNode,
  CharacterNode,
  StitchNode,
  OutputNode,
} from './impl/OtherNodes';

export const nodeTypes: Record<string, React.ComponentType<NodeProps<any>>> = {
  flowNode: WorkflowNode,
  prompt: PromptNode as any,
  t2i: ImageGenNode as any,
  t2v: TextToVideoNode as any,
  i2v: ImageToVideoNode as any,
  extend: ExtendVideoNode as any,
  interpolation: InterpolationNode as any,
  reference: ReferenceVideoNode as any,
  videoConcat: StitchNode as any,
  download: OutputNode as any,
  preview: OutputNode as any,
  gemini: GeminiNode as any,
  characterCreate: CharacterNode as any,
};
