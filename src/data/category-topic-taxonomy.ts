import sourceCategoryCovers from "./tahadani-games-category-covers.public.json";

export type ParentTopicId =
  | "sports"
  | "geography"
  | "screen"
  | "music"
  | "animation"
  | "games"
  | "science"
  | "religion"
  | "culture"
  | "restaurants"
  | "digital"
  | "lifestyle"
  | "history"
  | "literature"
  | "other";

type SourceTopicRange = readonly [start: number, end: number, topic: ParentTopicId];

// Reviewed against the 558 public-source records. Ranges keep the generated
// taxonomy small; explicit ordinals below resolve mixed-format source groups.
const sourceTopicRanges: readonly SourceTopicRange[] = [
  [1, 86, "culture"],
  [87, 101, "religion"],
  [102, 160, "culture"],
  [161, 220, "sports"],
  [221, 253, "music"],
  [254, 263, "lifestyle"],
  [264, 345, "geography"],
  [346, 496, "screen"],
  [497, 517, "animation"],
  [518, 538, "games"],
  [539, 547, "animation"],
  [548, 558, "sports"],
];

const sourceTopicOverrides: Readonly<Record<number, ParentTopicId>> = {
  1: "religion", 2: "sports", 3: "geography", 4: "sports", 5: "geography",
  6: "religion", 7: "sports", 8: "geography", 9: "literature", 10: "geography",
  11: "screen", 12: "restaurants", 13: "music", 14: "sports", 15: "digital",
  16: "religion", 17: "geography", 18: "geography", 19: "geography", 20: "history",
  21: "science", 22: "screen", 23: "screen", 24: "sports", 25: "sports", 26: "sports",
  27: "digital", 28: "digital", 29: "science", 30: "screen", 31: "screen",
  32: "geography", 33: "digital", 34: "literature", 35: "culture", 36: "culture",
  37: "digital", 38: "literature", 39: "history", 40: "music", 41: "music",
  42: "literature", 43: "science", 44: "history", 45: "history", 46: "lifestyle",
  47: "science", 48: "digital", 49: "lifestyle", 50: "screen", 51: "history",
  52: "science", 53: "screen", 54: "screen", 55: "lifestyle", 56: "lifestyle",
  57: "literature", 58: "digital", 59: "culture", 60: "sports", 61: "digital",
  62: "screen", 63: "science", 64: "history", 65: "history", 66: "history",
  67: "screen", 68: "lifestyle", 69: "literature", 70: "culture", 71: "screen",
  72: "literature", 73: "lifestyle", 74: "science", 75: "lifestyle", 76: "restaurants",
  77: "science", 78: "geography", 79: "culture", 80: "culture", 81: "religion",
  82: "music", 83: "screen", 84: "animation", 85: "sports", 86: "culture",
  102: "science", 103: "music", 104: "music", 105: "music", 106: "animation",
  107: "geography", 109: "screen", 110: "screen", 111: "animation", 112: "sports",
  113: "sports", 114: "screen", 115: "screen", 116: "sports", 117: "geography",
  118: "screen", 119: "screen", 129: "sports", 130: "science", 138: "science", 143: "science",
  144: "screen", 145: "screen", 146: "music", 147: "music", 148: "music", 149: "animation",
  150: "screen", 151: "screen", 152: "geography", 153: "sports", 154: "sports",
  156: "animation", 157: "sports", 158: "geography", 159: "screen", 160: "screen",
  294: "sports", 295: "culture", 298: "lifestyle", 299: "sports", 300: "lifestyle",
  301: "sports", 304: "culture", 305: "digital", 306: "literature", 308: "culture",
  309: "sports", 310: "restaurants", 311: "sports", 312: "sports", 313: "lifestyle",
  314: "history", 315: "digital", 316: "history", 317: "lifestyle", 318: "sports",
  320: "screen", 321: "culture", 323: "sports", 324: "restaurants", 325: "sports",
  328: "lifestyle", 330: "sports", 331: "restaurants", 332: "lifestyle", 333: "lifestyle",
  335: "sports", 336: "restaurants", 337: "lifestyle", 338: "lifestyle", 339: "restaurants",
  341: "sports", 342: "lifestyle", 343: "literature", 345: "sports", 377: "music",
  409: "music", 415: "music",
};

const sourceOrdinal = (categoryId: string) => {
  const match = /^tahadani-games-(\d{3})$/.exec(categoryId);
  return match ? Number(match[1]) : undefined;
};

export const topicForKnownSourceCategoryId = (categoryId: string): ParentTopicId | undefined => {
  const ordinal = sourceOrdinal(categoryId);
  if (ordinal === undefined) return undefined;
  return sourceTopicOverrides[ordinal] ?? sourceTopicRanges.find(
    ([start, end]) => ordinal >= start && ordinal <= end,
  )?.[2];
};

const normalizeSourceLabel = (value: string) =>
  value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("ar")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");

/**
 * Firebase sometimes uses a fresh runtime ID for a catalogued source label.
 * The public cover manifest is already client-safe metadata; index its 544
 * normalized labels once so those categories retain their reviewed parent.
 */
const sourceTopicByNormalizedLabel = new Map<string, ParentTopicId>();
for (const category of sourceCategoryCovers.categories) {
  const topic = topicForKnownSourceCategoryId(category.categoryId);
  if (topic) sourceTopicByNormalizedLabel.set(normalizeSourceLabel(category.normalizedNameAr), topic);
}

export const topicForKnownNormalizedLabel = (normalizedLabel: string) =>
  sourceTopicByNormalizedLabel.get(normalizedLabel);

export const sourceTopicCoverage = {
  categoryIds: sourceCategoryCovers.categories.length,
  normalizedLabels: sourceTopicByNormalizedLabel.size,
} as const;
