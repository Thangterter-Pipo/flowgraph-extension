import { node, type FlowEdge, type FlowNode } from './model';
import type { WorkflowTemplate } from './workflowTemplates';

export interface StoryScene {
  index: number;
  title: string;
  prompt: string;
}

export interface ParsedStory {
  rawPrompt: string;
  title: string;
  style: string;
  strategy: 'STORYBOARD_9GRID' | 'MULTI_SCENE' | 'SINGLE_SHOT';
  scenes: StoryScene[];
}

const W_PROMPT = { stroke: '#9a52f8' };
const W_IMAGE = { stroke: '#4e9fff' };
const W_VIDEO = { stroke: '#3ad39c' };

const makeEdge = (
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
 * Phân tích mọi format prompt từ người dùng:
 * - Đánh số (1., 2., Cảnh 1, Shot 1, Scene 1)
 * - Gạch đầu dòng (- / *)
 * - Đoạn văn tự do (tự động phân câu)
 * - Từ khóa đặc biệt (9 ô, cửu cung, 3x3, storyboard)
 */
export function parseCopilotPrompt(raw: string): ParsedStory {
  const text = (raw || '').trim();
  if (!text) {
    return {
      rawPrompt: '',
      title: 'Phim Ngắn Mới',
      style: 'Cinematic',
      strategy: 'SINGLE_SHOT',
      scenes: [{ index: 1, title: 'Cảnh 1', prompt: 'Cinematic scene' }],
    };
  }

  const lower = text.toLowerCase();
  const is9GridExplicit = /9\s*(ô|cảnh|shot|panel|grid)|cửu\s*cung|storyboard\s*grid|3\s*[x*×]\s*3/i.test(lower);

  // 1. Tìm các phân cảnh đánh số (VD: "1.", "Cảnh 1:", "Shot 1:", "Scene 1:")
  const numberedRegex = /(?:^|\n)\s*(?:(?:cảnh|shot|scene|phân cảnh|hồi)\s*(\d+)[:.]?|(\d+)[:.)-])\s*([^\n]+)/gi;
  const numberedMatches: Array<{ num: number; content: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = numberedRegex.exec(text)) !== null) {
    const num = Number(m[1] || m[2]);
    const content = (m[3] || '').trim();
    if (content) {
      numberedMatches.push({ num, content });
    }
  }

  // 2. Nếu tìm thấy ít nhất 2 phân cảnh đánh số
  if (numberedMatches.length >= 2) {
    const scenes: StoryScene[] = numberedMatches.map((item, idx) => ({
      index: idx + 1,
      title: `Cảnh ${idx + 1}`,
      prompt: item.content,
    }));

    const strategy = is9GridExplicit || scenes.length >= 7 ? 'STORYBOARD_9GRID' : 'MULTI_SCENE';
    const firstLine = text.split('\n')[0].replace(/^(?:đề tài|kịch bản|story|phim)[:.]?\s*/i, '').trim();
    return {
      rawPrompt: text,
      title: firstLine.length < 50 ? firstLine : `Phim Ngắn ${scenes.length} Cảnh`,
      style: 'Cinematic',
      strategy,
      scenes,
    };
  }

  // 3. Tìm theo gạch đầu dòng (- / *)
  const bulletLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean);

  if (bulletLines.length >= 2) {
    const scenes: StoryScene[] = bulletLines.map((content, idx) => ({
      index: idx + 1,
      title: `Cảnh ${idx + 1}`,
      prompt: content,
    }));

    const strategy = is9GridExplicit || scenes.length >= 7 ? 'STORYBOARD_9GRID' : 'MULTI_SCENE';
    return {
      rawPrompt: text,
      title: `Phim Ngắn ${scenes.length} Phân Đoạn`,
      style: 'Cinematic',
      strategy,
      scenes,
    };
  }

  // 4. Nếu là đoạn văn tự do không có định dạng phân cảnh
  if (is9GridExplicit) {
    // Người dùng muốn 9 ô từ 1 prompt tự do
    const scenes: StoryScene[] = Array.from({ length: 9 }, (_, i) => ({
      index: i + 1,
      title: `Shot ${i + 1}`,
      prompt: `${text} - Panel ${i + 1}`,
    }));
    return {
      rawPrompt: text,
      title: 'Phim Điện Ảnh Cửu Cung 9 Ô',
      style: 'Cinematic Storyboard',
      strategy: 'STORYBOARD_9GRID',
      scenes,
    };
  }

  // Tách câu tự do nếu đoạn văn dài có nhiều câu hành động
  const sentences = text
    .split(/[.;!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);

  if (sentences.length >= 3 && sentences.length <= 6) {
    const scenes: StoryScene[] = sentences.map((s, idx) => ({
      index: idx + 1,
      title: `Cảnh ${idx + 1}`,
      prompt: s,
    }));
    return {
      rawPrompt: text,
      title: sentences[0].slice(0, 35) + '...',
      style: 'Cinematic',
      strategy: 'MULTI_SCENE',
      scenes,
    };
  }

  // Mặc định: Single shot
  return {
    rawPrompt: text,
    title: text.slice(0, 35) + (text.length > 35 ? '...' : ''),
    style: 'Cinematic',
    strategy: 'SINGLE_SHOT',
    scenes: [{ index: 1, title: 'Cảnh 1', prompt: text }],
  };
}

/**
 * Tự động sinh toàn bộ đồ thị Node và tự động nối dây (Auto-wiring)
 * dựa trên phân tích từ AI Director.
 */
export function generateWorkflowFromPrompt(rawPrompt: string): {
  template: WorkflowTemplate;
  summary: string;
} {
  const story = parseCopilotPrompt(rawPrompt);
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // =========================================================================
  // CHIẾN LƯỢC 1: CỬU CUNG 9 Ô (STORYBOARD 9-GRID - LIBTV ARCHITECTURAL STANDARD)
  // =========================================================================
  if (story.strategy === 'STORYBOARD_9GRID') {
    const promptMaster = [
      story.rawPrompt,
      'Cinematic animated movie illustration, 3x3 storyboard grid, 9 numbered panels, read left to right top to bottom.',
      'Maintain character identity and lighting consistency across all 9 panels.',
    ].join('\n');

    // 1. Master Prompt Node
    nodes.push(
      node('cp-prompt-master', 'prompt', 80, 180, {
        title: 'Kịch bản Cửu Cung',
        subtitle: 'Master Prompt',
        tone: 'purple',
        config: { prompt: promptMaster },
      }),
    );

    // 2. T2I Master 9-Grid
    nodes.push(
      node('cp-t2i-master', 't2i', 480, 120, {
        title: 'T2I Master 9-Grid',
        subtitle: 'Image Generation',
        tone: 'blue',
        config: { model: '🍌 Nano Banana 2', aspectRatio: '16:9' },
      }),
    );
    edges.push(makeEdge('e-p-to-t2i', 'cp-prompt-master', 'prompt', 'cp-t2i-master', 'prompt', W_PROMPT));

    // 3. Storyboard 9-Grid Splitter
    nodes.push(
      node('cp-sb-split', 'storyboardSplit', 880, 80, {
        title: 'Storyboard 9-Grid Splitter',
        subtitle: 'Auto Crop & Clean Borders',
        tone: 'blue',
        config: { cleanBorders: 'true', gridLayout: '3x3' },
      }),
    );
    edges.push(makeEdge('e-t2i-to-split', 'cp-t2i-master', 'image', 'cp-sb-split', 'imageIn', W_IMAGE));

    // 4. Sinh các Node Video tương ứng cho từng Shot (ví dụ chọn 3-4 shot tiêu biểu hoặc đủ số shot)
    const shotsToGenerate = Math.min(story.scenes.length || 4, 4);
    const videoNodeIds: string[] = [];

    for (let i = 1; i <= shotsToGenerate; i++) {
      const shotId = `shot${i}`;
      const vNodeId = `cp-video-shot-${i}`;
      videoNodeIds.push(vNodeId);
      const sceneData = story.scenes[i - 1];
      const shotY = 40 + (i - 1) * 230;

      nodes.push(
        node(vNodeId, 'i2v', 1260, shotY, {
          title: `Shot ${i}: ${sceneData?.prompt?.slice(0, 20) || `Phân cảnh ${i}`}`,
          subtitle: 'I2V Motion',
          tone: 'green',
          config: {
            model: 'Omni 1.1 Flash',
            duration: '10s',
            targetResolution: '720p',
            prompt: sceneData?.prompt || `Cinematic motion for shot ${i}`,
          },
        }),
      );

      // Nối từ output tương ứng của Splitter sang cổng 'image' (Start Frame) của Video
      edges.push(makeEdge(`e-split-to-v${i}`, 'cp-sb-split', shotId, vNodeId, 'image', W_IMAGE));
    }

    // 5. Stitch / Timeline Node (ghép toàn bộ video clip thành phim hoàn chỉnh)
    nodes.push(
      node('cp-stitch-timeline', 'videoConcat', 1700, 240, {
        title: 'Stitch / Timeline',
        subtitle: 'Video Sequencer',
        tone: 'orange',
        config: { transition: 'fade', outputName: 'Master_Film.mp4' },
      }),
    );

    // Nối các video vào Stitch Timeline
    videoNodeIds.forEach((vId, idx) => {
      edges.push(makeEdge(`e-v${idx + 1}-to-stitch`, vId, 'video', 'cp-stitch-timeline', 'video', W_VIDEO));
    });

    // 6. Master Output Video
    nodes.push(
      node('cp-master-output', 'download', 2080, 240, {
        title: 'Phim Master 40s',
        subtitle: 'Full Film Export',
        tone: 'orange',
      }),
    );
    edges.push(makeEdge('e-stitch-to-out', 'cp-stitch-timeline', 'video', 'cp-master-output', 'media', W_VIDEO));

    return {
      template: {
        id: `copilot-storyboard-${Date.now()}`,
        title: story.title,
        description: `Quy trình điện ảnh Cửu Cung 9 Ô tự động sinh bởi AI Director: ${story.title}`,
        category: 'cinematic',
        tags: ['copilot', 'storyboard-9grid', 'libtv', 'cinematic'],
        nodes,
        edges,
      },
      summary: `Đã thiết lập quy trình Cửu Cung 9 Ô (LibTV Standard): 1 Prompt Master ➔ T2I Master 9-Grid ➔ Splitter bóc tách ${shotsToGenerate} Shots ➔ I2V Motion ➔ Ghép phim Stitch Timeline.`,
    };
  }

  // =========================================================================
  // CHIẾN LƯỢC 2: PHIM NGẮN ĐA PHÂN CẢNH (MULTI-SCENE SEQUENTIAL)
  // =========================================================================
  if (story.strategy === 'MULTI_SCENE') {
    const sceneCount = story.scenes.length;
    const videoNodeIds: string[] = [];

    // Master Prompt
    nodes.push(
      node('cp-prompt-overall', 'prompt', 80, 240, {
        title: 'Cốt Truyện Tổng',
        subtitle: 'Master Script',
        tone: 'purple',
        config: { prompt: story.rawPrompt },
      }),
    );

    // Từng phân cảnh tuần tự
    story.scenes.forEach((sc, idx) => {
      const sceneNum = sc.index;
      const xBase = 460 + (sceneNum - 1) * 380;
      const yBase = 120;

      // 1. Prompt của cảnh
      const pId = `cp-sc-${sceneNum}-prompt`;
      nodes.push(
        node(pId, 'prompt', xBase, yBase, {
          title: `Prompt Cảnh ${sceneNum}`,
          subtitle: sc.title,
          tone: 'purple',
          config: { prompt: sc.prompt },
        }),
      );

      // 2. T2I của cảnh
      const t2iId = `cp-sc-${sceneNum}-t2i`;
      nodes.push(
        node(t2iId, 't2i', xBase, yBase + 180, {
          title: `T2I Cảnh ${sceneNum}`,
          subtitle: 'Keyframe Image',
          tone: 'blue',
          config: { model: '🍌 Nano Banana 2', aspectRatio: '16:9' },
        }),
      );
      edges.push(makeEdge(`e-p-t2i-${sceneNum}`, pId, 'prompt', t2iId, 'prompt', W_PROMPT));

      // 3. I2V Motion của cảnh
      const i2vId = `cp-sc-${sceneNum}-i2v`;
      videoNodeIds.push(i2vId);
      nodes.push(
        node(i2vId, 'i2v', xBase, yBase + 420, {
          title: `Video Cảnh ${sceneNum}`,
          subtitle: 'Motion Video',
          tone: 'green',
          config: { model: 'Omni 1.1 Flash', duration: '10s', prompt: sc.prompt },
        }),
      );
      edges.push(makeEdge(`e-t2i-i2v-${sceneNum}`, t2iId, 'image', i2vId, 'image', W_IMAGE));
    });

    // Stitch / Timeline ghép tất cả video
    const stitchX = 460 + sceneCount * 380;
    nodes.push(
      node('cp-stitch-timeline', 'videoConcat', stitchX, 260, {
        title: 'Stitch / Timeline',
        subtitle: 'Timeline Sequencer',
        tone: 'orange',
        config: { transition: 'fade' },
      }),
    );

    videoNodeIds.forEach((vId, idx) => {
      edges.push(makeEdge(`e-v${idx + 1}-to-concat`, vId, 'video', 'cp-stitch-timeline', 'video', W_VIDEO));
    });

    // Master Output Video
    nodes.push(
      node('cp-final-film', 'download', stitchX + 380, 260, {
        title: 'Phim Hoàn Chỉnh',
        subtitle: 'Export Film',
        tone: 'orange',
      }),
    );
    edges.push(makeEdge('e-concat-to-final', 'cp-stitch-timeline', 'video', 'cp-final-film', 'media', W_VIDEO));

    return {
      template: {
        id: `copilot-multiscene-${Date.now()}`,
        title: story.title,
        description: `Phim ngắn ${sceneCount} phân cảnh tự động thiết kế bởi AI Director`,
        category: 'cinematic',
        tags: ['copilot', 'multi-scene', 'cinematic'],
        nodes,
        edges,
      },
      summary: `Đã thiết lập phim ngắn ${sceneCount} phân cảnh tuần tự: Mỗi cảnh gồm Prompt ➔ T2I Khung Hình ➔ Video Motion ➔ Ghép nối thành Phim Hoàn Chỉnh.`,
    };
  }

  // =========================================================================
  // CHIẾN LƯỢC 3: VIDEO ĐƠN LẺ (SINGLE SHOT)
  // =========================================================================
  nodes.push(
    node('cp-single-prompt', 'prompt', 100, 200, {
      title: 'Ý Tưởng Video',
      subtitle: 'Creative Prompt',
      tone: 'purple',
      config: { prompt: story.rawPrompt },
    }),
  );

  nodes.push(
    node('cp-single-t2i', 't2i', 480, 200, {
      title: 'T2I Khung Hình Đầu',
      subtitle: 'Start Frame',
      tone: 'blue',
      config: { model: '🍌 Nano Banana 2', aspectRatio: '16:9' },
    }),
  );
  edges.push(makeEdge('e-single-p-t2i', 'cp-single-prompt', 'prompt', 'cp-single-t2i', 'prompt', W_PROMPT));

  nodes.push(
    node('cp-single-i2v', 'i2v', 860, 200, {
      title: 'I2V Tạo Video',
      subtitle: 'Video Generator',
      tone: 'green',
      config: { model: 'Omni 1.1 Flash', duration: '10s', prompt: story.rawPrompt },
    }),
  );
  edges.push(makeEdge('e-single-t2i-i2v', 'cp-single-t2i', 'image', 'cp-single-i2v', 'image', W_IMAGE));

  nodes.push(
    node('cp-single-output', 'download', 1240, 200, {
      title: 'Video Hoàn Thành',
      subtitle: 'Video Export',
      tone: 'orange',
    }),
  );
  edges.push(makeEdge('e-single-i2v-out', 'cp-single-i2v', 'video', 'cp-single-output', 'media', W_VIDEO));

  return {
    template: {
      id: `copilot-single-${Date.now()}`,
      title: story.title,
      description: `Quy trình video đơn lẻ tự động sinh bởi AI Director: ${story.title}`,
      category: 'standard',
      tags: ['copilot', 'single-video'],
      nodes,
      edges,
    },
    summary: `Đã thiết lập quy trình tạo video hoàn chỉnh: Prompt ➔ T2I Khung hình đầu ➔ I2V Sinh chuyển động ➔ Xuất Video.`,
  };
}
