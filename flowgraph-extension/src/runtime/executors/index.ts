// Executor registry (FG-0601-0604) — maps node kind → executor instance.
// Kinds without a real executor here are REPORTED as unsupported by the validator
// (never simulated).
import type { NodeExecutor } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { PromptExecutor } from './PromptExecutor';
import { TextToImageExecutor } from './TextToImageExecutor';
import { ImageToVideoExecutor } from './ImageToVideoExecutor';
import { TextToVideoExecutor } from './TextToVideoExecutor';
import { InterpolationExecutor } from './InterpolationExecutor';
import { ReferenceVideoExecutor } from './ReferenceVideoExecutor';
import { ExtendVideoExecutor } from './ExtendVideoExecutor';
import { ImageUpscaleExecutor } from './ImageUpscaleExecutor';
import { VideoUpscaleExecutor } from './VideoUpscaleExecutor';
import { VideoConcatExecutor } from './VideoConcatExecutor';
import { MediaInputExecutor } from './MediaInputExecutor';
import { UploadImageExecutor } from './UploadImageExecutor';
import { CharacterCreateExecutor } from './CharacterCreateExecutor';
import { ImageInputExecutor } from './ImageInputExecutor';
import { VideoInputExecutor } from './VideoInputExecutor';
import { PreviewExecutor } from './PreviewExecutor';
import { DownloadExecutor } from './DownloadExecutor';
import { GeminiEnhanceExecutor } from './GeminiEnhanceExecutor';
import { GatewayGeminiAdapter } from '../../adapters/gemini/GatewayGeminiAdapter';
import { PollManager } from '../PollManager';

export const RUNTIME_SUPPORTED_KINDS: ReadonlySet<string> = new Set([
  'prompt',
  'gemini',
  't2i',
  'i2v',
  't2v',
  'interpolation',
  'reference',
  'extend',
  'imageUpscale',
  'videoUpscale',
  'videoConcat',
  'mediaInput',
  'imageInput',
  'videoInput',
  'uploadImage',
  'characterCreate',
  'preview',
  'download',
]);

export function buildExecutors(adapter: GoogleFlowAdapter, poller?: PollManager): ReadonlyMap<string, NodeExecutor> {
  const executors = new Map<string, NodeExecutor>();
  const geminiAdapter = new GatewayGeminiAdapter();
  if (typeof window !== 'undefined') {
    (window as any).__geminiAdapter = geminiAdapter;
  }
  for (const executor of [
    new PromptExecutor(),
    new GeminiEnhanceExecutor({ adapter: geminiAdapter }),
    new TextToImageExecutor({ adapter }),
    new ImageToVideoExecutor({ adapter, poller }),
    new TextToVideoExecutor({ adapter, poller }),
    new InterpolationExecutor({ adapter, poller }),
    new ReferenceVideoExecutor({ adapter, poller }),
    new ExtendVideoExecutor({ adapter, poller }),
    new ImageUpscaleExecutor({ adapter }),
    new VideoUpscaleExecutor({ adapter, poller }),
    new VideoConcatExecutor({ adapter }),
    new MediaInputExecutor(),
    new UploadImageExecutor({ adapter }),
    new CharacterCreateExecutor(),
    new ImageInputExecutor({ adapter }),
    new VideoInputExecutor(),
    new PreviewExecutor({ adapter }),
    new DownloadExecutor({ adapter }),
  ]) {
    executors.set(executor.kind, executor);
  }
  return executors;
}

export { RUNTIME_SUPPORTED_KINDS as supportedKinds };
export { VideoConcatExecutor };
export { ImageUpscaleExecutor, VideoUpscaleExecutor, MediaInputExecutor, ImageInputExecutor, VideoInputExecutor, PreviewExecutor, UploadImageExecutor, CharacterCreateExecutor, GeminiEnhanceExecutor };


