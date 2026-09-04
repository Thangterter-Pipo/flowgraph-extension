// FlowGraph content script — runs inside matching labs.google/fx/* tabs.
// Responsibilities:
//  - FLOWGRAPH_PING_FLOW: report url / projectId (from /project/{uuid}/ path) / title
//  - GET_FX_SESSION: fetch labs.google/fx/api/auth/session with page cookies; relay
//    user info (non-secret) + OAuth access token to the service worker ONLY.
//  - FLOWGRAPH_GENERATE_RECAPTCHA: run the page's own reCAPTCHA Enterprise widget
//    (sitekey is Flow's — the same mechanism the real UI uses). No bypass.
//  - RESOLVE_MEDIA_URL: follow the media 307 redirect with page cookies to a
//    signed CDN URL. The signed URL is returned transiently and never persisted.
//
// Security: token/signed URLs are relayed to the service worker, never surfaced
// to the React UI, never stored in chrome.storage or written to any log.

(() => {
  const FLOW_SITEKEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

  const getProjectId = () => {
    const match = location.pathname.match(/\/project\/([0-9a-f-]{36})/i);
    return match?.[1] ?? null;
  };

  async function fetchFlowSession() {
    const response = await fetch('https://labs.google/fx/api/auth/session', { method: 'GET', credentials: 'include' });
    if (!response.ok) return { ok: false, message: `Session fetch failed: HTTP ${response.status}` };
    const data = await response.json();
    return {
      ok: true,
      token: data.access_token,
      user: { name: data.user?.name, email: data.user?.email },
      expiresAt: data.expires,
    };
  }

  async function generateRecaptcha(sitekey, action) {
    const key = sitekey || FLOW_SITEKEY;
    if (!window.grecaptcha?.enterprise?.execute) {
      return { ok: false, message: 'reCAPTCHA Enterprise widget is not ready on this page.' };
    }
    try {
      const token = await window.grecaptcha.enterprise.execute(key, { action: action || 'FLOW_GENERATE' });
      return { ok: true, token };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'reCAPTCHA execution failed' };
    }
  }

  async function resolveMediaUrl(mediaId) {
    try {
      const response = await fetch(`https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(mediaId)}`, {
        method: 'GET',
        credentials: 'include',
        redirect: 'manual',
      });
      if (!response.ok && response.status !== 301 && response.status !== 302 && response.status !== 303 && response.status !== 307 && response.status !== 308) {
        return { ok: false, message: `Media redirect failed: HTTP ${response.status}` };
      }
      // Với redirect:'manual', response.url = URL gốc; lấy location header cho signed CDN URL.
      const location = response.headers.get('location');
      if (location) return { ok: true, url: location, contentType: response.headers.get('content-type') ?? undefined };
      return { ok: true, url: response.url, contentType: response.headers.get('content-type') ?? undefined };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Media resolve failed' };
    }
  }

  // The Flow composer has a Radix model picker with two modes: Image
  // ("Nano Banana 2") for Text-to-Image and Video ("Video · …") for
  // Image-to-Video. The chip does NOT auto-switch based on the selected
  // upstream media, so we must select the correct mode per generation kind.
  async function setComposerMode(kind) {
    const VIDEO_KINDS = new Set(['i2v', 't2v', 'extend', 'interpolation', 'reference', 'upscale']);
    const wantVideo = VIDEO_KINDS.has(kind);
    const readChip = () => {
      const chip = findModelChip();
      if (!chip) return null;
      const t = (chip.innerText || '').replace(/\s+/g, ' ').trim();
      return { isVideo: t.includes('Video ·'), text: t };
    };
    const cur = readChip();
    if (!cur) return { ok: false, reason: 'no-model-chip' };
    if (cur && cur.isVideo === wantVideo) return { ok: true, text: cur.text };

    const opened = await openComposerSettings();
    if (!opened.ok) return { ok: false, reason: 'mode-menu-not-found', detail: opened.message };
    // Legacy Radix used [role=tab]; the new Angular UI exposes the mode
    // options as Material radios ([role=radio]) with text like
    // "image Hình ảnh" / "videocam Video".
    const tabs = Array.from(opened.menu.querySelectorAll('[role="tab"], [role="radio"]'));
    const tab = tabs.find((candidate) => {
      const text = normalizeSettingText(candidate.innerText).toLowerCase();
      return wantVideo ? text.includes('video') : (text.includes('hình ảnh') || text.includes('image'));
    });
    if (!tab) {
      await closeOpenMenus();
      return { ok: false, reason: 'mode-tab-not-found', tabs: tabs.map((t) => (t.innerText || '').trim().slice(0, 40)) };
    }
    clickMenuItemLike(tab);
    let after = readChip();
    for (let attempt = 0; attempt < 20 && after?.isVideo !== wantVideo; attempt += 1) {
      await syncSleep(50);
      after = readChip();
    }
    await closeOpenMenus();
    const ok = after?.isVideo === wantVideo;
    return { ok, text: (after?.text || ''), wantVideo };
  }

  async function generateViaUi(prompt, kind, startImageMediaId) {
    const editor = document.querySelector('[contenteditable="true"]');
    if (!editor) return { ok: false, message: 'Prompt editor input not found on Flow page.' };

    // Choose the right composer mode before building the prompt/generation state.
    const mode = await setComposerMode(kind);
    if (!mode.ok) {
      return { ok: false, code: 'MEDIA_FAILED', message: `Could not switch Flow composer to ${kind === 'i2v' ? 'Video' : 'Image'} mode (${mode.reason ?? 'unknown'}).` };
    }

    if (kind === 'i2v') {
      if (!startImageMediaId) return { ok: false, code: 'INVALID_INPUT', message: 'Image-to-Video requires startImageMediaId.' };
      const candidates = Array.from(document.querySelectorAll('img, video, a, [data-media-id]'));
      const matchesMediaId = (el) => {
        const values = [
          el.getAttribute?.('data-media-id'),
          el.getAttribute?.('src'),
          el.getAttribute?.('href'),
          el.currentSrc,
          el.src,
          el.href,
        ].filter(Boolean).map(String);
        return values.some((value) => value.includes(startImageMediaId));
      };
      const mediaEl = candidates.find(matchesMediaId);
      if (!mediaEl) {
        return { ok: false, code: 'MEDIA_FAILED', message: `Upstream image ${startImageMediaId} was not found in the Google Flow project UI.` };
      }
      // Bind via the tile context menu: hover -> more_vert -> "Tạo ảnh động"
      // (motion_blur). A plain tile click navigates to /edit/<assetId> which is
      // image-only, so it cannot drive I2V on the project page.
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const fire = (el) => {
        ['pointerover','pointerenter','pointermove','pointerdown','mousedown','pointerup','mouseup','click'].forEach((type) => {
          const C = type.startsWith('pointer') ? PointerEvent : MouseEvent;
          el.dispatchEvent(new C(type, { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0 }));
        });
      };
      const tile = mediaEl.closest?.('[role="button"]') || mediaEl.parentElement;
      if (!tile) {
        return { ok: false, code: 'MEDIA_FAILED', message: `Upstream image ${startImageMediaId} is not clickable in the Google Flow UI.` };
      }
      tile.scrollIntoView?.({ block: 'center', inline: 'center' });
      fire(tile);
      await sleep(400);
      fire(tile);
      await sleep(400);

      const moreBtn = Array.from((tile.closest?.('[role="button"]') ?? tile).parentElement?.querySelectorAll('button') ?? [])
        .find((b) => (b.innerText || '').includes('Khác') || (b.textContent || '').includes('more_vert'));
      if (!moreBtn) {
        return { ok: false, code: 'MEDIA_FAILED', message: `Upstream image ${startImageMediaId} tile menu button not found.` };
      }
      fire(moreBtn);
      await sleep(600);

      let motionItem = null;
      for (const menu of Array.from(document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content]'))) {
        motionItem = Array.from(menu.querySelectorAll('[role="menuitem"], button'))
          .find((it) => (it.innerText || '').includes('Tạo ảnh động') || (it.innerText || '').includes('motion_blur'));
        if (motionItem) break;
      }
      if (!motionItem) {
        return { ok: false, code: 'MEDIA_FAILED', message: `Upstream image ${startImageMediaId} "Tạo ảnh động" menu item not found.` };
      }
      fire(motionItem);
      await sleep(900);

      // Fail closed: ensure the exact upstream image is bound as the composer
      // start thumbnail before the prompt/Generate is allowed to proceed.
      const boundImgs = Array.from(document.querySelectorAll('img, video')).filter((el) => {
        const s = (el.currentSrc || el.src || el.getAttribute('src') || '').toString();
        return s.includes('getMediaUrlRedirect') && s.includes(startImageMediaId);
      }).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 700 && r.width <= 120 && r.height <= 120;
      });
      if (boundImgs.length === 0) {
        return { ok: false, code: 'MEDIA_FAILED', message: `Upstream image ${startImageMediaId} was not bound as the Flow video start image.` };
      }
    }

    // 1. Ghi nhận mediaId hiện tại trên DOM
    const getMediaIds = () => {
      const ids = new Set();
      // UI mới (flow.google.com) lưu UUID trong data-media-id và src trỏ tới
      // proxy /asb/ không chứa id, nên phải dùng mediaIdFromElement (đọc cả
      // attribute lẫn URL) thay vì chỉ parse src.
      document.querySelectorAll('img, video, a, [data-media-id]').forEach((el) => {
        const id = mediaIdFromElement(el);
        if (id) ids.add(id);
      });
      return ids;
    };
    const initialIds = getMediaIds();

    // 2. Set text vào editor
    editor.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, prompt || '');
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((r) => setTimeout(r, 600));

    // 3. Chọn chính xác nút mũi tên Generate. Không chọn nhầm nút "+ Tạo".
    const btns = Array.from(document.querySelectorAll('button'));
    const genBtn = btns.find((button) =>
      Array.from(button.querySelectorAll('i.google-symbols, .google-symbols'))
        .some((icon) => (icon.textContent || '').trim() === 'arrow_forward'),
    );

    if (!genBtn) return { ok: false, code: 'INVALID_INPUT', message: 'Generate arrow button not found on Flow page.' };
    if (genBtn.disabled || genBtn.getAttribute('aria-disabled') === 'true') {
      return { ok: false, code: 'INVALID_INPUT', message: 'Generate arrow button is disabled on Flow page.' };
    }

    genBtn.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    genBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0 }));
    genBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    genBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0 }));
    genBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
    genBtn.click();

    // 4. Poll DOM chờ mediaId mới xuất hiện
    const maxWaitMs = 120_000;
    const startMs = Date.now();
    while (Date.now() - startMs < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 3000));
      const currentIds = getMediaIds();
      for (const id of currentIds) {
        if (!initialIds.has(id)) {
          const VIDEO_KINDS = new Set(['i2v', 't2v', 'extend', 'interpolation', 'reference', 'upscale']);
          return { ok: true, mediaId: id, type: VIDEO_KINDS.has(kind) ? 'VIDEO' : 'IMAGE' };
        }
      }
    }

    return { ok: false, message: 'Timed out waiting for generated media to appear on Flow page.' };
  }

  // ---------------------------------------------------------------------------
  // Realtime Studio <-> Flow sync
  // The service worker is only a relay. This script owns safe DOM reads/writes,
  // emits normalized Flow events, and suppresses its own write echoes locally.
  // ---------------------------------------------------------------------------
  const SYNC_WRITE_TYPES = new Set([
    'FLOWGRAPH_SYNC_SET_PROMPT',
    'FLOWGRAPH_SYNC_SET_MODE',
    'FLOWGRAPH_SYNC_SET_MODEL',
    'FLOWGRAPH_SYNC_SET_ASPECT_RATIO',
    'FLOWGRAPH_SYNC_SET_DURATION',
    'FLOWGRAPH_SYNC_SET_SEED',
    'FLOWGRAPH_SYNC_SET_RESOLUTION',
    'FLOWGRAPH_SYNC_BIND_MEDIA',
    'FLOWGRAPH_SYNC_START_FRAME',
    'FLOWGRAPH_SYNC_END_FRAME',
    'FLOWGRAPH_SYNC_REFERENCE_MEDIA',
    'FLOWGRAPH_SYNC_GENERATE',
    'FLOWGRAPH_SYNC_CANCEL',
  ]);

  const syncState = {
    active: false,
    projectId: null,
    mode: null,
    model: null,
    prompt: null,
    aspectRatio: null,
    durationSeconds: null,
    targetResolution: null,
    startImage: null,
    endImage: null,
    referenceMedia: [],
    uiVerified: false,
    instanceId: crypto.randomUUID(),
    sequence: 0,
    lastEventAt: 0,
    lastEventSignature: '',
    lastAppliedPrompt: null,
  };
  const echoSuppression = new Map();
  const generationWatch = { startedAt: 0, baseline: new Set() };
  let trustedStartImageUntil = 0;
  let trustedEndImageUntil = 0;
  let trustedReferenceMediaUntil = 0;

  const syncSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const valueSignature = (value) => JSON.stringify(value ?? null);

  function suppressEcho(field, value) {
    const signature = valueSignature(value);
    echoSuppression.set(field, signature);
    setTimeout(() => {
      if (echoSuppression.get(field) === signature) echoSuppression.delete(field);
    }, 8_000);
  }

  function shouldSuppressEcho(field, value) {
    const expected = echoSuppression.get(field);
    if (expected === undefined) return false;
    if (expected !== valueSignature(value)) return false;
    echoSuppression.delete(field);
    return true;
  }

  function sendSyncNotification(type, payload) {
    try {
      chrome.runtime.sendMessage(
        { type, requestId: `content:${crypto.randomUUID()}`, payload },
        () => void chrome.runtime.lastError,
      );
    } catch {
      // Extension context can disappear during reload; the next event retries.
    }
  }

  function nextSyncEvent(field, value, userInitiated = false) {
    const signature = `${field}:${valueSignature(value)}`;
    const now = Date.now();
    if (signature === syncState.lastEventSignature && now - syncState.lastEventAt < 20) return null;
    syncState.lastEventAt = now;
    syncState.lastEventSignature = signature;
    syncState.sequence += 1;
    const originEventId = `flow-${syncState.instanceId}-${field}-${syncState.sequence}`;
    return {
      syncId: originEventId,
      timestamp: new Date(now).toISOString(),
      source: 'GOOGLE_FLOW',
      projectId: syncState.projectId,
      field,
      value,
      sequence: syncState.sequence,
      originEventId,
      sourceInstanceId: syncState.instanceId,
      userInitiated,
    };
  }

  function emitFlowChange(field, value, options = {}) {
    if (!syncState.active || !syncState.projectId) return;
    if (shouldSuppressEcho(field, value)) return;
    const event = nextSyncEvent(field, value, options.userInitiated === true);
    if (event) sendSyncNotification('FLOWGRAPH_SYNC_EVENT', event);
  }

  function emitSyncState() {
    if (!syncState.active || !syncState.projectId) return;
    const snapshot = readComposerSnapshot();
    sendSyncNotification('FLOWGRAPH_SYNC_STATE', {
      projectId: snapshot.projectId,
      mode: snapshot.mode,
      model: snapshot.model,
      prompt: snapshot.prompt,
      aspectRatio: snapshot.aspectRatio,
      durationSeconds: snapshot.durationSeconds,
      targetResolution: snapshot.targetResolution,
      startImage: snapshot.startImage,
      endImage: snapshot.endImage,
      referenceMedia: snapshot.referenceMedia,
      uiVerified: snapshot.uiVerified,
    });
  }

  function modelFromMenuItem(item) {
    const icon = item.querySelector('i.google-symbols');
    const iconText = icon ? normalizeSettingText(icon.textContent) : '';
    let text = normalizeSettingText(item.innerText);
    if (iconText && text.toLowerCase().startsWith(iconText.toLowerCase())) {
      text = text.slice(iconText.length).trim();
    }
    const buttonText = normalizeSettingText(item.querySelector('button')?.innerText);
    if (iconText && buttonText.toLowerCase().startsWith(iconText.toLowerCase())) {
      return buttonText.slice(iconText.length).trim();
    }
    return text;
  }

  function isKnownFlowModel(value) {
    return /^(Omni\b|Veo\b|Nano Banana\b)/.test(normalizeSettingText(value));
  }

  function startSettingsMenuListener() {
    // VIDEO chips intentionally omit model and sometimes duration. Capture
    // trusted menu choices at the semantic control while the menu still exists;
    // the scoped DOM observer below remains the fallback for chip-backed fields.
    document.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      const element = event.target instanceof Element
        ? event.target.closest('[role="menuitem"], [role="tab"], button')
        : null;
      const menu = element?.closest('[role="menu"][data-state="open"]');
      if (!element || !menu) return;
      // Opening a submenu is not a setting change even when the trigger text is
      // the currently selected model.
      if (element.matches('[aria-haspopup="menu"]') || element.querySelector('[aria-haspopup="menu"]')) return;

      const emitTrusted = (field, value) => {
        emitFlowChange(field, value, { userInitiated: true });
        suppressEcho(field, value);
      };

      const menuItem = element.closest('[role="menuitem"]');
      if (menuItem) {
        const model = modelFromMenuItem(menuItem);
        const modelMenu = Array.from(menu.querySelectorAll('[role="menuitem"]'));
        const isModelSubmenu = modelMenu.some((candidate) => isKnownFlowModel(modelFromMenuItem(candidate)));
        if (model && (isKnownFlowModel(model) || isModelSubmenu)) {
          // Preserve an unrecognized provider label verbatim. Studio maps known
          // registry aliases and deliberately keeps future provider labels raw
          // instead of inventing a local model key.
          emitTrusted('model', model);
          return;
        }
      }

      const text = normalizeSettingText(element.innerText);
      if (/motion_blur|Tạo ảnh động|Animate/i.test(text)) {
        trustedStartImageUntil = Date.now() + 5_000;
        return;
      }
      const aspect = text.match(/\b(\d{1,2}:\d{1,2})\b/)?.[1];
      if (aspect) {
        emitTrusted('aspectRatio', aspect);
        return;
      }
      const resolution = text.match(/\b(\d{3,4}p)\b/i)?.[1];
      if (resolution) {
        emitTrusted('targetResolution', resolution.toLowerCase());
        return;
      }
      const duration = text.match(/\b(\d+)s\b/i)?.[1];
      if (duration) {
        emitTrusted('durationSeconds', Number(duration));
        return;
      }
      if (element.getAttribute('role') === 'tab') {
        if (/(?:^|\s)(?:Hình ảnh|Image)$/i.test(text)) emitTrusted('mode', 'IMAGE');
        if (/(?:^|\s)Video$/i.test(text)) emitTrusted('mode', 'VIDEO');
      }
    }, true);
  }

  function startMediaDialogListener() {
    let pendingSlot = null;
    document.addEventListener('click', (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const removeButton = event.target.closest('button');
      if (removeButton?.querySelector('img, video, [data-media-id]')
        && [...removeButton.querySelectorAll('i.google-symbols, .google-symbols')]
          .some((icon) => normalizeSettingText(icon.textContent) === 'cancel')) {
        trustedReferenceMediaUntil = Date.now() + 5_000;
      }
      const dialogTrigger = event.target.closest('[type="button"][aria-haspopup="dialog"]');
      if (dialogTrigger) {
        const text = normalizeSettingText(dialogTrigger.textContent);
        if (/^(Kết thúc|End)$/i.test(text)) pendingSlot = 'endImage';
        if (/^(Bắt đầu|Start)$/i.test(text)) pendingSlot = 'startImage';
        if ([...dialogTrigger.querySelectorAll('i.google-symbols, .google-symbols')]
          .some((icon) => normalizeSettingText(icon.textContent) === 'add_2')) {
          pendingSlot = 'referenceMedia';
        }
        return;
      }
      const button = event.target.closest('button');
      if (!button?.closest('[role="dialog"]')) return;
      if (!/Thêm vào câu lệnh|Add to prompt/i.test(normalizeSettingText(button.innerText))) return;
      if (pendingSlot === 'endImage') trustedEndImageUntil = Date.now() + 5_000;
      if (pendingSlot === 'startImage') trustedStartImageUntil = Date.now() + 5_000;
      if (pendingSlot === 'referenceMedia') trustedReferenceMediaUntil = Date.now() + 5_000;
      pendingSlot = null;
    }, true);
  }

  function mediaIdFromElement(element) {
    const values = [
      element.getAttribute?.('data-media-id'),
      element.getAttribute?.('src'),
      element.getAttribute?.('href'),
      element.currentSrc,
      element.src,
      element.href,
    ].filter(Boolean).map(String);
    for (const value of values) {
      const match = value.match(/getMediaUrlRedirect\?name=([0-9a-f-]{36})/i)
        || value.match(/\/media\/([0-9a-f-]{36})/i)
        || value.match(/^([0-9a-f-]{36})$/i);
      if (match?.[1]) return match[1];
    }
    return null;
  }

  function readPageMedia() {
    const media = new Map();
    document.querySelectorAll('img, video, a, [data-media-id]').forEach((element) => {
      const mediaId = mediaIdFromElement(element);
      if (!mediaId || media.has(mediaId)) return;
      media.set(mediaId, element.tagName === 'VIDEO' ? 'VIDEO' : 'IMAGE');
    });
    return media;
  }

  function startGenerationLifecycleListener() {
    document.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button) return;
      const isGenerate = Array.from(button.querySelectorAll('i.google-symbols, .google-symbols'))
        .some((icon) => normalizeSettingText(icon.textContent) === 'arrow_forward');
      if (!isGenerate) return;
      generationWatch.startedAt = Date.now();
      generationWatch.baseline = new Set(readPageMedia().keys());
      emitFlowChange('generationStatus', { status: 'STARTED' });
    }, true);
  }

  function detectGenerationResult() {
    if (!generationWatch.startedAt) return;
    if (Date.now() - generationWatch.startedAt > 5 * 60 * 1000) {
      generationWatch.startedAt = 0;
      generationWatch.baseline.clear();
      emitFlowChange('generationStatus', { status: 'TIMEOUT' });
      return;
    }
    const current = readPageMedia();
    const added = [...current.entries()].filter(([mediaId]) => !generationWatch.baseline.has(mediaId));
    if (added.length !== 1) return;
    const [[mediaId, type]] = added;
    generationWatch.startedAt = 0;
    generationWatch.baseline.clear();
    emitFlowChange('resultMedia', { mediaId, type, status: 'COMPLETED' });
  }

  function findModelChip() {
    return Array.from(document.querySelectorAll('button')).find((button) => {
      const text = (button.innerText || '').replace(/\s+/g, ' ');
      // Legacy Radix UI used aria-haspopup="menu"; the new Angular Flow UI
      // (flow.google.com) renders the composer chip as a Material
      // settings-trigger-button with no aria-haspopup, so accept either.
      const isTrigger = button.getAttribute('aria-haspopup') === 'menu'
        || button.classList.contains('settings-trigger-button');
      return isTrigger && (text.includes('Video ·') || text.includes('Nano Banana'));
    });
  }

  function modeFromChip(chip) {
    if (!chip) return null;
    return (chip.innerText || '').includes('Video ·') ? 'VIDEO' : 'IMAGE';
  }

  function modelFromChip(chip) {
    if (!chip) return null;
    // The first chip text node contains the mode/model/resolution segment.
    // Descendant icon text must never be treated as model text.
    const rawText = (chip.firstChild?.nodeValue ?? chip.innerText ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!rawText) return null;
    if (/^Video\b/i.test(rawText)) {
      const parts = rawText
        .replace(/^Video\s*(?:·\s*)?/i, '')
        .split(/\s*·\s*/)
        .map((part) => part.replace(/[^A-Za-z0-9 .:+_-]/gu, ' ').replace(/\s+/g, ' ').trim());
      return parts.find((part) =>
        part
        && !/^\d{3,4}p$/i.test(part)
        && !/^\d+s$/i.test(part)
        && !/^\d+:\d+$/.test(part)
        && !/^x\d+$/i.test(part)
      ) ?? null;
    }
    let text = rawText;
    text = text.replace(/[^A-Za-z0-9 .:+_-]/gu, ' ');
    // The image-mode chip concatenates the model name with the aspect-ratio
    // icon token (e.g. "crop_16_9") and the batch-count token (e.g. "x2").
    // Those are separate settings, not part of the model label, so strip them
    // before returning. Otherwise the model short-circuit comparison in
    // writeModel never matches and every sync re-opens the (flaky) menu.
    text = text.replace(/\bcrop_\d+_\d+\b/gi, ' ');
    text = text.replace(/\bcrop_free\b/gi, ' ');
    text = text.replace(/\bx\d+\b/gi, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  function aspectRatioFromChip(chip) {
    if (!chip) return null;
    const icon = Array.from(chip.querySelectorAll('i.google-symbols, .google-symbols'))
      .map((candidate) => normalizeSettingText(candidate.textContent))
      .find((text) => /^crop_(?:\d+_\d+|free)$/i.test(text));
    if (!icon || icon.toLowerCase() === 'crop_free') return null;
    return icon.replace(/^crop_/i, '').replace('_', ':');
  }

  function durationFromChip(chip) {
    const match = normalizeSettingText(chip?.innerText).match(/\b(\d+)s\b/i);
    return match ? Number(match[1]) : null;
  }

  function resolutionFromChip(chip) {
    return normalizeSettingText(chip?.innerText).match(/\b(\d{3,4}p)\b/i)?.[1]?.toLowerCase() ?? null;
  }

  function normalizeEditorText(value) {
    return (value || '').replace(/\r\n/g, '\n').trim();
  }

  // The composer placeholder must never be treated as real prompt text.
  // Legacy Slate marked it with data-slate-placeholder; the new Angular Flow
  // UI uses a ProseMirror widget span (contenteditable="false").
  function isPlaceholderNode(node) {
    const parent = node?.parentElement;
    if (!parent) return false;
    return Boolean(
      parent.closest('[data-slate-placeholder="true"]')
      || parent.closest('.prosemirror-placeholder')
      || parent.closest('.ProseMirror-widget')
      || parent.closest('[contenteditable="false"]')
    );
  }

  function findComposerEditor() {
    return document.querySelector('div[contenteditable="true"]');
  }

  function selectComposerText(editor) {
    const selection = window.getSelection();
    if (!selection) return false;

    // Slate renders the visual placeholder inside the same editor/leaf. Select
    // from the first real text node instead of selecting the non-editable
    // placeholder; otherwise execCommand insertText can be swallowed.
    let anchorNode = null;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        isPlaceholderNode(node)
          ? NodeFilter.FILTER_REJECT
          : (node.nodeValue || '').length > 0
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP,
    });
    anchorNode = walker.nextNode();
    const range = document.createRange();
    if (anchorNode) {
      range.setStart(anchorNode, 0);
      range.setEnd(anchorNode, anchorNode.nodeValue.length);
    } else {
      // Empty editor: anchor at the first editable paragraph so insertText has
      // a live selection. ProseMirror uses <p>, Slate uses data-slate-leaf.
      const leaf = editor.querySelector('[data-slate-leaf="true"]')
        || editor.querySelector('p')
        || editor;
      range.selectNodeContents(leaf);
      range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    // Slate needs a second selectAll after anchoring inside the real leaf.
    // Calling selectAll directly from the editor includes the non-editable
    // placeholder and causes insertText to be swallowed.
    document.execCommand('selectAll', false, null);
    return selection.rangeCount > 0;
  }

  function readComposerText(editor) {
    if (!editor) return '';
    let text = '';
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        isPlaceholderNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      text += node.nodeValue || '';
    }
    return text;
  }

  function mediaBindingFromSlot(root) {
    if (!root) return null;
    const mediaIds = new Set();
    const elements = [root, ...root.querySelectorAll('img, video, [data-media-id]')];
    elements.forEach((element) => {
      const mediaId = mediaIdFromElement(element);
      if (mediaId) mediaIds.add(mediaId);
    });
    return mediaIds.size === 1 ? { mediaId: [...mediaIds][0] } : null;
  }

  function mediaSlotsFromComposer(editor) {
    if (!editor) return { startImage: null, endImage: null };
    const editorRect = editor.getBoundingClientRect();
    const swap = Array.from(document.querySelectorAll('button')).find((button) => {
      const hasSwapIcon = Array.from(button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons'))
        .some((icon) => normalizeSettingText(icon.textContent) === 'swap_horiz');
      const rect = button.getBoundingClientRect();
      return hasSwapIcon && Math.abs(rect.top - editorRect.top) < 180;
    });
    if (swap) {
      return {
        startImage: mediaBindingFromSlot(swap.previousElementSibling),
        endImage: mediaBindingFromSlot(swap.nextElementSibling),
      };
    }
    // A Components/Reference chip is also a small image near the editor. Never
    // infer Start Frame spatially; without the semantic swap control the slot is
    // ambiguous and must fail closed.
    return { startImage: null, endImage: null };
  }

  function referenceMediaFromComposer(editor) {
    if (!editor) return [];
    const editorRect = editor.getBoundingClientRect();
    const swap = Array.from(document.querySelectorAll('button')).find((button) =>
      Array.from(button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons'))
        .some((icon) => normalizeSettingText(icon.textContent) === 'swap_horiz'));
    const frameRoots = [swap?.previousElementSibling, swap?.nextElementSibling].filter(Boolean);
    const ids = Array.from(document.querySelectorAll('button'))
      .filter((button) => Array.from(button.querySelectorAll('i.google-symbols, .google-symbols'))
        .some((icon) => normalizeSettingText(icon.textContent) === 'cancel'))
      .filter((button) => !frameRoots.some((root) => root.contains(button)))
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.width <= 90 && rect.height <= 90
          && rect.bottom >= editorRect.top - 220 && rect.top <= editorRect.bottom + 80;
      })
      .map((button) => Array.from(button.querySelectorAll('img, video, [data-media-id]'))
        .map((element) => mediaIdFromElement(element)).find(Boolean))
      .filter(Boolean);
    return [...new Set(ids)].map((mediaId) => ({ mediaId }));
  }

  function readComposerSnapshot() {
    const editor = findComposerEditor();
    const chip = findModelChip();
    const projectId = getProjectId();
    const mode = modeFromChip(chip);
    const model = modelFromChip(chip);
    const prompt = normalizeEditorText(readComposerText(editor));
    const aspectRatio = aspectRatioFromChip(chip);
    const durationSeconds = durationFromChip(chip);
    const targetResolution = resolutionFromChip(chip);
    const mediaSlots = mode === 'VIDEO' ? mediaSlotsFromComposer(editor) : { startImage: null, endImage: null };
    const referenceMedia = mode === 'VIDEO' ? referenceMediaFromComposer(editor) : [];
    return {
      projectId,
      editor,
      chip,
      mode,
      model,
      prompt,
      aspectRatio,
      durationSeconds,
      targetResolution,
      startImage: mediaSlots.startImage,
      endImage: mediaSlots.endImage,
      referenceMedia,
      uiVerified: Boolean(projectId && editor && chip),
    };
  }

  async function writePrompt(value, originEventId) {
    const editor = findComposerEditor();
    if (!editor) return { ok: false, code: 'UI_NOT_READY', message: 'Flow prompt editor not found.' };
    const requested = normalizeEditorText(value || '');
    const current = normalizeEditorText(readComposerText(editor));
    if (current === requested) {
      suppressEcho('prompt', requested);
      syncState.lastAppliedPrompt = requested;
      emitSyncState();
      return { ok: true, value: requested, originEventId };
    }

    suppressEcho('prompt', requested);
    editor.focus();
    if (!selectComposerText(editor)) {
      echoSuppression.delete('prompt');
      return { ok: false, code: 'UI_NOT_READY', message: 'Flow prompt text node not found.' };
    }
    document.execCommand('insertText', false, requested);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await syncSleep(150);
    const applied = normalizeEditorText(readComposerText(editor));
    if (applied !== requested) {
      return { ok: false, code: 'UI_NOT_READY', message: 'Flow prompt editor did not commit the value.' };
    }
    syncState.lastAppliedPrompt = requested;
    emitSyncState();
    return { ok: true, value: requested, originEventId };
  }

  async function writeMode(value, originEventId) {
    if (value !== 'IMAGE' && value !== 'VIDEO') {
      return { ok: false, code: 'INVALID_VALUE', message: 'Sync mode must be IMAGE or VIDEO.' };
    }
    const current = modeFromChip(findModelChip());
    if (current === value) {
      suppressEcho('mode', value);
      syncState.mode = value;
      emitSyncState();
      return { ok: true, value, originEventId };
    }
    suppressEcho('mode', value);
    let result = null;
    let applied = current;
    for (let attempt = 0; attempt < 3 && applied !== value; attempt += 1) {
      await closeOpenMenus();
      if (attempt > 0) await syncSleep(250);
      result = await setComposerMode(value === 'VIDEO' ? 'i2v' : 't2i');
      await syncSleep(200);
      applied = modeFromChip(findModelChip());
    }
    if (!result?.ok || applied !== value) {
      return {
        ok: false,
        code: 'UI_NOT_READY',
        message: `Could not switch Flow composer to ${value}.`,
        detail: result,
        applied,
      };
    }
    syncState.mode = value;
    emitSyncState();
    return { ok: true, value, originEventId };
  }

  function normalizeSettingText(value) {
    return (value ?? '').toString().replace(/\s+/g, ' ').trim();
  }

  function findOpenMenus() {
    // Legacy Radix menus expose [role=menu][data-state=open]; the new Angular
    // Flow UI opens its composer settings inside a CDK overlay pane.
    const radix = Array.from(document.querySelectorAll('[role="menu"][data-state="open"]'));
    const cdk = Array.from(document.querySelectorAll('.cdk-overlay-pane'));
    return [...radix, ...cdk];
  }

  function clickMenuItemLike(element) {
    const fire = (type) => {
      const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      element.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0 }));
    };
    fire('pointerdown');
    fire('mousedown');
    fire('pointerup');
    fire('mouseup');
    element.click();
  }

  function findSettingsChip() {
    return Array.from(document.querySelectorAll('button')).find((button) => {
      const isTrigger = button.getAttribute('aria-haspopup') === 'menu'
        || button.classList.contains('settings-trigger-button');
      return isTrigger && /Video ·|Nano Banana/.test(normalizeSettingText(button.innerText));
    });
  }

  async function closeOpenMenus() {
    const hadOpenMenu = findOpenMenus().length > 0;
    for (let attempt = 0; attempt < 4 && findOpenMenus().length > 0; attempt += 1) {
      const deepest = findOpenMenus().at(-1);
      deepest?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true,
      }));
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true,
      }));
      await syncSleep(120);
    }
    if (findOpenMenus().length > 0) {
      const chip = findSettingsChip();
      if (chip) {
        clickMenuItemLike(chip);
        await syncSleep(250);
      }
    }
    return hadOpenMenu && findOpenMenus().length === 0;
  }

  async function openComposerSettings() {
    const chip = findSettingsChip();
    if (!chip) return { ok: false, message: 'Flow settings chip not found.' };
    const existingMenu = findOpenMenus()
      .find((menu) => /Hình ảnh|Video/.test(normalizeSettingText(menu.innerText)));
    if (existingMenu) {
      // A stale menu from a previous failed writer can make Radix treat the
      // next trigger click as "toggle close". Start from a clean state.
      clickMenuItemLike(chip);
      await syncSleep(300);
    }

    clickMenuItemLike(chip);
    // The composer settings pane is rendered by Angular CDK and can lag behind
    // the trigger click, especially right after a generation has the page busy.
    // Poll for the pane and re-click the trigger a few times before giving up,
    // instead of relying on a single fixed 500ms wait.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      for (let waited = 0; waited < 1500; waited += 150) {
        const menu = findOpenMenus()
          .find((candidate) => /Hình ảnh|Video/.test(normalizeSettingText(candidate.innerText)));
        if (menu) return { ok: true, menu };
        await syncSleep(150);
      }
      // Still closed: the previous click may have toggled it shut or been
      // swallowed while the page was busy. Re-click the trigger and retry.
      clickMenuItemLike(chip);
    }
    const menu = findOpenMenus()
      .find((candidate) => /Hình ảnh|Video/.test(normalizeSettingText(candidate.innerText)));
    return menu ? { ok: true, menu } : { ok: false, message: 'Flow settings menu did not open.' };
  }

  function findSettingsTab(menu, expected) {
    const wanted = normalizeSettingText(expected).toLowerCase();
    return Array.from(menu.querySelectorAll('[role="tab"]')).find((tab) => {
      const text = normalizeSettingText(tab.innerText).toLowerCase();
      return text === wanted || text.endsWith(` ${wanted}`) || text.includes(wanted);
    });
  }

  async function writeComposerSetting(field, value, tabText, readApplied, originEventId) {
    if (readApplied() === value) {
      suppressEcho(field, value);
      emitSyncState();
      return { ok: true, value, originEventId };
    }

    const opened = await openComposerSettings();
    if (!opened.ok) {
      return { ok: false, code: 'UI_NOT_READY', message: opened.message, originEventId };
    }
    suppressEcho(field, value);
    const tab = findSettingsTab(opened.menu, tabText);
    if (!tab) {
      echoSuppression.delete(field);
      await closeOpenMenus();
      return {
        ok: false,
        code: (() => {
          const texts = Array.from(opened.menu.querySelectorAll('[role="tab"]'))
            .map((candidate) => normalizeSettingText(candidate.innerText));
          const hasCounterpart = field === 'aspectRatio'
            ? texts.some((text) => /\b\d{1,2}:\d{1,2}\b/.test(text))
            : field === 'durationSeconds'
              ? texts.some((text) => /\b\d+s\b/i.test(text))
              : field === 'targetResolution'
                ? texts.some((text) => /\b\d{3,4}p\b/i.test(text))
                : false;
          return hasCounterpart ? 'INVALID_VALUE' : 'NO_UI_COUNTERPART';
        })(),
        message: `Flow ${field} control "${tabText}" not found.`,
        originEventId,
      };
    }
    const fire = (type) => {
      const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      tab.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0 }));
    };
    fire('pointerdown');
    fire('mousedown');
    fire('pointerup');
    fire('mouseup');
    tab.click();
    await syncSleep(300);

    const applied = readApplied();
    if (applied !== value) {
      echoSuppression.delete(field);
      await closeOpenMenus();
      return {
        ok: false,
        code: 'UI_NOT_READY',
        message: `Flow ${field} did not commit the value.`,
        originEventId,
      };
    }
    await closeOpenMenus();
    emitSyncState();
    return { ok: true, value, originEventId };
  }

  async function writeModel(value, originEventId) {
    const requested = normalizeSettingText(value);
    if (!requested) {
      return { ok: false, code: 'INVALID_VALUE', message: 'Model must be a non-empty string.', originEventId };
    }
    if (modelFromChip(findModelChip()) === requested) {
      suppressEcho('model', requested);
      emitSyncState();
      return { ok: true, value: requested, originEventId };
    }

    const opened = await openComposerSettings();
    if (!opened.ok) {
      return { ok: false, code: 'UI_NOT_READY', message: opened.message, originEventId };
    }
    const modelButton = Array.from(opened.menu.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-haspopup') === 'menu');
    if (!modelButton) {
      await closeOpenMenus();
      return { ok: false, code: 'UI_NOT_READY', message: 'Flow model submenu trigger not found.', originEventId };
    }

    const fire = (element, type) => {
      const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      element.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0 }));
    };
    fire(modelButton, 'pointerdown');
    fire(modelButton, 'mousedown');
    fire(modelButton, 'pointerup');
    fire(modelButton, 'mouseup');
    modelButton.click();
    await syncSleep(400);

    // The new Angular Flow UI renders the model submenu inside a CDK overlay
    // pane (not a Radix [role=menu]) and its options are plain buttons rather
    // than [role=menuitem]. Search every open overlay for the newest pane that
    // is not the settings pane itself, then match options by their visible text.
    const submenu = findOpenMenus()
      .filter((menu) => menu !== opened.menu)
      .pop();
    const optionText = (candidate) => normalizeSettingText(candidate.innerText)
      .replace(/arrow_drop_down/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const matchesRequested = (candidate) => {
      const text = optionText(candidate);
      return text === requested || text.endsWith(` ${requested}`);
    };
    const item = Array.from(
      submenu?.querySelectorAll('[role="menuitem"],[role="option"],button') ?? [],
    ).find(matchesRequested);
    if (!item) {
      await closeOpenMenus();
      return {
        ok: false,
        code: 'INVALID_MODEL',
        message: `Flow model "${requested}" not found.`,
        originEventId,
      };
    }
    suppressEcho('model', requested);
    const target = item.querySelector('button') || item;
    fire(target, 'pointerdown');
    fire(target, 'mousedown');
    fire(target, 'pointerup');
    fire(target, 'mouseup');
    target.click();
    await syncSleep(400);

    let applied = modelFromChip(findModelChip());
    if (applied !== requested) {
      const fromMenu = await readModelFromSettingsMenu();
      const menuModel = normalizeSettingText(fromMenu.ok ? fromMenu.model : '');
      applied = menuModel === requested || menuModel.endsWith(` ${requested}`)
        ? requested
        : menuModel || null;
    }
    if (applied !== requested) {
      return {
        ok: false,
        code: 'UI_NOT_READY',
        message: 'Flow model did not commit the value.',
        detail: { applied, readError: applied ? undefined : 'settings-menu-unavailable' },
        originEventId,
      };
    }
    emitSyncState();
    return { ok: true, value: requested, originEventId };
  }

  async function readModelFromSettingsMenu() {
    const opened = await openComposerSettings();
    if (!opened.ok) {
      return { ok: false, message: opened.message };
    }
    const trigger = Array.from(opened.menu.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-haspopup') === 'menu');
    if (!trigger) {
      await closeOpenMenus();
      return { ok: false, message: 'Flow model trigger not found.' };
    }
    const text = normalizeSettingText(trigger.innerText)
      .replace(/arrow_drop_down/gi, ' ')
      .replace(/[^A-Za-z0-9 .:+_-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    await closeOpenMenus();
    return { ok: true, model: text || null };
  }

  async function writeAspectRatio(value, originEventId) {
    const requested = normalizeSettingText(value);
    if (!/^\d{1,2}:\d{1,2}$/.test(requested)) {
      return { ok: false, code: 'INVALID_VALUE', message: 'Aspect ratio must use NN:NN format.', originEventId };
    }
    return writeComposerSetting(
      'aspectRatio',
      requested,
      requested,
      () => aspectRatioFromChip(findModelChip()),
      originEventId,
    );
  }

  async function writeDuration(value, originEventId) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return { ok: false, code: 'INVALID_VALUE', message: 'Duration must be a positive number.', originEventId };
    }
    const requested = String(value);
    return writeComposerSetting(
      'durationSeconds',
      value,
      `${requested}s`,
      () => durationFromChip(findModelChip()),
      originEventId,
    );
  }

  async function writeResolution(value, originEventId) {
    const requested = normalizeSettingText(value).toLowerCase();
    if (!/^\d{3,4}p$/.test(requested)) {
      return { ok: false, code: 'INVALID_VALUE', message: 'Resolution must use 360p/720p format.', originEventId };
    }
    return writeComposerSetting(
      'targetResolution',
      requested,
      requested,
      () => resolutionFromChip(findModelChip()),
      originEventId,
    );
  }

  function unsupportedSettingsWrite(field, value, originEventId) {
    return {
      ok: false,
      code: 'NO_UI_COUNTERPART',
      message: `The safe realtime writer for ${field} is not installed yet.`,
      field,
      value,
      originEventId,
    };
  }

  async function handleSyncWrite(message) {
    const payload = message?.payload ?? {};
    const originEventId = payload.originEventId;
    const projectId = getProjectId();
    if (!payload.projectId) {
      return { ok: false, code: 'PROJECT_REQUIRED', message: 'Sync message has no projectId.', originEventId };
    }
    if (!projectId || payload.projectId !== projectId) {
      return {
        ok: false,
        code: 'PROJECT_MISMATCH',
        message: `Flow project ${projectId ?? 'none'} does not match sync project ${payload.projectId}.`,
        originEventId,
      };
    }
    switch (message.type) {
      case 'FLOWGRAPH_SYNC_SET_PROMPT':
        return writePrompt(payload.value, originEventId);
      case 'FLOWGRAPH_SYNC_SET_MODE':
        return writeMode(payload.value, originEventId);
      case 'FLOWGRAPH_SYNC_SET_MODEL':
        return writeModel(payload.value, originEventId);
      case 'FLOWGRAPH_SYNC_SET_ASPECT_RATIO':
        return writeAspectRatio(payload.value, originEventId);
      case 'FLOWGRAPH_SYNC_SET_DURATION':
        return writeDuration(payload.value, originEventId);
      case 'FLOWGRAPH_SYNC_SET_SEED':
        return unsupportedSettingsWrite('seed', payload.value, originEventId);
      case 'FLOWGRAPH_SYNC_SET_RESOLUTION':
        return writeResolution(payload.value, originEventId);
      case 'FLOWGRAPH_SYNC_BIND_MEDIA':
      case 'FLOWGRAPH_SYNC_START_FRAME':
      case 'FLOWGRAPH_SYNC_END_FRAME':
      case 'FLOWGRAPH_SYNC_REFERENCE_MEDIA':
        return unsupportedSettingsWrite('mediaBinding', payload.value, originEventId);
      case 'FLOWGRAPH_SYNC_GENERATE':
        return generateViaUi(payload.prompt, payload.kind, payload.startImageMediaId);
      case 'FLOWGRAPH_SYNC_CANCEL':
        return { ok: false, code: 'UNSUPPORTED_MESSAGE', message: 'Flow UI cancel is not part of realtime sync yet.' };
      default:
        return { ok: false, code: 'UNSUPPORTED_MESSAGE', message: `Unsupported sync write: ${message.type}` };
    }
  }

  function startDomSyncObserver() {
    let timer = null;
    let trustedPromptTimer = null;
    let trustedPromptPending = false;
    let lastMode = syncState.mode;
    let lastModel = syncState.model;
    let lastPrompt = syncState.prompt;
    let lastAspectRatio = syncState.aspectRatio;
    let lastDurationSeconds = syncState.durationSeconds;
    let lastTargetResolution = syncState.targetResolution;
    let lastStartImage = syncState.startImage;
    let lastEndImage = syncState.endImage;
    let lastReferenceMedia = syncState.referenceMedia;

    const read = () => {
      timer = null;
      const snapshot = readComposerSnapshot();
      detectGenerationResult();
      const projectChanged = snapshot.projectId !== syncState.projectId;
      syncState.active = Boolean(snapshot.projectId);
      syncState.projectId = snapshot.projectId;
      syncState.mode = snapshot.mode;
      syncState.model = snapshot.model;
      syncState.prompt = snapshot.prompt;
      syncState.aspectRatio = snapshot.aspectRatio;
      syncState.durationSeconds = snapshot.durationSeconds;
      syncState.targetResolution = snapshot.targetResolution;
      syncState.startImage = snapshot.startImage;
      syncState.endImage = snapshot.endImage;
      syncState.referenceMedia = snapshot.referenceMedia;
      syncState.uiVerified = snapshot.uiVerified;

      const rememberSnapshot = () => {
        lastMode = snapshot.mode;
        lastModel = snapshot.model;
        lastPrompt = snapshot.prompt;
        lastAspectRatio = snapshot.aspectRatio;
        lastDurationSeconds = snapshot.durationSeconds;
        lastTargetResolution = snapshot.targetResolution;
        lastStartImage = snapshot.startImage;
        lastEndImage = snapshot.endImage;
        lastReferenceMedia = snapshot.referenceMedia;
      };
      if (projectChanged) {
        rememberSnapshot();
        emitSyncState();
        return;
      }
      if (!syncState.active || !snapshot.projectId) {
        rememberSnapshot();
        return;
      }
      if (snapshot.mode !== lastMode) emitFlowChange('mode', snapshot.mode);
      if (snapshot.model && snapshot.model !== lastModel) emitFlowChange('model', snapshot.model);
      if (snapshot.prompt !== lastPrompt && !trustedPromptPending) emitFlowChange('prompt', snapshot.prompt);
      if (snapshot.aspectRatio && snapshot.aspectRatio !== lastAspectRatio) emitFlowChange('aspectRatio', snapshot.aspectRatio);
      if (snapshot.durationSeconds && snapshot.durationSeconds !== lastDurationSeconds) emitFlowChange('durationSeconds', snapshot.durationSeconds);
      if (snapshot.targetResolution && snapshot.targetResolution !== lastTargetResolution) emitFlowChange('targetResolution', snapshot.targetResolution);
      if (snapshot.startImage && valueSignature(snapshot.startImage) !== valueSignature(lastStartImage)) {
        const userInitiated = Date.now() <= trustedStartImageUntil;
        trustedStartImageUntil = 0;
        emitFlowChange('startImage', snapshot.startImage, { userInitiated });
      }
      if (snapshot.endImage && valueSignature(snapshot.endImage) !== valueSignature(lastEndImage)) {
        const userInitiated = Date.now() <= trustedEndImageUntil;
        trustedEndImageUntil = 0;
        emitFlowChange('endImage', snapshot.endImage, { userInitiated });
      }
      if (valueSignature(snapshot.referenceMedia) !== valueSignature(lastReferenceMedia)) {
        const userInitiated = Date.now() <= trustedReferenceMediaUntil;
        trustedReferenceMediaUntil = 0;
        emitFlowChange('referenceMedia', snapshot.referenceMedia, { userInitiated });
      }
      rememberSnapshot();
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, 120);
    };

    new MutationObserver(schedule).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'aria-haspopup', 'data-state', 'data-media-id', 'src', 'href'],
    });
    const markTrustedPromptEdit = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const editor = target?.closest('[data-slate-editor="true"][contenteditable="true"], [role="textbox"][contenteditable="true"]');
      if (event.isTrusted && editor) {
        trustedPromptPending = true;
        if (trustedPromptTimer) clearTimeout(trustedPromptTimer);
        trustedPromptTimer = setTimeout(() => {
          trustedPromptTimer = null;
          const prompt = readComposerSnapshot().prompt;
          trustedPromptPending = false;
          lastPrompt = prompt;
          emitFlowChange('prompt', prompt, { userInitiated: true });
        }, 250);
      }
    };
    // Slate commits CDP/keyboard text through a trusted `beforeinput` event and
    // may not dispatch `input`. Capture both paths so a real edit remains
    // authoritative without trusting unrelated DOM mutations.
    document.addEventListener('beforeinput', markTrustedPromptEdit, true);
    document.addEventListener('input', (event) => {
      markTrustedPromptEdit(event);
      schedule();
    }, true);
    read();
  }

  function startSyncBridge() {
    const snapshot = readComposerSnapshot();
    syncState.active = Boolean(snapshot.projectId);
    syncState.projectId = snapshot.projectId;
    syncState.mode = snapshot.mode;
    syncState.model = snapshot.model;
    syncState.prompt = snapshot.prompt;
    syncState.aspectRatio = snapshot.aspectRatio;
    syncState.durationSeconds = snapshot.durationSeconds;
    syncState.targetResolution = snapshot.targetResolution;
    syncState.startImage = snapshot.startImage;
    syncState.endImage = snapshot.endImage;
    syncState.referenceMedia = snapshot.referenceMedia;
    syncState.uiVerified = snapshot.uiVerified;
    startDomSyncObserver();
    emitSyncState();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (SYNC_WRITE_TYPES.has(message?.type)) {
      void handleSyncWrite(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, message: error instanceof Error ? error.message : 'Sync write failed' }));
      return true;
    }
    switch (message?.type) {
      case 'FLOWGRAPH_SYNC_SUPPRESS_ECHO':
        if (typeof message.field === 'string') suppressEcho(message.field, message.value);
        sendResponse({ ok: true });
        return false;
      case 'FLOWGRAPH_PING_FLOW':
        sendResponse({
          ok: true,
          url: location.href,
          projectId: getProjectId(),
          title: document.title,
        });
        return true;
      case 'GET_FX_SESSION':
        void fetchFlowSession()
          .then(sendResponse)
          .catch((error) => sendResponse({ ok: false, message: error instanceof Error ? error.message : 'Session fetch failed' }));
        return true;
      case 'FLOWGRAPH_GENERATE_RECAPTCHA':
        void generateRecaptcha(message.sitekey, message.action)
          .then(sendResponse)
          .catch((error) => sendResponse({ ok: false, message: error instanceof Error ? error.message : 'reCAPTCHA failed' }));
        return true;
      case 'RESOLVE_MEDIA_URL':
        void resolveMediaUrl(message.mediaId)
          .then(sendResponse)
          .catch((error) => sendResponse({ ok: false, message: error instanceof Error ? error.message : 'Media resolve failed' }));
        return true;
      case 'FLOWGRAPH_UI_GENERATE':
        void generateViaUi(message.prompt, message.kind, message.startImageMediaId)
          .then(sendResponse)
          .catch((error) => sendResponse({ ok: false, message: error instanceof Error ? error.message : 'UI generation failed' }));
        return true;
      default:
        return false;
    }
  });

  console.debug('[FlowGraph] Google Flow bridge ready');
  startSyncBridge();
  startSettingsMenuListener();
  startMediaDialogListener();
  startGenerationLifecycleListener();
})();
