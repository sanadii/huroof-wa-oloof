import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appCheck: vi.fn(), functionsEmulator: vi.fn(), firestoreEmulator: vi.fn(),
}));
vi.mock('firebase/app-check', () => ({
  initializeAppCheck: mocks.appCheck,
  ReCaptchaEnterpriseProvider: class {}, ReCaptchaV3Provider: class {},
}));
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: () => ({ name: 'test' }) }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({}), connectAuthEmulator: vi.fn(), signInAnonymously: vi.fn() }));
vi.mock('firebase/firestore', () => ({ getFirestore: () => ({}), connectFirestoreEmulator: mocks.firestoreEmulator }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), connectFunctionsEmulator: mocks.functionsEmulator }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  for (const key of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'APP_ID']) vi.stubEnv(`VITE_FIREBASE_${key}`, 'test');
  vi.stubEnv('VITE_GAME_RUNTIME', 'local');
  vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'false');
  vi.stubEnv('VITE_FIREBASE_APP_CHECK_PROVIDER', 'recaptcha-enterprise');
  vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY', 'public-test-key');
  vi.stubEnv('VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('administrative Firebase connection', () => {
  it('attests the admin client while leaving local gameplay offline', async () => {
    const client = await import('../../src/lib/firebase/client');
    expect(client.getOptionalFirebaseClient()).toBeNull();
    expect(client.getOptionalFirebaseAdminClient()).not.toBeNull();
    client.getOptionalFirebaseAdminClient();
    expect(mocks.appCheck).toHaveBeenCalledOnce();
  });
  it('fails closed if local administration has no App Check configuration', async () => {
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY', '');
    const client = await import('../../src/lib/firebase/client');
    expect(() => client.getOptionalFirebaseAdminClient()).toThrow(/SITE_KEY/);
  });
  it('connects administration to emulators when explicitly configured', async () => {
    vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', 'true');
    const client = await import('../../src/lib/firebase/client');
    client.getOptionalFirebaseAdminClient();
    expect(mocks.functionsEmulator).toHaveBeenCalledOnce();
    expect(mocks.firestoreEmulator).toHaveBeenCalledOnce();
    expect(mocks.appCheck).not.toHaveBeenCalled();
  });
});
