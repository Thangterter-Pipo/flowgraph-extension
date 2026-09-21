import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { gatewayModelOptions } from '../../src/ui/studio/nodeUiContracts';
import { getPairedTheme, normalizeTheme, THEME_DEFINITIONS } from '../../src/ui/themeSystem';

const studio = resolve(__dirname, '../../src/ui/studio');
const mainSrc = readFileSync(resolve(studio, 'main.tsx'), 'utf8');
const nodeSrc = readFileSync(resolve(studio, 'WorkflowNode.tsx'), 'utf8');
const themeSrc = readFileSync(resolve(studio, '../theme.css'), 'utf8');

describe('UI consolidation P0', () => {
  it('dock has a live Media tab and no dead Favorites / Recent tabs', () => {
    expect(mainSrc).toMatch(/setActiveDockTab\('media'\)/);
    expect(mainSrc).toMatch(/title="Thư viện Media"/);
    expect(mainSrc).not.toMatch(/setActiveDockTab\('favorites'\)/);
    expect(mainSrc).not.toMatch(/setActiveDockTab\('recent'\)/);
    expect(mainSrc).not.toMatch(/title="Yêu thích \(Favorites\)"/);
    expect(mainSrc).not.toMatch(/title="Gần đây \(Recent\)"/);
  });

  it('does not import unused Share2 and does not fake ⌘K', () => {
    expect(mainSrc).not.toMatch(/\bShare2\b/);
    expect(mainSrc).not.toMatch(/search-shortcut-badge/);
    expect(mainSrc).toMatch(/metaKey[\s\S]{0,80}key === ['"]k['"]/);
  });

  it('topbar theme toggle preserves the selected family and flips Light / Dark', () => {
    expect(getPairedTheme('modern-minimal-light')).toBe('modern-minimal-dark');
    expect(getPairedTheme('futuristic-ai-dark')).toBe('futuristic-ai-light');
    expect(getPairedTheme('developer-pro-light')).toBe('developer-pro-dark');
    expect(getPairedTheme('premium-warm-dark')).toBe('premium-warm-light');
    expect(normalizeTheme('standard-light')).toBe('modern-minimal-light');
    expect(THEME_DEFINITIONS).toHaveLength(8);
    expect(mainSrc).toMatch(/getPairedTheme/);
  });

  it('does not render MiniMap', () => {
    expect(mainSrc).not.toMatch(/<MiniMap/);
    expect(mainSrc).not.toMatch(/showMinimap/);
  });

  it('port labels are not force-hidden with display:none !important', () => {
    expect(themeSrc).not.toMatch(/\.port-badge-tag\s*\{[^}]*display:\s*none\s*!important/);
  });

  it('empty media well does not use mock-car-glow', () => {
    expect(nodeSrc).not.toMatch(/mock-car-glow/);
  });

  it('Gemini model combobox reads cached gateway models', () => {
    expect(gatewayModelOptions(null).length).toBeGreaterThan(0);
    expect(gatewayModelOptions(JSON.stringify(['cx/gpt-5.6-luna', 'ag/gemini-3.8-flash-high']))).toEqual([
      { value: 'cx/gpt-5.6-luna', label: 'cx/gpt-5.6-luna' },
      { value: 'ag/gemini-3.8-flash-high', label: 'ag/gemini-3.8-flash-high' },
    ]);
    expect(nodeSrc).toMatch(/gatewayModelOptions/);
  });
});
