import { RuntimeError } from '../RuntimeError';
import type { StitchArtifact } from './StitchArtifactStore';
import { finalizeWebmDuration } from './WebmDuration';

export function planStitchTimeline(durations: number[], config: Record<string, unknown>) {
  const transition = config.transition ?? 'cut';
  if (!['cut', 'crossfade', 'crossfade_1s'].includes(String(transition))) {
    throw new RuntimeError('INVALID_INPUT', 'Unsupported Stitch transition.');
  }
  const raw = String(config.transitionDuration ?? '0.5s');
  const overlap = transition === 'cut' ? 0 : transition === 'crossfade_1s' ? 1
    : /^(?:0\.5|1)(?:s)?$/.test(raw) ? Number(raw.replace(/s$/, '')) : NaN;
  if (!durations.length || !Number.isFinite(overlap) || durations.some((duration, index) =>
    !Number.isFinite(duration) || duration <= 0 || (durations.length > 1
      && duration <= overlap * (index > 0 && index < durations.length - 1 ? 2 : 1)))) {
    throw new RuntimeError('INVALID_INPUT', 'Stitch requires finite clip durations longer than their transition overlaps.');
  }
  const starts: number[] = [];
  let duration = 0;
  durations.forEach((length, index) => {
    starts.push(duration);
    duration += length - (index < durations.length - 1 ? overlap : 0);
  });
  return { starts, duration, overlap };
}

/** All asynchronous browser boundaries are bounded and cancellation-aware. */
export async function stitchWait<T>(promise: Promise<T>, signal?: AbortSignal, timeoutMs = 15_000): Promise<T> {
  if (signal?.aborted) throw new RuntimeError('CANCELLED', 'Stitch was cancelled.');
  return new Promise<T>((resolve, reject) => {
    const finish = (error?: unknown, value?: T) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value as T);
    };
    const abort = () => finish(new RuntimeError('CANCELLED', 'Stitch was cancelled.'));
    const timer = setTimeout(() => finish(new RuntimeError('TIMEOUT', 'Stitch media operation timed out.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    promise.then((value) => finish(undefined, value), (error) => finish(error));
  });
}

function mediaReady(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  return stitchWait(new Promise<void>((resolve, reject) => {
    // Gắn vào DOM ẩn để trình duyệt ưu tiên nạp và kích hoạt loadeddata cho media decoder
    video.style.position = 'fixed';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.style.width = '16px';
    video.style.height = '16px';
    if (!video.isConnected && document.body) {
      document.body.appendChild(video);
    }
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new RuntimeError('MEDIA_FAILED', 'Stitch source could not be decoded.'));
    video.load();
  }), signal);
}

/** Real-time native compositor. Never substitutes frames or silently drops audio.
 * Requires an active document; background throttling fails rather than truncating.
 * Sources are fetched as same-origin Blobs before decoding: this prevents Web Audio
 * from silently replacing cross-origin audio with silence.
 */
export async function stitchInBrowser(sources: string[], config: Record<string, unknown>, signal?: AbortSignal): Promise<StitchArtifact> {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined') {
    throw new RuntimeError('MEDIA_FAILED', 'Stitch requires browser media and audio APIs.');
  }
  if (!sources.length || sources.some((source) => !source)) throw new RuntimeError('INVALID_INPUT', 'Stitch requires resolved video sources.');
  const fps = Number(config.fps ?? 30);
  if (![24, 25, 30, 60].includes(fps)) throw new RuntimeError('INVALID_INPUT', 'Unsupported Stitch frame rate.');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const operationSignal = controller.signal;
  const videos: HTMLVideoElement[] = [];
  const urls: string[] = [];
  const nodes: AudioNode[] = [];
  const streams: MediaStream[] = [];
  let audio: AudioContext | undefined;
  let recorder: MediaRecorder | undefined;
  let frame = 0;
  try {
    for (const source of sources) {
      const response = await stitchWait(fetch(source, { signal: operationSignal }), operationSignal);
      if (!response.ok) throw new RuntimeError('MEDIA_FAILED', 'Stitch source fetch failed.');
      const blob = await stitchWait(response.blob(), operationSignal);
      if (!blob.size) throw new RuntimeError('MEDIA_FAILED', 'Stitch source is empty.');
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const video = document.createElement('video');
      videos.push(video);
      video.preload = 'auto';
      video.playsInline = true;
      video.src = url;
      await mediaReady(video, operationSignal);
      if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) {
        throw new RuntimeError('MEDIA_FAILED', 'Stitch requires a decoded video with finite duration.');
      }
    }
    const timeline = planStitchTimeline(videos.map((video) => video.duration), config);
    const canvas = document.createElement('canvas');
    canvas.width = videos[0].videoWidth;
    canvas.height = videos[0].videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.captureStream) throw new RuntimeError('MEDIA_FAILED', 'Stitch canvas capture is unavailable.');
    audio = new AudioContext();
    await stitchWait(audio.resume(), operationSignal);
    if (audio.state !== 'running') throw new RuntimeError('USER_ACTION_REQUIRED', 'Activate the Stitch tab to enable audio.');
    const destination = audio.createMediaStreamDestination();
    const silentMonitor = audio.createGain();
    silentMonitor.gain.value = 0;
    silentMonitor.connect(audio.destination);
    nodes.push(silentMonitor);
    const gains = videos.map((video) => {
      const source = audio!.createMediaElementSource(video);
      const gain = audio!.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(destination);
      gain.connect(silentMonitor);
      nodes.push(source, gain);
      return gain;
    });
    const stream = canvas.captureStream(fps);
    streams.push(stream, destination.stream);
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'].find((mime) => MediaRecorder.isTypeSupported(mime));
    if (!mimeType || !stream.getVideoTracks().length || !stream.getAudioTracks().length) {
      throw new RuntimeError('MEDIA_FAILED', 'Stitch requires WebM video and Opus audio recording.');
    }
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
    const chunks: Blob[] = [];
    let recordingError = false;
    let recordingStopped = false;
    const recorded = new Promise<Blob>((resolve) => {
      recorder!.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder!.onerror = () => { recordingError = true; };
      recorder!.onstop = () => { recordingStopped = true; resolve(new Blob(chunks, { type: mimeType })); };
    });
    const draw = (video: HTMLVideoElement, alpha: number) => {
      const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      ctx.globalAlpha = alpha;
      ctx.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    };
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    draw(videos[0], 1);
    // Throw on tainted canvas before recording anything.
    ctx.getImageData(0, 0, 1, 1);
    const started = new Set<number>([0]);
    gains[0].gain.value = 1;
    // Cho video[0] thực sự bắt đầu phát frame đầu tiên trước khi chốt mốc epoch
    await stitchWait(videos[0].play(), operationSignal);
    await new Promise<void>((resolve) => {
      const checkFirstFrame = () => {
        if (videos[0].currentTime > 0.01 || operationSignal.aborted) resolve();
        else requestAnimationFrame(checkFirstFrame);
      };
      checkFirstFrame();
    });

    const epoch = performance.now() - videos[0].currentTime * 1000;
    recorder.start(250);
    let lastTick = performance.now();
    await stitchWait(new Promise<void>((resolve, reject) => {
      const tick = async () => {
        try {
          if (operationSignal.aborted) throw new RuntimeError('CANCELLED', 'Stitch was cancelled.');
          const now = performance.now();
          if (document.hidden || now - lastTick > 300 || audio!.state !== 'running') {
            throw new RuntimeError('MEDIA_FAILED', 'Stitch was throttled or audio suspended; keep the tab active and retry.');
          }
          if (recordingError || recordingStopped) throw new RuntimeError('MEDIA_FAILED', 'Stitch recorder stopped unexpectedly.');
          lastTick = now;
          const time = (now - epoch) / 1000;
          for (let i = 0; i < videos.length; i++) {
            if (time >= timeline.starts[i] && !started.has(i)) {
              started.add(i);
              await stitchWait(videos[i].play(), operationSignal, 2_000);
            }
          }
          ctx.globalAlpha = 1;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          let activeCount = 0;
          videos.forEach((video, i) => {
            const localTime = time - timeline.starts[i];
            const active = localTime >= 0 && localTime < video.duration;
            if (!active) { gains[i].gain.value = 0; if (localTime >= video.duration) video.pause(); return; }
            if (video.error || video.readyState < 2 || Math.abs(video.currentTime - localTime) > 0.25) {
              throw new RuntimeError('MEDIA_FAILED', `Stitch source ${i + 1} stalled or drifted (expected ${localTime.toFixed(3)}s, decoded ${video.currentTime.toFixed(3)}s, ready ${video.readyState}, audio ${audio!.currentTime.toFixed(3)}s, paused ${video.paused}).`);
            }
            const fadeIn = i > 0 && timeline.overlap ? Math.min(1, localTime / timeline.overlap) : 1;
            const fadeOut = i < videos.length - 1 && timeline.overlap ? Math.min(1, (video.duration - localTime) / timeline.overlap) : 1;
            gains[i].gain.setValueAtTime(Math.max(0, Math.min(fadeIn, fadeOut)), audio!.currentTime);
            draw(video, activeCount++ === 0 ? 1 : fadeIn);
          });
          if (time >= timeline.duration) {
            if (videos.some((video) => video.currentTime < video.duration - 0.25)) throw new RuntimeError('MEDIA_FAILED', 'Stitch did not reach every clip ending.');
            resolve();
          } else frame = requestAnimationFrame(() => { void tick(); });
        } catch (error) { reject(error); }
      };
      frame = requestAnimationFrame(() => { void tick(); });
    }), operationSignal, timeline.duration * 1000 + 10_000);
    recorder.stop();
    const blob = await stitchWait(finalizeWebmDuration(await stitchWait(recorded, operationSignal), timeline.duration), operationSignal);
    if (recordingError || !blob.size) throw new RuntimeError('MEDIA_FAILED', 'Stitch produced no valid recording.');
    return { blob, duration: timeline.duration, width: canvas.width, height: canvas.height };
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError('MEDIA_FAILED', 'Stitch failed to fetch, decode or record its sources.');
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', cancel);
    cancelAnimationFrame(frame);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    videos.forEach((video) => { video.pause(); video.removeAttribute('src'); video.load(); });
    nodes.forEach((node) => node.disconnect());
    streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    if (audio && audio.state !== 'closed') await audio.close();
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}
