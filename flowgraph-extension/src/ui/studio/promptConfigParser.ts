/**
 * Bộ phân tích câu lệnh Prompt (Prompt Config Parser)
 * Tự động trích xuất các chỉ định cấu hình (Tỷ lệ khung hình, Model, Thời lượng, Độ phân giải, Batch)
 * ngay khi người dùng gõ vào prompt!
 */

export interface ParsedPromptConfig {
  aspectRatio?: string;
  duration?: string;
  resolution?: string;
  batchCount?: string;
  modelKeyword?: string;
}

export function parseConfigFromPrompt(text: string): ParsedPromptConfig {
  if (!text || typeof text !== 'string') return {};
  const t = text.toLowerCase();
  const res: ParsedPromptConfig = {};

  // 1. Aspect Ratio: 16:9, 9:16, 1:1, 4:3, 3:4, landscape, portrait, square
  if (/\b16:9\b|--ar 16:9|landscape|khung ngang|ngang/.test(t)) {
    res.aspectRatio = '16:9';
  } else if (/\b9:16\b|--ar 9:16|portrait|khung dọc|dọc|tiktok|reel|shorts/.test(t)) {
    res.aspectRatio = '9:16';
  } else if (/\b1:1\b|--ar 1:1|square|vuông/.test(t)) {
    res.aspectRatio = '1:1';
  } else if (/\b4:3\b|--ar 4:3/.test(t)) {
    res.aspectRatio = '4:3';
  } else if (/\b3:4\b|--ar 3:4/.test(t)) {
    res.aspectRatio = '3:4';
  }

  // 2. Duration: normalize to the same labels used by the model registry/UI.
  const durMatch = t.match(/\b(4|6|8|10)\s*(s|sec|seconds|giây)\b/);
  if (durMatch) {
    res.duration = `${durMatch[1]} seconds`;
  }

  // 3. Resolution: 720p, 1080p, 4K, 2K
  if (/\b4k\b|ultra hd|siêu nét/i.test(t)) {
    res.resolution = '4K';
  } else if (/\b1080p\b|full hd/i.test(t)) {
    res.resolution = '1080p';
  } else if (/\b720p\b|hd\b/i.test(t)) {
    res.resolution = '720p';
  }

  // 4. Batch Count: config stores the canonical numeric string; the UI adds "x" only for display.
  const batchMatch = t.match(/\bx([1-4])\b|tạo\s*([1-4])\s*(ảnh|video|bản)/);
  if (batchMatch) {
    const num = batchMatch[1] || batchMatch[2];
    res.batchCount = num;
  }

  // 5. Model Keywords
  if (/veo\s*3\.?1\s*-?\s*lite|veo lite/i.test(t)) {
    res.modelKeyword = 'Veo 3.1 - Lite';
  } else if (/veo\s*3\.?1\s*-?\s*fast|veo fast/i.test(t)) {
    res.modelKeyword = 'Veo 3.1 - Fast';
  } else if (/omni\s*1\.?1\s*-?\s*flash|omni flash/i.test(t)) {
    res.modelKeyword = 'Omni 1.1 Flash';
  } else if (/omni\s*1\.?1/i.test(t)) {
    res.modelKeyword = 'Omni 1.1';
  } else if (/nano banana 2|banana 2/i.test(t)) {
    res.modelKeyword = '🍌 Nano Banana 2';
  } else if (/nano banana pro|banana pro/i.test(t)) {
    res.modelKeyword = '🍌 Nano Banana Pro';
  }

  return res;
}
