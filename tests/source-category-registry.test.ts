import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sourceCategoryRegistry } from "../scripts/source-category-crosswalk.js";

test("pins all 100 direct source identities and preserves the legacy runtime boundary", async () => {
  const archive = await readFile("huroof_everything_available_bundle.zip");
  const legacyCatalog = JSON.parse(await readFile("content/categories/categories.json", "utf8")) as { categories: { id: string }[] };
  assert.equal(createHash("sha256").update(archive).digest("hex"), "7afd1423925b68e11f3f0cab5253879154763994272203b1a4df8007f9cd31ec");
  assert.equal(sourceCategoryRegistry.categories.length, 100);
  assert.equal(legacyCatalog.categories.length, 62);
  assert.equal(new Set(sourceCategoryRegistry.categories.map((category) => category.sourceCategoryId)).size, 100);
  assert.deepEqual(sourceCategoryRegistry.categories.map((category) => category.sourceIndex), Array.from({ length: 100 }, (_, index) => String(index + 1).padStart(3, "0")));
  for (const category of sourceCategoryRegistry.categories) {
    assert.equal(category.declaredMode, "unclassified");
    assert.match(category.sourceFileSha256, /^[a-f0-9]{64}$/);
    if (Number(category.sourceIndex) <= 62) assert.equal(category.runtimeCategoryId, category.sourceCategoryId);
    else assert.equal(category.runtimeCategoryId, null);
  }
  assert.deepEqual(sourceCategoryRegistry.categories.slice(0, 62).map((category) => category.runtimeCategoryId), legacyCatalog.categories.map((category) => category.id));
});
