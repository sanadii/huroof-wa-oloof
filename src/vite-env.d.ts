/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_APP_CHECK_PROVIDER?: 'recaptcha-v3' | 'recaptcha-enterprise';
  readonly VITE_FIREBASE_AUTH_EMULATOR_PORT?: string;
  readonly VITE_FIREBASE_FIRESTORE_EMULATOR_PORT?: string;
  readonly VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT?: string;
  readonly VITE_FIREBASE_STORAGE_EMULATOR_PORT?: string;
}
