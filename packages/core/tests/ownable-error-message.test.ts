import { describe, expect, it } from 'vitest';

import ownableErrorMessage from '../src/ownableErrorMessage';

describe('ownableErrorMessage', () => {
  it('unwraps wrapped ownable errors', () => {
    const cause = new Error('Custom Error val: "lock failed"');
    const err = new Error('Ownable execute failed') as Error & { cause?: Error };
    err.cause = cause;

    expect(ownableErrorMessage(err)).toBe('lock failed');
  });

  it('prefers viem shortMessage and falls back to message', () => {
    const viemError = Object.assign(new Error('very long'), {
      shortMessage: 'short message',
    });
    expect(ownableErrorMessage(viemError)).toBe('short message');

    expect(ownableErrorMessage(new Error('plain error'))).toBe('plain error');
    expect(ownableErrorMessage('msg')).toBe('msg');
  });
});
