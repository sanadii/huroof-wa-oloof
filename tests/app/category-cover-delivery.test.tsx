import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import liveCatalog from "../fixtures/t44-live-category-catalog.json";
import sourceMapping from "../../src/data/tahadani-games-category-covers.public.json";
import { catalogCategoryCovers } from "../../src/data/local-question-inventory";

it("resolves a non-fallback image for all 530 saved live catalog categories", () => {
  expect(liveCatalog.categoryCount).toBe(530);
  expect(liveCatalog.categories).toHaveLength(530);
  expect(new Set(liveCatalog.categories.map((category) => category.id)).size).toBe(530);
  const resolved = catalogCategoryCovers(liveCatalog.categories);
  expect(resolved).toHaveLength(530);
  expect(resolved.filter((category) => !category.cover.publishable)).toHaveLength(159);
  for (const category of resolved) {
    expect(category.cover.altAr).not.toContain("افتراضية");
    expect(existsSync(resolve("public", category.cover.web320))).toBe(true);
  }
});

it("keeps all 558 source categories mapped to both 320 and 640 delivery files", () => {
  expect(sourceMapping.categories).toHaveLength(558);
  expect(new Set(sourceMapping.categories.map((category) => category.categoryId)).size).toBe(558);
  expect(sourceMapping.categories.filter((category) => category.cover?.source === "generated_review" && category.cover.publishable)).toHaveLength(446);
  expect(sourceMapping.categories.filter((category) => category.cover?.source === "existing_library" && !category.cover.publishable)).toHaveLength(112);
  for (const category of sourceMapping.categories) {
    expect(category.cover).not.toBeNull();
    expect(existsSync(resolve("public", category.cover!.web320))).toBe(true);
    expect(existsSync(resolve("public", category.cover!.web640))).toBe(true);
  }
});

it("uses exact normalized names only when release category IDs differ", () => {
  const result = catalogCategoryCovers(sourceMapping.categories.map((category, index) => ({
    id: `release-topic-${index}`,
    labelAr: category.normalizedNameAr,
  })));
  for (const [index, category] of sourceMapping.categories.entries()) {
    expect(result[index].cover.web320).toBe(category.cover!.web320);
  }
});

it("uses original replacement art for seven exact legacy-rights holds", () => {
  const result = catalogCategoryCovers([
    { id: "huroof-069", labelAr: "كرة القدم الكويتية" },
    { id: "huroof-097", labelAr: "علوم" },
    { id: "huroof-099", labelAr: "طب وجسم الإنسان" },
    { id: "huroof-100", labelAr: "جغرافيا العالم" },
    { id: "tahadani-001", labelAr: "من أنا - دول" },
    { id: "tahadani-003", labelAr: "من أنا - حيوانات" },
    { id: "tahadani-006", labelAr: "معلومات عامة" },
  ]);
  for (const category of result) {
    expect(category.cover.web320).toBe(`assets/categories/generated/t44-rights/320/${category.id}.webp`);
    expect(category.cover.publishable).toBe(true);
    expect(existsSync(resolve("public", category.cover.web320))).toBe(true);
    expect(existsSync(resolve("public", `assets/categories/generated/t44-rights/640/${category.id}.webp`))).toBe(true);
  }
});
