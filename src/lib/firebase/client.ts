import { type FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { type Auth, connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { type Firestore, connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { type Functions, connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { ReCaptchaEnterpriseProvider, ReCaptchaV3Provider, initializeAppCheck } from 'firebase/app-check';

export interface FirebaseClientServices { app: FirebaseApp; auth: Auth; firestore: Firestore; functions: Functions; }
const authEmulatorAttachedAppNames = new Set<string>();
const gameEmulatorAttachedAppNames = new Set<string>();
const appCheckAttachedAppNames = new Set<string>();
let anonymousSignIn: ReturnType<typeof signInAnonymously> | undefined;

type AppCheckProviderKind = 'recaptcha-v3' | 'recaptcha-enterprise';

/**
 * Resolves App Check only for the live Firebase runtime. Fixture and emulator
 * modes intentionally bypass browser attestation so their existing local flows
 * remain independent from a reCAPTCHA key.
 */
export function resolveAppCheckProvider(
  runtime: string | undefined,
  emulator: boolean,
  configuredProvider: string | undefined,
  siteKey: string | undefined,
): AppCheckProviderKind | null {
  if (runtime !== 'firebase' || emulator) return null;
  if (!siteKey?.trim())
    throw new Error('Firebase production runtime is fail-closed until VITE_FIREBASE_APP_CHECK_SITE_KEY is configured.');

  const provider = configuredProvider ?? 'recaptcha-v3';
  if (provider === 'recaptcha-v3' || provider === 'recaptcha-enterprise') return provider;
  throw new Error(
    'VITE_FIREBASE_APP_CHECK_PROVIDER must be either recaptcha-v3 or recaptcha-enterprise.',
  );
}

function emulatorPort(name: 'VITE_FIREBASE_AUTH_EMULATOR_PORT' | 'VITE_FIREBASE_FIRESTORE_EMULATOR_PORT' | 'VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT' | 'VITE_FIREBASE_STORAGE_EMULATOR_PORT', fallback: number) {
  const value = import.meta.env[name];
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9]\d{0,4}$/.test(value)) throw new Error(`${name} must be a TCP port between 1 and 65535.`);
  const port = Number(value);
  if (port > 65535) throw new Error(`${name} must be a TCP port between 1 and 65535.`);
  return port;
}

function configuredFirebase() {
  const env = import.meta.env;
  const required = [env.VITE_FIREBASE_API_KEY, env.VITE_FIREBASE_AUTH_DOMAIN, env.VITE_FIREBASE_PROJECT_ID, env.VITE_FIREBASE_APP_ID];
  return required.every((value) => typeof value === 'string' && value.length > 0);
}

function firebaseApp() {
  return getApps().length ? getApp() : initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  });
}

function attachAuthEmulatorOnce(app: FirebaseApp, auth: Auth) {
  if (import.meta.env.VITE_USE_FIREBASE_EMULATORS !== 'true' || authEmulatorAttachedAppNames.has(app.name)) return;
  connectAuthEmulator(auth, `http://127.0.0.1:${emulatorPort('VITE_FIREBASE_AUTH_EMULATOR_PORT', 9099)}`, { disableWarnings: true });
  authEmulatorAttachedAppNames.add(app.name);
}

function attachAppCheckOnce(app: FirebaseApp, providerKind: AppCheckProviderKind, siteKey: string) {
  if (appCheckAttachedAppNames.has(app.name)) return;
  // A registered debug token is local-only; production always uses attestation.
  if (import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(window.location.hostname) && import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN) {
    (self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN;
  }
  const provider = providerKind === 'recaptcha-enterprise'
    ? new ReCaptchaEnterpriseProvider(siteKey)
    : new ReCaptchaV3Provider(siteKey);
  initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
  appCheckAttachedAppNames.add(app.name);
}

/**
 * Returns the shared Firebase Auth instance whenever public Firebase Web config
 * is complete. Authentication intentionally does not depend on game runtime or
 * App Check, so signing in remains available while rooms use fixture mode.
 */
export function getOptionalFirebaseAuth(): Auth | null {
  if (!configuredFirebase()) return null;
  const app = firebaseApp();
  const auth = getAuth(app);
  attachAuthEmulatorOnce(app, auth);
  return auth;
}

/** Returns null rather than throwing when fixture mode has no Firebase configuration. */
export function getOptionalFirebaseClient(): FirebaseClientServices | null {
  if (envRuntimeIsFixture() || !configuredFirebase()) return null;
  return configuredClient();
}

function configuredClient(): FirebaseClientServices {
  const emulator = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
  const appCheckProvider = resolveAppCheckProvider(
    'firebase',
    emulator,
    import.meta.env.VITE_FIREBASE_APP_CHECK_PROVIDER,
    import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY,
  );
  const app = firebaseApp();
  if (appCheckProvider)
    attachAppCheckOnce(app, appCheckProvider, import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY!);
  const services = { app, auth: getAuth(app), firestore: getFirestore(app), functions: getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'me-central1') };
  attachAuthEmulatorOnce(app, services.auth);
  if (emulator && !gameEmulatorAttachedAppNames.has(app.name)) {
    connectFirestoreEmulator(services.firestore, '127.0.0.1', emulatorPort('VITE_FIREBASE_FIRESTORE_EMULATOR_PORT', 8080));
    connectFunctionsEmulator(services.functions, '127.0.0.1', emulatorPort('VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT', 5001));
    gameEmulatorAttachedAppNames.add(app.name);
  }
  return services;
}

/**
 * Administration is never anonymous, but it may use the configured Firebase
 * project while the game itself runs in local/fixture mode.  This keeps local
 * gameplay isolated without making the administrative studio impossible to
 * review during development.
 */
export function getOptionalFirebaseAdminClient(): FirebaseClientServices | null {
  if (!configuredFirebase()) return null;
  return configuredClient();
}

function envRuntimeIsFixture() { return import.meta.env.VITE_GAME_RUNTIME !== 'firebase'; }

/** Explicit opt-in for Firebase routes; fixture mode never creates an auth user. */
export async function signInAnonymouslyIfNeeded() {
  const client = getOptionalFirebaseClient();
  if (!client) throw new Error('Firebase runtime is not configured; fixture mode remains active.');
  if (client.auth.currentUser) return client.auth.currentUser;
  anonymousSignIn ??= signInAnonymously(client.auth);
  try { return (await anonymousSignIn).user; } finally { anonymousSignIn = undefined; }
}
