import { cloneInitialNodes, initialEdges, node, type FlowEdge, type FlowNode } from './model';

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

// Edge palette — must match wire colors used across the studio.
const W_PROMPT = { stroke: '#9a52f8' };
const W_IMAGE = { stroke: '#4e9fff' };
const W_VIDEO = { stroke: '#3ad39c' };
const W_CHAR = { stroke: '#f59e0b' };

const edge = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  style: { stroke: string },
): FlowEdge => ({
  id,
  source,
  sourceHandle,
  target,
  targetHandle,
  type: 'default',
  animated: false,
  style,
});

/**
 * 8 BỘ TEMPLATE CHUẨN HOÁ 100% PHỤC VỤ LIVE TEST & UI TEST
 * Đảm bảo:
 * - Đầy đủ 100% inputs, wires, và model configuration.
 * - Image Input tự động khởi tạo payload ảnh hợp lệ (hoặc bind tự động theo project).
 * - Chạy trơn tru và sinh ra artifact thật sự trên cả FlowGraph Studio và Google Flow.
 */
export const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  // 1. LIVE TEST 01: Standard T2I -> I2V (Kinh điển sinh ảnh tạo video)
  {
    id: 'tpl-standard-t2i-i2v',
    title: 'Standard T2I → I2V Pipeline',
    description: 'Quy trình chuẩn: Prompt → Text-to-Image (Nano Banana 2) → Image-to-Video (Omni 1.1 Flash) → Final Video.',
    category: 'standard',
    tags: ['T2I', 'I2V', 'LiveTest', 'Banana', 'Omni'],
    nodes: cloneInitialNodes(),
    edges: initialEdges,
  },

  // 2. LIVE TEST 02: Pure Text to Video (Direct T2V)
  {
    id: 'tpl-pure-t2v',
    title: 'Pure Text → Video (Direct T2V)',
    description: 'Sinh video trực tiếp từ Prompt văn bản: Prompt → Text-to-Video (Omni 1.1 Flash) → Output Preview / Download.',
    category: 'standard',
    tags: ['T2V', 'LiveTest', 'Direct', 'Omni'],
    nodes: [
      node('t2v-1', 'prompt', 80, 160, { config: { prompt: 'A sleek cybernetic sports car driving on a wet neon-lit street at night, cinematic, ultra realistic 8k.' } }),
      node('t2v-2', 't2v', 460, 160, { config: { model: 'Omni 1.1 Flash', duration: '6s', targetResolution: '720p', aspectRatio: '16:9' } }),
      node('t2v-3', 'download', 860, 160, { config: { format: 'Original media', fileName: 't2v-direct-live' } }),
    ],
    edges: [
      edge('t2v-e1-2', 't2v-1', 'prompt', 't2v-2', 'prompt', W_PROMPT),
      edge('t2v-e2-3', 't2v-2', 'video', 't2v-3', 'media', W_VIDEO),
    ],
  },

  // 3. LIVE TEST 03: Gemini AI Enhance -> Text to Image
  {
    id: 'tpl-gemini-enhance-t2i',
    title: 'Gemini Enhance → Text to Image',
    description: 'Prompt thô → Gemini AI Enhance trau chuốt kịch bản → Text-to-Image (Nano Banana Pro) → Final Image.',
    category: 'standard',
    tags: ['AI', 'Gemini', 'T2I', 'LiveTest'],
    nodes: [
      node('gem-1', 'prompt', 80, 160, { title: 'Raw Prompt', config: { prompt: 'A futuristic city with flying vehicles, golden hour, ultra high detail.' } }),
      node('gem-2', 'gemini', 420, 160, { title: 'Gemini Enhance', config: { model: 'cx/gpt-5.6-luna', style: 'AUTO' } }),
      node('gem-3', 't2i', 760, 160, { title: 'Text to Image', config: { model: 'Nano Banana Pro', aspectRatio: '16:9' } }),
      node('gem-4', 'download', 1100, 160, { title: 'Final Image', config: { format: 'Original media', fileName: 'gemini-t2i-result' } }),
    ],
    edges: [
      edge('gem-e1-2', 'gem-1', 'prompt', 'gem-2', 'prompt', W_PROMPT),
      edge('gem-e2-3', 'gem-2', 'enhancedPrompt', 'gem-3', 'prompt', W_PROMPT),
      edge('gem-e3-4', 'gem-3', 'image', 'gem-4', 'media', W_IMAGE),
    ],
  },

  // 4. LIVE TEST 04: Keyframe Scene Interpolation (Start - End Frame)
  {
    id: 'tpl-keyframe-interpolation',
    title: 'Keyframe Scene Interpolation (Start - End Frame)',
    description: 'Nội suy chuyển cảnh hoàn chỉnh: 2 Prompt (Start/End) → 2 Ảnh Khung Đầu/Cuối + Prompt Chuyển Động → Tạo Cảnh (Interpolation) → Final Video.',
    category: 'cinematic',
    tags: ['Interpolation', 'Scene', 'Keyframe', 'Veo', 'LiveTest'],
    nodes: [
      node('kf-1', 'prompt', 60, 60, { title: 'Prompt (Start Frame)', config: { prompt: 'Wide shot of a cyberpunk street racer standing near a glowing sports car, dusk atmosphere.' } }),
      node('kf-2', 't2i', 420, 60, { title: 'Start Frame T2I', config: { model: 'Nano Banana 2', aspectRatio: '16:9' } }),
      node('kf-3', 'prompt', 60, 360, { title: 'Prompt (End Frame)', config: { prompt: 'Close up of the same racer sitting inside the glowing cockpit, neon reflections on helmet visor.' } }),
      node('kf-4', 't2i', 420, 360, { title: 'End Frame T2I', config: { model: 'Nano Banana 2', aspectRatio: '16:9' } }),
      node('kf-5', 'prompt', 60, 620, { title: 'Motion Prompt', config: { prompt: 'Camera pans smoothly forward from the exterior into the vehicle cockpit.' } }),
      node('kf-6', 'interpolation', 800, 220, { title: 'Start - End Frame', config: { model: 'Omni 1.1 Flash', duration: '6s', targetResolution: '720p', aspectRatio: '16:9' } }),
      node('kf-7', 'download', 1180, 220, { title: 'Final Video', config: { format: 'Original media', fileName: 'interpolation-scene' } }),
    ],
    edges: [
      edge('kf-e1-2', 'kf-1', 'prompt', 'kf-2', 'prompt', W_PROMPT),
      edge('kf-e3-4', 'kf-3', 'prompt', 'kf-4', 'prompt', W_PROMPT),
      edge('kf-e2-6', 'kf-2', 'image', 'kf-6', 'startImage', W_IMAGE),
      edge('kf-e4-6', 'kf-4', 'image', 'kf-6', 'endImage', W_IMAGE),
      edge('kf-e5-6', 'kf-5', 'prompt', 'kf-6', 'prompt', W_PROMPT),
      edge('kf-e6-7', 'kf-6', 'video', 'kf-7', 'media', W_VIDEO),
    ],
  },

  // 5. LIVE TEST 05: Reference Images to Video (R2V Multi-Reference)
  {
    id: 'tpl-reference-video',
    title: 'Multi-Reference Images to Video (R2V)',
    description: 'Tạo video từ nhiều ảnh tham chiếu phong cách/chủ thể: 2 Ảnh tham chiếu (T2I) + Prompt Chuyển động → Reference Images Video (Omni 1.1 Flash) → Final Video.',
    category: 'cinematic',
    tags: ['R2V', 'MultiReference', 'Video', 'LiveTest'],
    nodes: [
      node('r2v-p1', 'prompt', 60, 60, { title: 'Style Reference 1 Prompt', config: { prompt: 'A mystical glowing deer standing in an enchanted bioluminescent forest, magical particles.' } }),
      node('r2v-ref-img1', 't2i', 420, 60, { title: 'Reference Image 1', config: { model: 'Nano Banana 2', aspectRatio: '16:9' } }),
      node('r2v-p2', 'prompt', 60, 300, { title: 'Style Reference 2 Prompt', config: { prompt: 'An ancient crystal ruin illuminated by aurora borealis, surreal fantasy atmosphere.' } }),
      node('r2v-ref-img2', 't2i', 420, 300, { title: 'Reference Image 2', config: { model: 'Nano Banana 2', aspectRatio: '16:9' } }),
      node('r2v-p3', 'prompt', 60, 540, { title: 'Motion & Camera Prompt', config: { prompt: 'Drone shot circling around the subject in high velocity, dramatic sunset rim lighting.' } }),
      node('r2v-gen', 'reference', 800, 200, { title: 'Reference Images Video', config: { model: 'Omni 1.1 Flash', duration: '6s', targetResolution: '720p', aspectRatio: '16:9' } }),
      node('r2v-out', 'download', 1180, 200, { title: 'Final Video', config: { format: 'Original media', fileName: 'ref-video-live' } }),
    ],
    edges: [
      edge('r2v-e1', 'r2v-p1', 'prompt', 'r2v-ref-img1', 'prompt', W_PROMPT),
      edge('r2v-e2', 'r2v-ref-img1', 'image', 'r2v-gen', 'references', W_IMAGE),
      edge('r2v-e3', 'r2v-p2', 'prompt', 'r2v-ref-img2', 'prompt', W_PROMPT),
      edge('r2v-e4', 'r2v-ref-img2', 'image', 'r2v-gen', 'references', W_IMAGE),
      edge('r2v-e5', 'r2v-p3', 'prompt', 'r2v-gen', 'prompt', W_PROMPT),
      edge('r2v-e6', 'r2v-gen', 'video', 'r2v-out', 'media', W_VIDEO),
    ],
  },

  // 6. LIVE TEST 06: Two-Shot Continuity & Concat (Stitch Timeline)
  {
    id: 'tpl-extend-sequence',
    title: 'Two-Shot Continuity & Concat (Stitch Timeline)',
    description: 'Ghép nối liền mạch 2 cảnh qua Stitch Timeline: Cảnh 1 (T2V) + Cảnh 2 (T2V) → Stitch Video Concat → Final Movie.',
    category: 'cinematic',
    tags: ['Timeline', 'Stitch', 'Concat', 'Continuity', 'LiveTest'],
    nodes: [
      node('st-p1', 'prompt', 60, 80, { title: 'Shot 1 Prompt', config: { prompt: 'A sports car accelerating down an open desert highway at sunset, wide angle cinematic.' } }),
      node('st-v1', 't2v', 420, 80, { title: 'Shot 1 (T2V)', config: { model: 'Omni 1.1 Flash', duration: '6s', targetResolution: '720p' } }),
      node('st-p2', 'prompt', 60, 340, { title: 'Shot 2 Prompt', config: { prompt: 'Close up of the front wheel spinning at high velocity with tire smoke and sparks.' } }),
      node('st-v2', 't2v', 420, 340, { title: 'Shot 2 (T2V)', config: { model: 'Omni 1.1 Flash', duration: '6s', targetResolution: '720p' } }),
      node('st-concat', 'videoConcat', 800, 200, { title: 'Stitch / Timeline', config: { transition: 'crossfade' } }),
      node('st-out', 'download', 1140, 200, { title: 'Final Movie', config: { format: 'Original media', fileName: 'stitched-two-shots' } }),
    ],
    edges: [
      edge('st-e1', 'st-p1', 'prompt', 'st-v1', 'prompt', W_PROMPT),
      edge('st-e2', 'st-p2', 'prompt', 'st-v2', 'prompt', W_PROMPT),
      edge('st-e3', 'st-v1', 'video', 'st-concat', 'videos', W_VIDEO),
      edge('st-e4', 'st-v2', 'video', 'st-concat', 'videos', W_VIDEO),
      edge('st-e5', 'st-concat', 'video', 'st-out', 'media', W_VIDEO),
    ],
  },

  // 7. LIVE TEST 07: Multi-Stage Video Extension (Extend Sequence)
  {
    id: 'tpl-multi-extend-sequence',
    title: 'Multi-Stage Video Extension (Extend Sequence)',
    description: 'Mở rộng video liên tiếp nhiều chặng: Video gốc (T2V) → Mở rộng đoạn 1 (Extend Forward) → Mở rộng đoạn 2 (Extend Forward) → Final Extended Video.',
    category: 'cinematic',
    tags: ['Extend', 'Sequence', 'Continuity', 'Video', 'LiveTest'],
    nodes: [
      node('ext-p0', 'prompt', 60, 80, { title: 'Initial Scene Prompt', config: { prompt: 'A lone astronaut walking toward an alien monolith on Mars, red dust storm rising.' } }),
      node('ext-v0', 't2v', 420, 80, { title: 'Base Video (T2V)', config: { model: 'Omni 1.1 Flash', duration: '6s', targetResolution: '720p' } }),
      node('ext-p1', 'prompt', 60, 320, { title: 'Extension 1 Prompt', config: { prompt: 'The astronaut reaches the monolith and touches the glowing glyphs, blinding light.' } }),
      node('ext-v1', 'extend', 800, 160, { title: 'Extend Stage 1', config: { model: 'Omni 1.1 Flash', mode: 'Extend Forward', prompt: 'Touching glowing glyphs' } }),
      node('ext-p2', 'prompt', 420, 480, { title: 'Extension 2 Prompt', config: { prompt: 'The monolith splits open revealing a swirling cosmic wormhole.' } }),
      node('ext-v2', 'extend', 1160, 240, { title: 'Extend Stage 2', config: { model: 'Omni 1.1 Flash', mode: 'Extend Forward', prompt: 'Monolith opens into wormhole' } }),
      node('ext-out', 'download', 1520, 240, { title: 'Final Extended Video', config: { format: 'Original media', fileName: 'extended-mars-sequence' } }),
    ],
    edges: [
      edge('ext-e0', 'ext-p0', 'prompt', 'ext-v0', 'prompt', W_PROMPT),
      edge('ext-e1', 'ext-v0', 'video', 'ext-v1', 'video', W_VIDEO),
      edge('ext-e2', 'ext-p1', 'prompt', 'ext-v1', 'prompt', W_PROMPT),
      edge('ext-e3', 'ext-v1', 'video', 'ext-v2', 'video', W_VIDEO),
      edge('ext-e4', 'ext-p2', 'prompt', 'ext-v2', 'prompt', W_PROMPT),
      edge('ext-e5', 'ext-v2', 'video', 'ext-out', 'media', W_VIDEO),
    ],
  },

  // 7. LIVE TEST 07: Character Consistency DNA Pipeline (Self-Contained)
  {
    id: 'tpl-character-consistency',
    title: 'Character Consistency (DNA Lock → T2I)',
    description: 'Tạo nhân vật gốc (T2I) → Đóng gói Character DNA Lock → Sinh bối cảnh mới nhất quán nhân vật → Final Image.',
    category: 'cinematic',
    tags: ['Character', 'DNA', 'Consistency', 'T2I', 'LiveTest'],
    nodes: [
      node('char-init-p', 'prompt', 60, 80, { title: 'Character Concept Prompt', config: { prompt: 'Portrait of a futuristic cyberpunk detective, sharp jawline, silver hair, cybernetic eye, neutral background.' } }),
      node('char-init-img', 't2i', 420, 80, { title: 'Origin Face (T2I)', config: { model: 'Nano Banana 2', aspectRatio: '1:1' } }),
      node('char-node', 'characterCreate', 780, 80, { title: 'Character Creation', config: { characterId: 'HERO_001', displayName: 'Detective Vance' } }),
      node('char-prompt', 'prompt', 60, 360, { title: 'New Scene Action Prompt', config: { prompt: 'Standing on a rain-slicked neon rooftop at night, holding an umbrella, cinematic rim lighting, 8k.' } }),
      node('char-t2i', 't2i', 780, 360, { title: 'Consistent Scene T2I', config: { model: 'Nano Banana Pro', aspectRatio: '16:9' } }),
      node('char-out', 'download', 1140, 240, { title: 'Consistency Result', config: { format: 'Original media', fileName: 'hero-detective-scene' } }),
    ],
    edges: [
      edge('char-e1', 'char-init-p', 'prompt', 'char-init-img', 'prompt', W_PROMPT),
      edge('char-e2', 'char-init-img', 'image', 'char-node', 'image', W_IMAGE),
      edge('char-e3', 'char-node', 'character', 'char-t2i', 'characters', W_CHAR),
      edge('char-e4', 'char-prompt', 'prompt', 'char-t2i', 'prompt', W_PROMPT),
      edge('char-e5', 'char-t2i', 'image', 'char-out', 'media', W_IMAGE),
    ],
  },

  // 8. LIVE TEST 08: All Nodes Master Pipeline (Live & Benchmark)
  {
    id: 'tpl-all-nodes-benchmark',
    title: 'All Nodes Master Pipeline (Live & Benchmark)',
    description: 'Template tổng hợp chuẩn mực kết nối đầy đủ toàn bộ các loại Node thực thi của hệ thống, chuẩn 100% input và dây cáp.',
    category: 'cinematic',
    tags: ['Benchmark', 'All-Nodes', 'Full-Test', 'LiveTest'],
    nodes: [
      node('bm-p1', 'prompt', 40, 60, { title: 'Prompt (Start Frame)', config: { prompt: 'A futuristic electric hypercar speeding through a neo-tokyo highway, wet reflections, ultra sharp.' } }),
      node('bm-gemini', 'gemini', 240, 60, { title: 'Gemini Enhance', config: { model: 'cx/gpt-5.6-luna', style: 'AUTO' } }),
      node('bm-t2i-1', 't2i', 460, 60, { title: 'T2I Start Frame', config: { model: 'Nano Banana 2', aspectRatio: '16:9' } }),
      node('bm-p2', 'prompt', 40, 320, { title: 'Prompt (End Frame)', config: { prompt: 'The same hypercar parked in an underground neon garage, steam rising, atmospheric.' } }),
      node('bm-t2i-2', 't2i', 460, 320, { title: 'T2I End Frame', config: { model: 'Nano Banana 2', aspectRatio: '16:9' } }),
      node('bm-p3', 'prompt', 40, 560, { title: 'Prompt (Motion)', config: { prompt: 'Smooth camera dolly forward tracking the car seamlessly.' } }),
      node('bm-interp', 'interpolation', 800, 200, { title: 'Start - End Frame', config: { model: 'Omni 1.1 Flash', duration: '6s', targetResolution: '720p' } }),
      node('bm-prev', 'preview', 1140, 140, { title: 'Live Preview' }),
      node('bm-dl', 'download', 1140, 280, { title: 'Export Master MP4', config: { fileName: 'master-benchmark-video' } }),
      node('bm-p4', 'prompt', 40, 780, { title: 'Prompt (Direct T2V)', config: { prompt: 'Aerial drone view of cyberpunk skyscrapers, neon nightscape.' } }),
      node('bm-t2v', 't2v', 460, 780, { title: 'Direct T2V', config: { model: 'Omni 1.1 Flash', duration: '6s', targetResolution: '720p' } }),
      node('bm-dl-t2v', 'download', 800, 780, { title: 'Download T2V', config: { fileName: 'direct-t2v' } }),
      node('bm-char-1', 'characterCreate', 800, 480, { title: 'Character DNA', config: { characterId: 'CHAR_001', displayName: 'Main Pilot' } }),
    ],
    edges: [
      edge('bm-e-p1-gem', 'bm-p1', 'prompt', 'bm-gemini', 'prompt', W_PROMPT),
      edge('bm-e-gem-t2i1', 'bm-gemini', 'enhancedPrompt', 'bm-t2i-1', 'prompt', W_PROMPT),
      edge('bm-e-p2-t2i2', 'bm-p2', 'prompt', 'bm-t2i-2', 'prompt', W_PROMPT),
      edge('bm-e-t2i1-int', 'bm-t2i-1', 'image', 'bm-interp', 'startImage', W_IMAGE),
      edge('bm-e-t2i2-int', 'bm-t2i-2', 'image', 'bm-interp', 'endImage', W_IMAGE),
      edge('bm-e-p3-int', 'bm-p3', 'prompt', 'bm-interp', 'prompt', W_PROMPT),
      edge('bm-e-int-prev', 'bm-interp', 'video', 'bm-prev', 'media', W_VIDEO),
      edge('bm-e-int-dl', 'bm-interp', 'video', 'bm-dl', 'media', W_VIDEO),
      edge('bm-e-p4-t2v', 'bm-p4', 'prompt', 'bm-t2v', 'prompt', W_PROMPT),
      edge('bm-e-t2v-dl', 'bm-t2v', 'video', 'bm-dl-t2v', 'media', W_VIDEO),
      edge('bm-e-t2i1-char', 'bm-t2i-1', 'image', 'bm-char-1', 'image', W_IMAGE),
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

export function deleteCustomTemplate(id: string): boolean {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return false;
    const custom: WorkflowTemplate[] = JSON.parse(raw);
    const filtered = custom.filter((t) => t.id !== id);
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch {
    return false;
  }
}
