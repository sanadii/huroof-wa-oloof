import { describe, expect, it } from 'vitest';
import { resolveAppCheckProvider } from '../../src/lib/firebase/client';

describe('Firebase App Check provider configuration', () => {
  it('uses v3 by default and selects Enterprise explicitly', () => {
    expect(resolveAppCheckProvider('firebase', false, undefined, 'public-key')).toBe('recaptcha-v3');
    expect(resolveAppCheckProvider('firebase', false, 'recaptcha-enterprise', 'public-key')).toBe('recaptcha-enterprise');
  });

  it('fails closed when the live runtime has no site key or an unknown provider', () => {
    expect(() => resolveAppCheckProvider('firebase', false, 'recaptcha-v3', '')).toThrow(
      /VITE_FIREBASE_APP_CHECK_SITE_KEY/,
    );
    expect(() => resolveAppCheckProvider('firebase', false, 'unknown-provider', 'public-key')).toThrow(
      /VITE_FIREBASE_APP_CHECK_PROVIDER/,
    );
  });

  it('leaves fixture and emulator runtimes independent from App Check configuration', () => {
    expect(resolveAppCheckProvider('fixture', false, 'unknown-provider', '')).toBeNull();
    expect(resolveAppCheckProvider('firebase', true, 'unknown-provider', '')).toBeNull();
  });
});
