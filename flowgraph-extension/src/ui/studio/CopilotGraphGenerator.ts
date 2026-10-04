import { node, type FlowEdge, type FlowNode } from './model';
import type { WorkflowTemplate } from './workflowTemplates';
import { GatewayGeminiAdapter } from '../../adapters/gemini/GatewayGeminiAdapter';

export interface StoryScene {
  index: number;
  title: string;
  prompt: string;
  camera?: string;
}

export interface ParsedStory {
  rawPrompt: string;
  title: string;
  style: string;
  strategy: 'STORYBOARD_9GRID' | 'MULTI_SCENE' | 'SINGLE_SHOT';
  scenes: StoryScene[];
  directorNotes?: string;
  isAiGenerated?: boolean;
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
 * AI DIRECTOR THỰC THỤ:
 * Gửi prompt của người dùng sang LLM (Gemini / GPT qua Gateway/9Router)
 * để AI phân tích kịch bản, lập dàn ý các shot và quyết định kiến trúc node.
 */
export async function consultAiDirector(rawPrompt: string): Promise<ParsedStory> {
  const text = (rawPrompt || '').trim();
  if (!text) {
    return parseCopilotPromptFallback('');
  }

  const adapter = new GatewayGeminiAdapter();

  const systemPrompt = `You are an expert AI Film Director and Graph Architect for FlowGraph Studio.
The user provides a filmmaking request, script, or story in ANY format (Vietnamese or English, natural language paragraph, numbered scenes, bullet points, single-sentence idea, etc.).

Analyze the user's creative vision and return a strictly valid JSON object representing the film structure:
{
  "title": "Short evocative title (max 50 chars)",
  "strategy": "STORYBOARD_9GRID" | "MULTI_SCENE" | "SINGLE_SHOT",
  "style": "Cinematic visual style description",
  "scenes": [
    {
      "index": 1,
      "title": "Scene 1 name",
      "prompt": "Detailed cinematic prompt for this scene including character, environment, action, lighting and mood in English",
      "camera": "Camera shot and motion (e.g. Wide establishing shot, Slow push in, Low angle tracking)"
    }
  ],
  "directorNotes": "A concise explanation in Vietnamese explaining how you structured the film, visual beats, and why you chose this layout."
}

Rules for strategy:
- Use "STORYBOARD_9GRID" if user mentions 9 panels / 9-grid / Cửu cung / 3x3, or if the story requires 7-9 consistent narrative frames.
- Use "MULTI_SCENE" if the story has 2 to 6 distinct sequential scenes.
- Use "SINGLE_SHOT" if the user only describes a single short clip or single idea.
- Output ONLY the raw JSON string. Do NOT wrap in markdown code blocks like \`\`\`json ... \`\`\`. No extra text before or after.`;

  try {
    const rawResponse = await adapter.enhancePrompt(text, {
      customInstruction: systemPrompt,
    });

    // Làm sạch chuỗi JSON nếu LLM có bọc markdown
    let cleanJson = rawResponse.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }

    const parsed = JSON.parse(cleanJson);
    if (parsed && Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
      return {
        rawPrompt: text,
        title: parsed.title || 'Phim Điện Ảnh AI',
        style: parsed.style || 'Cinematic',
        strategy: ['STORYBOARD_9GRID', 'MULTI_SCENE', 'SINGLE_SHOT'].includes(parsed.strategy)
          ? parsed.strategy
          : parsed.scenes.length >= 7
          ? 'STORYBOARD_9GRID'
          : parsed.scenes.length >= 2
          ? 'MULTI_SCENE'
          : 'SINGLE_SHOT',
        scenes: parsed.scenes.map((s: any, idx: number) => ({
          index: s.index || idx + 1,
          title: s.title || `Cảnh ${idx + 1}`,
          prompt: s.prompt || text,
          camera: s.camera,
        })),
        directorNotes: parsed.directorNotes || 'AI Director đã phân tích và hoàn tất kịch bản.',
        isAiGenerated: true,
      };
    }
  } catch (err) {
    console.warn('[Copilot AI Director] LLM call failed or offline, using rule-based parser fallback:', err);
  }

  // Fallback nếu LLM offline
  return parseCopilotPromptFallback(text);
}

/**
 * Parser dự phòng (khi không có kết nối LLM hoặc chạy unit test offline)
 */
export function parseCopilotPromptFallback(raw: string): ParsedStory {
  const text = (raw || '').trim();
  if (!text) {
    return {
      rawPrompt: '',
      title: 'Phim Ngắn Mới',
      style: 'Cinematic',
      strategy: 'SINGLE_SHOT',
      scenes: [{ index: 1, title: 'Cảnh 1', prompt: 'Cinematic scene' }],
      directorNotes: 'Khởi tạo cảnh đơn lẻ mặc định.',
      isAiGenerated: false,
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
      directorNotes: `Đã phân rã ${scenes.length} phân cảnh đánh số liên hoàn.`,
      isAiGenerated: false,
    };
  }

  // 2. Tìm theo gạch đầu dòng (- / *)
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
      directorNotes: `Đã bóc tách ${scenes.length} gạch đầu dòng thành các phân cảnh tuần tự.`,
      isAiGenerated: false,
    };
  }

  // 3. Nếu có từ khóa Cửu cung / 9 ô
  if (is9GridExplicit) {
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
      directorNotes: 'Áp dụng chuẩn LibTV Cửu Cung 9 Ô khóa nhân vật và ánh sáng toàn cảnh.',
      isAiGenerated: false,
    };
  }

  // 4. Tách câu tự do nếu đoạn văn dài có nhiều câu hành động
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
      directorNotes: `Tự động phân tích các câu hành động thành ${scenes.length} phân cảnh phim.`,
      isAiGenerated: false,
    };
  }

  // Mặc định: Single shot
  return {
    rawPrompt: text,
    title: text.slice(0, 35) + (text.length > 35 ? '...' : ''),
    style: 'Cinematic',
    strategy: 'SINGLE_SHOT',
    scenes: [{ index: 1, title: 'Cảnh 1', prompt: text }],
    directorNotes: 'Thiết lập quy trình tạo video đơn lẻ chất lượng cao.',
    isAiGenerated: false,
  };
}

/**
 * Tự động sinh toàn bộ đồ thị Node và tự động nối dây (Auto-wiring)
 * dựa trên phân tích từ AI Director.
 */
export async function generateWorkflowFromPrompt(rawPrompt: string): Promise<{
  template: WorkflowTemplate;
  summary: string;
  story: ParsedStory;
}> {
  // 1. Tham vấn AI Director (LLM thật)
  const story = await consultAiDirector(rawPrompt);
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

    nodes.push(
      node('cp-prompt-master', 'prompt', 80, 180, {
        title: 'Kịch bản Cửu Cung',
        subtitle: 'Master Prompt',
        tone: 'purple',
        config: { prompt: promptMaster },
      }),
    );

    nodes.push(
      node('cp-t2i-master', 't2i', 480, 120, {
        title: 'T2I Master 9-Grid',
        subtitle: 'Image Generation',
        tone: 'blue',
        config: { model: '🍌 Nano Banana 2', aspectRatio: '16:9' },
      }),
    );
    edges.push(makeEdge('e-p-to-t2i', 'cp-prompt-master', 'prompt', 'cp-t2i-master', 'prompt', W_PROMPT));

    nodes.push(
      node('cp-sb-split', 'storyboardSplit', 880, 80, {
        title: 'Storyboard 9-Grid Splitter',
        subtitle: 'Auto Crop & Clean Borders',
        tone: 'blue',
        config: { cleanBorders: 'true', gridLayout: '3x3' },
      }),
    );
    edges.push(makeEdge('e-t2i-to-split', 'cp-t2i-master', 'image', 'cp-sb-split', 'imageIn', W_IMAGE));

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
          title: `Shot ${i}: ${sceneData?.title || `Phân cảnh ${i}`}`,
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

      edges.push(makeEdge(`e-split-to-v${i}`, 'cp-sb-split', shotId, vNodeId, 'image', W_IMAGE));
    }

    nodes.push(
      node('cp-stitch-timeline', 'videoConcat', 1700, 240, {
        title: 'Stitch / Timeline',
        subtitle: 'Video Sequencer',
        tone: 'orange',
        config: { transition: 'fade', outputName: 'Master_Film.mp4' },
      }),
    );

    videoNodeIds.forEach((vId, idx) => {
      edges.push(makeEdge(`e-v${idx + 1}-to-stitch`, vId, 'video', 'cp-stitch-timeline', 'video', W_VIDEO));
    });

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
        description: `Quy trình điện ảnh Cửu Cung 9 Ô bởi AI Director: ${story.title}`,
        category: 'cinematic',
        tags: ['copilot', 'storyboard-9grid', 'libtv', 'cinematic'],
        nodes,
        edges,
      },
      summary: `🎬 [AI Director] ${story.directorNotes || 'Đã thiết lập quy trình Cửu Cung 9 Ô'} (1 Master Prompt ➔ T2I Grid ➔ Splitter ${shotsToGenerate} Shots ➔ I2V ➔ Stitch Film).`,
      story,
    };
  }

  // =========================================================================
  // CHIẾN LƯỢC 2: PHIM NGẮN ĐA PHÂN CẢNH (MULTI-SCENE SEQUENTIAL)
  // =========================================================================
  if (story.strategy === 'MULTI_SCENE') {
    const sceneCount = story.scenes.length;
    const videoNodeIds: string[] = [];

    nodes.push(
      node('cp-prompt-overall', 'prompt', 80, 240, {
        title: 'Cốt Truyện Tổng',
        subtitle: 'Master Script',
        tone: 'purple',
        config: { prompt: story.rawPrompt },
      }),
    );

    story.scenes.forEach((sc, idx) => {
      const sceneNum = sc.index;
      const xBase = 460 + (sceneNum - 1) * 380;
      const yBase = 120;

      const pId = `cp-sc-${sceneNum}-prompt`;
      nodes.push(
        node(pId, 'prompt', xBase, yBase, {
          title: `Prompt Cảnh ${sceneNum}`,
          subtitle: sc.title,
          tone: 'purple',
          config: { prompt: sc.prompt },
        }),
      );

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
      summary: `🎬 [AI Director] ${story.directorNotes || `Đã thiết lập phim ${sceneCount} phân cảnh`} (Mỗi cảnh gồm Prompt ➔ T2I Khung Hình ➔ Video Motion ➔ Ghép nối Stitch Timeline).`,
      story,
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
    summary: `🎬 [AI Director] ${story.directorNotes || 'Đã thiết lập video đơn lẻ'} (Prompt ➔ T2I Khung hình đầu ➔ I2V Chuyển động ➔ Xuất Video).`,
    story,
  };
}
