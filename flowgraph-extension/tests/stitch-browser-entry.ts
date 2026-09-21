import { stitchInBrowser } from '../src/runtime/stitch/BrowserStitchEngine';
import { saveStitchArtifact, loadStitchArtifact, stitchArtifactUrl } from '../src/runtime/stitch/StitchArtifactStore';

Object.assign(window, {
  stitchTest: {
    stitchInBrowser,
    saveStitchArtifact,
    loadStitchArtifact,
    async audioClock() {
      // Exercise the same output-device dependency as the production graph.
      // A 'running' state alone does not prove the render clock is advancing.
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const destination = audio.createMediaStreamDestination();
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(audio.destination);
      gain.connect(destination);
      try {
        await audio.resume();
        oscillator.start();
        const start = audio.currentTime;
        const wallStart = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          state: audio.state,
          elapsed: audio.currentTime - start,
          wallElapsed: (performance.now() - wallStart) / 1000,
          sampleRate: audio.sampleRate,
          userAgent: navigator.userAgent,
        };
      } finally {
        oscillator.stop();
        oscillator.disconnect();
        gain.disconnect();
        destination.stream.getTracks().forEach((track) => track.stop());
        await audio.close();
      }
    },
    async failures() {
      const codes: string[] = [];
      for (const action of [
        () => stitchInBrowser([`${location.origin}/missing.webm`], {}),
        () => stitchInBrowser([`${location.origin}/bundle.js`], {}),
        () => loadStitchArtifact('stitch-idb:missing', 'isolated-test'),
        () => { const abort = new AbortController(); setTimeout(() => abort.abort(), 500); return stitchInBrowser([`${location.origin}/clip1.webm`, `${location.origin}/clip2.webm`], {}, abort.signal); },
      ]) {
        try { await action(); throw new Error('Unexpected success'); }
        catch (error) { const code = (error as { code?: string }).code; if (!code) throw error; codes.push(code); }
      }
      return codes;
    },
    async playable(id: string) {
      const video = document.createElement('video');
      video.src = await stitchArtifactUrl(id, 'isolated-test');
      video.muted = true;
      await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = reject; });
      const duration = video.duration;
      await video.play();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const currentTime = video.currentTime;
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (!Number.isFinite(duration) || currentTime <= 0) throw new Error('Output lacks finite duration or playback advancement');
      return { duration, currentTime };
    },
    async run(transition: string) {
      const result = await stitchInBrowser(
        [1, 2, 3, 4].map((n) => `${location.origin}/clip${n}.webm`),
        { transition },
      );
      const id = await saveStitchArtifact('isolated-test', result);
      const loaded = await loadStitchArtifact(id, 'isolated-test');
      return { id, duration: result.duration, size: loaded.blob.size, mimeType: loaded.blob.type };
    },
    async bytes(id: string) {
      const stored = await loadStitchArtifact(id, 'isolated-test');
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(';base64,')[1]);
        reader.readAsDataURL(stored.blob);
      });
    },
  },
});
