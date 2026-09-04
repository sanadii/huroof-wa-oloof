import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { Firestore, connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { Functions, connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { ReCaptchaV3Provider, initializeAppCheck } from 'firebase/app-check';

export interface FirebaseClientServices { app: FirebaseApp; auth: Auth; firestore: Firestore; functions: Functions; }
const emulatorAttachedAppNames = new Set<string>();
const appCheckAttachedAppNames = new Set<string>();
let anonymousSignIn: ReturnType<typeof signInAnonymously> | undefined;

function configuredFirebase() {
  const env = import.meta.env;
  const required = [env.VITE_FIREBASE_API_KEY, env.VITE_FIREBASE_AUTH_DOMAIN, env.VITE_FIREBASE_PROJECT_ID, env.VITE_FIREBASE_APP_ID];
  return required.every((value) => typeof value === 'string' && value.length > 0);
}

/** Returns null rather than throwing when fixture mode has no Firebase configuration. */
export function getOptionalFirebaseClient(): FirebaseClientServices | null {
  if (envRuntimeIsFixture() || !configuredFirebase()) return null;
  const emulator = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
  if (!emulator && !import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY) throw new Error('Firebase production runtime is fail-closed until VITE_FIREBASE_APP_CHECK_SITE_KEY is configured.');
  const app = getApps().length ? getApp() : initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  });
  const services = { app, auth: getAuth(app), firestore: getFirestore(app), functions: getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'me-central2') };
  if (emulator && !emulatorAttachedAppNames.has(app.name)) {
    connectAuthEmulator(services.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(services.firestore, '127.0.0.1', 8080);
    connectFunctionsEmulator(services.functions, '127.0.0.1', 5001);
    emulatorAttachedAppNames.add(app.name);
  }
  if (!emulator && !appCheckAttachedAppNames.has(app.name)) { initializeAppCheck(app, { provider: new ReCaptchaV3Provider(import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true }); appCheckAttachedAppNames.add(app.name); }
  return services;
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
