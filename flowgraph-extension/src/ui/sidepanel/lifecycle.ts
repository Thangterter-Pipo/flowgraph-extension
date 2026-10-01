import type { FlowStatus } from '../../shared/bridge';
import type { createSidepanelController } from './controller';
import { shouldRefreshLastRun, type FlowgraphRuntimeEventMessage } from './runtimeEventLog';
import { HISTORY_KEY, LEGACY_HISTORY_KEY } from './state';

type Controller = Pick<ReturnType<typeof createSidepanelController>,
  'refresh' | 'loadProjects' | 'flowChanged' | 'runtimeEvent' | 'dispose'>;

export function bindSidepanel(controller: Controller, history: () => void) {
  const storage = (event: StorageEvent) => {
    if (!event.key || [HISTORY_KEY, LEGACY_HISTORY_KEY].includes(event.key)) history();
  };
  const listener = (message: FlowgraphRuntimeEventMessage & { type?: string; payload?: { flow?: FlowStatus } }) => {
    if (message?.type !== 'FLOWGRAPH_EVENT') return;
    if (message.payload?.flow) {
      // URL/tab-state event resets stale projects, then immediately repopulates
      // the history from the newly detected Flow page without manual refresh.
      controller.flowChanged(message.payload.flow);
      controller.loadProjects();
      return;
    }
    controller.runtimeEvent(message);
    if (shouldRefreshLastRun(message)) { history(); void controller.refresh(); }
  };
  window.addEventListener('storage', storage);
  if (typeof chrome !== 'undefined') chrome.runtime?.onMessage?.addListener(listener);
  void controller.refresh(); void controller.loadProjects(); history();
  const timer = setInterval(() => { void controller.refresh(); history(); }, 15_000);
  return () => {
    clearInterval(timer); controller.dispose();
    window.removeEventListener('storage', storage);
    if (typeof chrome !== 'undefined') chrome.runtime?.onMessage?.removeListener(listener);
  };
}
