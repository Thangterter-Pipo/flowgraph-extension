import { describe, expect, it } from 'vitest';

import { normalizeError } from '../../src/shared/bridge';

describe('normalizeError', () => {
  it('preserves a bridge code carried by an Error instance', () => {
    const error = Object.assign(new Error('Wrong Google Flow project.'), {
      code: 'PROJECT_MISMATCH',
      retryable: true,
    });

    expect(normalizeError(error)).toEqual({
      code: 'PROJECT_MISMATCH',
      message: 'Wrong Google Flow project.',
      retryable: true,
    });
  });
});
