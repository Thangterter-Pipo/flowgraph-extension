import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workerSource = () => readFileSync(resolve(__dirname, '../../src/background/service-worker.ts'), 'utf8');
const studioSource = () => readFileSync(resolve(__dirname, '../../src/ui/studio/main.tsx'), 'utf8');
const debugDrawerSource = () => readFileSync(resolve(__dirname, '../../src/ui/studio/DebugLogDrawer.tsx'), 'utf8');

describe('background provider focus policy', () => {
  it('never foregrounds Google Flow from automatic service-worker paths', () => {
    const source = workerSource();

    expect(source).not.toMatch(/sendCommand\([^\n]*['"]Page\.bringToFront['"]/);
    expect(source).not.toMatch(/chrome\.tabs\.update\([^\n]*\{[^\n}]*active\s*:\s*true/);
    expect(source).not.toMatch(/chrome\.windows\.update\([^\n]*\{[^\n}]*focused\s*:\s*true/);
  });

  it('keeps input reachability background-safe', () => {
    const source = workerSource();
    const helper = source
      .split('async function ensureInputReachable(')[1]
      .split('async function ensureFlowProjectComposerReady(')[0];

    expect(helper).toContain('Emulation.setFocusEmulationEnabled');
    expect(helper).not.toContain('Page.bringToFront');
    expect(helper).not.toContain('chrome.tabs.update');
    expect(helper).not.toContain('chrome.windows.update');
  });

  it('keeps project-provider navigation in a background tab', () => {
    const source = workerSource();
    expect(source).toContain('chrome.tabs.create({ url: targetUrl, active: false })');
  });

  it('records suspected focus steals while automatic provider work is active', () => {
    const source = workerSource();
    expect(source).toContain('activeProviderFocusActivities');
    expect(source).toContain('chrome.tabs.onActivated.addListener');
    expect(source).toContain("type: 'FLOWGRAPH_FOCUS_TELEMETRY'");
    expect(source).toContain("code: 'SUSPECTED_FOCUS_STEAL'");
    expect(source).toContain('withProviderFocusTelemetry(');
  });

  it('surfaces focus telemetry in Studio realtime debug logs', () => {
    const studio = studioSource();
    const drawer = debugDrawerSource();
    expect(studio).toContain("message?.type === 'FLOWGRAPH_FOCUS_TELEMETRY'");
    expect(studio).toContain("kind: 'focus:steal'");
    expect(studio).toContain("status: 'warning'");
    expect(drawer).toContain("evt.kind?.includes('focus:steal')");
    expect(drawer).toContain('realtime-event-detail');
  });
});
