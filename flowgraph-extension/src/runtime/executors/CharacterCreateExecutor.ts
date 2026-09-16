// CharacterCreateExecutor — turns an upstream image + prompt into a verified CHARACTER token.
import type {
  NodeExecutionContext,
  NodeExecutor,
  NodeExecutorOutput,
  ValidationResult,
} from '../../engine/execution/NodeExecutor';
import { RuntimeError } from '../RuntimeError';
import { populateCharacterDna } from '../../shared/characterDnaTemplate';
import { asText } from '../RuntimeValue';

export class CharacterCreateExecutor implements NodeExecutor {
  readonly kind = 'characterCreate';

  validate(context: NodeExecutionContext): ValidationResult {
    const image = context.inputs.image;
    const errors: string[] = [];
    if (!image && !context.config.mediaId) {
      errors.push('Character Create requires an image input or configured mediaId to define the character appearance.');
    }
    if (!context.context.activeProject.projectId) {
      errors.push('Character Create requires an active project.');
    }
    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const rawImage = context.inputs.image;
    const image = (rawImage && typeof rawImage === 'object' && 'value' in (rawImage as any))
      ? (rawImage as any).value
      : rawImage;

    const mediaId = String((image as any)?.mediaId || context.config.mediaId || '');
    if (!mediaId) {
      throw new RuntimeError('INVALID_INPUT', 'Character Create received no valid image input or mediaId.', { nodeId: context.nodeId });
    }
    const activeProjectId = context.context.activeProject.projectId;
    const mediaProjectId = (image as any)?.projectId;
    if (mediaProjectId && mediaProjectId !== activeProjectId) {
      throw new RuntimeError('PROJECT_ISOLATION', `Character Create rejected image from foreign project ${mediaProjectId} (active: ${activeProjectId})`, {
        nodeId: context.nodeId,
      });
    }

    const characterId = String(context.config.characterId || 'CHAR_001');
    const displayName = String(context.config.displayName || 'Character');
    const dnaText = asText(context.inputs.prompt) || String(context.config.dnaText || populateCharacterDna({ ...context.config, characterId, displayName }));

    // Tạo thực thể nhân vật chuẩn hóa mang đầy đủ DNA cố định
    const characterEntity = {
      characterId,
      displayName,
      dnaText,
      mediaId,
      projectId: context.context.activeProject.projectId,
    };

    const mediaRefVal = {
      mediaId,
      type: 'IMAGE' as const,
      projectId: context.context.activeProject.projectId,
      previewUrl: (image as any)?.previewUrl || '',
    };

    return {
      outputs: {
        character: {
          type: 'character',
          value: characterEntity,
        },
        image: {
          type: 'image',
          value: mediaRefVal,
        },
      },
      result: {
        type: 'image',
        mediaId,
        previewUrl: (image as any)?.previewUrl || '',
        fileName: `${characterId}_dna_card.png`,
      },
    };
  }
}
