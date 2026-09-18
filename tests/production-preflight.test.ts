import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionPreflight,
  productionFunctionsRegion,
  productionProjectId,
} from "../scripts/production-preflight.js";

const valid = {
  VITE_GAME_RUNTIME: "firebase",
  VITE_USE_FIREBASE_EMULATORS: "false",
  VITE_FIREBASE_PROJECT_ID: productionProjectId,
  VITE_FIREBASE_FUNCTIONS_REGION: productionFunctionsRegion,
  VITE_FIREBASE_API_KEY: "public-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "huroof-a3ee7.firebaseapp.com",
  VITE_FIREBASE_APP_ID: "1:123:web:production",
  VITE_FIREBASE_APP_CHECK_SITE_KEY: "public-app-check-key",
  FIREBASE_ACTIVE_RELEASE_ID: "release_20260908",
  FIREBASE_ACTIVE_RELEASE_ROOT_SHA256: "a".repeat(64),
};

test("production preflight accepts an explicit non-emulator Node 22 release build", () => {
  assert.doesNotThrow(() => assertProductionPreflight(valid, "22.16.0"));
});

test("production preflight rejects the former Dammam Functions region", () => {
  assert.throws(
    () =>
      assertProductionPreflight(
        { ...valid, VITE_FIREBASE_FUNCTIONS_REGION: "me-central2" },
        "22.16.0",
      ),
    /VITE_FIREBASE_FUNCTIONS_REGION must be me-central1/,
  );
});

test("production preflight rejects fixture, emulator, missing release, and wrong Node inputs", () => {
  assert.throws(
    () =>
      assertProductionPreflight(
        {
          ...valid,
          VITE_GAME_RUNTIME: "fixture",
          VITE_USE_FIREBASE_EMULATORS: "true",
          VITE_FIREBASE_PROJECT_ID: "demo-huroof-wa-oloof",
          FIREBASE_ACTIVE_RELEASE_ID: "",
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        },
        "24.0.0",
      ),
    /Node 22.*VITE_GAME_RUNTIME.*VITE_USE_FIREBASE_EMULATORS.*VITE_FIREBASE_PROJECT_ID.*FIREBASE_ACTIVE_RELEASE_ID.*FIRESTORE_EMULATOR_HOST/s,
  );
});

test("production preflight accepts the Enterprise provider and rejects an unknown one", () => {
  assert.doesNotThrow(() =>
    assertProductionPreflight(
      { ...valid, VITE_FIREBASE_APP_CHECK_PROVIDER: "recaptcha-enterprise" },
      "22.16.0",
    ),
  );
  assert.throws(
    () =>
      assertProductionPreflight(
        { ...valid, VITE_FIREBASE_APP_CHECK_PROVIDER: "recaptcha-unknown" },
        "22.16.0",
      ),
    /VITE_FIREBASE_APP_CHECK_PROVIDER/,
  );
});
