/** Canvas keyboard helpers — select-all nodes instead of browser text selection. */

export function isEditableKeyTarget(target: { tagName?: string; isContentEditable?: boolean; closest?: (selector: string) => unknown } | null | undefined): boolean {
  if (!target) return false;
  if (typeof target.closest === 'function' && target.closest('input, textarea, select, [contenteditable="true"]')) {
    return true;
  }
  const tag = String(target.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target.isContentEditable);
}

export function isSelectAllShortcut(event: { key?: string; code?: string; ctrlKey?: boolean; metaKey?: boolean }): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  return event.key?.toLowerCase() === 'a' || event.code === 'KeyA';
}

export function applySelectAllNodes<T extends { selected?: boolean }>(nodes: T[]): T[] {
  return nodes.map((node) => (node.selected ? node : { ...node, selected: true }));
}
