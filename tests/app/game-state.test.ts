import { describe, expect, it } from 'vitest';
import { connectionLabel, stateLabel } from '../../src/features/ui/game-state.js';

describe('Arabic game-state labels', () => {
  it('never exposes a raw lifecycle enum to the presentation layer', () => {
    expect(stateLabel('QUESTION_READING')).toBe('قراءة السؤال');
    expect(stateLabel('UNKNOWN_STATE')).not.toContain('UNKNOWN_STATE');
  });

  it('labels connection state for people, not diagnostics', () => {
    expect(connectionLabel('offline')).toBe('دون اتصال');
  });
});
