import React from 'react';

export interface CustomComboboxProps {
  id: string;
  activeId: string | null;
  onToggle: (id: string | null) => void;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (val: string) => void;
  icon?: React.ReactNode;
  wrapClass?: string;
  title?: string;
  label?: string;
}

export function CustomCombobox({
  id,
  activeId,
  onToggle,
  value,
  options,
  onChange,
  icon,
  wrapClass = '',
  title = '',
  label = '',
}: CustomComboboxProps) {
  const open = activeId === id;
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const dropRef = React.useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = React.useState({ top: 0, left: 0, width: 180, maxHeight: 220 });

  const place = React.useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportPad = 8;
    const gap = 6;
    const width = Math.min(
      Math.max(rect.width, 180),
      Math.max(180, window.innerWidth - viewportPad * 2),
    );
    const left = Math.min(
      Math.max(viewportPad, rect.left),
      Math.max(viewportPad, window.innerWidth - width - viewportPad),
    );
    const desiredHeight = Math.min(220, Math.max(42, options.length * 34 + 12));
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportPad);
    const spaceAbove = Math.max(0, rect.top - gap - viewportPad);
    const openBelow = spaceBelow >= Math.min(desiredHeight, 128) || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(72, Math.min(220, openBelow ? spaceBelow : spaceAbove));
    const renderedHeight = Math.min(desiredHeight, maxHeight);
    const top = openBelow
      ? rect.bottom + gap
      : Math.max(viewportPad, rect.top - gap - renderedHeight);
    const next = { top, left, width, maxHeight };
    setCoords((previous) => (
      Math.abs(previous.top - next.top) < 0.25
      && Math.abs(previous.left - next.left) < 0.25
      && Math.abs(previous.width - next.width) < 0.25
      && Math.abs(previous.maxHeight - next.maxHeight) < 0.25
        ? previous
        : next
    ));
  }, [options.length]);

  React.useLayoutEffect(() => {
    if (!open) return;
    place();
    let animationFrame = 0;
    const followAnchor = () => {
      place();
      animationFrame = window.requestAnimationFrame(followAnchor);
    };
    animationFrame = window.requestAnimationFrame(followAnchor);
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || dropRef.current?.contains(target)) return;
      onToggle(null);
    };
    const onReposition = () => place();
    document.addEventListener('mousedown', handleClickOutside, true);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    document.addEventListener('wheel', onReposition, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('mousedown', handleClickOutside, true);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      document.removeEventListener('wheel', onReposition, true);
    };
  }, [open, onToggle, place]);

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const [activeIndex, setActiveIndex] = React.useState(selectedIndex);
  const currentOption = options[selectedIndex] ?? options[0];

  React.useEffect(() => {
    if (open) setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  const commitActiveOption = () => {
    const option = options[activeIndex];
    if (!option) return;
    onChange(option.value);
    onToggle(null);
  };

  return (
    <div
      ref={wrapRef}
      className={`custom-combobox-wrap ${wrapClass} ${open ? 'is-open' : ''} nodrag nopan nowheel`}
      data-label={label || title}
      title={title}
      role="combobox"
      tabIndex={0}
      aria-label={label || title || 'Select option'}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={`${id}-listbox`}
      aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(open ? null : id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (open) {
            e.preventDefault();
            onToggle(null);
          }
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          if (!open) {
            onToggle(id);
            return;
          }
          const delta = e.key === 'ArrowDown' ? 1 : -1;
          setActiveIndex((index) => (index + delta + options.length) % Math.max(options.length, 1));
          return;
        }
        if (e.key === 'Home' && open) {
          e.preventDefault();
          setActiveIndex(0);
          return;
        }
        if (e.key === 'End' && open) {
          e.preventDefault();
          setActiveIndex(Math.max(0, options.length - 1));
          return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && open) {
          e.preventDefault();
          e.stopPropagation();
          commitActiveOption();
        }
      }}
    >
      <div className="custom-combobox-trigger">
        {icon ? <span className="custom-combobox-icon">{icon}</span> : null}
        <span className="custom-combobox-value">{currentOption?.label ?? value}</span>
        <span className="custom-combobox-arrow">▼</span>
      </div>
      {open && (
        <div
          ref={dropRef}
          id={`${id}-listbox`}
          role="listbox"
          tabIndex={-1}
          className="custom-combobox-dropdown nodrag nopan nowheel"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            maxHeight: `${coords.maxHeight}px`,
            zIndex: 9999,
          }}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <div
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={isSelected}
                className={`custom-combobox-item ${isSelected ? 'is-selected' : ''} ${isActive ? 'is-active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(option.value);
                  onToggle(null);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="custom-combobox-item-label">{option.label}</span>
                {isSelected && <span className="custom-combobox-check">✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
