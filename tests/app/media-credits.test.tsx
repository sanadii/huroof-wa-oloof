import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

test("media credits route gives players OpenMoji attribution, license, source and modification notice", async () => {
  const [route, app, home] = await Promise.all(["src/routes/MediaCredits.tsx", "src/app/App.tsx", "src/routes/HomeSurface.tsx"].map((path) => readFile(resolve(path), "utf8")));
  assert.match(route, /اعتمادات الصور/u);
  assert.match(route, /https:\/\/openmoji\.org\//u);
  assert.match(route, /https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\//u);
  assert.match(route, /aeb8bb3a59e2de39c754ac79180c8131c906acea/u);
  assert.match(route, /حُوّلت الرسوم إلى PNG/u);
  assert.match(route, /تُقص/u);
  assert.match(app, /path="\/media-credits"/u);
  assert.match(home, /to="\/media-credits"/u);
});
