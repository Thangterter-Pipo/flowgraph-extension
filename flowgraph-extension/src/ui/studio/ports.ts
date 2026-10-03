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
  note: string;
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
  note: string,
  options: Partial<Omit<NodePortDefinition, 'id' | 'label' | 'type' | 'note'>> = {},
): NodePortDefinition => ({ id, label, type, note, connectable: true, ...options });

export const nodePortCatalog: Record<string, NodePortSpec> = {
  prompt: {
    inputs: [],
    outputs: [p('prompt', 'Prompt', 'PROMPT', 'Prompt thô')],
  },
  gemini: {
    inputs: [p('prompt', 'Prompt', 'PROMPT', 'Prompt thô', { required: true })],
    outputs: [p('enhancedPrompt', 'Enhance', 'PROMPT', 'Prompt đã enhance')],
  },
  t2i: {
    inputs: [
      p('prompt', 'Prompt', 'PROMPT', 'Mô tả ảnh', { required: true, configKey: 'customPrompt' }),
      p('references', 'Ref', 'IMAGE', 'Ảnh tham chiếu', { multiple: true, role: 'REF' }),
      p('characters', 'Char', 'CHARACTER', 'DNA nhân vật', { multiple: true, role: 'CHAR' }),
    ],
    outputs: [p('image', 'Image', 'IMAGE', 'Ảnh ra')],
  },
  uploadImage: {
    inputs: [p('file', 'File', 'FILE', 'File máy', { required: true, connectable: false, configKey: 'mediaId' })],
    outputs: [p('image', 'Image', 'IMAGE', 'Ảnh tải lên')],
  },
  imageTransform: {
    inputs: [p('image', 'Image', 'IMAGE', 'Ảnh gốc', { required: true })],
    outputs: [p('image', 'Image', 'IMAGE', 'Ảnh biến đổi')],
  },
  imageUpscale: {
    inputs: [
      p('image', 'Image', 'IMAGE', 'Ảnh gốc', { required: true }),
    ],
    outputs: [p('image', 'Image', 'IMAGE', 'Ảnh 2K/4K')],
  },
  t2v: {
    inputs: [p('prompt', 'Prompt', 'PROMPT', 'Mô tả video', { required: true, configKey: 'customPrompt' })],
    outputs: [
      p('video', 'Video', 'VIDEO', 'Video ra'),
      p('lastFrame', 'Cuối', 'IMAGE', 'Khung cuối nối tiếp', { required: false }),
    ],
  },
  i2v: {
    inputs: [
      p('image', 'Start', 'IMAGE', 'Khung đầu', { required: true }),
      p('prompt', 'Prompt', 'PROMPT', 'Chuyển động', { required: true, configKey: 'prompt' }),
      p('characters', 'Char', 'CHARACTER', 'DNA nhân vật', { multiple: true, role: 'CHAR' }),
    ],
    outputs: [
      p('video', 'Video', 'VIDEO', 'Video ra'),
      p('lastFrame', 'Cuối', 'IMAGE', 'Khung cuối nối tiếp', { required: false }),
    ],
  },
  extend: {
    inputs: [
      p('video', 'Video', 'VIDEO', 'Video gốc', { required: true }),
      p('prompt', 'Prompt', 'PROMPT', 'Cách kéo dài', { required: true, configKey: 'prompt' }),
    ],
    outputs: [p('video', 'Video', 'VIDEO', 'Video kéo dài')],
  },
  interpolation: {
    inputs: [
      p('startImage', 'Start', 'IMAGE', 'Khung đầu', { required: true, role: 'S' }),
      p('endImage', 'End', 'IMAGE', 'Khung cuối', { required: true, role: 'E' }),
      p('prompt', 'Prompt', 'PROMPT', 'Chuyển cảnh', { required: true, configKey: 'prompt', role: 'P' }),
    ],
    outputs: [p('video', 'Video', 'VIDEO', 'Video ra')],
  },
  reference: {
    inputs: [
      p('prompt', 'Prompt', 'PROMPT', 'Mô tả video', { required: true, configKey: 'prompt', role: 'P' }),
      p('references', 'Ref', 'IMAGE', 'Ảnh tham chiếu', { required: true, multiple: true, role: 'REF' }),
      p('characters', 'Char', 'CHARACTER', 'DNA nhân vật', { multiple: true, role: 'CHAR' }),
    ],
    outputs: [p('video', 'Video', 'VIDEO', 'Video ra')],
  },
  videoUpscale: {
    inputs: [
      p('video', 'Video', 'VIDEO', 'Video gốc', { required: true }),
    ],
    outputs: [p('video', 'Video', 'VIDEO', 'Video 1080p/4K')],
  },
  videoConcat: {
    inputs: [
      p('videos', 'Videos', 'VIDEO', 'Danh sách video', { required: true, multiple: true }),
      p('prompt', 'Prompt', 'PROMPT', 'Kịch bản / Ghi chú'),
    ],
    outputs: [p('video', 'Video', 'VIDEO', 'Video đã ghép')],
  },
  cancelGeneration: {
    inputs: [p('media', 'Task', 'MEDIA', 'Tác vụ đang chạy', { required: true })],
    outputs: [p('canceled', 'Canceled', 'BOOLEAN', 'Đã hủy')],
  },
  likenessCheck: {
    inputs: [],
    outputs: [p('eligible', 'Eligible', 'BOOLEAN', 'Đủ likeness')],
  },
  likenessList: {
    inputs: [],
    outputs: [p('characters', 'Chars', 'CHARACTER_LIST', 'Danh sách likeness')],
  },
  characterAssign: {
    inputs: [
      p('image', 'Image', 'IMAGE', 'Ảnh gán', { required: true }),
      p('character', 'Char', 'CHARACTER', 'Nhân vật'),
    ],
    outputs: [p('character', 'Char', 'CHARACTER', 'Nhân vật đã gán')],
  },
  characterCreate: {
    inputs: [
      p('image', 'Face', 'IMAGE', 'Ảnh mặt', { required: true }),
      p('prompt', 'Desc', 'PROMPT', 'Mô tả DNA'),
    ],
    outputs: [
      p('character', 'Char', 'CHARACTER', 'Thực thể nhân vật'),
      p('image', 'Image', 'IMAGE', 'Ảnh DNA'),
    ],
  },
  creationAgent: {
    inputs: [p('prompt', 'Prompt', 'PROMPT', 'Yêu cầu', { required: true })],
    outputs: [p('text', 'Text', 'TEXT', 'Câu trả lời')],
  },
  download: {
    inputs: [p('media', 'Media', 'MEDIA', 'Ảnh hoặc video', { required: true })],
    outputs: [p('file', 'File', 'FILE', 'File tải')],
  },
  mediaInput: {
    inputs: [],
    outputs: [p('media', 'Media', 'MEDIA', 'Nguồn media')],
  },
  imageInput: {
    inputs: [],
    outputs: [p('image', 'Image', 'IMAGE', 'Nguồn ảnh')],
  },
  videoInput: {
    inputs: [],
    outputs: [p('video', 'Video', 'VIDEO', 'Nguồn video')],
  },
  audioInput: {
    inputs: [],
    outputs: [p('audio', 'Audio', 'AUDIO', 'Coming soon · audio runtime not verified', { connectable: false })],
  },
  preview: {
    inputs: [p('media', 'Media', 'MEDIA', 'Run target', { required: true })],
    outputs: [p('media', 'Media', 'MEDIA', 'Pass-through')],
  },
  condition: {
    inputs: [p('value', 'If', 'BOOLEAN', 'Điều kiện', { required: true })],
    outputs: [
      p('true', 'True', 'BOOLEAN', 'Nhánh đúng', { role: 'T' }),
      p('false', 'False', 'BOOLEAN', 'Nhánh sai', { role: 'F' }),
    ],
  },
  delay: {
    inputs: [p('input', 'Input', 'ANY', 'Tín hiệu vào')],
    outputs: [p('output', 'Output', 'ANY', 'Sau khi chờ')],
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
  if (source === target) return true;
  if (source === 'ANY' || target === 'ANY') return true;
  if (target === 'MEDIA') return source === 'IMAGE' || source === 'VIDEO' || source === 'AUDIO' || source === 'MEDIA';
  if (source === 'PROMPT' && target === 'TEXT') return true;
  if (source === 'TEXT' && target === 'PROMPT') return true;
  if (source === 'CHARACTER_LIST' && target === 'CHARACTER') return false;
  return false;
}

export function portTypeClass(type: PortDataType): string {
  return `port-type-${type.toLowerCase().replace('_', '-')}`;
}
