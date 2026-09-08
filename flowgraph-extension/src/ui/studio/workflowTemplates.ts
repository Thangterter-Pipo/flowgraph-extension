import { cloneInitialNodes, initialEdges, type FlowEdge, type FlowNode } from './model';

export interface WorkflowTemplate {
  id: string;
  title: string;
  description: string;
  category: 'standard' | 'cinematic' | 'experimental' | 'custom';
  tags: string[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const TEMPLATE_STORAGE_KEY = 'flowgraph.customTemplates.v1';

export const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'tpl-standard-t2i-i2v',
    title: 'Standard T2I → I2V Pipeline',
    description: 'Quy trình kinh điển: Prompt → Text-to-Image (Nano Banana) → Image-to-Video (Omni 1.1) → Final Video.',
    category: 'standard',
    tags: ['T2I', 'I2V', 'Veo', 'Omni'],
    nodes: cloneInitialNodes(),
    edges: initialEdges,
  },
  {
    id: 'tpl-keyframe-interpolation',
    title: 'Keyframe Scene Interpolation (Start - End Frame)',
    description: 'Tạo cảnh điện ảnh nội suy mượt mà: 2 Prompt (Start/End) → 2 Ảnh Khung Đầu/Cuối → Tạo Cảnh (Veo Lite 8s) → Final Video.',
    category: 'cinematic',
    tags: ['Interpolation', 'Scene', 'Veo 3.1', '8s'],
    nodes: [
      {
        id: '1',
        type: 'flowNode',
        position: { x: 50, y: 50 },
        data: {
          kind: 'prompt',
          title: 'Prompt 1 (Start Frame)',
          subtitle: 'Khung Đầu',
          tone: 'purple',
          config: { prompt: 'A charming 3D small robot Miko reaching out hand toward a glowing golden butterfly at sunset, 16:9.' },
          status: 'idle',
        } as any,
      },
      {
        id: '2',
        type: 'flowNode',
        position: { x: 420, y: 50 },
        data: {
          kind: 't2i',
          title: 'Text to Image #1',
          subtitle: 'Khung Đầu',
          tone: 'blue',
          config: { model: '🍌 Nano Banana 2', aspectRatio: '16:9', batchCount: 'x1' },
          status: 'idle',
        } as any,
      },
      {
        id: '3',
        type: 'flowNode',
        position: { x: 50, y: 520 },
        data: {
          kind: 'prompt',
          title: 'Prompt 2 (End Frame)',
          subtitle: 'Khung Cuối',
          tone: 'purple',
          config: { prompt: 'The exact same 3D robot Miko, golden butterfly landed on fingertip, smiling happily at sunset, 16:9.' },
          status: 'idle',
        } as any,
      },
      {
        id: '4',
        type: 'flowNode',
        position: { x: 420, y: 520 },
        data: {
          kind: 't2i',
          title: 'Text to Image #2',
          subtitle: 'Khung Cuối',
          tone: 'blue',
          config: { model: '🍌 Nano Banana 2', aspectRatio: '16:9', batchCount: 'x1' },
          status: 'idle',
        } as any,
      },
      {
        id: '5',
        type: 'flowNode',
        position: { x: 810, y: 50 },
        data: {
          kind: 'prompt',
          title: 'Mô Tả Cảnh (Scene Prompt)',
          subtitle: 'Chuyển Động Cảnh',
          tone: 'purple',
          config: { prompt: 'The golden butterfly gently circles around Miko, then lands softly on fingertip. Smooth motion.' },
          status: 'idle',
        } as any,
      },
      {
        id: '6',
        type: 'flowNode',
        position: { x: 810, y: 300 },
        data: {
          kind: 'interpolation',
          title: 'Tạo Cảnh (Start - End Frame)',
          subtitle: 'Keyframe Interpolation',
          tone: 'green',
          config: { model: 'Veo 3.1 - Lite', duration: '8s', resolution: '720p', aspectRatio: '16:9', batchCount: 'x1' },
          status: 'idle',
        } as any,
      },
      {
        id: '7',
        type: 'flowNode',
        position: { x: 1200, y: 240 },
        data: {
          kind: 'download',
          title: 'Final Video',
          subtitle: 'Thành Phẩm Cảnh Hoàn Chỉnh',
          tone: 'orange',
          config: { fileName: 'miko-scene.mp4', autoDownload: 'false' },
          status: 'idle',
        } as any,
      },
    ],
    edges: [
      { id: 'e1-2', source: '1', sourceHandle: 'prompt', target: '2', targetHandle: 'prompt', type: 'default', animated: false, style: { stroke: '#9a52f8' } },
      { id: 'e3-4', source: '3', sourceHandle: 'prompt', target: '4', targetHandle: 'prompt', type: 'default', animated: false, style: { stroke: '#9a52f8' } },
      { id: 'e2-6', source: '2', sourceHandle: 'image', target: '6', targetHandle: 'startImage', type: 'default', animated: false, style: { stroke: '#4e9fff' } },
      { id: 'e4-6', source: '4', sourceHandle: 'image', target: '6', targetHandle: 'endImage', type: 'default', animated: false, style: { stroke: '#4e9fff' } },
      { id: 'e5-6', source: '5', sourceHandle: 'prompt', target: '6', targetHandle: 'prompt', type: 'default', animated: false, style: { stroke: '#9a52f8' } },
      { id: 'e6-7', source: '6', sourceHandle: 'video', target: '7', targetHandle: 'media', type: 'default', animated: false, style: { stroke: '#3ad39c' } },
    ],
  },
  {
    id: 'tpl-advanced-master-upscale',
    title: 'Advanced AI Production Pipeline (Upscale Master)',
    description: 'Đường ống chuyên nghiệp toàn diện: Prompt → T2I → Image Upscale (4K) → I2V (Omni Flash) → Video Upscale (1080p) → Final Master Video.',
    category: 'cinematic',
    tags: ['Master', 'Upscale 4K', '1080p', 'Production'],
    nodes: [
      {
        id: '1',
        type: 'flowNode',
        position: { x: 40, y: 140 },
        data: {
          kind: 'prompt',
          title: 'Prompt',
          subtitle: 'Kịch bản chủ đạo',
          tone: 'purple',
          config: { prompt: 'Cinematic hyper-detailed futuristic cyberpunk city with neon reflections in the rain, 8k render, masterpiece.' },
          status: 'idle',
        } as any,
      },
      {
        id: '2',
        type: 'flowNode',
        position: { x: 340, y: 140 },
        data: {
          kind: 't2i',
          title: 'Text to Image',
          subtitle: 'Tạo ảnh nguồn',
          tone: 'blue',
          config: { model: '🍌 Nano Banana Pro', aspectRatio: '16:9', batchCount: 'x1' },
          status: 'idle',
        } as any,
      },
      {
        id: '3',
        type: 'flowNode',
        position: { x: 670, y: 140 },
        data: {
          kind: 'imageUpscale',
          title: 'Image Upscale',
          subtitle: 'Nâng cấp 4K siêu nét',
          tone: 'blue',
          config: { targetResolution: '4K' },
          status: 'idle',
        } as any,
      },
      {
        id: '4',
        type: 'flowNode',
        position: { x: 990, y: 140 },
        data: {
          kind: 'i2v',
          title: 'Image to Video',
          subtitle: 'Chuyển động điện ảnh',
          tone: 'green',
          config: { model: 'Omni 1.1 Flash', duration: '4s', resolution: '720p', aspectRatio: '16:9' },
          status: 'idle',
        } as any,
      },
      {
        id: '5',
        type: 'flowNode',
        position: { x: 1320, y: 140 },
        data: {
          kind: 'videoUpscale',
          title: 'Video Upscale',
          subtitle: 'Nâng cấp Video 1080p',
          tone: 'green',
          config: { targetResolution: '1080p' },
          status: 'idle',
        } as any,
      },
      {
        id: '6',
        type: 'flowNode',
        position: { x: 1650, y: 140 },
        data: {
          kind: 'download',
          title: 'Final Video',
          subtitle: 'Video Master Đã Tinh Chỉnh',
          tone: 'orange',
          config: { fileName: 'master-cyberpunk.mp4', autoDownload: 'false' },
          status: 'idle',
        } as any,
      },
    ],
    edges: [
      { id: 'e1-2', source: '1', sourceHandle: 'prompt', target: '2', targetHandle: 'prompt', type: 'default', animated: false, style: { stroke: '#9a52f8' } },
      { id: 'e1-4', source: '1', sourceHandle: 'prompt', target: '4', targetHandle: 'prompt', type: 'default', animated: false, style: { stroke: '#9a52f8' } },
      { id: 'e2-3', source: '2', sourceHandle: 'image', target: '3', targetHandle: 'image', type: 'default', animated: false, style: { stroke: '#4e9fff' } },
      { id: 'e3-4', source: '3', sourceHandle: 'image', target: '4', targetHandle: 'image', type: 'default', animated: false, style: { stroke: '#4e9fff' } },
      { id: 'e4-5', source: '4', sourceHandle: 'video', target: '5', targetHandle: 'video', type: 'default', animated: false, style: { stroke: '#3ad39c' } },
      { id: 'e5-6', source: '5', sourceHandle: 'video', target: '6', targetHandle: 'media', type: 'default', animated: false, style: { stroke: '#3ad39c' } },
    ],
  },
  {
    id: 'tpl-reference-video',
    title: 'Character Reference Video Pipeline',
    description: 'Tạo video duy trì nhất quán nhân vật: Upload/Tạo ảnh nhân vật → Reference Video (Omni Flash) → Final Video.',
    category: 'standard',
    tags: ['Character', 'Consistency', 'Reference'],
    nodes: [
      {
        id: '1',
        type: 'flowNode',
        position: { x: 80, y: 80 },
        data: {
          kind: 'uploadImage',
          title: 'Character Image',
          subtitle: 'Ảnh nhân vật mẫu',
          tone: 'blue',
          config: { source: 'Hero Character' },
          status: 'idle',
        } as any,
      },
      {
        id: '2',
        type: 'flowNode',
        position: { x: 80, y: 350 },
        data: {
          kind: 'prompt',
          title: 'Action Prompt',
          subtitle: 'Mô tả hành động nhân vật',
          tone: 'purple',
          config: { prompt: 'The character looks around smiling warmly, wind gently blowing hair, cinematic lighting.' },
          status: 'idle',
        } as any,
      },
      {
        id: '3',
        type: 'flowNode',
        position: { x: 480, y: 200 },
        data: {
          kind: 'reference',
          title: 'Reference Video',
          subtitle: 'Tạo video theo ảnh tham chiếu',
          tone: 'green',
          config: { model: 'Omni 1.1 Flash', duration: '4s', resolution: '720p', aspectRatio: '16:9' },
          status: 'idle',
        } as any,
      },
      {
        id: '4',
        type: 'flowNode',
        position: { x: 860, y: 200 },
        data: {
          kind: 'download',
          title: 'Final Video',
          subtitle: 'Video nhân vật hoàn chỉnh',
          tone: 'orange',
          config: { fileName: 'character-scene.mp4', autoDownload: 'false' },
          status: 'idle',
        } as any,
      },
    ],
    edges: [
      { id: 'e1-3', source: '1', sourceHandle: 'image', target: '3', targetHandle: 'referenceImages', type: 'default', animated: false, style: { stroke: '#4e9fff' } },
      { id: 'e2-3', source: '2', sourceHandle: 'prompt', target: '3', targetHandle: 'prompt', type: 'default', animated: false, style: { stroke: '#9a52f8' } },
      { id: 'e3-4', source: '3', sourceHandle: 'video', target: '4', targetHandle: 'media', type: 'default', animated: false, style: { stroke: '#3ad39c' } },
    ],
  },
];

export function loadAllTemplates(): WorkflowTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    const custom: WorkflowTemplate[] = raw ? JSON.parse(raw) : [];
    return [...BUILTIN_TEMPLATES, ...custom];
  } catch {
    return BUILTIN_TEMPLATES;
  }
}

export function saveCustomTemplate(template: Omit<WorkflowTemplate, 'id'>): WorkflowTemplate {
  const allTemplates = loadAllTemplates();
  const id = `custom-tpl-${Date.now()}`;
  const newTpl: WorkflowTemplate = {
    ...template,
    id,
    category: 'custom',
  };
  const customOnly = allTemplates.filter((t) => t.category === 'custom');
  customOnly.unshift(newTpl);
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(customOnly));
  return newTpl;
}

export function deleteCustomTemplate(id: string): void {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return;
    const custom: WorkflowTemplate[] = JSON.parse(raw);
    const updated = custom.filter((t) => t.id !== id);
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}
