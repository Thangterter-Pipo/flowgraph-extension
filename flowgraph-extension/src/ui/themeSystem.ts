export type ThemeMode = 'light' | 'dark';
export type ThemeFamilyId = 'modern-minimal' | 'futuristic-ai' | 'developer-pro' | 'premium-warm';
export type FlowGraphTheme = `${ThemeFamilyId}-${ThemeMode}`;

export interface ThemeDefinition {
  id: FlowGraphTheme;
  family: ThemeFamilyId;
  familyLabel: string;
  label: string;
  mode: ThemeMode;
  description: string;
  swatch: string;
}

export const THEME_SETTINGS_STORAGE_KEY = 'flowgraph.settings.v1';
export const DEFAULT_THEME: FlowGraphTheme = 'modern-minimal-dark';

export const THEME_DEFINITIONS: readonly ThemeDefinition[] = [
  {
    id: 'modern-minimal-light',
    family: 'modern-minimal',
    familyLabel: 'Modern Minimal',
    label: 'Modern Minimal — Light',
    mode: 'light',
    description: 'Clean, simple, modern, professional',
    swatch: '#2563eb',
  },
  {
    id: 'modern-minimal-dark',
    family: 'modern-minimal',
    familyLabel: 'Modern Minimal',
    label: 'Modern Minimal — Dark',
    mode: 'dark',
    description: 'Clean, simple, modern, professional',
    swatch: '#3b82f6',
  },
  {
    id: 'futuristic-ai-light',
    family: 'futuristic-ai',
    familyLabel: 'Futuristic AI',
    label: 'Futuristic AI — Light',
    mode: 'light',
    description: 'Modern, creative, AI-powered, futuristic',
    swatch: '#7c3aed',
  },
  {
    id: 'futuristic-ai-dark',
    family: 'futuristic-ai',
    familyLabel: 'Futuristic AI',
    label: 'Futuristic AI — Dark',
    mode: 'dark',
    description: 'Modern, creative, AI-powered, futuristic',
    swatch: '#8b5cf6',
  },
  {
    id: 'developer-pro-light',
    family: 'developer-pro',
    familyLabel: 'Developer Pro',
    label: 'Developer Pro — Light',
    mode: 'light',
    description: 'Focused, efficient, developer-friendly',
    swatch: '#059669',
  },
  {
    id: 'developer-pro-dark',
    family: 'developer-pro',
    familyLabel: 'Developer Pro',
    label: 'Developer Pro — Dark',
    mode: 'dark',
    description: 'Focused, efficient, developer-friendly',
    swatch: '#10b981',
  },
  {
    id: 'premium-warm-light',
    family: 'premium-warm',
    familyLabel: 'Premium Warm',
    label: 'Premium Warm — Light',
    mode: 'light',
    description: 'Warm, friendly, premium, comfortable',
    swatch: '#ea580c',
  },
  {
    id: 'premium-warm-dark',
    family: 'premium-warm',
    familyLabel: 'Premium Warm',
    label: 'Premium Warm — Dark',
    mode: 'dark',
    description: 'Warm, friendly, premium, comfortable',
    swatch: '#f97316',
  },
] as const;

const THEME_IDS = new Set<FlowGraphTheme>(THEME_DEFINITIONS.map((theme) => theme.id));

export function normalizeTheme(value: unknown): FlowGraphTheme {
  if (typeof value === 'string' && THEME_IDS.has(value as FlowGraphTheme)) {
    return value as FlowGraphTheme;
  }

  // One-way migration only. Legacy theme ids are not part of the active theme system.
  if (value === 'standard-light' || value === 'studio-light') return 'modern-minimal-light';
  if (
    value === 'standard-dark' ||
    value === 'cyber-dark' ||
    value === 'midnight-blue' ||
    value === 'oled-black' ||
    value === 'titanium-gray'
  ) {
    return 'modern-minimal-dark';
  }

  return DEFAULT_THEME;
}

export function isLightTheme(theme: unknown): boolean {
  return normalizeTheme(theme).endsWith('-light');
}

export function getThemeMode(theme: unknown): ThemeMode {
  return isLightTheme(theme) ? 'light' : 'dark';
}

export function getThemeDefinition(theme: unknown): ThemeDefinition {
  const normalized = normalizeTheme(theme);
  return THEME_DEFINITIONS.find((entry) => entry.id === normalized) ?? THEME_DEFINITIONS[1];
}

export function getPairedTheme(theme: unknown): FlowGraphTheme {
  const current = getThemeDefinition(theme);
  const targetMode: ThemeMode = current.mode === 'light' ? 'dark' : 'light';
  return THEME_DEFINITIONS.find((entry) => entry.family === current.family && entry.mode === targetMode)?.id ?? DEFAULT_THEME;
}

let themeApplyEpoch = 0;

export function applyTheme(theme: unknown): FlowGraphTheme {
  const normalized = normalizeTheme(theme);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const epoch = ++themeApplyEpoch;

    // Theme changes must be atomic. Chrome can pause CSS transitions on extension
    // pages while they are backgrounded (especially the Side Panel), otherwise a
    // surface may keep the previous family's color until the page is foregrounded.
    root.classList.add('flowgraph-theme-switching');
    root.setAttribute('data-theme', normalized);
    root.style.colorScheme = isLightTheme(normalized) ? 'light' : 'dark';

    const finishThemeSwitch = () => {
      if (epoch === themeApplyEpoch) root.classList.remove('flowgraph-theme-switching');
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(finishThemeSwitch));
    } else {
      setTimeout(finishThemeSwitch, 0);
    }
  }
  return normalized;
}

export function readStoredTheme(): FlowGraphTheme {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME;
  try {
    const raw = localStorage.getItem(THEME_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    return normalizeTheme(JSON.parse(raw)?.theme);
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyStoredTheme(): FlowGraphTheme {
  return applyTheme(readStoredTheme());
}
