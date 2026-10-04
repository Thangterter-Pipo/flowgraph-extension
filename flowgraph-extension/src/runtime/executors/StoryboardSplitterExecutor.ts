import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import { asMedia, mediaValue, type RuntimeMediaRef } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';

export interface StoryboardSplitterConfig {
  gridFormat?: '3x3' | '2x2';
  cleanBorders?: boolean | string;
}

export class StoryboardSplitterExecutor implements NodeExecutor {
  readonly kind = 'storyboardSplit';

  validate(context: NodeExecutionContext): ValidationResult {
    const errors: string[] = [];
    const media = asMedia(context.inputs.image);
    if (!media && !context.config.mediaId) {
      errors.push('Storyboard 9-Grid Splitter requires an input grid image (from T2I or Image Input).');
    } else if (media && media.type !== 'IMAGE') {
      errors.push('Storyboard 9-Grid Splitter only accepts IMAGE inputs.');
    }
    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext, signal?: AbortSignal): Promise<NodeExecutorOutput> {
    if (signal?.aborted) throw new RuntimeError('CANCELLED', 'Storyboard split was cancelled.', { nodeId: context.nodeId });

    const media = asMedia(context.inputs.image) ?? {
      provider: 'GOOGLE_FLOW' as const,
      type: 'IMAGE' as const,
      mediaId: String(context.config.mediaId || 'grid-media'),
      projectId: context.context.activeProject?.projectId || 'proj',
      previewUrl: String(context.config.previewUrl || ''),
    };

    const projectId = context.context.activeProject?.projectId ?? media.projectId;
    const format = context.config.gridFormat === '2x2' ? '2x2' : '3x3';
    const clean = context.config.cleanBorders !== 'false' && context.config.cleanBorders !== false;
    const totalCount = format === '2x2' ? 4 : 9;

    let sliceUrls: string[] = [];
    if (media.previewUrl && typeof document !== 'undefined' && typeof Image !== 'undefined') {
      sliceUrls = await this.sliceInCanvas(media.previewUrl, format, clean);
    } else {
      sliceUrls = Array.from({ length: totalCount }, (_, i) => `${media.previewUrl || media.mediaId}#shot=${i + 1}`);
    }

    const outputs: Record<string, ReturnType<typeof mediaValue>> = {};
    for (let i = 0; i < totalCount; i++) {
      const shotKey = `shot${i + 1}`;
      const shotRef: RuntimeMediaRef = {
        provider: 'GOOGLE_FLOW',
        type: 'IMAGE',
        mediaId: `${media.mediaId}-shot-${i + 1}`,
        projectId,
        previewUrl: sliceUrls[i],
        fileName: `storyboard-shot-${i + 1}.jpg`,
        mimeType: 'image/jpeg',
      };
      outputs[shotKey] = mediaValue(shotRef);
    }

    return {
      outputs,
      result: {
        type: 'image',
        mediaId: `${media.mediaId}-storyboard`,
        projectId,
        previewUrl: sliceUrls[0],
        fileName: `storyboard-split-${format}.jpg`,
      },
    };
  }

  private async sliceInCanvas(url: string, format: '3x3' | '2x2', cleanBorders: boolean): Promise<string[]> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const numRows = format === '2x2' ? 2 : 3;
          const numCols = format === '2x2' ? 2 : 3;
          const cellW = img.width / numCols;
          const cellH = img.height / numRows;
          const marginX = cleanBorders ? Math.floor(cellW * 0.02) : 0;
          const marginY = cleanBorders ? Math.floor(cellH * 0.02) : 0;
          const cropW = Math.max(1, cellW - marginX * 2);
          const cropH = Math.max(1, cellH - marginY * 2);

          const results: string[] = [];
          for (let r = 0; r < numRows; r++) {
            for (let c = 0; c < numCols; c++) {
              const canvas = document.createElement('canvas');
              canvas.width = cropW;
              canvas.height = cropH;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                const sx = c * cellW + marginX;
                const sy = r * cellH + marginY;
                ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
                results.push(canvas.toDataURL('image/jpeg', 0.92));
              } else {
                results.push(`${url}#shot=${r * numCols + c + 1}`);
              }
            }
          }
          resolve(results);
        } catch {
          resolve(Array.from({ length: format === '2x2' ? 4 : 9 }, (_, i) => `${url}#shot=${i + 1}`));
        }
      };
      img.onerror = () => {
        resolve(Array.from({ length: format === '2x2' ? 4 : 9 }, (_, i) => `${url}#shot=${i + 1}`));
      };
      img.src = url;
    });
  }
}
