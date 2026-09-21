import { RuntimeError } from '../RuntimeError';

/** MediaRecorder emits streaming WebM without Duration. Add it to Segment/Info
 * so the persisted file is seekable with finite metadata after reopening. */
export async function finalizeWebmDuration(blob: Blob, seconds: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  function element(offset: number) {
    const width = (byte: number, max: number) => {
      for (let n = 1; n <= max; n++) if (byte & (1 << (8 - n))) return n;
      throw new RuntimeError('MEDIA_FAILED', 'Invalid WebM element.');
    };
    const idWidth = width(bytes[offset], 4);
    let id = 0;
    for (let i = 0; i < idWidth; i++) id = id * 256 + bytes[offset + i];
    const sizeOffset = offset + idWidth;
    const sizeWidth = width(bytes[sizeOffset], 8);
    let size = bytes[sizeOffset] & ((1 << (8 - sizeWidth)) - 1);
    let unknown = size === (1 << (8 - sizeWidth)) - 1;
    for (let i = 1; i < sizeWidth; i++) { size = size * 256 + bytes[sizeOffset + i]; unknown = unknown && bytes[sizeOffset + i] === 255; }
    const start = sizeOffset + sizeWidth;
    const end = unknown ? bytes.length : start + size;
    if (end > bytes.length || end <= offset) throw new RuntimeError('MEDIA_FAILED', 'Truncated WebM recording.');
    return { id, sizeOffset, sizeWidth, start, end, size, unknown };
  }
  let segment: ReturnType<typeof element> | undefined;
  for (let offset = 0; offset < bytes.length;) {
    const item = element(offset);
    if (item.id === 0x18538067) { segment = item; break; }
    offset = item.end;
  }
  if (!segment) throw new RuntimeError('MEDIA_FAILED', 'WebM Segment is missing.');
  let info: ReturnType<typeof element> | undefined;
  for (let offset = segment.start; offset < segment.end;) {
    const item = element(offset);
    if (item.id === 0x1549a966) { info = item; break; }
    offset = item.end;
  }
  if (!info || info.unknown) throw new RuntimeError('MEDIA_FAILED', 'WebM Info is missing.');
  let scale = 1_000_000;
  for (let offset = info.start; offset < info.end;) {
    const item = element(offset);
    if (item.id === 0x2ad7b1) {
      scale = 0;
      for (let i = item.start; i < item.end; i++) scale = scale * 256 + bytes[i];
    }
    if (item.id === 0x4489) return blob;
    offset = item.end;
  }
  const duration = new Uint8Array(11);
  duration.set([0x44, 0x89, 0x88]);
  new DataView(duration.buffer).setFloat64(3, seconds * 1_000_000_000 / scale);
  const setSize = (item: ReturnType<typeof element>, size: number) => {
    if (size >= 2 ** (7 * item.sizeWidth) - 1) throw new RuntimeError('MEDIA_FAILED', 'WebM metadata size overflow.');
    for (let i = item.sizeWidth - 1; i >= 0; i--) { bytes[item.sizeOffset + i] = size % 256; size = Math.floor(size / 256); }
    bytes[item.sizeOffset] |= 1 << (8 - item.sizeWidth);
  };
  setSize(info, info.size + duration.length);
  if (!segment.unknown) setSize(segment, segment.size + duration.length);
  return new Blob([bytes.slice(0, info.end), duration, bytes.slice(info.end)], { type: blob.type });
}
