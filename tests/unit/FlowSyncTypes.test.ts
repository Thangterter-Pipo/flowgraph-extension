import { describe, expect, it } from 'vitest';
import {
  isAuthoritativeFlowToStudioEvent,
  type FlowSyncEvent,
} from '../../src/shared/sync/FlowSyncTypes';

function event(overrides: Partial<FlowSyncEvent> = {}): FlowSyncEvent {
  return {
    syncId: 'flow-event',
    timestamp: '2026-09-04T00:00:00.000Z',
    source: 'GOOGLE_FLOW',
    projectId: 'project-1',
    field: 'prompt',
    value: 'prompt',
    sequence: 1,
    ...overrides,
  };
}

describe('isAuthoritativeFlowToStudioEvent', () => {
  it('accepts trusted user edits for editable configuration fields', () => {
    expect(isAuthoritativeFlowToStudioEvent(event({ userInitiated: true }))).toBe(true);
    expect(isAuthoritativeFlowToStudioEvent(event({ field: 'startImage', userInitiated: true }))).toBe(true);
  });

  it('rejects untrusted provider DOM mutations even when no Studio write is pending', () => {
    expect(isAuthoritativeFlowToStudioEvent(event({ value: '' }))).toBe(false);
    expect(isAuthoritativeFlowToStudioEvent(event({ field: 'model', value: 'Omni 1.1 Flash' }))).toBe(false);
  });

  it('accepts automatic generation lifecycle and result events', () => {
    expect(isAuthoritativeFlowToStudioEvent(event({ field: 'generationStatus', value: 'RUNNING' }))).toBe(true);
    expect(isAuthoritativeFlowToStudioEvent(event({ field: 'resultMedia', value: { mediaId: 'media-1' } }))).toBe(true);
  });

  it('rejects events that do not originate from Google Flow', () => {
    expect(isAuthoritativeFlowToStudioEvent(event({ source: 'FLOWGRAPH', userInitiated: true }))).toBe(false);
  });
});
