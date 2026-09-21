import { describe, it, expect } from 'vitest';
import { nodePortCatalog, portsForKind } from '../../src/ui/studio/ports';

describe('Port notes', () => {
  it('every connectable port has a short Vietnamese note distinct from TYPE', () => {
    const kinds = Object.keys(nodePortCatalog);
    expect(kinds.length).toBeGreaterThan(10);
    for (const kind of kinds) {
      const spec = portsForKind(kind);
      for (const port of [...spec.inputs, ...spec.outputs]) {
        if (port.connectable === false) continue;
        expect(port.note, `${kind}.${port.id}`).toMatch(/\S/);
        expect(port.note.length, `${kind}.${port.id}`).toBeLessThanOrEqual(28);
        expect(port.note, `${kind}.${port.id}`).not.toMatch(/PROMPT|IMAGE|VIDEO|CHARACTER_LIST|BOOLEAN/);
        expect(port.label.length, `${kind}.${port.id} label`).toBeLessThanOrEqual(8);
      }
    }
  });
});
