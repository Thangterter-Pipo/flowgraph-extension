import { resolveVariant, type ServiceTier } from './flowModelRegistry';

export const VIDEO_DURATION_OPTIONS = ['4 seconds', '6 seconds', '8 seconds', '10 seconds'] as const;

export const VIDEO_UPSCALE_RESOLUTIONS = ['1080p', '4K'] as const;

function formatClock(raw: number): string {
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : 0;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function formatPlayerTimestamp(currentSeconds: number, durationSeconds: number): string {
  return `${formatClock(currentSeconds)} / ${formatClock(durationSeconds)}`;
}

export function computeEstimatedCredits(kind: string, config: Record<string, string>): string {
  if (kind === 't2i') return '0';
  const variant = resolveVariant(kind, config);
  if (!variant) return 'Unavailable';
  const tier = (config.serviceTier as ServiceTier | undefined) ?? 'SERVICE_TIER_INTERMEDIATE';
  const cost = variant.creditMapping[tier];
  if (typeof cost === 'number') {
    const batch = Number.parseInt(config.batchCount || '1', 10) || 1;
    return String(cost * batch);
  }
  return 'Unavailable';
}

export function gatewayModelOptions(raw: string | null): Array<{ value: string; label: string }> {
  const fallback = [
    { value: 'cx/gpt-5.6-luna', label: 'cx/gpt-5.6-luna' },
    { value: 'ag/gemini-3.8-flash-high', label: 'ag/gemini-3.8-flash-high' },
  ];
  if (!raw) return fallback;
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return fallback;
    return list
      .map((item) => {
        const value = typeof item === 'string' ? item : String(item?.id || item?.name || '');
        return { value, label: value };
      })
      .filter((item) => item.value);
  } catch {
    return fallback;
  }
}
