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
  expect(resolved.filter((category) => !category.cover.publishable)).toHaveLength(103);
  for (const category of resolved) {
    expect(category.cover.altAr).not.toContain("افتراضية");
    expect(existsSync(resolve("public", category.cover.web320))).toBe(true);
  }
});

it("keeps all 558 source categories mapped to both 320 and 640 delivery files", () => {
  expect(sourceMapping.categories).toHaveLength(558);
  expect(new Set(sourceMapping.categories.map((category) => category.categoryId)).size).toBe(558);
  expect(sourceMapping.categories.filter((category) => category.cover?.source === "generated_review" && category.cover.publishable)).toHaveLength(472);
  expect(sourceMapping.categories.filter((category) => category.cover?.source === "existing_library" && !category.cover.publishable)).toHaveLength(86);
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

it("uses original replacement art for twelve exact legacy-rights holds", () => {
  const result = catalogCategoryCovers([
    { id: "huroof-069", labelAr: "كرة القدم الكويتية" },
    { id: "huroof-097", labelAr: "علوم" },
    { id: "huroof-099", labelAr: "طب وجسم الإنسان" },
    { id: "huroof-100", labelAr: "جغرافيا العالم" },
    { id: "tahadani-001", labelAr: "من أنا - دول" },
    { id: "tahadani-003", labelAr: "من أنا - حيوانات" },
    { id: "tahadani-006", labelAr: "معلومات عامة" },
    { id: "tahadani-007", labelAr: "عالم الحيوان" },
    { id: "tahadani-008", labelAr: "تكنولوجيا" },
    { id: "tahadani-009", labelAr: "تاريخ" },
    { id: "tahadani-013", labelAr: "ألغاز" },
    { id: "tahadani-015", labelAr: "أمثال وغطاوي" },
  ]);
  for (const category of result) {
    expect(category.cover.web320).toBe(`assets/categories/generated/t44-rights/320/${category.id}.webp`);
    expect(category.cover.publishable).toBe(true);
    expect(existsSync(resolve("public", category.cover.web320))).toBe(true);
    expect(existsSync(resolve("public", `assets/categories/generated/t44-rights/640/${category.id}.webp`))).toBe(true);
  }
});

it("uses nineteen original topic covers for thirty-eight matching live and source categories", () => {
  const groups = [
    ["أعلام", "tahadani-044", "tahadani-games-280"],
    ["عواصم", "tahadani-045", "tahadani-games-277"],
    ["عملات", "tahadani-047", "tahadani-games-272"],
    ["تنس", "tahadani-049", "tahadani-games-551"],
    ["سيارات", "tahadani-051", "tahadani-games-073"],
    ["منوعات شعرية", "tahadani-053", "tahadani-games-069"],
    ["منو المشهور", "tahadani-010", "tahadani-games-067"],
    ["من هو اللاعب", "tahadani-025", "tahadani-games-196"],
    ["أفلام رعب", "tahadani-029", "tahadani-games-458"],
    ["أفلام كلاسيك", "tahadani-028", "tahadani-games-455"],
    ["ألعاب الطفولة", "tahadani-043", "tahadani-games-523", "العاب الطفولة"],
    ["منوعات كرة قدم", "tahadani-052", "tahadani-games-219"],
    ["كرة قدم عالمية", "tahadani-054", "tahadani-games-212"],
    ["مسيرة لاعب", "tahadani-060", "tahadani-games-220"],
    ["مطاعم الكويت", "tahadani-058", "tahadani-games-310"],
    ["كأس العالم", "tahadani-023", "tahadani-games-199"],
    ["دول وعواصم", "tahadani-046", "tahadani-games-283", "دول و عواصم"],
    ["Minecraft", "tahadani-042", "tahadani-games-534"],
    ["Call Of Duty", "tahadani-041", "tahadani-games-536", "Call of Duty"],
  ] as const;
  const liveLabels = new Map(liveCatalog.categories.map((category) => [category.id, category.labelAr]));
  for (const [label, legacyId, sourceId, alternateSourceLabel] of groups) {
    expect(liveLabels.get(legacyId)).toBe(label);
    expect(liveLabels.get(sourceId)).toBe(alternateSourceLabel ?? label);
    const mappedSource = sourceMapping.categories.find((category) => category.categoryId === sourceId)!;
    expect(mappedSource.normalizedNameAr).toBe(alternateSourceLabel ?? label);
    expect(mappedSource.cover?.source).toBe("generated_review");
    expect(mappedSource.cover?.publishable).toBe(true);
    const resolved = catalogCategoryCovers([legacyId, sourceId].map((id) => ({ id, labelAr: id === sourceId ? (alternateSourceLabel ?? label) : label })));
    for (const [index, id] of [legacyId, sourceId].entries()) {
      expect(resolved[index].cover.publishable).toBe(true);
      expect(resolved[index].cover.web320).toBe(`assets/categories/generated/t44-rights/320/${id}.webp`);
      for (const size of [320, 640]) {
        expect(existsSync(resolve("public", `assets/categories/generated/t44-rights/${size}/${id}.webp`))).toBe(true);
      }
    }
  }
});

it("uses original blank-completion art for its source-only category", () => {
  const id = "tahadani-games-038";
  const labelAr = "أكمل الفراغ";
  const live = liveCatalog.categories.find((category) => category.id === id)!;
  const source = sourceMapping.categories.find((category) => category.categoryId === id)!;
  expect(live.labelAr).toBe(labelAr);
  expect(source.normalizedNameAr).toBe(labelAr);
  expect(source.cover?.source).toBe("generated_review");
  expect(source.cover?.publishable).toBe(true);
  const resolved = catalogCategoryCovers([{ id, labelAr }])[0];
  expect(resolved.cover.publishable).toBe(true);
  for (const size of [320, 640] as const) {
    const path = `assets/categories/generated/t44-rights/${size}/${id}.webp`;
    expect(source.cover?.[`web${size}`]).toBe(path);
    if (size === 320) expect(resolved.cover.web320).toBe(path);
    expect(existsSync(resolve("public", path))).toBe(true);
  }
});

it("reuses five original legacy covers for exact matching source-category labels", () => {
  const pairs = [
    ["tahadani-games-043", "tahadani-008", "تكنولوجيا"],
    ["tahadani-games-066", "tahadani-009", "تاريخ"],
    ["tahadani-games-070", "tahadani-006", "معلومات عامة"],
    ["tahadani-games-074", "tahadani-007", "عالم الحيوان"],
    ["tahadani-games-140", "tahadani-013", "ألغاز"],
  ] as const;
  const liveLabels = new Map(liveCatalog.categories.map((category) => [category.id, category.labelAr]));
  for (const [sourceId, originalId, label] of pairs) {
    expect(liveLabels.get(sourceId)).toBe(label);
    expect(liveLabels.get(originalId)).toBe(label);
    const mappedSource = sourceMapping.categories.find((category) => category.categoryId === sourceId)!;
    expect(mappedSource.normalizedNameAr).toBe(label);
    expect(mappedSource.cover?.source).toBe("generated_review");
    expect(mappedSource.cover?.publishable).toBe(true);
    const resolved = catalogCategoryCovers([{ id: sourceId, labelAr: label }])[0];
    expect(resolved.cover.publishable).toBe(true);
    for (const size of [320, 640] as const) {
      const path = `assets/categories/generated/t44-rights/${size}/${originalId}.webp`;
      expect(mappedSource.cover?.[`web${size}`]).toBe(path);
      if (size === 320) expect(resolved.cover.web320).toBe(path);
      expect(existsSync(resolve("public", path))).toBe(true);
    }
  }
});

it("reuses the original animal-guess cover for its punctuation-equivalent source label", () => {
  const legacyId = "tahadani-003";
  const sourceId = "tahadani-games-021";
  const liveLabels = new Map(liveCatalog.categories.map((category) => [category.id, category.labelAr]));
  expect(liveLabels.get(legacyId)).toBe("من أنا - حيوانات");
  expect(liveLabels.get(sourceId)).toBe("من أنا / حيوانات");
  const source = sourceMapping.categories.find((category) => category.categoryId === sourceId)!;
  expect(source.normalizedNameAr).toBe("من أنا / حيوانات");
  expect(source.cover?.source).toBe("generated_review");
  expect(source.cover?.publishable).toBe(true);
  const resolved = catalogCategoryCovers([{ id: sourceId, labelAr: liveLabels.get(sourceId)! }])[0];
  expect(resolved.cover.publishable).toBe(true);
  for (const size of [320, 640] as const) {
    const path = `assets/categories/generated/t44-rights/${size}/${legacyId}.webp`;
    expect(source.cover?.[`web${size}`]).toBe(path);
    if (size === 320) expect(resolved.cover.web320).toBe(path);
    expect(existsSync(resolve("public", path))).toBe(true);
  }
});

it("reuses generated covers only for six checked legacy-rights topic pairs", () => {
  const pairs = [
    ["tahadani-002", "tahadani-games-024"],
    ["tahadani-011", "tahadani-games-134"],
    ["tahadani-012", "tahadani-games-135"],
    ["tahadani-014", "tahadani-games-127"],
    ["tahadani-050", "tahadani-games-554"],
    ["tahadani-055", "tahadani-games-194"],
  ] as const;
  const liveLabels = new Map(liveCatalog.categories.map((category) => [category.id, category.labelAr]));
  const result = catalogCategoryCovers(pairs.map(([id]) => ({ id, labelAr: liveLabels.get(id)! })));
  pairs.forEach(([, sourceId], index) => {
    const source = sourceMapping.categories.find((category) => category.categoryId === sourceId)!;
    expect(source.cover?.source).toBe("generated_review");
    expect(source.cover?.publishable).toBe(true);
    expect(result[index].cover.web320).toBe(source.cover!.web320);
    expect(result[index].cover.publishable).toBe(true);
    expect(existsSync(resolve("public", source.cover!.web320))).toBe(true);
    expect(existsSync(resolve("public", source.cover!.web640))).toBe(true);
  });
  const wrongLabel = catalogCategoryCovers([{ id: "tahadani-002", labelAr: "غير مطابق" }])[0];
  expect(wrongLabel.cover.publishable).toBe(false);
  expect(wrongLabel.cover.web320).toBe("assets/categories/320/category-002.webp");
  for (const id of ["tahadani-005", "tahadani-031", "tahadani-033", "tahadani-036", "tahadani-037", "tahadani-038", "tahadani-039", "tahadani-048", "tahadani-059", "tahadani-061"]) {
    const labelAr = liveLabels.get(id)!;
    expect(catalogCategoryCovers([{ id, labelAr }])[0].cover.publishable).toBe(false);
  }
});
