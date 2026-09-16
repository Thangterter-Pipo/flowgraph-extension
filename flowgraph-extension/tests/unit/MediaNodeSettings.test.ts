import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mediaNodeSettingsRows } from '../../src/ui/studio/mediaInputUi';
import { isCacheableNodeKind } from '../../src/runtime/CacheStore';

const PROJECT = '729eaa19-1c85-4cfc-89c3-5f86de2dffc5';
const UUID = '65bdee87-426f-432c-8b5c-8272bb5fb9fd';

function values(rows: ReturnType<typeof mediaNodeSettingsRows>) {
  return rows.map((row) => `${row.label}:${row.value}`).join('|');
}

describe('media node Settings', () => {
  it('shows local/ready semantics for staged Upload Image, never provider-success', () => {
    const rows = mediaNodeSettingsRows({
      kind: 'uploadImage',
      status: 'idle',
      config: { mediaId: 'dropped-1', fileName: 'hero.png' },
      result: { mediaId: 'dropped-1', type: 'image', previewUrl: 'blob:secret', fileName: 'hero.png' },
    });
    const text = values(rows);
    expect(text).toContain('Source:Local file');
    expect(text).toContain('File:hero.png');
    expect(text).toContain('State:Ready to upload');
    expect(text).not.toContain('Existing Flow media');
    expect(text).not.toContain('blob:');
    expect(text).not.toContain('https://');
  });

  it('guides empty Upload Image without uploading from Settings', () => {
    const rows = mediaNodeSettingsRows({ kind: 'uploadImage', status: 'idle', config: {} });
    expect(values(rows)).toContain('Action:Drop image here / Browse file');
    const nodeSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/WorkflowNode.tsx'), 'utf8');
    expect(nodeSrc).toContain('mediaNodeSettingsRows');
    expect(nodeSrc).not.toMatch(/settings[\s\S]{0,200}uploadImage\(/i);
  });

  it('summarizes bound provider inputs from trusted state and never from current', () => {
    const bound = mediaNodeSettingsRows({
      kind: 'imageInput',
      status: 'idle',
      config: { mediaId: UUID, mediaType: 'IMAGE', projectId: PROJECT },
      result: { mediaId: UUID, type: 'image', previewUrl: 'https://signed.example/x?token=1', projectId: PROJECT },
    });
    const text = values(bound);
    expect(text).toContain('Source:Existing Flow media');
    expect(text).toContain('Type:IMAGE');
    expect(text).toContain(`Media:${UUID.slice(0, 8)}`);
    expect(text).toContain(`Project:${PROJECT.slice(0, 8)}`);
    expect(text).not.toContain('signed.example');
    expect(text).not.toContain('current');

    const fakeCurrent = mediaNodeSettingsRows({
      kind: 'mediaInput',
      config: { mediaId: UUID, mediaType: 'VIDEO', projectId: 'current' },
    });
    expect(values(fakeCurrent)).not.toMatch(/Project:current/);
    expect(values(fakeCurrent)).toContain('Provenance:Untrusted');
  });

  it('guides unbound provider inputs toward Choose existing Flow media', () => {
    const rows = mediaNodeSettingsRows({ kind: 'videoInput', status: 'idle', config: { mediaType: 'VIDEO' } });
    expect(values(rows)).toContain('Action:Choose existing Flow media');
    expect(values(rows)).toContain('Type:VIDEO');
  });

  it('identifies Output Preview as a run target with safe metadata', () => {
    const empty = mediaNodeSettingsRows({ kind: 'preview', status: 'idle' });
    expect(values(empty)).toContain('Role:Output Preview / Run Target');
    expect(values(empty)).toContain('State:Empty');
    expect(values(empty)).toContain('Note:Execution sink, pass-through');

    const connected = mediaNodeSettingsRows({
      kind: 'preview',
      status: 'success',
      result: { mediaId: UUID, type: 'video', previewUrl: 'https://cdn/x?sig=1', projectId: PROJECT },
    });
    const text = values(connected);
    expect(text).toContain('State:Connected');
    expect(text).toContain('Type:VIDEO');
    expect(text).toContain(`Media:${UUID.slice(0, 8)}`);
    expect(text).toContain(`Project:${PROJECT.slice(0, 8)}`);
    expect(text).not.toContain('https://');
    expect(isCacheableNodeKind('preview')).toBe(false);
  });
});
