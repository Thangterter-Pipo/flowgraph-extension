import { describe, expect, it } from 'vitest';
import { copySelectedGraph, cutSelectedGraph, pasteGraph, FLOWGRAPH_NODES_CLIP, isCopyShortcut, isCutShortcut, isPasteShortcut } from '../../src/ui/studio/studioClipboard';
import { loadMediaLibrary, saveMediaLibrary, type RecentProjectUpload } from '../../src/ui/studio/projectMediaUploadUi';
import type { FlowNode } from '../../src/ui/studio/model';

const PROJECT = '729eaa19-1c85-4cfc-89c3-5f86de2dffc5';

function node(id: string, selected = false): FlowNode {
  return {
    id,
    type: 'flowNode',
    position: { x: 10, y: 20 },
    selected,
    data: {
      kind: 't2i',
      title: id,
      subtitle: '',
      tone: 'blue',
      status: 'idle',
      config: { model: 'Banana 2' },
      maturity: 'RUNTIME_VERIFIED',
      capabilityLabel: '',
      capabilitySummary: '',
    },
  };
}

describe('studio clipboard and media library', () => {
  it('copies only selected nodes and internal edges', () => {
    const nodes = [node('a', true), node('b', true), node('c', false)];
    const edges = [
      { id: 'ab', source: 'a', target: 'b', type: 'default' as const },
      { id: 'ac', source: 'a', target: 'c', type: 'default' as const },
    ];
    const clip = copySelectedGraph(nodes, edges);
    expect(clip?.type).toBe(FLOWGRAPH_NODES_CLIP);
    expect(clip?.nodes.map((item) => item.id)).toEqual(['a', 'b']);
    expect(clip?.edges.map((item) => item.id)).toEqual(['ab']);
  });

  it('cut removes selected graph and paste remaps ids', () => {
    const nodes = [node('a', true), node('b', false)];
    const cut = cutSelectedGraph(nodes, [{ id: 'e', source: 'a', target: 'b', type: 'default' }]);
    expect(cut?.nodes.map((item) => item.id)).toEqual(['b']);
    const pasted = pasteGraph(cut!.clipboard, 'p1', 40);
    expect(pasted?.nodes[0].id).toBe('p1-a');
    expect(pasted?.nodes[0].selected).toBe(true);
    expect(pasted?.nodes[0].position).toEqual({ x: 50, y: 60 });
  });

  it('persists media library without preview URLs and scopes by project', () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    };
    const item: RecentProjectUpload = {
      id: `${PROJECT}:m1`,
      mediaId: '65bdee87-426f-432c-8b5c-8272bb5fb9fd',
      mediaType: 'IMAGE',
      projectId: PROJECT,
      fileName: 'hero.png',
      previewUrl: 'https://signed.example/x?token=1',
    };
    saveMediaLibrary(PROJECT, [item], adapter);
    expect(JSON.parse(storage.get('flowgraph.mediaLibrary.v1') || '{}')[PROJECT][0].previewUrl).toBeUndefined();
    expect(loadMediaLibrary(PROJECT, adapter)).toHaveLength(1);
    expect(loadMediaLibrary('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', adapter)).toEqual([]);
  });

  it('detects copy/cut/paste shortcuts', () => {
    expect(isCopyShortcut({ key: 'c', ctrlKey: true })).toBe(true);
    expect(isCutShortcut({ code: 'KeyX', metaKey: true })).toBe(true);
    expect(isPasteShortcut({ key: 'v', ctrlKey: true })).toBe(true);
    expect(isCopyShortcut({ key: 'c' })).toBe(false);
  });
});
