import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const firebaseE2EProjectId = 'demo-huroof-wa-oloof';
export const firebaseE2EPorts = { auth: 19099, firestore: 18080, functions: 15001, storage: 19199, hub: 14400, logging: 14500 };
type FirebaseConfig = Record<string, unknown>;

/** Creates a disposable, port-isolated emulator config. It never writes the checked-in firebase.json. */
export function createFirebaseE2EConfig(root: string, baseConfig: FirebaseConfig, configDirectory = root): FirebaseConfig {
  return {
  ...baseConfig,
  firestore: { rules: resolve(root, 'firestore.rules'), indexes: resolve(root, 'firestore.indexes.json') },
  storage: { rules: resolve(root, 'storage.rules') },
  // Firebase resolves function sources relative to --config, even when supplied as Windows absolute paths.
  functions: [{ source: relative(configDirectory, resolve(root, 'functions')).replaceAll('\\', '/'), codebase: 'default' }],
  emulators: {
    auth: { port: firebaseE2EPorts.auth }, firestore: { port: firebaseE2EPorts.firestore }, functions: { port: firebaseE2EPorts.functions }, storage: { port: firebaseE2EPorts.storage },
    hub: { port: firebaseE2EPorts.hub }, logging: { port: firebaseE2EPorts.logging }, ui: { enabled: false },
  },
  };
}

export function firebaseE2EEnvironment(java: string): NodeJS.ProcessEnv {
  return {
  ...process.env,
  JAVA_HOME: dirname(dirname(java)),
  Path: `${dirname(java)};${process.env.Path ?? ''}`,
  GCLOUD_PROJECT: firebaseE2EProjectId,
  FIRESTORE_EMULATOR_HOST: `127.0.0.1:${firebaseE2EPorts.firestore}`,
  FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${firebaseE2EPorts.auth}`,
  FIREBASE_FUNCTIONS_EMULATOR_HOST: `127.0.0.1:${firebaseE2EPorts.functions}`,
  FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${firebaseE2EPorts.storage}`,
  VITE_GAME_RUNTIME: 'firebase', VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: `${firebaseE2EProjectId}.firebaseapp.com`, VITE_FIREBASE_PROJECT_ID: firebaseE2EProjectId, VITE_FIREBASE_APP_ID: '1:1234567890:web:firebasee2edemo', VITE_FIREBASE_FUNCTIONS_REGION: 'me-central2',
  VITE_FIREBASE_AUTH_EMULATOR_PORT: String(firebaseE2EPorts.auth), VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: String(firebaseE2EPorts.firestore), VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: String(firebaseE2EPorts.functions), VITE_FIREBASE_STORAGE_EMULATOR_PORT: String(firebaseE2EPorts.storage),
  };
}

async function main() {
  const root = process.cwd();
  const jbrCandidates = [process.env.JAVA_HOME && resolve(process.env.JAVA_HOME, 'bin', 'java.exe'), 'C:/Program Files/Android/Android Studio/jbr/bin/java.exe', 'C:/Program Files/Android/Android Studio/jbr/bin/java'];
  const java = jbrCandidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
  if (!java) throw new Error('Java is required for Firebase emulators. Set JAVA_HOME/PATH or install Android Studio JBR.');
  const baseConfig = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8')) as FirebaseConfig;
  const outputDirectory = resolve(root, 'output');
  const tempDirectory = mkdtempSync(join(outputDirectory, 'firebase-e2e-'));
  const configPath = join(tempDirectory, 'firebase.e2e.json');
  if (!resolve(tempDirectory).startsWith(`${outputDirectory}${sep}`)) throw new Error('Refusing to clean an emulator config outside the workspace output directory.');
  const cleanup = () => rmSync(tempDirectory, { recursive: true, force: true });
  writeFileSync(configPath, `${JSON.stringify(createFirebaseE2EConfig(root, baseConfig, tempDirectory), null, 2)}\n`);
  const env = firebaseE2EEnvironment(java);
  const npmCli = process.env.npm_execpath;
  const firebaseCli = resolve(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  if (!npmCli || !existsSync(npmCli)) throw new Error('npm CLI path is unavailable; run this script through npm so npm_execpath is set.');
  if (!existsSync(firebaseCli)) throw new Error('Local Firebase CLI is unavailable. Run npm install before Firebase E2E.');
  const functionsBuild = spawnSync(process.execPath, [npmCli, '--prefix', 'functions', 'run', 'build'], { cwd: root, env, stdio: 'inherit' });
  if (functionsBuild.error || functionsBuild.status !== 0) {
    cleanup();
    if (functionsBuild.error) console.error(`Functions build could not start: ${functionsBuild.error.message}`);
    process.exitCode = functionsBuild.status ?? 1;
    return;
  }
  const args = ['emulators:exec', '--config', configPath, '--only', 'auth,firestore,functions,storage', '--project', firebaseE2EProjectId, 'scripts\\run-firebase-e2e.cmd'];
  const child = spawn(process.execPath, [firebaseCli, ...args], { cwd: root, env, stdio: 'inherit' });
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (status) => resolve(status ?? 1));
  });
  cleanup();
  process.exitCode = code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
