import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const jbrCandidates = [process.env.JAVA_HOME && resolve(process.env.JAVA_HOME, 'bin', 'java.exe'), 'C:/Program Files/Android/Android Studio/jbr/bin/java.exe', 'C:/Program Files/Android/Android Studio/jbr/bin/java'];
const java = jbrCandidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
if (!java) throw new Error('Java is required for Firebase emulators. Set JAVA_HOME/PATH or install Android Studio JBR.');
const env = { ...process.env, JAVA_HOME: dirname(dirname(java)), Path: `${dirname(java)};${process.env.Path ?? ''}`, GCLOUD_PROJECT: 'demo-huroof-wa-oloof', VITE_GAME_RUNTIME: 'firebase', VITE_USE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_API_KEY: 'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-huroof-wa-oloof.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'demo-huroof-wa-oloof', VITE_FIREBASE_APP_ID: '1:1234567890:web:firebasee2edemo', VITE_FIREBASE_FUNCTIONS_REGION: 'me-central2' };
const child = process.platform === 'win32'
  ? spawn('npx.cmd', ['firebase', 'emulators:exec', '--only', 'auth,firestore,functions', '--project', 'demo-huroof-wa-oloof', 'scripts\\run-firebase-e2e.cmd'], { cwd: root, env, stdio: 'inherit', shell: true })
  : spawn('npx', ['firebase', 'emulators:exec', '--only', 'auth,firestore,functions', '--project', 'demo-huroof-wa-oloof', 'scripts/run-firebase-e2e.cmd'], { cwd: root, env, stdio: 'inherit' });
child.once('exit', (code) => process.exitCode = code ?? 1);
