import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("Firebase Hosting routes all nested app paths to the app shell", async () => {
  const config = JSON.parse(
    await readFile(resolve(process.cwd(), "firebase.json"), "utf8"),
  ) as {
    hosting?: {
      public?: string;
      rewrites?: Array<{ source: string; destination: string }>;
    };
  };
  assert.equal(config.hosting?.public, "dist");
  assert.deepEqual(config.hosting?.rewrites, [
    { source: "**", destination: "/index.html" },
  ]);
});

test("the app-shell CSP retains production Firebase/App Check origins and explicit emulator-only ports", async () => {
  const html = await readFile(resolve(process.cwd(), "index.html"), "utf8");
  const policy = /Content-Security-Policy" content="([^"]+)"/u.exec(html)?.[1] ?? "";
  for (const source of ["https://*.googleapis.com", "https://*.firebaseio.com", "https://*.cloudfunctions.net", "https://*.firebaseapp.com", "https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/", "https://recaptcha.google.com/recaptcha/", "http://127.0.0.1:19099", "http://127.0.0.1:18080", "http://127.0.0.1:15001", "http://127.0.0.1:19199", "media-src 'self' blob: data:"]) assert.match(policy, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
});
