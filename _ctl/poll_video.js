(async () => {
  // Poll the rendered <video> until it reports real dimensions/duration,
  // mirroring the DOM-based readiness check documented in D1.
  const deadline = Date.now() + 100000;
  const probe = () => [...document.querySelectorAll('video')].map(e => ({
    hasRedirectSrc: /getMediaUrlRedirect/.test(e.src || e.currentSrc || ''),
    readyState: e.readyState,
    dur: Number.isFinite(e.duration) ? e.duration : null,
    w: e.videoWidth,
    h: e.videoHeight
  }));

  while (Date.now() < deadline) {
    const p = probe();
    if (p.length && p.some(v => v.w > 0 && v.dur)) {
      return { done: true, videos: p, bodyHasError: /Không thành công|Rất tiếc/i.test(document.body.innerText) };
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  return { done: false, videos: probe(), bodyHasError: /Không thành công|Rất tiếc/i.test(document.body.innerText) };
})()
