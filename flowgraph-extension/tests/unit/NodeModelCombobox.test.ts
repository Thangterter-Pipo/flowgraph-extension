import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { modelFamilyOptions } from '../../src/ui/studio/flowModelRegistry';

describe('node model combobox', () => {
  it('lists all three Nano Banana families for Text to Image', () => {
    const models = modelFamilyOptions('t2i', { serviceTier: 'SERVICE_TIER_INTERMEDIATE' });
    expect(models).toEqual(expect.arrayContaining([
      '🍌 Nano Banana Pro',
      '🍌 Nano Banana 2',
      '🍌 Nano Banana 2 Lite',
    ]));
    expect(models).toHaveLength(3);
  });

  it('lists canonical Omni plus Veo Lite / Fast / Quality for every compatible video node', () => {
    const expected = ['Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality'];
    for (const kind of ['t2v', 'i2v', 'interpolation'] as const) {
      const models = modelFamilyOptions(kind, { serviceTier: 'SERVICE_TIER_INTERMEDIATE' });
      expect(models).toEqual(expect.arrayContaining(expected));
      expect(models.filter((name) => /Omni/i.test(name))).toEqual(['Omni 1.1 Flash']);
      expect(models).not.toContain('Omni Flash');
      expect(models.some((name) => /lower priority/i.test(name))).toBe(false);
    }
  });

  it('keeps node-specific video model capability sets canonical', () => {
    expect(modelFamilyOptions('extend', { serviceTier: 'SERVICE_TIER_INTERMEDIATE' })).toEqual([
      'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality',
    ]);
    expect(modelFamilyOptions('reference', { serviceTier: 'SERVICE_TIER_INTERMEDIATE' })).toEqual([
      'Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast',
    ]);
  });

  it('surfaces provider-declared Lower Priority only for ADVANCED entitlement', () => {
    const intermediate = modelFamilyOptions('t2v', { serviceTier: 'SERVICE_TIER_INTERMEDIATE' });
    const advanced = modelFamilyOptions('t2v', { serviceTier: 'SERVICE_TIER_ADVANCED' });
    expect(intermediate).not.toContain('Veo 3.1 - Lite [Lower Priority]');
    expect(advanced).toContain('Veo 3.1 - Lite [Lower Priority]');
  });

  it('portals the combobox dropdown so React Flow nodes cannot clip or swallow it', () => {
    const nodeSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/WorkflowNode.tsx'), 'utf8');
    const themeSrc = readFileSync(resolve(__dirname, '../../src/ui/theme.css'), 'utf8');
    expect(nodeSrc).toMatch(/createPortal/);
    expect(nodeSrc).toMatch(/position:\s*['\"]fixed['\"]/);
    expect(themeSrc).toMatch(/\.react-flow__node[^{]*\{[^}]*overflow:\s*visible\s*!important/);
    expect(themeSrc).toMatch(/\.react-flow__node:has\(\.custom-combobox-wrap\.is-open\)/);
  });

  it('repositions an open body-portal combobox while the React Flow viewport transform changes', () => {
    const nodeSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/WorkflowNode.tsx'), 'utf8');
    expect(nodeSrc).toContain('const followAnchor = () =>');
    expect(nodeSrc).toContain('window.requestAnimationFrame(followAnchor)');
    expect(nodeSrc).toContain('window.cancelAnimationFrame(animationFrame)');
    expect(nodeSrc).toContain("document.addEventListener('mousedown', handleClickOutside, true)");
    expect(nodeSrc).toContain("document.removeEventListener('mousedown', handleClickOutside, true)");
    expect(nodeSrc).toContain('place();');
  });

  it('enforces one globally open combobox across all workflow nodes', () => {
    const nodeSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/WorkflowNode.tsx'), 'utf8');
    expect(nodeSrc).toContain("flowgraph:combobox-open");
    expect(nodeSrc).toContain('setGlobalComboboxId');
    expect(nodeSrc).toContain("nextId.startsWith(`${id}-`)");
  });
});
