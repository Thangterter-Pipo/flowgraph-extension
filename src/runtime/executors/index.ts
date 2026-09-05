// Executor registry (FG-0601-0604) — maps node kind → executor instance.
// Kinds without a real executor here are REPORTED as unsupported by the validator
// (never simulated).
import type { NodeExecutor } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { PromptExecutor } from './PromptExecutor';
import { TextToImageExecutor } from './TextToImageExecutor';
import { ImageToVideoExecutor } from './ImageToVideoExecutor';
import { TextToVideoExecutor } from './TextToVideoExecutor';
import { DownloadExecutor } from './DownloadExecutor';
import { PollManager } from '../PollManager';

export const RUNTIME_SUPPORTED_KINDS: ReadonlySet<string> = new Set([
  'prompt',
  't2i',
  'i2v',
  't2v',
  'download',
]);

export function buildExecutors(adapter: GoogleFlowAdapter, poller?: PollManager): ReadonlyMap<string, NodeExecutor> {
  const executors = new Map<string, NodeExecutor>();
  for (const executor of [
    new PromptExecutor(),
    new TextToImageExecutor({ adapter }),
    new ImageToVideoExecutor({ adapter, poller }),
    new TextToVideoExecutor({ adapter, poller }),
    new DownloadExecutor({ adapter }),
  ]) {
    executors.set(executor.kind, executor);
  }
  return executors;
}

export { RUNTIME_SUPPORTED_KINDS as supportedKinds };
