import { describe, expect, it } from 'vitest';
import { RuntimeError, toRuntimeError } from '../../src/runtime/RuntimeError';

describe('RuntimeError', () => {
  it('maps provider errors to normalized codes', () => {
    expect(toRuntimeError({ code: 'AUTH_EXPIRED', message: 'Token expired', retryable: true }).code).toBe('AUTH_EXPIRED');
    expect(toRuntimeError('HTTP 500').code).toBe('PROVIDER_ERROR');
    expect(toRuntimeError(new Error('boom')).code).toBe('PROVIDER_ERROR');
  });

  it('marks retryable codes', () => {
    expect(new RuntimeError('CAPTCHA_REQUIRED', 'x').retryable).toBe(true);
    expect(new RuntimeError('TIMEOUT', 'x').retryable).toBe(true);
    expect(new RuntimeError('INVALID_INPUT', 'x').retryable).toBe(false);
    expect(new RuntimeError('MEDIA_FAILED', 'x').retryable).toBe(false);
    expect(new RuntimeError('PROJECT_ISOLATION', 'x').retryable).toBe(false);
  });

  it('generates a diagnostic id per error', () => {
    const a = new RuntimeError('CAPTCHA_REQUIRED', 'x');
    const b = new RuntimeError('CAPTCHA_REQUIRED', 'x');
    expect(a.diagnosticId).toMatch(/^fg-captcha-required-/);
    expect(a.diagnosticId).not.toBe(b.diagnosticId);
  });

  it('never leaks raw provider messages into codes', () => {
    const error = toRuntimeError({ code: 'PERMISSION_DENIED', message: 'reCAPTCHA evaluation failed' });
    expect(error.code).toBe('CAPTCHA_REQUIRED');

    const unusual = toRuntimeError({ code: 'UNKNOWN', message: 'MZZa6b failed: PUBLIC_ERROR_UNUSUAL_ACTIVITY' });
    expect(unusual.code).toBe('PROVIDER_ERROR');
  });
});
