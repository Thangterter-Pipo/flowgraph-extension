(() => {
  // Delete ONLY the project created by this run. Identified strictly by the
  // project id suffix captured at creation time; anything else is refused.
  const TARGET_SUFFIX = '63c887bb6b51';

  const link = [...document.querySelectorAll('a[href*="project"]')]
    .find(a => (a.getAttribute('href') || '').endsWith(TARGET_SUFFIX));
  if (!link) return { error: 'target project link not found' };

  // Walk up until we find a container that also holds a delete button.
  let node = link;
  let delBtn = null;
  for (let i = 0; i < 8 && node; i++) {
    node = node.parentElement;
    if (!node) break;
    const cands = [...node.querySelectorAll('button')]
      .filter(b => /Xoá dự án|Xóa dự án|delete/i.test(b.getAttribute('aria-label') || b.innerText || ''));
    // Only accept if this container holds exactly ONE project link -> no ambiguity.
    const links = [...node.querySelectorAll('a[href*="project"]')];
    if (cands.length && links.length === 1) { delBtn = cands[0]; break; }
  }
  if (!delBtn) return { error: 'delete button not uniquely resolvable for target' };

  const r = delBtn.getBoundingClientRect();
  const base = { bubbles: true, cancelable: true, composed: true, view: window,
                 clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  delBtn.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }));
  delBtn.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
  delBtn.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true, button: 0, buttons: 0 }));
  delBtn.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
  delBtn.dispatchEvent(new MouseEvent('click', { ...base, button: 0 }));

  return { clickedDeleteFor: TARGET_SUFFIX, label: (delBtn.getAttribute('aria-label') || delBtn.innerText || '').trim() };
})()
