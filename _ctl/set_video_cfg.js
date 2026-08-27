(() => {
  // Radix tab triggers respond to pointerdown, not a bare .click().
  // Dispatch a full trusted-like pointer sequence at the element centre.
  const fire = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, composed: true,
                   clientX: x, clientY: y, view: window };
    el.scrollIntoView({ block: 'center' });
    el.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...base, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseover', base));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
    el.focus?.();
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true, button: 0, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...base, button: 0 }));
  };

  const pick = (label) => {
    const el = [...document.querySelectorAll('button[role=tab]')]
      .find(e => e.innerText.trim() === label);
    if (!el) return 'not-found';
    if (el.getAttribute('aria-selected') === 'true') return 'already';
    fire(el);
    return 'fired';
  };

  const r4 = pick('4s');
  const r1 = pick('x1');
  const state = [...document.querySelectorAll('button[role=tab]')]
    .map(e => `${e.innerText.trim()}=${e.getAttribute('aria-selected')}`);
  return { '4s': r4, x1: r1, tabs: state };
})()
