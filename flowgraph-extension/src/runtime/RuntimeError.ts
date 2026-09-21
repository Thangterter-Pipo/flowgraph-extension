// Normalized runtime error model (FG-0802) — provider errors map to these codes so the
// UI can present code + message + retryable consistently, never leaking raw secrets.
import { normalizeError, type BridgeError } from '../shared/bridge';

export type RuntimeErrorCode =
  | 'AUTH_EXPIRED'
  | 'PROJECT_REQUIRED'
  | 'PROJECT_ISOLATION'
  | 'INVALID_INPUT'
  | 'INVALID_MODEL'
  | 'CREDIT_EXHAUSTED'
  | 'QUOTA_EXCEEDED'
  | 'PROVIDER_ERROR'
  | 'MEDIA_FAILED'
  | 'PREVIEW_FAILED'
  | 'CAPTCHA_REQUIRED'
  | 'USER_ACTION_REQUIRED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'NETWORK_ERROR'
  | 'UNSUPPORTED_KIND'
  | 'UNSUPPORTED_NODE';

const RETRYABLE: ReadonlySet<string> = new Set([
  'AUTH_EXPIRED',
  'CAPTCHA_REQUIRED',
  'TIMEOUT',
  'NETWORK_ERROR',
  'PROVIDER_ERROR',
]);

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly retryable: boolean;
  readonly nodeId?: string;
  readonly diagnosticId: string;

  constructor(code: RuntimeErrorCode, message: string, options: { retryable?: boolean; nodeId?: string } = {}) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
    this.nodeId = options.nodeId;
    this.diagnosticId = `fg-${code.toLowerCase().replaceAll('_', '-')}-${Math.random().toString(36).slice(2, 10)}`;
  }

  toBridgeError(): BridgeError {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

const CODE_MAP: Record<string, RuntimeErrorCode> = {
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  USER_ACTION_REQUIRED: 'USER_ACTION_REQUIRED',
  CREDIT_EXHAUSTED: 'CREDIT_EXHAUSTED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_MODEL: 'INVALID_MODEL',
  PROJECT_ISOLATION: 'PROJECT_ISOLATION',
  MEDIA_FAILED: 'MEDIA_FAILED',
  PREVIEW_FAILED: 'PREVIEW_FAILED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  PROJECT_REQUIRED: 'PROJECT_REQUIRED',
  CANCELLED: 'CANCELLED',
  UNSUPPORTED_KIND: 'UNSUPPORTED_KIND',
  UNSUPPORTED_NODE: 'UNSUPPORTED_NODE',
};

/** Map a provider/bridge error (normalized already) to a RuntimeError. */
export function toRuntimeError(error: unknown, nodeId?: string): RuntimeError {
  const normalized: BridgeError = error instanceof RuntimeError
    ? error.toBridgeError()
    : normalizeError(error);
  const combined = `${normalized.code} ${normalized.message}`;
  const code = CODE_MAP[normalized.code]
    ?? (combined.includes('reCAPTCHA') || combined.includes('UNUSUAL_ACTIVITY') ? 'CAPTCHA_REQUIRED' : 'PROVIDER_ERROR');
  return new RuntimeError(code, normalized.message, { retryable: normalized.retryable, nodeId });
}
