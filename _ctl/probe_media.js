(async () => {
  // Resolve the media redirect from page context (same-origin, cookie auth) and
  // report ONLY the delivery-chain shape. The signed URL itself is reduced to its
  // host + path pattern + query KEY NAMES; signature/expiry values are dropped.
  const el = document.querySelector('video');
  if (!el) return { error: 'no video element' };
  const src = el.src || el.currentSrc;
  if (!src) return { error: 'no src' };

  const redact = (u) => {
    try {
      const p = new URL(u);
      const keys = [...p.searchParams.keys()];
      return { host: p.host, path: p.pathname.replace(/[0-9a-f-]{36}/i, '<mediaId>'), queryKeys: keys };
    } catch (e) { return { raw: 'unparseable' }; }
  };

  const out = { requested: redact(src) };

  // manual: do not follow, so we can observe the redirect target
  try {
    const r1 = await fetch(src, { credentials: 'include', redirect: 'manual' });
    out.manual = { status: r1.status, type: r1.type };
  } catch (e) { out.manual = { error: String(e).slice(0, 120) }; }

  // follow: observe the final resource without downloading the whole body
  try {
    const r2 = await fetch(src, { credentials: 'include', redirect: 'follow' });
    out.followed = {
      status: r2.status,
      finalUrl: redact(r2.url),
      contentType: r2.headers.get('content-type'),
      contentLength: r2.headers.get('content-length'),
      acceptRanges: r2.headers.get('accept-ranges'),
      contentDisposition: r2.headers.get('content-disposition') ? 'present' : 'absent'
    };
    // Read a small slice only, to prove the body is real media without keeping it.
    const buf = await r2.arrayBuffer();
    out.followed.bytes = buf.byteLength;
    const head = new Uint8Array(buf.slice(0, 12));
    out.followed.magic = Array.from(head).map(b => b.toString(16).padStart(2, '0')).join(' ');
  } catch (e) { out.followed = { error: String(e).slice(0, 160) }; }

  return out;
})()
