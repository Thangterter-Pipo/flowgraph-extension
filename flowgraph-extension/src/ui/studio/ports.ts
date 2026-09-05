export type PortDataType =
  | 'PROMPT'
  | 'TEXT'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'CHARACTER'
  | 'CHARACTER_LIST'
  | 'BOOLEAN'
  | 'NUMBER'
  | 'FILE'
  | 'MEDIA'
  | 'ANY';

export interface NodePortDefinition {
  id: string;
  label: string;
  type: PortDataType;
  role?: string;
  required?: boolean;
  multiple?: boolean;
  connectable?: boolean;
  configKey?: string;
}

export interface NodePortSpec {
  inputs: NodePortDefinition[];
  outputs: NodePortDefinition[];
}

const p = (
  id: string,
  label: string,
  type: PortDataType,
  options: Partial<Omit<NodePortDefinition, 'id' | 'label' | 'type'>> = {},
): NodePortDefinition => ({ id, label, type, connectable: true, ...options });

export const nodePortCatalog: Record<string, NodePortSpec> = {
  prompt: {
    inputs: [],
    outputs: [p('prompt', 'Prompt', 'PROMPT')],
  },
  gemini: {
    inputs: [p('prompt', 'Prompt', 'PROMPT', { required: true })],
    outputs: [p('enhancedPrompt', 'Enhanced', 'PROMPT')],
  },
  t2i: {
    inputs: [
      p('prompt', 'Prompt', 'PROMPT', { required: true }),
      p('references', 'Refs', 'IMAGE', { multiple: true, role: 'REF' }),
      p('characters', 'Chars', 'CHARACTER', { multiple: true, role: 'CHAR' }),
    ],
    outputs: [p('image', 'Image', 'IMAGE')],
  },
  uploadImage: {
    inputs: [p('file', 'File', 'FILE', { required: true, connectable: false, configKey: 'source' })],
    outputs: [p('image', 'Image', 'IMAGE')],
  },
  imageTransform: {
    inputs: [p('image', 'Image', 'IMAGE', { required: true })],
    outputs: [p('image', 'Image', 'IMAGE')],
  },
  imageUpscale: {
    inputs: [p('image', 'Image', 'IMAGE', { required: true })],
    outputs: [p('image', 'Image', 'IMAGE')],
  },
  t2v: {
    inputs: [p('prompt', 'Prompt', 'PROMPT', { required: true })],
    outputs: [p('video', 'Video', 'VIDEO')],
  },
  i2v: {
    inputs: [
      p('image', 'Start', 'IMAGE', { required: true }),
      p('prompt', 'Prompt', 'PROMPT'),
    ],
    outputs: [p('video', 'Video', 'VIDEO')],
  },
  extend: {
    inputs: [
      p('video', 'Video', 'VIDEO', { required: true }),
      p('prompt', 'Prompt', 'PROMPT'),
    ],
    outputs: [p('video', 'Video', 'VIDEO')],
  },
  interpolation: {
    inputs: [
      p('startImage', 'Start', 'IMAGE', { required: true, role: 'S' }),
      p('endImage', 'End', 'IMAGE', { required: true, role: 'E' }),
      p('prompt', 'Prompt', 'PROMPT', { role: 'P' }),
    ],
    outputs: [p('video', 'Video', 'VIDEO')],
  },
  reference: {
    inputs: [
      p('prompt', 'Prompt', 'PROMPT', { required: true, role: 'P' }),
      p('references', 'Refs', 'IMAGE', { required: true, multiple: true, role: 'REF' }),
      p('audio', 'Audio', 'AUDIO', { multiple: true, role: 'AUD' }),
      p('characters', 'Chars', 'CHARACTER', { multiple: true, role: 'CHAR' }),
    ],
    outputs: [p('video', 'Video', 'VIDEO')],
  },
  videoUpscale: {
    inputs: [p('video', 'Video', 'VIDEO', { required: true })],
    outputs: [p('video', 'Video', 'VIDEO')],
  },
  cancelGeneration: {
    inputs: [p('media', 'Active', 'MEDIA', { required: true })],
    outputs: [p('canceled', 'Canceled', 'BOOLEAN')],
  },
  likenessCheck: {
    inputs: [],
    outputs: [p('eligible', 'Eligible', 'BOOLEAN')],
  },
  likenessList: {
    inputs: [],
    outputs: [p('characters', 'Likenesses', 'CHARACTER_LIST')],
  },
  characterAssign: {
    inputs: [
      p('image', 'Image', 'IMAGE', { required: true }),
      p('character', 'Character', 'CHARACTER'),
    ],
    outputs: [p('character', 'Character', 'CHARACTER')],
  },
  characterCreate: {
    inputs: [
      p('image', 'Image', 'IMAGE', { required: true }),
      p('prompt', 'Prompt', 'PROMPT'),
    ],
    outputs: [p('character', 'Character', 'CHARACTER')],
  },
  creationAgent: {
    inputs: [p('prompt', 'Prompt', 'PROMPT', { required: true })],
    outputs: [p('text', 'Response', 'TEXT')],
  },
  download: {
    inputs: [p('media', 'Media', 'MEDIA', { required: true })],
    outputs: [p('file', 'File', 'FILE')],
  },
  mediaInput: {
    inputs: [],
    outputs: [p('media', 'Media', 'MEDIA')],
  },
  imageInput: {
    inputs: [],
    outputs: [p('image', 'Image', 'IMAGE')],
  },
  videoInput: {
    inputs: [],
    outputs: [p('video', 'Video', 'VIDEO')],
  },
  preview: {
    inputs: [p('media', 'Media', 'MEDIA', { required: true })],
    outputs: [p('media', 'Media', 'MEDIA')],
  },
  condition: {
    inputs: [p('value', 'Value', 'BOOLEAN', { required: true })],
    outputs: [p('true', 'True', 'BOOLEAN', { role: 'T' }), p('false', 'False', 'BOOLEAN', { role: 'F' })],
  },
  delay: {
    inputs: [p('input', 'Input', 'ANY')],
    outputs: [p('output', 'Output', 'ANY')],
  },
  note: {
    inputs: [],
    outputs: [],
  },
};

const fallback: NodePortSpec = { inputs: [], outputs: [] };

export function portsForKind(kind: string): NodePortSpec {
  return nodePortCatalog[kind] ?? fallback;
}

export function inputPort(kind: string, id?: string | null): NodePortDefinition | undefined {
  const ports = portsForKind(kind).inputs.filter((port) => port.connectable !== false);
  if (id) return ports.find((port) => port.id === id);
  return ports.length === 1 ? ports[0] : undefined;
}

export function outputPort(kind: string, id?: string | null): NodePortDefinition | undefined {
  const ports = portsForKind(kind).outputs.filter((port) => port.connectable !== false);
  if (id) return ports.find((port) => port.id === id);
  return ports.length === 1 ? ports[0] : undefined;
}

export function portTypesCompatible(source: PortDataType, target: PortDataType): boolean {
  if (source === 'ANY' || target === 'ANY') return true;
  if (target === 'MEDIA') return source === 'IMAGE' || source === 'VIDEO' || source === 'AUDIO' || source === 'MEDIA';
  if (source === 'CHARACTER_LIST' && target === 'CHARACTER') return false;
  return source === target;
}

export function portTypeClass(type: PortDataType): string {
  return `port-type-${type.toLowerCase().replace('_', '-')}`;
}
