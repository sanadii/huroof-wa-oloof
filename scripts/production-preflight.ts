import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const productionProjectId = "huroof-a3ee7";
export const productionFunctionsRegion = "me-central2";

type Environment = Record<string, string | undefined>;

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function nodeMajor(version: string): number | undefined {
  const match = /^(\d+)\./.exec(version);
  return match ? Number(match[1]) : undefined;
}

/** Validates build inputs only; it never reads or writes a Firebase project. */
export function assertProductionPreflight(
  environment: Environment,
  nodeVersion: string,
): void {
  const failures: string[] = [];
  if (nodeMajor(nodeVersion) !== 22)
    failures.push(`Node 22 is required for production parity (received ${nodeVersion}).`);
  if (environment.VITE_GAME_RUNTIME !== "firebase")
    failures.push("VITE_GAME_RUNTIME must be firebase.");
  if (environment.VITE_USE_FIREBASE_EMULATORS !== "false")
    failures.push("VITE_USE_FIREBASE_EMULATORS must be false.");
  if (environment.VITE_FIREBASE_PROJECT_ID !== productionProjectId)
    failures.push(`VITE_FIREBASE_PROJECT_ID must be ${productionProjectId}.`);
  if (environment.VITE_FIREBASE_FUNCTIONS_REGION !== productionFunctionsRegion)
    failures.push(
      `VITE_FIREBASE_FUNCTIONS_REGION must be ${productionFunctionsRegion}.`,
    );
  for (const name of [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_APP_ID",
    "VITE_FIREBASE_APP_CHECK_SITE_KEY",
    "FIREBASE_ACTIVE_RELEASE_ID",
    "FIREBASE_ACTIVE_RELEASE_ROOT_SHA256",
  ])
    if (!hasValue(environment[name])) failures.push(`${name} is required.`);
  if (
    hasValue(environment.FIREBASE_ACTIVE_RELEASE_ID) &&
    !/^[A-Za-z0-9_-]{1,128}$/.test(environment.FIREBASE_ACTIVE_RELEASE_ID!)
  )
    failures.push("FIREBASE_ACTIVE_RELEASE_ID has an invalid format.");
  if (
    hasValue(environment.FIREBASE_ACTIVE_RELEASE_ROOT_SHA256) &&
    !/^[a-f0-9]{64}$/i.test(environment.FIREBASE_ACTIVE_RELEASE_ROOT_SHA256!)
  )
    failures.push("FIREBASE_ACTIVE_RELEASE_ROOT_SHA256 must be a SHA-256 hex digest.");
  for (const name of [
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
    "FIREBASE_FUNCTIONS_EMULATOR_HOST",
    "FIREBASE_STORAGE_EMULATOR_HOST",
    "VITE_FIREBASE_AUTH_EMULATOR_PORT",
    "VITE_FIREBASE_FIRESTORE_EMULATOR_PORT",
    "VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT",
    "VITE_FIREBASE_STORAGE_EMULATOR_PORT",
  ])
    if (hasValue(environment[name])) failures.push(`${name} must be unset.`);
  for (const name of ["GCLOUD_PROJECT", "FIREBASE_PROJECT"])
    if (hasValue(environment[name]) && environment[name] !== productionProjectId)
      failures.push(`${name} must be ${productionProjectId} when provided.`);
  if (failures.length)
    throw new Error(`Production preflight rejected:\n- ${failures.join("\n- ")}`);
}

function main(): void {
  assertProductionPreflight(process.env, process.versions.node);
  console.log(
    `Production preflight passed for ${productionProjectId}; immutable release ${process.env.FIREBASE_ACTIVE_RELEASE_ID}.`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  main();
