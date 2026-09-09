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
