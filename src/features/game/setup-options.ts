import { availableCategoryCatalog } from "../../data/category-catalog";
import publicSourceCategoryIds from "../../data/source-category-ids.public.json";

export type MatchMode = "classic" | "fast" | "custom";
export type SetupGameKind = "huroof" | "categories";

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
const categoryIds = new Set([...availableCategoryCatalog.map(({ id }) => id), ...publicSourceCategoryIds.sourceCategoryIds]);
const maximumSelectedCategories = 10;

export const setupGameKindOptions: readonly {
  id: SetupGameKind;
  labelAr: string;
  descriptionAr: string;
}[] = [
  {
    id: "huroof",
    labelAr: "الحروف",
    descriptionAr: "لوح من خمسة وعشرين حرفاً مع خلايا مفاجآت مرقمة.",
  },
  {
    id: "categories",
    labelAr: "الفئات",
    descriptionAr: "لوح من أسماء الفئات، والرقم يميز تكرار الخلية وليس نقاطاً.",
  },
];

export const isMatchMode = (value: string | null): value is MatchMode =>
  value !== null && matchModeIds.has(value as MatchMode);

export const matchModeOption = (mode: MatchMode) =>
  matchModeOptions.find((option) => option.id === mode)!;

export interface SetupQuerySeed {
  demo: boolean;
  mode: MatchMode;
  gameKind: SetupGameKind;
  horizontal: string;
  opponentSeconds: number;
  questionSeconds: number;
  vertical: string;
  categories: string[];
  notice?: string;
}

export const isSetupGameKind = (value: string | null): value is SetupGameKind =>
  value === "huroof" || value === "categories";

/**
 * Reads only supported query values. This intentionally seeds a setup route once;
 * route components keep subsequent edits in local form state.
 */
export function parseSetupQuery(search: URLSearchParams): SetupQuerySeed {
  const requestedMode = search.get("mode");
  const requestedGameKind = search.get("kind");
  const mode = isMatchMode(requestedMode) ? requestedMode : "classic";
  const gameKind = isSetupGameKind(requestedGameKind) ? requestedGameKind : "huroof";
  const requestedCategories = search.getAll("category");
  const requestedQuestionSeconds = search.get("questionSeconds");
  const requestedOpponentSeconds = search.get("opponentSeconds");
  const requestedHorizontal = search.get("horizontal");
  const requestedVertical = search.get("vertical");
  const requestedDemo = search.get("demo");
  const parseSeconds = (value: string | null, fallback: number) =>
    value !== null && /^\d+$/.test(value) && Number(value) >= 10 && Number(value) <= 60
      ? Number(value)
      : fallback;
  const parseTeamName = (value: string | null, fallback: string) =>
    value !== null && value.trim().length > 0 && value.trim().length <= 48 && !/\p{Cc}/u.test(value)
      ? value.trim()
      : fallback;
  const questionSeconds = parseSeconds(requestedQuestionSeconds, 20);
  const opponentSeconds = parseSeconds(requestedOpponentSeconds, 10);
  const horizontal = parseTeamName(requestedHorizontal, "الأحمر");
  const vertical = parseTeamName(requestedVertical, "الأخضر");
  const demo = requestedDemo === "0" ? false : true;
  const categories = requestedCategories
    .filter((id, index) => categoryIds.has(id) && requestedCategories.indexOf(id) === index)
    .slice(0, maximumSelectedCategories);
  const hasInvalidMode = requestedMode !== null && !isMatchMode(requestedMode);
  const hasInvalidGameKind = requestedGameKind !== null && !isSetupGameKind(requestedGameKind);
  const hasInvalidCategory = requestedCategories.some((id) => !categoryIds.has(id));
  const hasInvalidSeconds =
    (requestedQuestionSeconds !== null && questionSeconds === 20 && requestedQuestionSeconds !== "20") ||
    (requestedOpponentSeconds !== null && opponentSeconds === 10 && requestedOpponentSeconds !== "10");
  const hasInvalidTeam =
    (requestedHorizontal !== null && horizontal === "الأحمر" && requestedHorizontal.trim() !== "الأحمر") ||
    (requestedVertical !== null && vertical === "الأخضر" && requestedVertical.trim() !== "الأخضر");
  const hasInvalidDemo = requestedDemo !== null && requestedDemo !== "0" && requestedDemo !== "1";

  return {
    demo,
    mode,
    gameKind,
    horizontal,
    opponentSeconds,
    questionSeconds,
    vertical,
    categories,
    notice:
      hasInvalidMode || hasInvalidGameKind || hasInvalidCategory || hasInvalidSeconds || hasInvalidTeam || hasInvalidDemo || requestedCategories.length > maximumSelectedCategories
        ? "تجاهلنا اختيارات غير مدعومة من الرابط واستخدمنا الإعدادات المتاحة."
        : undefined,
  };
}

/** Serializes only the route-owned setup state so a refresh or shared link keeps the choice. */
export function setupQueryString({
  categories,
  demo,
  gameKind,
  horizontal,
  mode,
  opponentSeconds,
  questionSeconds,
  vertical,
}: Pick<SetupQuerySeed, "categories" | "demo" | "gameKind" | "horizontal" | "mode" | "opponentSeconds" | "questionSeconds" | "vertical">) {
  const params = new URLSearchParams({ kind: gameKind, mode });
  if (horizontal !== "الأحمر") params.set("horizontal", horizontal);
  if (vertical !== "الأخضر") params.set("vertical", vertical);
  if (questionSeconds !== 20) params.set("questionSeconds", String(questionSeconds));
  if (opponentSeconds !== 10) params.set("opponentSeconds", String(opponentSeconds));
  if (!demo) params.set("demo", "0");
  categories.forEach((category) => params.append("category", category));
  return params.toString();
}

export function categoryReadinessLabel(readiness: string) {
  if (readiness === "ready") return "جاهزية الأسئلة: متاحة بحسب السجل المستورد";
  if (readiness === "drafting") return "جاهزية الأسئلة: قيد الإعداد";
  if (readiness === "empty") return "جاهزية الأسئلة: لا توجد أسئلة جاهزة بعد";
  return "جاهزية الأسئلة: غير مؤكدة";
}
