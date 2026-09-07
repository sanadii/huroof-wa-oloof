import { categoryCatalog } from "../../data/category-catalog";

export type MatchMode = "classic" | "fast" | "custom";

export interface MatchModeOption {
  id: MatchMode;
  labelAr: string;
  descriptionAr: string;
}

/** The single source for setup modes used by both the home and setup surfaces. */
export const matchModeOptions: readonly MatchModeOption[] = [
  {
    id: "classic",
    labelAr: "كلاسيكية",
    descriptionAr: "يبدأ إعداد المباراة بالوضع الكلاسيكي.",
  },
  {
    id: "fast",
    labelAr: "سريعة",
    descriptionAr: "يُحفَظ هذا الاختيار في الإعداد؛ التوقيت لا يتغير تلقائياً.",
  },
  {
    id: "custom",
    labelAr: "مخصصة",
    descriptionAr: "اختر الوضع ثم اضبط الإعدادات المتاحة للمباراة.",
  },
];

const matchModeIds = new Set<MatchMode>(matchModeOptions.map(({ id }) => id));
const categoryIds = new Set(categoryCatalog.map(({ id }) => id));

export const isMatchMode = (value: string | null): value is MatchMode =>
  value !== null && matchModeIds.has(value as MatchMode);

export const matchModeOption = (mode: MatchMode) =>
  matchModeOptions.find((option) => option.id === mode)!;

export interface SetupQuerySeed {
  mode: MatchMode;
  categories: string[];
  notice?: string;
}

/**
 * Reads only supported query values. This intentionally seeds a setup route once;
 * route components keep subsequent edits in local form state.
 */
export function parseSetupQuery(search: URLSearchParams): SetupQuerySeed {
  const requestedMode = search.get("mode");
  const mode = isMatchMode(requestedMode) ? requestedMode : "classic";
  const requestedCategories = search.getAll("category");
  const categories = requestedCategories.filter(
    (id, index) => categoryIds.has(id) && requestedCategories.indexOf(id) === index,
  );
  const hasInvalidMode = requestedMode !== null && !isMatchMode(requestedMode);
  const hasInvalidCategory = requestedCategories.some((id) => !categoryIds.has(id));

  return {
    mode,
    categories,
    notice:
      hasInvalidMode || hasInvalidCategory
        ? "تجاهلنا اختيارات غير مدعومة من الرابط واستخدمنا الإعدادات المتاحة."
        : undefined,
  };
}

export function categoryReadinessLabel(readiness: string) {
  if (readiness === "ready") return "جاهزية الأسئلة: متاحة بحسب السجل المستورد";
  if (readiness === "drafting") return "جاهزية الأسئلة: قيد الإعداد";
  if (readiness === "empty") return "جاهزية الأسئلة: لا توجد أسئلة جاهزة بعد";
  return "جاهزية الأسئلة: غير مؤكدة";
}
