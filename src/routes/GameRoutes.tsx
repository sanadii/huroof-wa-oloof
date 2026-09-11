import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as QRCode from "qrcode";
import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { ThemeToggle } from "../design-system/ThemeToggle";
import { AuthAccountControl } from "../features/auth/AuthAccountControl";
import { QuestionReveal } from "../features/ui/QuestionReveal";
import {
  availableCategoryCatalog as legacyAvailableCategoryCatalog,
  categoryCatalog,
} from "../data/category-catalog";
import {
  fetchLocalQuestionInventory,
  catalogCategoryCovers,
  inventoryCategoryCovers,
  staticPreviewQuestionInventory,
  type LocalQuestionInventory,
} from "../data/local-question-inventory";
import {
  categoryTopics,
  filterCategories,
  type CategoryTopicId,
} from "../data/category-filters";
import {
  approvedCategoryPlayable,
  localCategoryPlayable,
} from "../data/category-playability";
import { GameBoard, type BoardCell } from "../features/board/game-board";
import { generateBoard } from "../features/game/domain/board";
import {
  matchModeOptions,
  parseSetupQuery,
  setupGameKindOptions,
  setupQueryString,
} from "../features/game/setup-options";
import { connectionLabel, stateLabel } from "../features/ui/game-state";
import type {
  HostPresenceSnapshot,
  ApprovedReleaseCatalog,
  IntentType,
  PlayerPresenceState,
  ProjectionEnvelope,
  SafeProjection,
} from "../features/game/runtime/contracts";
import { gameRuntime } from "../features/game/runtime";
import {
  isStaticPreviewBuild,
  staticPreviewNotice,
} from "../features/game/runtime/static-preview";

type StoredCapability = { token: string; role: "host" | "player" | "audience" };
type ViewProjection = SafeProjection & {
  question?: {
    headerAr?: string;
    promptAr?: string;
    primaryAnswer?: string;
    acceptedAnswers?: string[];
    revealedAnswer?: string;
    occurrence?: string;
    sources?: Array<{ title?: string; url?: string }>;
    media?: { mediaId: string; assetSha256: string; altAr: string; type?: "image" | "video"; contentType?: string };
  };
  audit?: Array<{ revision: number; type: string; payload?: unknown }>;
};
type CurrentQuestionMediaGrant = {
  mediaId: string;
  assetSha256: string;
  url: string;
  expiresAt: string;
};
type CurrentQuestionMediaRequest = {
  roomId: string;
  mediaId: string;
  assetSha256: string;
};
const revokeObjectUrl = (url: string) => {
  if (url.startsWith("blob:") && typeof URL.revokeObjectURL === "function")
    URL.revokeObjectURL(url);
};

/** Loads only a current server-authorized grant and clears it before its bearer expiry. */
export function CurrentQuestionMedia({
  roomId,
  media,
  load,
}: {
  roomId: string;
  media: { mediaId: string; assetSha256: string; altAr: string; type?: "image" | "video"; contentType?: string };
  load?: (
    request: CurrentQuestionMediaRequest,
  ) => Promise<CurrentQuestionMediaGrant>;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const activeUrl = useRef("");
  const activeBinding = useRef("");
  const binding = `${roomId}\u0000${media.mediaId}\u0000${media.assetSha256}`;
  const request = useCallback(() => {
    const value = {
      roomId,
      mediaId: media.mediaId,
      assetSha256: media.assetSha256,
    };
    if (load) return load(value);
    // Keep the adapter receiver intact: both local and deferred adapters use this.
    return (
      gameRuntime.getCurrentQuestionMedia?.(value) ??
      Promise.reject(new Error("MEDIA_UNAVAILABLE"))
    );
  }, [load, media.assetSha256, media.mediaId, roomId]);
  // A reauthorization for the same immutable video must not replace its Blob
  // URL: replacing src would make the native autoplay attribute replay it.
  useEffect(
    () => () => {
      revokeObjectUrl(activeUrl.current);
      activeUrl.current = "";
      activeBinding.current = "";
    },
    [binding],
  );
  useEffect(() => {
    let alive = true;
    let receivedUrl = "";
    let refreshTimer: number | undefined;
    const preserveVideo =
      media.type === "video" &&
      activeBinding.current === binding &&
      Boolean(activeUrl.current);
    if (!preserveVideo) {
      setUrl("");
      setFailed(false);
    }
    void request()
      .then((value) => {
        if (!alive) {
          revokeObjectUrl(value.url);
          return;
        }
        const expiresAtMs = Date.parse(value.expiresAt);
        if (
          typeof value.url !== "string" ||
          value.mediaId !== media.mediaId ||
          value.assetSha256 !== media.assetSha256 ||
          !Number.isFinite(expiresAtMs) ||
          expiresAtMs <= Date.now()
        ) {
          setFailed(true);
          return;
        }
        receivedUrl = value.url;
        if (preserveVideo) revokeObjectUrl(value.url);
        else {
          revokeObjectUrl(activeUrl.current);
          activeBinding.current = binding;
          activeUrl.current = value.url;
          setUrl(value.url);
        }
        refreshTimer = window.setTimeout(
          () => setRefresh((current) => current + 1),
          Math.max(0, expiresAtMs - Date.now() - 1_000),
        );
      })
      .catch(() => {
        if (alive && !preserveVideo) setFailed(true);
      });
    return () => {
      alive = false;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      if (receivedUrl && receivedUrl !== activeUrl.current)
        revokeObjectUrl(receivedUrl);
    };
  }, [binding, media.type, refresh, request]);
  if (failed)
    return (
      <section
        className="question-media"
        aria-live="polite"
        data-testid="question-media-error"
      >
        <p>تعذر تحميل وسائط السؤال.</p>
        <button
          className="button button--quiet"
          onClick={() => setRefresh((value) => value + 1)}
          type="button"
        >
          أعد المحاولة
        </button>
      </section>
    );
  return (
    <figure
      className="question-media"
      aria-busy={!url}
      data-testid="question-media"
    >
      {url && media.type === "video" ? (
        <video autoPlay controls muted onError={() => setFailed(true)} playsInline src={url} />
      ) : url ? (
        <img alt={media.altAr} onError={() => setFailed(true)} src={url} />
      ) : (
        <p aria-live="polite">جارٍ تحميل وسائط السؤال…</p>
      )}
    </figure>
  );
}
const capabilityKey = (id: string) => `huroof:${id}`;
const audienceCapabilityKey = (id: string) => `huroof:${id}:audience`;
const capabilityFor = (id: string) => {
  try {
    const value = sessionStorage.getItem(capabilityKey(id));
    return value ? (JSON.parse(value) as StoredCapability) : undefined;
  } catch {
    return undefined;
  }
};
const audienceCapabilityFor = (id: string) => {
  try {
    const value = sessionStorage.getItem(audienceCapabilityKey(id));
    return value ? (JSON.parse(value) as StoredCapability) : undefined;
  } catch {
    return undefined;
  }
};
const saveCapability = (id: string, value: StoredCapability) =>
  sessionStorage.setItem(capabilityKey(id), JSON.stringify(value));
const saveAudienceCapability = (id: string, value: StoredCapability) =>
  sessionStorage.setItem(audienceCapabilityKey(id), JSON.stringify(value));
export const readableError = (error: unknown) => {
  const message =
    error instanceof Error ? error.message.replace(/^Error:\s*/, "") : "";
  if (message === "STALE_REVISION")
    return "تغيّرت الغرفة للتو. راجع الحالة الحالية ثم حاول مرة أخرى.";
  if (
    message === "PROJECTION_UNAVAILABLE" ||
    message === "CAPABILITY_UNAVAILABLE"
  )
    return "تعذر التحقق من جلسة الغرفة. أعد فتح الرابط ثم حاول مرة أخرى.";
  if (
    message === "QUESTION_SCOPE_INSUFFICIENT_COVERAGE" ||
    /(?:Insufficient 16 visible \+ 9 surprise letter coverage|Pinned release has insufficient 16 visible \+ 9 surprise coverage)/.test(
      message,
    )
  )
    return "لا تكفي الأسئلة في الفئات المختارة لتجهيز لوحة المباراة. اختر «استخدام كل الفئات» أو أضف «معلومات عامة».";
  if (message === "SELECTED_SCOPE_NOT_PLAYABLE")
    return "الفئات المختارة لا تكفي للوحة المطلوبة في الحزمة المعتمدة. غيّر الاختيار ثم حاول مرة أخرى.";
  if (message === "ACTIVE_RELEASE_CHANGED")
    return "تغيّرت الحزمة المعتمدة. حدّث الإعدادات للتحقق من الفهرس الجديد.";
  return message || "تعذر إتمام العملية.";
};
type LocalIntentResponse = {
  projection?: ProjectionEnvelope<ViewProjection>;
  error?: string;
  stale?: boolean;
};
/** A local stale response is HTTP-successful but not an accepted user action. */
export function applyLocalIntentResponse(
  result: LocalIntentResponse,
  setProjection: (projection: ProjectionEnvelope<ViewProjection>) => void,
) {
  if (result.projection) setProjection(result.projection);
  if (result.stale) throw new Error("STALE_REVISION");
}

const previewLetters = [
  "أ",
  "ب",
  "ت",
  "ث",
  "ج",
  "ح",
  "خ",
  "د",
  "ذ",
  "ر",
  "ز",
  "س",
  "ش",
  "ص",
  "ض",
  "ط",
];
/** Stable, rule-generated board while a room projection is still loading. */
export const previewBoardCells: BoardCell[] = generateBoard(
  0x4855524f,
  previewLetters,
).cells;
export const isReadOnlyFixtureRoom = (
  runtimeKind: "fixture" | "firebase" | "local",
  roomId?: string,
) => runtimeKind === "fixture" && roomId === "fixture-room";
function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | تحدي الخلية`;
  }, [title]);
}
const teamName = (name?: string) =>
  name?.trim().startsWith("فريق")
    ? name.trim()
    : `فريق ${name?.trim() || "غير محدد"}`;
export const canDispatchLobbyStart = (state: string, canStart?: boolean) =>
  state === "LOBBY" && canStart === true;
const teamManagementStates = new Set([
  "LOBBY",
  "ROUND_SETUP",
  "CELL_SELECTION",
  "QUESTION_FAILED",
  "ROUND_COMPLETE",
]);
export const canManageTeamsInState = (state: string) =>
  teamManagementStates.has(state);

type SecureRandomSource = Pick<Crypto, "getRandomValues"> &
  Partial<Pick<Crypto, "randomUUID">>;

/**
 * `crypto.randomUUID()` is unavailable on some HTTP LAN origins. Keep intent
 * IDs unique there with the same Web Crypto source instead of weakening them
 * with a pseudo-random fallback.
 */
export function createGameIntentId(source?: SecureRandomSource) {
  const secureRandom = source ?? globalThis.crypto;
  if (!secureRandom || typeof secureRandom.getRandomValues !== "function")
    throw new Error("SECURE_RANDOM_UNAVAILABLE");
  if (typeof secureRandom.randomUUID === "function")
    return secureRandom.randomUUID();

  const bytes = secureRandom.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function normalizedJoinOrigin(value: string | undefined) {
  if (!value?.trim()) return undefined;
  try {
    const origin = new URL(value.trim());
    const hostname = origin.hostname.toLowerCase().replace(/\.+$/, "");
    const ipv6 = hostname.replace(/^\[|\]$/g, "");
    const mappedIpv4 = ipv6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    const mappedIpv4Value = mappedIpv4
      ? Number.parseInt(mappedIpv4[1], 16) * 0x1_0000 +
        Number.parseInt(mappedIpv4[2], 16)
      : undefined;
    const loopback =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      ipv6 === "::1" ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname === "0.0.0.0" ||
      ipv6 === "::" ||
      (mappedIpv4Value !== undefined &&
        mappedIpv4Value >= 0x7f00_0000 &&
        mappedIpv4Value <= 0x7fff_ffff);
    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:") ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      loopback
    )
      return undefined;
    return origin.origin;
  } catch {
    return undefined;
  }
}

export function playerJoinUrl(origin: string | undefined, roomCode: string) {
  const safeOrigin = normalizedJoinOrigin(origin);
  if (!safeOrigin || !roomCode) return undefined;
  const url = new URL("/", safeOrigin);
  url.searchParams.set("room", roomCode);
  return url.toString();
}

export function currentRoomDestination(
  roomCode: string | undefined,
  role: "host" | "player" | "audience" | undefined,
) {
  if (!roomCode || !role) return undefined;
  const surface =
    role === "host" ? "host" : role === "player" ? "play" : "display";
  return `/room/${encodeURIComponent(roomCode)}/${surface}`;
}

export function resultRouteState(
  roomCode: string | undefined,
  role: "host" | "player" | "audience" | undefined,
  state: string,
) {
  const isFinal = state === "MATCH_COMPLETE";
  return {
    isFinal,
    returnTo: isFinal ? undefined : currentRoomDestination(roomCode, role),
  };
}

/** Keeps a completed host's next-match link on the setup route with its chosen scope. */
export function sameSettingsNewMatchHref(
  settings: SafeProjection["room"]["matchSettings"] | undefined,
) {
  if (!settings) return "/host/new";
  const search = setupQueryString({
    categories: settings.categories,
    demo: settings.demo,
    gameKind: settings.gameKind ?? "huroof",
    horizontal: settings.teams.horizontal,
    mode: settings.mode,
    opponentSeconds: settings.opponentSeconds,
    questionSeconds: settings.questionSeconds,
    vertical: settings.teams.vertical,
  });
  return `/host/new?${search}`;
}

export function activeLobbyDestination(
  roomCode: string | undefined,
  surface: "lobby" | "host" | "play" | "display" | "results",
  role: "host" | "player" | "audience" | undefined,
  state: string | undefined,
) {
  if (!roomCode || surface !== "lobby" || !state || state === "LOBBY")
    return undefined;
  if (role === "host" || role === "player")
    return currentRoomDestination(roomCode, role);
  return undefined;
}

export function AppHeader() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        تجاوز إلى المحتوى
      </a>
      <header className="app-header">
        <Link className="wordmark" to="/">
          تحدي الخلية
        </Link>
        <nav aria-label="التنقل الرئيسي">
          <NavLink to="/how-to-play">كيف تلعب؟</NavLink>
          <NavLink to="/questions">الأسئلة</NavLink>
        </nav>
        <AuthAccountControl />
        <ThemeToggle />
      </header>
    </>
  );
}
const AxisMark = ({ axis }: { axis: "horizontal" | "vertical" }) => (
  <span className={`axis-mark axis-mark--${axis}`}>
    {axis === "horizontal" ? "↔ الأحمر" : "↕ الأخضر"}
  </span>
);
const defaultCategoryCover = "/assets/categories/320/category-006.webp";
const maximumSelectedCategories = 10;
const setupGameKindCardDescriptions = {
  huroof: "إجابات تبدأ بحرف الخلية",
  categories: "أسئلة من الفئات التي تختارها",
} as const;

function SetupGameKindIcon({ kind }: { kind: "huroof" | "categories" }) {
  return kind === "huroof" ? (
    <svg aria-hidden="true" className="setup-kind-selector__icon" viewBox="0 0 24 24">
      <path d="m12 3 7 4v10l-7 4-7-4V7zM9 9h6M9 12h6M9 15h6" />
    </svg>
  ) : (
    <svg aria-hidden="true" className="setup-kind-selector__icon" viewBox="0 0 24 24">
      <path d="M5 5.5h5v5H5zM14 5.5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" />
    </svg>
  );
}

export function HostNewRoute() {
  useDocumentTitle("إنشاء مباراة");
  const navigate = useNavigate();
  const staticPreview = isStaticPreviewBuild();
  const location = useLocation();
  const querySeed = useRef(
    parseSetupQuery(new URLSearchParams(location.search)),
  );
  const [form, setForm] = useState({
    demo: querySeed.current.demo,
    gameKind: querySeed.current.gameKind,
    mode: querySeed.current.mode,
    horizontal: querySeed.current.horizontal,
    vertical: querySeed.current.vertical,
    questionSeconds: querySeed.current.questionSeconds,
    opponentSeconds: querySeed.current.opponentSeconds,
    categories: querySeed.current.categories,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryTopic, setCategoryTopic] = useState<CategoryTopicId | "all">(
    "all",
  );
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [unavailableCovers, setUnavailableCovers] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionLimitMessage, setSelectionLimitMessage] = useState("");
  const [localQuestionInventory, setLocalQuestionInventory] =
    useState<LocalQuestionInventory>();
  const [localQuestionInventoryError, setLocalQuestionInventoryError] =
    useState("");
  const [inventoryAttempt, setInventoryAttempt] = useState(0);
  const [approvedReleaseCatalog, setApprovedReleaseCatalog] = useState<ApprovedReleaseCatalog>();
  const [approvedReleaseCatalogError, setApprovedReleaseCatalogError] = useState("");
  const [approvedReleaseCatalogAttempt, setApprovedReleaseCatalogAttempt] = useState(0);
  const firebaseRuntime = gameRuntime.kind === "firebase";
  const modeControls = useRef<Array<HTMLButtonElement | null>>([]);
  const kindControls = useRef<Array<HTMLButtonElement | null>>([]);
  const categoryFilterControl = useRef<HTMLInputElement | null>(null);
  const removalControls = useRef<Record<string, HTMLButtonElement | null>>({});
  const [removalFocusTarget, setRemovalFocusTarget] = useState<string>();
  useEffect(() => {
    if (staticPreview || gameRuntime.kind !== "local") return;
    let active = true;
    void fetchLocalQuestionInventory()
      .then((inventory) => {
        if (active) {
          setLocalQuestionInventory(inventory);
          setLocalQuestionInventoryError("");
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setLocalQuestionInventoryError(
            reason instanceof Error
              ? reason.message
              : "تعذر تحميل فهرس أسئلة التجربة المحلية.",
          );
      });
    return () => {
      active = false;
    };
  }, [inventoryAttempt, staticPreview]);
  useEffect(() => {
    if (staticPreview || !firebaseRuntime) return;
    let active = true;
    void (gameRuntime.getApprovedReleaseCatalog?.() ?? Promise.reject(new Error("APPROVED_RELEASE_CATALOG_UNAVAILABLE")))
      .then((catalog) => {
        if (!active) return;
        setApprovedReleaseCatalog(catalog);
        setApprovedReleaseCatalogError("");
      })
      .catch(() => {
        if (!active) return;
        setApprovedReleaseCatalog(undefined);
        setApprovedReleaseCatalogError("تعذر الاتصال بخدمة اللعبة أو التحقق من إعدادات الاتصال. أعد المحاولة لاحقاً.");
      });
    return () => { active = false; };
  }, [approvedReleaseCatalogAttempt, firebaseRuntime, staticPreview]);
  const activeQuestionInventory = localQuestionInventory ?? (staticPreview ? staticPreviewQuestionInventory : undefined);
  const localCategoryById = useMemo(
    () =>
      new Map(
        activeQuestionInventory?.categories.map((category) => [
          category.id,
          category,
        ]) ?? [],
      ),
    [activeQuestionInventory],
  );
  const categorySelectionAllowed = useCallback((id: string) => {
    if (firebaseRuntime)
      return approvedCategoryPlayable(
        approvedReleaseCatalog?.categories.find((category) => category.id === id),
        form.gameKind,
      );
    if (!activeQuestionInventory) return true;
    return localCategoryPlayable(
      localCategoryById.get(id),
      form.gameKind,
      activeQuestionInventory.huroofAvailable,
    );
  }, [activeQuestionInventory, approvedReleaseCatalog, firebaseRuntime, form.gameKind, localCategoryById]);
  const categoryCatalogue = useMemo(() => {
    if (localQuestionInventoryError) return [];
    if (firebaseRuntime)
      return approvedReleaseCatalog ? catalogCategoryCovers(approvedReleaseCatalog.categories) : [];
    const inventory = localQuestionInventory ?? (staticPreview ? staticPreviewQuestionInventory : undefined);
    return inventory ? inventoryCategoryCovers(inventory) : legacyAvailableCategoryCatalog;
  }, [approvedReleaseCatalog, firebaseRuntime, localQuestionInventory, localQuestionInventoryError, staticPreview]);
  const availableCategoryCatalog = useMemo(
    () => categoryCatalogue.filter((category) => categorySelectionAllowed(category.id)),
    [categoryCatalogue, categorySelectionAllowed],
  );
  const firebaseSelectedModeUnavailable = Boolean(
    firebaseRuntime && approvedReleaseCatalog && !approvedReleaseCatalog.boardCapabilities[form.gameKind],
  );
  const firebaseSelectedModeMessage = "الأسئلة المعتمدة الحالية لا تكفي لهذا النمط. اختر نمطاً متاحاً أو حدّث الحزمة.";
  useEffect(() => {
    if (!activeQuestionInventory && (!firebaseRuntime || !approvedReleaseCatalog)) return;
    setForm((current) => {
      const categories = current.categories.filter((id) => categorySelectionAllowed(id));
      return categories.length === current.categories.length
        ? current
        : { ...current, categories };
    });
  }, [activeQuestionInventory, approvedReleaseCatalog, categorySelectionAllowed, firebaseRuntime]);
  const availableCategoryTopics = useMemo(
    () =>
      categoryTopics.flatMap((topic) => {
        const count = availableCategoryCatalog.filter((category) =>
          topic.categoryIds.includes(category.id),
        ).length;
        return count ? [{ topic, count }] : [];
      }),
    [availableCategoryCatalog],
  );
  const visibleCategories = useMemo(() => {
    return filterCategories(availableCategoryCatalog, {
      query: categoryQuery,
      selectedIds: form.categories,
      selectedOnly,
      topicId: categoryTopic,
    });
  }, [
    availableCategoryCatalog,
    categoryQuery,
    categoryTopic,
    form.categories,
    selectedOnly,
  ]);
  const selectedCategories = useMemo(
    () =>
      form.categories.flatMap((id) => {
        const category = availableCategoryCatalog.find(
          (candidate) => candidate.id === id,
        );
        return category ? [category] : [];
      }),
    [availableCategoryCatalog, form.categories],
  );
  const update = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    const search = setupQueryString(form);
    if (location.search.slice(1) !== search)
      navigate(
        { pathname: location.pathname, search: `?${search}` },
        { replace: true },
      );
  }, [
    form.categories,
    form.demo,
    form.gameKind,
    form.horizontal,
    form.mode,
    form.opponentSeconds,
    form.questionSeconds,
    form.vertical,
    location.pathname,
    location.search,
    navigate,
  ]);
  const selectMode = (index: number, focus = false) => {
    const normalizedIndex =
      (index + matchModeOptions.length) % matchModeOptions.length;
    update("mode", matchModeOptions[normalizedIndex].id);
    if (focus) modeControls.current[normalizedIndex]?.focus();
  };
  const handleModeKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const nextIndex =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? matchModeOptions.length - 1
              : undefined;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectMode(nextIndex, true);
  };
  const selectGameKind = (index: number, focus = false) => {
    const normalizedIndex =
      (index + setupGameKindOptions.length) % setupGameKindOptions.length;
    update("gameKind", setupGameKindOptions[normalizedIndex].id);
    if (focus) kindControls.current[normalizedIndex]?.focus();
  };
  const handleGameKindKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const nextIndex =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? setupGameKindOptions.length - 1
              : undefined;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectGameKind(nextIndex, true);
  };
  const toggleCategory = (id: string) => {
    if (!categorySelectionAllowed(id)) return;
    const isSelected = form.categories.includes(id);
    if (!isSelected && form.categories.length >= maximumSelectedCategories) {
      setSelectionLimitMessage(
        `يمكن اختيار ${maximumSelectedCategories} فئات كحد أقصى.`,
      );
      return;
    }
    setSelectionLimitMessage("");
    update(
      "categories",
      isSelected
        ? form.categories.filter((item) => item !== id)
        : [...form.categories, id],
    );
  };
  const removeSelectedCategory = (id: string) => {
    const index = selectedCategories.findIndex(
      (category) => category.id === id,
    );
    const remaining = selectedCategories.filter(
      (category) => category.id !== id,
    );
    setRemovalFocusTarget(
      remaining[index]?.id ?? remaining[index - 1]?.id ?? "filter",
    );
    toggleCategory(id);
  };
  useEffect(() => {
    if (!removalFocusTarget) return;
    if (removalFocusTarget === "filter") categoryFilterControl.current?.focus();
    else removalControls.current[removalFocusTarget]?.focus();
    setRemovalFocusTarget(undefined);
  }, [removalFocusTarget, selectedCategories]);
  const resetCategoryFilters = () => {
    setCategoryQuery("");
    setCategoryTopic("all");
    setSelectedOnly(false);
  };
  const categoryFiltersActive =
    categoryQuery.trim().length > 0 || categoryTopic !== "all" || selectedOnly;
  async function create(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (staticPreview) {
      setError(staticPreviewNotice);
      return;
    }
    if (firebaseRuntime && !approvedReleaseCatalog) {
      setError(approvedReleaseCatalogError || "جارٍ التحقق من الحزمة المعتمدة قبل إنشاء الغرفة.");
      return;
    }
    const releaseCatalog = approvedReleaseCatalog;
    if (firebaseRuntime && !releaseCatalog!.boardCapabilities[form.gameKind]) {
      setError("لا توجد تغطية معتمدة كافية لنوع اللوح المحدد. اختر نوعاً آخر أو انتظر نشر حزمة مكتملة.");
      return;
    }
    if (localQuestionInventory && !form.demo) {
      setError(
        "أسئلة قاعدة البيانات المحلية مسودات للتجربة فقط؛ فعّل وضع التجربة أو استخدم المصدر المعتمد.",
      );
      return;
    }
    if (
      localQuestionInventory &&
      form.gameKind === "huroof" &&
      !localQuestionInventory.huroofAvailable
    ) {
      setError(
        "لا توجد تغطية حروف كافية في مصدر التجربة المحلي لهذه المباراة.",
      );
      return;
    }
    if (form.gameKind === "categories" && selectedCategories.length < 2) {
      setError(
        "لإنشاء لعبة الفئات، اختر فئتين مختلفتين على الأقل من الفئات المختارة.",
      );
      categoryFilterControl.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const request = {
        displayName: "المضيف",
        demo: firebaseRuntime ? releaseCatalog?.demoFixture === true : form.demo,
        ...(firebaseRuntime && releaseCatalog ? { expectedRelease: { releaseId: releaseCatalog.releaseId, releaseRootSha256: releaseCatalog.releaseRootSha256 } } : {}),
        gameKind: form.gameKind,
        mode: form.mode,
        modality: "classic" as const,
        questionSeconds: form.questionSeconds,
        opponentSeconds: form.opponentSeconds,
        teams: { horizontal: form.horizontal, vertical: form.vertical },
        categories: selectedCategories.length
          ? selectedCategories.map((category) => category.id)
          : form.gameKind === "huroof" &&
              localQuestionInventory?.recommendedHuroofCategoryIds?.length
            ? localQuestionInventory.recommendedHuroofCategoryIds
            : availableCategoryCatalog.map((category) => category.id),
      };
      const body =
        gameRuntime.kind === "fixture"
          ? await fetch("/api/rooms", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(request),
            }).then(async (response) => {
              if (!response.ok)
                throw new Error(
                  ((await response.json()) as { error?: string }).error ??
                    "تعذر إنشاء الغرفة.",
                );
              return response.json() as Promise<{
                roomId: string;
                roomCode: string;
                token: string;
              }>;
            })
          : await gameRuntime.createRoom(request);
      if (!body.roomId || !body.roomCode) throw new Error("تعذر إنشاء الغرفة.");
      saveCapability(body.roomId, { token: body.token ?? "", role: "host" });
      sessionStorage.setItem(`huroof:code:${body.roomCode}`, body.roomId);
      navigate(`/room/${body.roomCode}/lobby`);
    } catch (reason) {
      setError(readableError(reason));
      if (
        firebaseRuntime &&
        reason instanceof Error &&
        reason.message.replace(/^Error:\s*/, "") === "ACTIVE_RELEASE_CHANGED"
      )
        setApprovedReleaseCatalogAttempt((attempt) => attempt + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      className="app-page spatial-shell spatial-shell--setup"
      id="main-content"
    >
      <AppHeader />
      <section
        className="setup-page spatial-setup"
        aria-labelledby="setup-title"
      >
        <div>
          <p className="eyebrow">إعداد المباراة</p>
          <h1 id="setup-title">أنشئ مباراة</h1>
          {staticPreview ? <p className="form-message" role="status">{staticPreviewNotice}</p> : null}
        </div>
        <form className="setup-form" id="match-setup-form" onSubmit={create}>
          <section>
            <h2>نوع اللوح</h2>
            <div
              className="setup-kind-selector"
              role="radiogroup"
              aria-label="نوع اللوح"
            >
              {setupGameKindOptions.map((kind, index) => (
                <button
                  aria-checked={form.gameKind === kind.id}
                  aria-describedby={`setup-kind-${kind.id}-description`}
                  aria-label={kind.labelAr}
                  className={form.gameKind === kind.id ? "is-selected" : ""}
                  key={kind.id}
                  onClick={() => selectGameKind(index)}
                  onKeyDown={(event) => handleGameKindKeyDown(event, index)}
                  ref={(element) => {
                    kindControls.current[index] = element;
                  }}
                  role="radio"
                  tabIndex={form.gameKind === kind.id ? 0 : -1}
                  type="button"
                >
                  <SetupGameKindIcon kind={kind.id} />
                  <strong>{kind.labelAr}</strong>
                  <small id={`setup-kind-${kind.id}-description`}>
                    {setupGameKindCardDescriptions[kind.id]}
                  </small>
                  <span aria-hidden="true" className="setup-kind-selector__check">✓</span>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h2>المباراة</h2>
            <div
              className="segmented"
              role="radiogroup"
              aria-label="نمط المباراة"
            >
              {matchModeOptions.map((mode, index) => (
                <button
                  aria-checked={form.mode === mode.id}
                  className={form.mode === mode.id ? "is-selected" : ""}
                  key={mode.id}
                  onClick={() => selectMode(index)}
                  onKeyDown={(event) => handleModeKeyDown(event, index)}
                  ref={(element) => {
                    modeControls.current[index] = element;
                  }}
                  role="radio"
                  tabIndex={form.mode === mode.id ? 0 : -1}
                  type="button"
                >
                  {mode.labelAr}
                </button>
              ))}
            </div>
            <p className="field-note">
              {
                matchModeOptions.find((mode) => mode.id === form.mode)
                  ?.descriptionAr
              }
            </p>
            <p className="field-note">
              تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات إجمالاً
            </p>
          </section>
          <section className="team-fields">
            <h2>الفريقان</h2>
            <label className="team-card team-card--horizontal">
              <span className="team-card__header">
                الفريق الأحمر <AxisMark axis="horizontal" />
              </span>
              <input
                aria-label="اسم الفريق الأحمر ↔ الأحمر"
                value={form.horizontal}
                onChange={(event) => update("horizontal", event.target.value)}
              />
            </label>
            <label className="team-card team-card--vertical">
              <span className="team-card__header">
                الفريق الأخضر <AxisMark axis="vertical" />
              </span>
              <input
                aria-label="اسم الفريق الأخضر ↕ الأخضر"
                value={form.vertical}
                onChange={(event) => update("vertical", event.target.value)}
              />
            </label>
          </section>
          <section className="timing-fields">
            <h2>التوقيت</h2>
            <label>
              وقت السؤال
              <input
                min="10"
                max="60"
                type="number"
                value={form.questionSeconds}
                onChange={(event) =>
                  update("questionSeconds", Number(event.target.value))
                }
              />
            </label>
            <label>
              فرصة الخصم
              <input
                min="10"
                max="60"
                type="number"
                value={form.opponentSeconds}
                onChange={(event) =>
                  update("opponentSeconds", Number(event.target.value))
                }
              />
            </label>
          </section>
          <section>
            <h2>الفئات</h2>
            <p className="field-note category-filter__hint">
              {form.gameKind === "categories"
                ? "اختر من فئتين إلى عشر فئات. لا يُستبدل النقص بفئة غير مختارة."
                : "اختر فئات محددة، أو اترك الاختيار فارغاً لاستخدام كل الفئات في ترشيح الأسئلة."}
            </p>
            {localQuestionInventory ? (
              <p className="field-note" role="status">
                أسئلة مستوردة للتجربة المحلية وليست إصداراً معتمداً.
              </p>
            ) : null}
            {staticPreview ? (
              <p className="field-note" role="status">
                يعرض هذا الفهرس محتوى معاينة الواجهة فقط، ولا يثبت توفره للعب المنشور.
              </p>
            ) : null}
            {localQuestionInventoryError ? (
              <div role="alert">
                <p className="field-note">{localQuestionInventoryError}</p>
                <button
                  className="button"
                  type="button"
                  onClick={() => setInventoryAttempt((attempt) => attempt + 1)}
                >
                  إعادة المحاولة
                </button>
              </div>
            ) : null}
            <div className="category-filter" role="search">
              <label>
                <span>تصفية الفئات</span>
                <input
                  aria-label="تصفية الفئات"
                  onChange={(event) => setCategoryQuery(event.target.value)}
                  placeholder="ابحث باسم الفئة"
                  ref={categoryFilterControl}
                  type="search"
                  value={categoryQuery}
                />
              </label>
              <div className="category-filter__controls">
                <label>
                  <span>الموضوع</span>
                  <select
                    aria-label="الموضوع"
                    onChange={(event) =>
                      setCategoryTopic(
                        event.target.value as CategoryTopicId | "all",
                      )
                    }
                    value={categoryTopic}
                  >
                    <option value="all">
                      كل الموضوعات ({availableCategoryCatalog.length})
                    </option>
                    {availableCategoryTopics.map(({ topic, count }) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.labelAr} ({count})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="category-filter__selected-only">
                  <input
                    checked={selectedOnly}
                    onChange={(event) => setSelectedOnly(event.target.checked)}
                    type="checkbox"
                  />
                  <span>الفئات المختارة فقط</span>
                </label>
              </div>
              <div className="category-filter__meta">
                <small aria-live="polite">
                  {visibleCategories.length} من{" "}
                  {availableCategoryCatalog.length} فئة
                </small>
                <button
                  className="category-filter__reset"
                  disabled={!categoryFiltersActive}
                  onClick={resetCategoryFilters}
                  type="button"
                >
                  إعادة ضبط التصفية
                </button>
              </div>
            </div>
            <div className="category-filter__scope" aria-live="polite">
              <p>
                {form.gameKind === "categories" && form.categories.length === 0
                  ? "اختر فئتين مختلفتين على الأقل لتجهيز لوحة الفئات."
                  : form.gameKind === "categories" &&
                      form.categories.length === 1
                    ? "اختر فئة ثانية: لا تكفي فئة واحدة لتدوير خلية فئات عند الفشل."
                    : form.categories.length === 0
                      ? `كل الفئات المتاحة (${availableCategoryCatalog.length}) ستدخل في ترشيح الأسئلة.`
                      : `سيجري ترشيح الأسئلة من ${form.categories.length} فئة مختارة.`}
              </p>
              {form.categories.length > 0 ? (
                <button
                  className="category-filter__all"
                  onClick={() => {
                    setSelectionLimitMessage("");
                    update("categories", []);
                  }}
                  type="button"
                >
                  استخدام كل الفئات
                </button>
              ) : null}
            </div>
            <div className="category-grid">
              {visibleCategories.map((category) =>
                (() => {
                  const isFallbackCover = unavailableCovers.has(category.id);
                  return (
                    <button
                      aria-label={`${category.displayNameAr}${form.categories.includes(category.id) ? " — محددة" : " — أضف إلى الاختيار"}`}
                      aria-pressed={form.categories.includes(category.id)}
                      className={`category-choice ${form.categories.includes(category.id) ? "is-selected" : ""}`}
                      key={category.id}
                      onClick={() => toggleCategory(category.id)}
                      type="button"
                    >
                      <img
                        alt={
                          isFallbackCover
                            ? `صورة افتراضية لفئة ${category.displayNameAr}`
                            : category.cover.altAr
                        }
                        onError={() => {
                          if (!isFallbackCover)
                            setUnavailableCovers((current) =>
                              new Set(current).add(category.id),
                            );
                        }}
                        src={
                          isFallbackCover
                            ? defaultCategoryCover
                            : `/${category.cover.web320}`
                        }
                      />
                      <span className="category-choice__title">
                        {category.displayNameAr}
                      </span>
                    </button>
                  );
                })(),
              )}
              {visibleCategories.length === 0 ? (
                <p className="category-filter__empty" role="status">
                  {selectedOnly && form.categories.length === 0
                    ? "لا توجد فئات مختارة بعد. اختر فئة ثم فعّل هذا الخيار."
                    : "لا توجد فئات مطابقة. أعد ضبط التصفية لعرض كل الفئات."}
                </p>
              ) : null}
            </div>
          </section>
          {selectedCategories.length > 0 ? (
            <aside
              className="selected-categories-bar"
              aria-label="الفئات المختارة"
            >
              <div className="selected-categories-bar__heading">
                <strong>الفئات المختارة</strong>
                <bdi
                  aria-label={`${selectedCategories.length} من ${maximumSelectedCategories} فئات`}
                  dir="ltr"
                >
                  {selectedCategories.length} / {maximumSelectedCategories}
                </bdi>
              </div>
              <ul className="selected-categories-bar__chips">
                {selectedCategories.map((category) => (
                  <li key={category.id}>
                    <button
                      aria-label={`إزالة ${category.displayNameAr}`}
                      onClick={() => removeSelectedCategory(category.id)}
                      ref={(element) => {
                        removalControls.current[category.id] = element;
                      }}
                      type="button"
                    >
                      <span className="selected-categories-bar__chip-label">
                        {category.displayNameAr}
                      </span>
                      <span
                        aria-hidden="true"
                        className="selected-categories-bar__chip-close"
                      >
                        ×
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p aria-live="polite">{selectionLimitMessage}</p>
            </aside>
          ) : null}
          {querySeed.current.notice && (
            <p className="form-message" data-testid="setup-query-notice">
              {querySeed.current.notice}
            </p>
          )}
          {firebaseRuntime ? (
            <p className="field-note" role="status">
              {approvedReleaseCatalog
                ? firebaseSelectedModeUnavailable
                  ? firebaseSelectedModeMessage
                  : approvedReleaseCatalog.demoFixture
                  ? "هذه حزمة تجريبية للمحاكي فقط."
                  : "سيُنشأ اللعب المباشر من الحزمة المعتمدة النشطة."
                : approvedReleaseCatalogError || "جارٍ التحقق من الحزمة المعتمدة…"}
              {approvedReleaseCatalogError ? (
                <button className="button button--quiet" onClick={() => setApprovedReleaseCatalogAttempt((attempt) => attempt + 1)} type="button">أعد المحاولة</button>
              ) : null}
            </p>
          ) : <label className="demo-control">
            <input
              checked={form.demo}
              onChange={(event) => update("demo", event.target.checked)}
              type="checkbox"
            />{" "}
            استخدم مسودات تجريبية صريحة؛ يمكن للمضيف تشغيل الفريقين دون لاعبين.
          </label>}
        </form>
        <aside className="setup-summary">
          <p className="eyebrow">ملخص مباشر</p>
          <h2>
            {form.horizontal} <span>×</span> {form.vertical}
          </h2>
          <p>
            <AxisMark axis="horizontal" /> مقابل <AxisMark axis="vertical" />
          </p>
          <dl>
            <div>
              <dt>نوع اللوح</dt>
              <dd>
                {
                  setupGameKindOptions.find((kind) => kind.id === form.gameKind)
                    ?.labelAr
                }
              </dd>
            </div>
            <div>
              <dt>قاعدة الفوز</dt>
              <dd>
                تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات
                إجمالاً
              </dd>
            </div>
            <div>
              <dt>الفئات المختارة</dt>
              <dd>
                {form.categories.length ||
                  (form.gameKind === "categories"
                    ? "يلزم اختيار فئتين"
                    : "كل الفئات")}
              </dd>
            </div>
            <div>
              <dt>التوقيت</dt>
              <dd>
                {form.questionSeconds}ث / {form.opponentSeconds}ث
              </dd>
            </div>
          </dl>
          <p className="field-note">
            ابدأ بلا لاعبين للتحكم بالفريقين، أو انضم بلاعبين من الفريقين
            واجعلهم جميعاً جاهزين.
          </p>
          <button
            className="button button--primary"
            data-testid="create-room"
            disabled={
              busy || Boolean(localQuestionInventoryError) || staticPreview || (firebaseRuntime ? !approvedReleaseCatalog || !approvedReleaseCatalog.boardCapabilities[form.gameKind] : !form.demo)
            }
            form="match-setup-form"
            title={staticPreview ? staticPreviewNotice : firebaseRuntime && !approvedReleaseCatalog ? approvedReleaseCatalogError || "جارٍ التحقق من الحزمة المعتمدة" : !form.demo ? "لا يوجد مخزون معتمد كافٍ" : undefined}
            type="submit"
          >
            {staticPreview ? "إنشاء الغرفة غير متاح في المعاينة" : busy ? "جارٍ الإنشاء…" : firebaseRuntime ? "أنشئ الغرفة المباشرة" : "أنشئ الغرفة التجريبية"}
          </button>
          <p aria-live="polite" className="form-message">
            {error ||
              (firebaseRuntime && !approvedReleaseCatalog
                ? approvedReleaseCatalogError || "جارٍ التحقق من الحزمة المعتمدة…"
                : firebaseSelectedModeUnavailable
                  ? firebaseSelectedModeMessage
                : !firebaseRuntime && !form.demo
                ? "لا يوجد مخزون معتمد كافٍ لإنشاء مباراة عادية."
                : "")}
          </p>
        </aside>
      </section>
    </main>
  );
}

function useRoom(
  code?: string,
  autoAudience = false,
  projectionRole?: "host" | "player" | "audience",
) {
  const [envelope, setEnvelope] =
    useState<ProjectionEnvelope<ViewProjection> | null>(null);
  // Intents must bind the most recently delivered authoritative revision, not a
  // render-closure that can lag a Firestore server snapshot after reload.
  const envelopeRef = useRef<ProjectionEnvelope<ViewProjection> | null>(null);
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "reconnecting" | "offline" | "stale"
  >("connecting");
  const [error, setError] = useState("");
  const [presence, setPresence] = useState<HostPresenceSnapshot | null>(null);
  const retry = useRef<number | undefined>(undefined);
  const presenceTimeout = useRef<number | undefined>(undefined);
  const presenceStop = useRef<(() => void) | undefined>(undefined);
  const latestPresenceServerTime = useRef(0);
  const expectedPresenceRefresh = useRef<string | undefined>(undefined);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const connecting = useRef(false);
  useEffect(() => {
    let alive = true;
    const online = () => navigator.onLine !== false;
    const clearRetry = () => {
      if (retry.current !== undefined) {
        window.clearTimeout(retry.current);
        retry.current = undefined;
      }
    };
    const clearPresence = () => {
      presenceStop.current?.();
      presenceStop.current = undefined;
      if (presenceTimeout.current !== undefined)
        window.clearTimeout(presenceTimeout.current);
      presenceTimeout.current = undefined;
      latestPresenceServerTime.current = 0;
      expectedPresenceRefresh.current = undefined;
      setPresence(null);
    };
    const acceptPresence = (value: HostPresenceSnapshot) => {
      const serverTime = Date.parse(value.serverTime);
      if (
        expectedPresenceRefresh.current &&
        value.refreshId !== expectedPresenceRefresh.current
      )
        return;
      if (
        !Number.isFinite(serverTime) ||
        serverTime < latestPresenceServerTime.current
      )
        return;
      expectedPresenceRefresh.current = undefined;
      latestPresenceServerTime.current = serverTime;
      setPresence(value);
      if (presenceTimeout.current !== undefined)
        window.clearTimeout(presenceTimeout.current);
      presenceTimeout.current = window.setTimeout(
        () => setPresence(null),
        30_000,
      );
    };
    const closeSocket = () => {
      const socket = socketRef.current;
      socketRef.current = undefined;
      connecting.current = false;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
      clearPresence();
    };
    const schedule = (connect: () => void, delay = 1_000) => {
      if (
        alive &&
        online() &&
        retry.current === undefined &&
        !socketRef.current &&
        !connecting.current
      )
        retry.current = window.setTimeout(() => {
          retry.current = undefined;
          connect();
        }, delay);
    };
    const connect = async () => {
      if (!alive) return;
      if (!online()) {
        setConnection("offline");
        return;
      }
      if (connecting.current || socketRef.current) return;
      connecting.current = true;
      try {
        if (!code) throw new Error("ROOM_CODE_REQUIRED");
        let roomId = sessionStorage.getItem(`huroof:code:${code}`);
        let cap = roomId
          ? autoAudience
            ? audienceCapabilityFor(roomId)
            : capabilityFor(roomId)
          : undefined;
        if (autoAudience && (!cap || cap.role !== "audience")) {
          if (gameRuntime.kind === "firebase" && gameRuntime.joinAudience) {
            const audience = await gameRuntime.joinAudience(code);
            roomId = audience.roomId;
            saveAudienceCapability(roomId, { token: "", role: "audience" });
          } else {
            const claim = await fetch(`/api/rooms/${code}/audience`, {
              method: "POST",
            });
            if (!claim.ok) throw new Error("تعذر فتح شاشة الجمهور.");
            const audience = (await claim.json()) as {
              roomId: string;
              token: string;
            };
            roomId = audience.roomId;
            saveAudienceCapability(roomId, {
              token: audience.token,
              role: "audience",
            });
          }
          sessionStorage.setItem(`huroof:code:${code}`, roomId);
          cap = roomId ? audienceCapabilityFor(roomId) : undefined;
        }
        if (!roomId || !cap)
          throw new Error("افتح الرابط بعد الانضمام أو من رابط المضيف.");
        const role = projectionRole ?? cap.role;
        // A local reload and audience display restore distinct route-owned
        // capabilities, so this singleton never reuses a previous room role.
        if (gameRuntime.kind === "local")
          gameRuntime.setCapabilityToken?.(cap.token);
        if (gameRuntime.kind === "firebase") {
          const unsubscribe = gameRuntime.subscribeProjection(
            roomId,
            role,
            "",
            (value) => {
              if (!alive) return;
              const next = value as ProjectionEnvelope<ViewProjection>;
              if ((envelopeRef.current?.revision ?? -1) > next.revision) return;
              envelopeRef.current = next;
              setEnvelope(next);
              if (value.authoritative === false) {
                setConnection("stale");
              } else {
                setConnection("connected");
                setError("");
              }
            },
            (reason) => {
              if (!alive) return;
              connecting.current = false;
              setConnection("offline");
              setError(readableError(reason));
            },
          );
          socketRef.current = {
            readyState: WebSocket.OPEN,
            close: unsubscribe,
          } as unknown as WebSocket;
          if (role === "host" && gameRuntime.subscribeHostPresence)
            presenceStop.current = gameRuntime.subscribeHostPresence(
              roomId,
              acceptPresence,
              () => setPresence(null),
            );
          else if (role === "player" && gameRuntime.startPlayerPresence)
            presenceStop.current = gameRuntime.startPlayerPresence(roomId);
          connecting.current = false;
          return;
        }
        const response = await fetch(`/api/rooms/${roomId}`, {
          headers: { authorization: `Bearer ${cap.token}` },
        });
        if (!response.ok) throw new Error("تعذر الاتصال بالغرفة.");
        const snapshot =
          (await response.json()) as ProjectionEnvelope<ViewProjection>;
        if (!alive || !online()) return;
        envelopeRef.current = snapshot;
        setEnvelope(snapshot);
        setConnection("connected");
        setError("");
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(
          `${protocol}//${location.host}/ws?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(cap.token)}`,
        );
        socketRef.current = socket;
        socket.onopen = () => {
          connecting.current = false;
        };
        socket.onmessage = (event) => {
          const value = JSON.parse(String(event.data)) as
            | (ProjectionEnvelope<ViewProjection> & { error?: string })
            | (HostPresenceSnapshot & { type: "presence" });
          if ((value as { type?: string }).type === "presence") {
            acceptPresence(value as HostPresenceSnapshot);
            return;
          }
          const envelopeValue = value as ProjectionEnvelope<ViewProjection> & {
            error?: string;
          };
          if (envelopeValue.error) {
            setError(envelopeValue.error);
            return;
          }
          envelopeRef.current = envelopeValue;
          setEnvelope(envelopeValue);
          setConnection("connected");
        };
        socket.onclose = () => {
          if (socketRef.current === socket) socketRef.current = undefined;
          connecting.current = false;
          setPresence(null);
          if (alive && online()) {
            setConnection("reconnecting");
            schedule(() => void connect());
          }
        };
        socket.onerror = () => socket.close();
      } catch (reason) {
        connecting.current = false;
        if (!alive) return;
        setError(readableError(reason));
        if (online()) {
          setConnection("reconnecting");
          schedule(() => void connect());
        } else setConnection("offline");
      }
    };
    const offline = () => {
      clearRetry();
      closeSocket();
      setConnection("offline");
    };
    const reconnect = () => {
      if (!alive) return;
      setConnection("reconnecting");
      schedule(() => void connect(), 250);
    };
    const visible = () => {
      if (document.visibilityState !== "visible") return;
      latestPresenceServerTime.current = 0;
      setPresence(null);
      const socket = socketRef.current;
      if (
        gameRuntime.kind === "local" &&
        socket?.readyState === WebSocket.OPEN
      ) {
        const refreshId =
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`;
        expectedPresenceRefresh.current = refreshId;
        socket.send(JSON.stringify({ type: "presence-refresh", refreshId }));
      }
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", visible);
    if (online()) void connect();
    else offline();
    return () => {
      alive = false;
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", visible);
      clearRetry();
      closeSocket();
    };
  }, [autoAudience, code, projectionRole]);
  const send = async (
    type: IntentType,
    payload: Record<string, unknown> = {},
  ) => {
    if (connection !== "connected") throw new Error("CONNECTION_UNAVAILABLE");
    const currentEnvelope = envelopeRef.current ?? envelope;
    if (!currentEnvelope) throw new Error("PROJECTION_UNAVAILABLE");
    if (gameRuntime.kind === "firebase") {
      await gameRuntime.submitGameIntent(currentEnvelope.roomId, {
        type,
        payload,
        expectedRevision: currentEnvelope.revision,
        intentId: createGameIntentId(),
      });
      return;
    }
    const cap = capabilityFor(currentEnvelope.roomId);
    if (!cap) throw new Error("CAPABILITY_UNAVAILABLE");
    const response = await fetch(
      `/api/rooms/${currentEnvelope.roomId}/intents`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cap.token}`,
        },
        body: JSON.stringify({
          type,
          payload,
          expectedRevision: currentEnvelope.revision,
          intentId: createGameIntentId(),
        }),
      },
    );
    const result = (await response.json()) as LocalIntentResponse;
    if (!response.ok) throw new Error(result.error ?? "تعذر تنفيذ العملية.");
    applyLocalIntentResponse(result, (next) => {
      envelopeRef.current = next;
      setEnvelope(next);
    });
  };
  return { envelope, connection, error, presence, send, reportError: setError };
}

function Countdown({
  deadlineAt,
  serverTime,
  onDeadline,
}: {
  deadlineAt?: string;
  serverTime: string;
  onDeadline?: () => void;
}) {
  const [clientNow, setClientNow] = useState(() => Date.now());
  const offset = useMemo(
    () => Date.parse(serverTime) - Date.now(),
    [serverTime],
  );
  const fired = useRef<string | undefined>(undefined);
  useEffect(() => {
    setClientNow(Date.now());
    if (!deadlineAt) return;
    const timer = window.setInterval(() => setClientNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadlineAt, offset]);
  useEffect(() => {
    if (
      deadlineAt &&
      Date.parse(deadlineAt) <= clientNow + offset &&
      fired.current !== deadlineAt
    ) {
      fired.current = deadlineAt;
      onDeadline?.();
    }
  }, [clientNow, deadlineAt, offset, onDeadline]);
  if (!deadlineAt) return null;
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(deadlineAt) - (clientNow + offset)) / 1000),
  );
  const text = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <p
      className="timer"
      data-testid="countdown"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {text}
    </p>
  );
}

type TeamAxis = "horizontal" | "vertical";
type AssignmentTarget = { memberUid: string } | { manualParticipantId: string };
const targetForMember = (member: TeamMember): AssignmentTarget | undefined =>
  member.manualParticipantId
    ? { manualParticipantId: member.manualParticipantId }
    : member.uid
      ? { memberUid: member.uid }
      : undefined;
const targetKey = (target: AssignmentTarget) =>
  "manualParticipantId" in target
    ? `manual:${target.manualParticipantId}`
    : `member:${target.memberUid}`;
const parseAssignmentTarget = (value: string): AssignmentTarget | undefined => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const item = parsed as Record<string, unknown>;
      if (typeof item.memberUid === "string" && item.memberUid)
        return { memberUid: item.memberUid };
      if (
        typeof item.manualParticipantId === "string" &&
        item.manualParticipantId
      )
        return { manualParticipantId: item.manualParticipantId };
    }
  } catch {
    /* Legacy drag payloads use a raw device UID. */
  }
  return value ? { memberUid: value } : undefined;
};
type TeamAssignment = {
  busy: boolean;
  draggedTarget?: AssignmentTarget;
  enabled: boolean;
  onAssign: (target: AssignmentTarget, team: TeamAxis) => void;
  onDragEnd: () => void;
  onDragStart: (target: AssignmentTarget) => void;
  onDrop: (team: TeamAxis, target?: AssignmentTarget) => void;
  teams: NonNullable<SafeProjection["room"]["teams"]>;
};
type TeamMember = NonNullable<SafeProjection["room"]["members"]>[number];

function HostPlayerCapsule({
  assignment,
  member,
  presence,
  showReadiness = false,
}: {
  assignment?: TeamAssignment;
  member: TeamMember;
  presence?: PlayerPresenceState;
  showReadiness?: boolean;
}) {
  const dragEndedAt = useRef(0);
  const presenceLabel =
    presence === "connected"
      ? "متصل"
      : presence === "disconnected"
        ? "غير متصل"
        : "حالة الاتصال غير معروفة";
  const status =
    member.participation === "manual" ? (
      <span className="host-player-capsule__manual">بدون بازر</span>
    ) : (
      <span
        className={`host-player-capsule__presence host-player-capsule__presence--${presence ?? "unknown"}`}
      >
        <i aria-hidden="true" />
        {presenceLabel}
      </span>
    );
  if (!assignment)
    return (
      <span className="host-player-capsule host-player-capsule--static">
        <span>{member.displayName}</span>
        {status}
      </span>
    );
  const destination = member.team === "horizontal" ? "vertical" : "horizontal";
  const target = targetForMember(member);
  const canMove = assignment.enabled && !assignment.busy && Boolean(target);
  return (
    <button
      aria-grabbed={Boolean(
        target &&
        assignment.draggedTarget &&
        targetKey(target) === targetKey(assignment.draggedTarget),
      )}
      aria-label={`${member.displayName}${member.participation === "manual" ? "، بدون بازر" : `، ${presenceLabel}، ${member.ready ? "جاهز" : "بانتظار الجاهزية"}`}، انقل إلى ${teamName(assignment.teams[destination])}`}
      className="host-player-capsule"
      data-member-uid={member.uid}
      data-manual-participant-id={member.manualParticipantId}
      data-presence-state={
        member.participation === "manual" ? undefined : (presence ?? "unknown")
      }
      data-target-key={target ? targetKey(target) : undefined}
      data-testid="host-player-capsule"
      disabled={!canMove}
      draggable={canMove}
      onClick={(event) => {
        if (event.detail !== 0 && Date.now() - dragEndedAt.current < 250) {
          dragEndedAt.current = 0;
          return;
        }
        if (target) assignment.onAssign(target, destination);
      }}
      onDragEnd={() => {
        dragEndedAt.current = Date.now();
        assignment.onDragEnd();
      }}
      onDragStart={(event) => {
        if (!target) return;
        dragEndedAt.current = 0;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", JSON.stringify(target));
        assignment.onDragStart(target);
      }}
      type="button"
    >
      <span>{member.displayName}</span>
      {status}
      {member.participation !== "manual" && showReadiness ? (
        <span className="host-player-capsule__readiness">
          {member.ready ? "جاهز" : "بانتظار الجاهزية"}
        </span>
      ) : member.participation !== "manual" && member.ready ? (
        <span aria-label="جاهز" className="host-player-capsule__ready">
          ✓
        </span>
      ) : null}
    </button>
  );
}

function RoundMarkers({
  axis,
  currentRound,
  roundResults = [],
}: {
  axis: TeamAxis;
  currentRound?: number;
  roundResults?: NonNullable<SafeProjection["roundResults"]>;
}) {
  return (
    <ol
      className="round-markers"
      aria-label={`نتائج جولات الفريق ${axis === "vertical" ? "الأخضر" : "الأحمر"}`}
    >
      {Array.from({ length: 5 }, (_, index) => {
        const round = index + 1;
        const result = roundResults.find((item) => item.round === round);
        const status =
          result?.winner === axis
            ? "won"
            : result
              ? "lost"
              : currentRound === round
                ? "current"
                : "pending";
        return (
          <li
            aria-label={`الجولة ${round}: ${status === "won" ? "فوز" : status === "lost" ? "خسارة" : status === "current" ? "الحالية" : "بانتظار"}`}
            className={`round-markers__marker round-markers__marker--${status}`}
            data-round={round}
            key={round}
          >
            <svg aria-hidden="true" viewBox="0 0 12 12">
              <circle cx="6" cy="6" r="5" />
            </svg>
          </li>
        );
      })}
    </ol>
  );
}

export function TeamScoreCard({
  axis,
  assignment,
  players,
  presence,
  currentRound,
  points,
  roundResults,
  rounds,
  testId,
  teamName: customName,
  variant,
}: {
  axis: TeamAxis;
  assignment?: TeamAssignment;
  players?: NonNullable<SafeProjection["room"]["members"]>;
  presence?: HostPresenceSnapshot["players"];
  currentRound?: number;
  points: number;
  roundResults?: NonNullable<SafeProjection["roundResults"]>;
  rounds: number;
  testId?: string;
  teamName?: string;
  variant: "host" | "stage";
}) {
  const label = axis === "vertical" ? "الأخضر" : "الأحمر";
  return (
    <section
      aria-label={`فريق ${label}: ${teamName(customName)}، محور ${axis === "vertical" ? "عمودي" : "أفقي"}`}
      className={`${variant}-score ${variant}-score--${axis}`}
      data-testid={testId}
      onDragOver={(event) => {
        if (assignment?.enabled && assignment.draggedTarget)
          event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (assignment?.enabled && !assignment.busy)
          assignment.onDrop(
            axis,
            parseAssignmentTarget(event.dataTransfer.getData("text/plain")),
          );
      }}
    >
      {variant === "stage" ? (
        <span aria-hidden="true" className="stage-score__medallion">
          <svg viewBox="0 0 24 24">
            <path d="M8 3h8l-1 6h-6L8 3Z" />
            <path d="M9 5 5 7l4 5M15 5l4 2-4 5" />
            <path d="M8 10h8v3a4 4 0 0 1-8 0v-3Z" />
            <path d="M12 17v3M9 21h6" />
          </svg>
        </span>
      ) : null}
      <span className={`${variant}-score__team`}>
        {variant === "host" ? teamName(customName) : label}
      </span>
      <div className="team-score__rounds">
        <strong
          data-testid={
            testId ? `${testId.replace("score", "round-wins")}` : undefined
          }
        >
          {rounds}
        </strong>
        <small>الجولات</small>
        {variant === "host" && (
          <RoundMarkers
            axis={axis}
            currentRound={currentRound}
            roundResults={roundResults}
          />
        )}
      </div>
      <div className={`team-score__points ${variant}-score__points`}>
        <span aria-hidden="true" className="team-score__points-label">
          النقاط
        </span>
        <strong aria-hidden="true" className="team-score__points-value">
          {points}
        </strong>
        <span className="sr-only">نقاط الإجابات: {points}</span>
      </div>
      {players?.length ? (
        <section
          className={`team-score__players ${assignment?.draggedTarget ? "is-drop-target" : ""}`}
          aria-label={`لاعبو ${label}`}
        >
          <ul>
            {players.map((player, index) => (
              <li key={player.uid ?? index}>
                <HostPlayerCapsule
                  assignment={assignment}
                  member={player}
                  presence={
                    player.uid ? presence?.[player.uid]?.state : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function RoundTimerModule({
  hasQuestion,
  deadlineAt,
  onDeadline,
  serverTime,
}: {
  hasQuestion: boolean;
  deadlineAt?: string;
  onDeadline?: () => void;
  serverTime: string;
}) {
  return (
    <section className="round-timer-module" aria-label="مؤقت الجولة">
      {deadlineAt ? (
        <>
          <svg
            aria-hidden="true"
            className="round-timer-module__icon"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="13" fill="none" r="8" />
            <path d="M12 9v4l3 2M9 2h6M12 2v3" fill="none" />
          </svg>
          <Countdown
            deadlineAt={deadlineAt}
            onDeadline={onDeadline}
            serverTime={serverTime}
          />
        </>
      ) : (
        <span>{hasQuestion ? "تم اختيار السؤال" : "اختر السؤال"}</span>
      )}
    </section>
  );
}

function matchWinner(projection: SafeProjection): string | undefined {
  return projection.matchWinner
    ? teamName(projection.room.teams?.[projection.matchWinner])
    : undefined;
}
function matchReason(projection: SafeProjection): string | undefined {
  return projection.matchWinReason === "two_consecutive_round_wins"
    ? "بجولتين متتاليتين"
    : projection.matchWinReason === "three_total_round_wins"
      ? "بثلاث جولات إجمالاً"
      : undefined;
}

function ConnectionStatus({ value }: { value: string }) {
  return (
    <p className={`connection connection--${value}`} role="status">
      {connectionLabel(value)}
    </p>
  );
}
function BuzzWinnerBanner({
  winner,
}: {
  winner: NonNullable<SafeProjection["buzzWinner"]>;
}) {
  return (
    <p className={`buzz-winner buzz-winner--${winner.team}`} role="status">
      {winner.method === "host" ? "اختيار المضيف:" : "الأسرع:"}{" "}
      {winner.displayName}
    </p>
  );
}

function EndWithoutWinnerDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      queueMicrotask(() => cancelRef.current?.focus());
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);
  return (
    <dialog
      aria-describedby="end-without-winner-description"
      aria-labelledby="end-without-winner-title"
      className="correction-dialog"
      data-testid="end-without-winner-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
      ref={dialogRef}
    >
      <div className="correction-dialog__surface">
        <header className="correction-dialog__header">
          <h2 id="end-without-winner-title">إنهاء المباراة بلا فائز</h2>
        </header>
        <p id="end-without-winner-description">
          سيُنهي هذا الخيار المباراة كاملةً الآن، ولن يحتسب أي فريق فائزًا.
        </p>
        <div className="control-grid">
          <button
            className="button button--primary"
            onClick={onConfirm}
            type="button"
          >
            إنهاء المباراة كاملةً
          </button>
          <button className="button" onClick={onCancel} ref={cancelRef} type="button">
            متابعة اللعب
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function HostActions({
  state,
  action,
  playerCount,
  teams,
  entitledTeam,
  contentHold,
  gameKind = "huroof",
  endedWithoutWinner,
  newMatchHref = "/host/new",
}: {
  state: string;
  action: (type: IntentType, payload?: Record<string, unknown>) => void;
  playerCount: number;
  teams: NonNullable<SafeProjection["room"]["teams"]>;
  entitledTeam?: "horizontal" | "vertical";
  contentHold?: SafeProjection["contentHold"];
  gameKind?: "huroof" | "categories";
  endedWithoutWinner?: boolean;
  newMatchHref?: string;
}) {
  const manualSelection =
    state === "QUESTION_READING" || state === "OPPONENT_CHANCE";
  const hostOnly = playerCount === 0;
  const selectionLabel = gameKind === "categories" ? "فئة" : "حرفًا";
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const endTriggerRef = useRef<HTMLButtonElement>(null);
  const closeEndConfirmation = () => {
    setEndConfirmOpen(false);
    window.setTimeout(() => endTriggerRef.current?.focus(), 0);
  };
  const endButton = (
    <button
      className={`button${contentHold ? " button--primary" : ""}`}
      onClick={() => setEndConfirmOpen(true)}
      ref={endTriggerRef}
      type="button"
    >
      إنهاء المباراة كاملةً بلا فائز
    </button>
  );
  const endConfirmation = (
    <EndWithoutWinnerDialog
      onCancel={closeEndConfirmation}
      onConfirm={() => {
        setEndConfirmOpen(false);
        action("END_WITHOUT_WINNER");
      }}
      open={endConfirmOpen}
    />
  );
  const primary: Partial<Record<string, [IntentType, string]>> = {
    ROUND_SETUP: ["ROUND_READY", "جهّز الجولة"],
    ROUND_COMPLETE: ["START_NEXT_ROUND", "جولة جديدة"],
  };
  if (state === "MATCH_COMPLETE") {
    return (
      <section className="control-grid" role="status">
        <p>
          {endedWithoutWinner
            ? "انتهت المباراة بلا فائز."
            : "اكتملت المباراة."}
        </p>
        <Link className="button button--primary" to={newMatchHref}>
          مباراة جديدة بالإعدادات نفسها
        </Link>
      </section>
    );
  }
  if (contentHold) {
    return (
      <>
        <div className="control-grid control-grid--content-hold" role="status">
          <p>
            توقف اختيار المحتوى: لا يتوفر بديل صالح لهذه الخطوة. لا تُحتسب أي نقطة
            ولا تتغير ملكية الخلية.
          </p>
          {endButton}
        </div>
        {endConfirmation}
      </>
    );
  }
  return (
    <>
      <div
        className={`control-grid ${manualSelection && !hostOnly ? "control-grid--player-override" : ""}`}
      >
      {state === "CELL_SELECTION" && (
        <button
          className="button button--primary host-select-cell"
          type="button"
          onClick={() => {
            const cell = document.querySelector<HTMLButtonElement>(
              ".host-board .game-board__button:not(:disabled)",
            );
            cell?.scrollIntoView?.({ block: "center", behavior: "instant" });
            cell?.focus({ preventScroll: true });
          }}
        >
          {`اختر ${selectionLabel} من اللوحة`}
        </button>
      )}
      {state === "FIRST_ANSWER" && (
        <>
          <button
            className="button button--primary"
            onClick={() => action("JUDGE_CORRECT")}
          >
            إجابة صحيحة
          </button>
          <button className="button" onClick={() => action("JUDGE_INCORRECT")}>
            إجابة خاطئة
          </button>
        </>
      )}
      {state === "QUESTION_FAILED" && (
        <>
          <p className="host-failure-summary" role="status">
            لم تُمنح الخلية لأي فريق. استبدلها ثم اختر {selectionLabel} آخر من
            اللوحة؛ لن يعود السؤال المكشوف.
          </p>
          <button
            className="button button--primary"
            onClick={() => action("RETRY_CELL")}
          >
            {`استبدل الخلية واختر ${selectionLabel} آخر`}
          </button>
          {endButton}
        </>
      )}
      {primary[state] && (
        <button
          className="button button--primary"
          onClick={() => action(primary[state]![0])}
        >
          {primary[state]![1]}
        </button>
      )}
      {manualSelection && (
        <section
          className="host-team-selection"
          aria-label="اختيار فريق الإجابة"
        >
          <div>
            {(["horizontal", "vertical"] as const).map((team) => (
              <button
                aria-label={`اختيار ${teams[team]} للإجابة`}
                className={`button host-team-selection__button host-team-selection__button--${team}`}
                data-testid={`host-select-${team}`}
                disabled={state === "OPPONENT_CHANCE" && entitledTeam !== team}
                key={team}
                onClick={() => action("HOST_SELECT_TEAM", { team })}
              >
                <span>{teamName(teams[team])}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      </div>
      {endConfirmation}
    </>
  );
}

export function HostPauseAction({
  state,
  action,
  contentHold = false,
}: {
  state: string;
  action: (type: IntentType, payload?: Record<string, unknown>) => void;
  contentHold?: boolean;
}) {
  if (contentHold || state === "CORRECTION" || state === "MATCH_COMPLETE")
    return null;
  return (
    <button
      className="button button--quiet host-controls__pause"
      onClick={() => action(state === "PAUSED" ? "RESUME" : "PAUSE")}
      type="button"
    >
      {state === "PAUSED" ? "استئناف" : "إيقاف مؤقت"}
    </button>
  );
}

export function HostVisibilityControls({
  audienceQuestionVisible,
  disabled,
  readOnlyReason,
  onAudienceQuestionChange,
  onHostAnswerChange,
  showHostAnswer,
}: {
  audienceQuestionVisible: boolean;
  disabled: boolean;
  readOnlyReason?: string;
  onAudienceQuestionChange: (visible: boolean) => void;
  onHostAnswerChange: (visible: boolean) => void;
  showHostAnswer: boolean;
}) {
  return (
    <section className="host-visibility-controls" aria-label="خيارات العرض">
      <label className="host-visibility-control">
        <span>إظهار الإجابة للمضيف</span>
        <input
          checked={showHostAnswer}
          data-testid="host-show-answer"
          onChange={(event) => onHostAnswerChange(event.target.checked)}
          type="checkbox"
        />
      </label>
      <label className="host-visibility-control">
        <span>إظهار السؤال على شاشة العرض</span>
        <input
          checked={audienceQuestionVisible}
          data-testid="host-show-audience-question"
          disabled={disabled}
          onChange={(event) => onAudienceQuestionChange(event.target.checked)}
          type="checkbox"
        />
      </label>
      {readOnlyReason ? (
        <p className="form-message" role="status">
          {readOnlyReason}
        </p>
      ) : null}
    </section>
  );
}

export const audienceQuestionBandVisible = (
  audienceQuestionVisible: boolean,
  state: string,
  prompt?: string,
) =>
  audienceQuestionVisible &&
  (state === "MATCH_COMPLETE" ||
    (state !== "CELL_SELECTION" &&
      state !== "ROUND_SETUP" &&
      Boolean(prompt?.trim())));

/** Cached/offline projections may render safe text, but never retain a media grant. */
const activeImageStatesForView = new Set([
  "QUESTION_READING",
  "FIRST_ANSWER",
  "OPPONENT_CHANCE",
  "QUESTION_FAILED",
]);
export const canRenderCurrentQuestionMedia = ({
  audienceQuestionVisible,
  authoritative,
  connection,
  role,
  state,
  surface,
}: {
  audienceQuestionVisible: boolean;
  authoritative?: boolean;
  connection: string;
  role: "host" | "player" | "audience";
  state: string;
  surface: "lobby" | "host" | "play" | "display" | "results";
}) => {
  if (connection !== "connected" || authoritative === false) return false;
  if (role === "host") return surface === "host";
  return (
    role === "audience" &&
    surface === "display" &&
    audienceQuestionVisible &&
    activeImageStatesForView.has(state)
  );
};

export const shouldShowHostAnswers = (
  showHostAnswer: boolean,
  question: ViewProjection["question"] | undefined,
) => showHostAnswer && Boolean(question);

export function HostLobbyControls({
  action,
  busy,
  canStart,
  connection,
  error,
  fixture,
  presence,
  room,
  visibilityControls,
}: {
  action: (
    type: IntentType,
    payload?: Record<string, unknown>,
  ) => Promise<boolean | void>;
  busy: boolean;
  canStart: boolean;
  connection: string;
  error: string;
  fixture: boolean;
  presence?: HostPresenceSnapshot["players"];
  room: SafeProjection["room"];
  visibilityControls?: ReactNode;
}) {
  const players = (room.members ?? []).filter(
    (member) => member.role === "player",
  );
  const devicePlayers = players.filter(
    (member) => member.participation !== "manual",
  );
  const state = room.state;
  const canManage =
    !fixture && connection === "connected" && canManageTeamsInState(state);
  const [draggedTarget, setDraggedTarget] = useState<AssignmentTarget>();
  const [manualFormOpen, setManualFormOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualTeam, setManualTeam] = useState<TeamAxis>("horizontal");
  const [manualError, setManualError] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const focusTargetKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = focusTargetKey.current;
    if (!key) return;
    const target = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-target-key]"),
    ).find((element) => element.dataset.targetKey === key);
    if (target) {
      target.focus();
      focusTargetKey.current = undefined;
    }
  }, [room.members]);
  const teamMembers = (team: "horizontal" | "vertical") =>
    players.filter((member) => member.team === team);
  const unassignedMembers = players.filter((member) => !member.team);
  const blockedMessage = fixture
    ? "إدارة اللاعبين غير متاحة في المعاينة الثابتة."
    : connection !== "connected"
      ? "تحتاج إدارة الردهة إلى اتصال مستقر بالغرفة."
      : !canManageTeamsInState(state)
        ? "نقل اللاعبين مقفل أثناء السؤال أو الإجابة أو الإيقاف أو التصحيح أو بعد اكتمال المباراة."
        : room.startBlockedReason
          ? "بانتظار جاهزية الجميع وتوزيع اللاعبين على الفريقين."
          : players.length
            ? "المباراة جاهزة بعد اكتمال الفريقين."
            : "وضع المضيف فقط جاهز: ستتحكم بالفريقين يدوياً.";
  const assignTeam = (target: AssignmentTarget, team: TeamAxis) => {
    focusTargetKey.current = targetKey(target);
    void Promise.resolve(
      action("LOBBY_ASSIGN_TEAM", { ...target, team }),
    ).catch(() => undefined);
  };
  const assignment: TeamAssignment = {
    busy: busy || manualBusy,
    draggedTarget,
    enabled: canManage,
    onAssign: assignTeam,
    onDragEnd: () => setDraggedTarget(undefined),
    onDragStart: setDraggedTarget,
    onDrop: (team, target) => {
      if (!canManage || busy || manualBusy) {
        setDraggedTarget(undefined);
        return;
      }
      const targetMember = target || draggedTarget;
      setDraggedTarget(undefined);
      if (targetMember) assignTeam(targetMember, team);
    },
    teams: room.teams ?? { horizontal: "الأحمر", vertical: "الأخضر" },
  };
  const assignmentCapsule = (member: TeamMember, index: number) => (
    <li
      className="host-lobby__member"
      key={member.manualParticipantId ?? member.uid ?? `unidentified-${index}`}
    >
      <HostPlayerCapsule
        assignment={assignment}
        member={member}
        presence={member.uid ? presence?.[member.uid]?.state : undefined}
        showReadiness
      />
    </li>
  );
  return (
    <section className="host-lobby" aria-label="اللاعبون والفِرَق">
      <header className="host-lobby__summary">
        <p data-testid="host-lobby-member-count">
          {players.length} لاعبون منضمون · {room.readyCount} جاهزون
        </p>
      </header>
      <section className="manual-player" aria-label="إضافة لاعب بدون بازر">
        <button
          aria-expanded={manualFormOpen}
          className="manual-player__toggle"
          data-testid="manual-player-toggle"
          disabled={!canManage || busy}
          onClick={() => setManualFormOpen((open) => !open)}
          type="button"
        >
          إضافة لاعب بدون بازر
        </button>
        {manualFormOpen ? (
          <form
            className="manual-player__form"
            onSubmit={(event) => {
              event.preventDefault();
              const displayName = manualName.trim();
              if (
                !displayName ||
                displayName.length > 48 ||
                /\p{Cc}/u.test(displayName)
              ) {
                setManualError("أدخل اسماً من حرف إلى 48 حرفاً دون رموز تحكم.");
                return;
              }
              setManualBusy(true);
              setManualError("");
              void action("LOBBY_ADD_MANUAL_PLAYER", {
                displayName,
                team: manualTeam,
              })
                .then((succeeded) => {
                  if (succeeded === false) {
                    setManualError(
                      "تعذر إضافة اللاعب. تحقق من الاتصال وحاول مرة أخرى.",
                    );
                    return;
                  }
                  setManualName("");
                  setManualFormOpen(false);
                })
                .catch((reason) => setManualError(readableError(reason)))
                .finally(() => setManualBusy(false));
            }}
          >
            <label>
              اسم اللاعب
              <input
                aria-describedby={
                  manualError ? "manual-player-error" : undefined
                }
                aria-invalid={Boolean(manualError)}
                data-testid="manual-player-name"
                maxLength={48}
                onChange={(event) => {
                  setManualName(event.target.value);
                  if (manualError) setManualError("");
                }}
                value={manualName}
              />
            </label>
            <p className="manual-player__help">
              اللاعب المضاف جاهز تلقائياً ولا يستخدم البازر.
            </p>
            <div
              aria-label="فريق اللاعب"
              className="manual-player__teams"
              role="group"
            >
              {(["vertical", "horizontal"] as const).map((team) => (
                <button
                  aria-pressed={manualTeam === team}
                  className={`manual-player__team manual-player__team--${team}`}
                  data-testid={`manual-player-team-${team}`}
                  key={team}
                  onClick={() => setManualTeam(team)}
                  type="button"
                >
                  {teamName(room.teams?.[team])}
                </button>
              ))}
            </div>
            {manualError ? (
              <p className="form-message" id="manual-player-error" role="alert">
                {manualError}
              </p>
            ) : null}
            <button
              className="button"
              data-testid="add-manual-player"
              disabled={manualBusy}
              type="submit"
            >
              {manualBusy ? "جارٍ الإضافة…" : "إضافة"}
            </button>
          </form>
        ) : null}
      </section>
      <div className="host-lobby__teams">
        {(["horizontal", "vertical"] as const).map((team) => {
          const members = teamMembers(team);
          return (
            <section
              className={`host-lobby__team host-lobby__team--${team} ${draggedTarget ? "is-drop-target" : ""}`}
              data-testid={`host-lobby-team-${team}`}
              key={team}
              onDragOver={(event) => {
                if (
                  assignment.enabled &&
                  !assignment.busy &&
                  assignment.draggedTarget
                )
                  event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (assignment.enabled && !assignment.busy)
                  assignment.onDrop(
                    team,
                    parseAssignmentTarget(
                      event.dataTransfer.getData("text/plain"),
                    ),
                  );
              }}
            >
              <header className="host-lobby__team-header">
                <h3>{teamName(room.teams?.[team])}</h3>
                <bdi data-testid={`host-lobby-team-${team}-count`} dir="ltr">
                  {members.length}
                </bdi>
              </header>
              {members.length ? (
                <ul>{members.map(assignmentCapsule)}</ul>
              ) : (
                <p className="host-lobby__empty">
                  لا يوجد لاعب في هذا الفريق بعد.
                </p>
              )}
            </section>
          );
        })}
      </div>
      {unassignedMembers.length ? (
        <section
          className="host-lobby__unassigned"
          aria-label="لاعبون غير موزعين"
        >
          <h3>غير موزعين ({unassignedMembers.length})</h3>
          <ul>{unassignedMembers.map(assignmentCapsule)}</ul>
        </section>
      ) : null}
      {canManage && devicePlayers.length ? (
        <p aria-live="polite" className="host-lobby__notice">
          نقل لاعب البازر يلغي جاهزيته.
        </p>
      ) : null}
      {error ? (
        <p aria-live="polite" className="form-message">
          {error}
        </p>
      ) : null}
      <div className="host-lobby__status">
        <ConnectionStatus value={connection} />
      </div>
      {visibilityControls}
      {state === "LOBBY" ? (
        <section className="host-lobby__start" aria-label="بدء المباراة">
          <p data-testid="host-lobby-start-blocked">{blockedMessage}</p>
          <button
            className="button button--primary"
            data-testid="start-match"
            disabled={!canManage || busy || !canStart}
            onClick={() => void action("START_MATCH")}
            type="button"
          >
            {busy ? "جارٍ التحديث…" : "ابدأ المباراة"}
          </button>
        </section>
      ) : (
        <p className="host-lobby__locked" role="status">
          {blockedMessage}
        </p>
      )}
    </section>
  );
}

function HostTeamManagementStatus({ state }: { state: string }) {
  if (canManageTeamsInState(state)) return null;
  return (
    <p className="host-team-management-status" role="status">
      نقل اللاعبين مقفل أثناء السؤال أو الإجابة أو الإيقاف أو التصحيح أو بعد
      اكتمال المباراة.
    </p>
  );
}

type HostJoinLink = {
  copyLink: () => Promise<void>;
  copyStatus: string;
  origin: string;
  originIsInvalid: boolean;
  qrDataUrl: string;
  qrError: string;
  setOrigin: (origin: string) => void;
  joinUrl: string | undefined;
};

function useHostJoinLink(roomCode: string): HostJoinLink {
  const [origin, setOrigin] = useState(
    () =>
      import.meta.env.VITE_PUBLIC_JOIN_ORIGIN ||
      (typeof window === "undefined" ? "" : window.location.origin),
  );
  const [qr, setQr] = useState<{ joinUrl: string; value: string }>();
  const [qrFailure, setQrFailure] = useState<{
    joinUrl: string;
    message: string;
  }>();
  const [copyStatus, setCopyStatus] = useState("");
  const joinUrl = playerJoinUrl(origin, roomCode);
  const originIsInvalid =
    Boolean(origin.trim()) && !normalizedJoinOrigin(origin);
  const qrDataUrl = qr && qr.joinUrl === joinUrl ? qr.value : "";
  const qrError =
    qrFailure && qrFailure.joinUrl === joinUrl ? qrFailure.message : "";

  useEffect(() => {
    let cancelled = false;
    setQr(undefined);
    setQrFailure(undefined);
    if (!joinUrl) return;
    void QRCode.toDataURL(joinUrl, {
      color: { dark: "#071d38", light: "#ffffffff" },
      errorCorrectionLevel: "M",
      margin: 4,
      width: 280,
    })
      .then((value) => {
        if (!cancelled) setQr({ joinUrl, value });
      })
      .catch(() => {
        if (!cancelled)
          setQrFailure({
            joinUrl,
            message: "تعذر إنشاء رمز QR محلياً. يمكنك نسخ الرابط.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  const copyLink = async () => {
    if (!joinUrl) return;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("النسخ غير مدعوم في هذا المتصفح.");
      await navigator.clipboard.writeText(joinUrl);
      setCopyStatus("تم نسخ رابط الانضمام.");
    } catch (reason) {
      setCopyStatus(readableError(reason));
    }
  };

  return {
    copyLink,
    copyStatus,
    joinUrl,
    origin,
    originIsInvalid,
    qrDataUrl,
    qrError,
    setOrigin,
  };
}

export function HostJoinInlineQr({
  join,
  onOpen,
}: {
  join: HostJoinLink;
  onOpen: () => void;
}) {
  const status = join.joinUrl
    ? join.qrError || "امسح الرمز للانضمام إلى هذه المباراة."
    : join.originIsInvalid
      ? "عنوان الموقع غير صالح للهاتف. اضغط لتعديله."
      : "اضبط عنوان الموقع القابل للوصول لإظهار الرمز.";
  return (
    <aside className="lobby-join-qr" aria-label="انضمام اللاعبين برمز QR">
      <button
        aria-describedby="lobby-join-qr-caption"
        aria-label={
          join.qrError
            ? "فتح إعدادات رمز QR بعد تعذر إنشائه"
            : join.joinUrl
              ? "تكبير رمز QR للانضمام"
              : "إعداد عنوان انضمام اللاعبين"
        }
        className="lobby-join-qr__trigger"
        data-testid="lobby-join-qr"
        onClick={onOpen}
        type="button"
      >
        <span className="lobby-join-qr__code">
          {join.qrDataUrl ? (
            <img alt="رمز QR لرابط انضمام اللاعب" src={join.qrDataUrl} />
          ) : join.qrError ? (
            <span role="alert">تعذر إنشاء الرمز</span>
          ) : (
            <span role="status">
              {join.joinUrl ? "جارٍ إنشاء الرمز…" : "إعداد رمز الانضمام"}
            </span>
          )}
        </span>
        <span className="lobby-join-qr__label">رمز QR للانضمام</span>
      </button>
      <p id="lobby-join-qr-caption">{status}</p>
    </aside>
  );
}

export function HostJoinDialog({
  join,
  onDismiss,
  open,
}: {
  join: HostJoinLink;
  onDismiss: () => void;
  open: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      aria-labelledby="host-join-qr-title"
      className="host-join-dialog"
      onClose={onDismiss}
      ref={dialogRef}
    >
      <section className="host-join-dialog__surface">
        <header className="host-join-dialog__header">
          <div>
            <p className="eyebrow">انضمام لاعب</p>
            <h2 id="host-join-qr-title">امسح رمز QR للانضمام</h2>
          </div>
          <button
            aria-label="إغلاق رمز الانضمام"
            className="host-join-dialog__close"
            onClick={() => {
              if (typeof dialogRef.current?.close === "function")
                dialogRef.current.close();
              else onDismiss();
            }}
            type="button"
          >
            ×
          </button>
        </header>
        <p>امسح الرمز، أدخل اسمك، وانضم إلى المباراة.</p>
        <label className="host-join-dialog__origin">
          <span>عنوان الموقع للاعبين</span>
          <input
            aria-describedby="host-join-origin-help"
            dir="ltr"
            inputMode="url"
            onChange={(event) => join.setOrigin(event.target.value)}
            placeholder="http://192.168.1.10:5173"
            value={join.origin}
          />
        </label>
        <p className="host-join-dialog__hint" id="host-join-origin-help">
          {join.originIsInvalid
            ? "استخدم عنوان http أو https عاماً أو من الشبكة المحلية. لا يمكن مسح localhost من هاتف."
            : "عند تشغيل التطبيق على localhost، أدخل عنوان الشبكة المحلية أو العنوان العام الذي يصل إليه اللاعبون."}
        </p>
        {join.joinUrl ? (
          <>
            <div
              className="host-join-dialog__qr"
              aria-label="رمز QR لرابط انضمام اللاعب"
            >
              {join.qrDataUrl ? (
                <img alt="رمز QR لرابط انضمام اللاعب" src={join.qrDataUrl} />
              ) : join.qrError ? (
                <p role="alert">تعذر إنشاء الرمز.</p>
              ) : (
                <p role="status">جارٍ إنشاء الرمز…</p>
              )}
            </div>
            <label className="host-join-dialog__link">
              <span>رابط انضمام اللاعب</span>
              <input dir="ltr" readOnly value={join.joinUrl} />
            </label>
            <button
              className="button"
              onClick={() => void join.copyLink()}
              type="button"
            >
              انسخ رابط الانضمام
            </button>
          </>
        ) : null}
        <p aria-live="polite" className="form-message">
          {join.qrError || join.copyStatus}
        </p>
      </section>
    </dialog>
  );
}

export function RoomRoute({
  surface,
}: {
  surface: "lobby" | "host" | "play" | "display" | "results";
}) {
  const { roomCode } = useParams();
  // A same-route rematch replaces the room identity. Key the entire live route so
  // subscriptions, capabilities, and authoritative envelopes from the completed
  // room cannot render or dispatch while the new room is still loading.
  return (
    <RoomRouteInstance key={roomCode ?? "missing-room"} surface={surface} />
  );
}

function RoomRouteInstance({
  surface,
}: {
  surface: "lobby" | "host" | "play" | "display" | "results";
}) {
  useDocumentTitle(
    surface === "host"
      ? "لوحة المضيف"
      : surface === "play"
        ? "بازر اللاعب"
        : surface === "display"
          ? "شاشة الجمهور"
          : surface === "results"
            ? "نتيجة المباراة"
            : "ردهة المباراة",
  );
  const { roomCode } = useParams();
  const { envelope, connection, error, presence, send, reportError } = useRoom(
    roomCode,
    surface === "display",
    surface === "display" ? "audience" : undefined,
  );
  const navigate = useNavigate();
  const projection = envelope?.projection;
  // The legacy fixture setting still creates a real local room through the
  // route fallback. Only the adapter's own synthetic room is read-only.
  const fixtureRoom = isReadOnlyFixtureRoom(gameRuntime.kind, envelope?.roomId);
  const [copyStatus, setCopyStatus] = useState("");
  const [rematchBusy, setRematchBusy] = useState(false);
  const [lobbyBusy, setLobbyBusy] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [showHostAnswer, setShowHostAnswer] = useState(true);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const hostJoin = useHostJoinLink(
    envelope?.role === "host" ? projection?.room.roomCode ?? "" : "",
  );
  const [draggedTeamTarget, setDraggedTeamTarget] =
    useState<AssignmentTarget>();
  const liveTeamFocusTarget = useRef<string | undefined>(undefined);
  const [buzzSubmitting, setBuzzSubmitting] = useState(false);
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false);
  const [expandedBoardOpen, setExpandedBoardOpen] = useState(false);
  const correctionTriggerRef = useRef<HTMLButtonElement>(null);
  const expandedBoardDialogRef = useRef<HTMLDialogElement>(null);
  const expandedBoardCloseRef = useRef<HTMLButtonElement>(null);
  const expandedBoardTriggerRef = useRef<HTMLButtonElement>(null);
  const buzzSubmittingRef = useRef(false);
  const automaticHostTransitionRef = useRef<string | undefined>(undefined);
  const priorHostStateRef = useRef<string | undefined>(undefined);
  const restoreExpandedBoardFocus = () => {
    setExpandedBoardOpen(false);
    window.requestAnimationFrame(() =>
      expandedBoardTriggerRef.current?.focus(),
    );
  };
  const closeExpandedBoard = () => {
    const dialog = expandedBoardDialogRef.current;
    if (dialog?.open && typeof dialog.close === "function") {
      dialog.close();
      return;
    }
    dialog?.removeAttribute("open");
    restoreExpandedBoardFocus();
  };
  useEffect(() => {
    const dialog = expandedBoardDialogRef.current;
    if (!dialog) return;
    if (expandedBoardOpen && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      queueMicrotask(() => expandedBoardCloseRef.current?.focus());
    }
    if (!expandedBoardOpen && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [expandedBoardOpen]);
  useEffect(() => {
    const key = liveTeamFocusTarget.current;
    if (!key) return;
    const target = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-target-key]"),
    ).find((element) => element.dataset.targetKey === key);
    if (target) {
      target.focus();
      liveTeamFocusTarget.current = undefined;
    }
  }, [envelope?.revision]);
  useEffect(() => {
    if (!projection) return;
    buzzSubmittingRef.current = false;
    setBuzzSubmitting(false);
  }, [envelope?.revision, projection?.self?.canBuzz]);
  useEffect(() => {
    const priorState = priorHostStateRef.current;
    priorHostStateRef.current = projection?.room.state;
    if (
      priorState !== "QUESTION_FAILED" ||
      projection?.room.state !== "CELL_SELECTION" ||
      envelope?.role !== "host" ||
      projection.contentHold
    )
      return;
    window.requestAnimationFrame(() => {
      const cell = document.querySelector<HTMLButtonElement>(
        ".host-board .game-board__button:not(:disabled)",
      );
      cell?.scrollIntoView?.({ block: "center", behavior: "instant" });
      cell?.focus({ preventScroll: true });
    });
  }, [envelope?.role, projection?.contentHold, projection?.room.state]);
  const activeDestination = activeLobbyDestination(
    roomCode,
    surface,
    envelope?.role,
    projection?.room.state,
  );
  useEffect(() => {
    if (activeDestination) navigate(activeDestination, { replace: true });
  }, [activeDestination, navigate]);
  const action = async (
    type: IntentType,
    payload?: Record<string, unknown>,
  ) => {
    try {
      await send(type, payload);
      reportError("");
      return true;
    } catch (reason) {
      reportError(readableError(reason));
      return false;
    }
  };
  useEffect(() => {
    const type =
      projection?.room.state === "LETTER_REVEAL"
        ? "LETTER_REVEALED"
        : projection?.room.state === "CELL_AWARDED"
          ? "AWARD_CELL"
          : projection?.room.state === "PATH_CHECK"
            ? "CHECK_PATH"
            : undefined;
    const transitionKey = type ? `${envelope?.revision}:${type}` : undefined;
    if (
      !type ||
      surface !== "host" ||
      envelope?.role !== "host" ||
      connection !== "connected" ||
      fixtureRoom ||
      automaticHostTransitionRef.current === transitionKey
    )
      return;
    automaticHostTransitionRef.current = transitionKey;
    void action(type);
  }, [
    action,
    connection,
    envelope?.revision,
    envelope?.role,
    fixtureRoom,
    projection?.room.state,
    surface,
  ]);
  const hostLobbyAction = async (
    type: IntentType,
    payload?: Record<string, unknown>,
  ) => {
    if (lobbyBusy || connection !== "connected" || fixtureRoom) return false;
    setLobbyBusy(true);
    try {
      return await action(type, payload);
    } finally {
      setLobbyBusy(false);
    }
  };
  const updateAudienceQuestionVisibility = async (visible: boolean) => {
    if (visibilityBusy || connection !== "connected" || fixtureRoom) return;
    setVisibilityBusy(true);
    try {
      await action("SET_AUDIENCE_QUESTION_VISIBILITY", {
        showQuestion: visible,
      });
    } finally {
      setVisibilityBusy(false);
    }
  };
  const teamAssignment =
    envelope?.role === "host" && projection
      ? {
          busy: lobbyBusy,
          draggedTarget: draggedTeamTarget,
          enabled:
            !fixtureRoom &&
            connection === "connected" &&
            canManageTeamsInState(projection.room.state),
          onAssign: (target: AssignmentTarget, team: TeamAxis) => {
            if (
              fixtureRoom ||
              connection !== "connected" ||
              !canManageTeamsInState(projection.room.state)
            )
              return;
            liveTeamFocusTarget.current = targetKey(target);
            void hostLobbyAction("LOBBY_ASSIGN_TEAM", { ...target, team });
          },
          onDragEnd: () => setDraggedTeamTarget(undefined),
          onDragStart: (target: AssignmentTarget) =>
            setDraggedTeamTarget(target),
          onDrop: (team: TeamAxis, target?: AssignmentTarget) => {
            if (
              fixtureRoom ||
              connection !== "connected" ||
              !canManageTeamsInState(projection.room.state)
            ) {
              setDraggedTeamTarget(undefined);
              return;
            }
            const targetMember = target || draggedTeamTarget;
            setDraggedTeamTarget(undefined);
            if (targetMember) {
              liveTeamFocusTarget.current = targetKey(targetMember);
              void hostLobbyAction("LOBBY_ASSIGN_TEAM", {
                ...targetMember,
                team,
              });
            }
          },
          teams: projection.room.teams ?? {
            horizontal: "الأحمر",
            vertical: "الأخضر",
          },
        }
      : undefined;
  const reconcileDeadline = () => {
    if (gameRuntime.kind === "firebase" && envelope)
      void gameRuntime
        .syncDeadline?.(envelope.roomId)
        .catch((reason) => reportError(readableError(reason)));
  };
  const rematch = async () => {
    const settings = projection?.room.matchSettings;
    if (!settings || rematchBusy) return;
    setRematchBusy(true);
    reportError("");
    try {
      const body = await gameRuntime.createRoom({
        displayName: "المضيف",
        ...settings,
      });
      if (!body.roomId || !body.roomCode)
        throw new Error("تعذر إنشاء الإعادة.");
      saveCapability(body.roomId, { token: body.token ?? "", role: "host" });
      sessionStorage.setItem(`huroof:code:${body.roomCode}`, body.roomId);
      navigate(`/room/${body.roomCode}/lobby`);
    } catch (reason) {
      reportError(readableError(reason));
    } finally {
      setRematchBusy(false);
    }
  };
  const copyRoomCode = async () => {
    if (!projection?.room.roomCode) return;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("النسخ غير مدعوم في هذا المتصفح.");
      await navigator.clipboard.writeText(projection.room.roomCode);
      setCopyStatus("تم نسخ رمز الغرفة.");
    } catch (reason) {
      setCopyStatus(readableError(reason));
    }
  };
  if (!projection || !envelope)
    return (
      <main
        className="app-page spatial-shell spatial-shell--status"
        id="main-content"
      >
        <AppHeader />
        <section className="status-panel spatial-status-panel">
          <h1>
            {error || connection === "offline"
              ? "تعذر فتح الغرفة"
              : "جارٍ الاتصال بالغرفة…"}
          </h1>
          <p>
            {error || "تحقق من رابط الغرفة ثم حاول الانضمام من صفحة الدخول."}
          </p>
          <Link className="button" to="/">
            العودة إلى الدخول
          </Link>
        </section>
      </main>
    );
  const role = envelope.role;
  const state = projection.room.state;
  const host = role === "host";
  const audienceQuestionVisible =
    projection.room.audienceQuestionVisible !== false;
  const questionMediaVisible =
    Boolean(projection.question?.media) &&
    canRenderCurrentQuestionMedia({
      audienceQuestionVisible,
      authoritative: envelope.authoritative,
      connection,
      role,
      state,
      surface,
    });
  const visibilityControls = host ? (
    <HostVisibilityControls
      audienceQuestionVisible={audienceQuestionVisible}
      disabled={
        fixtureRoom ||
        connection !== "connected" ||
        visibilityBusy ||
        Boolean(projection.contentHold)
      }
      readOnlyReason={
        projection.contentHold
          ? "توقف المحتوى: خيارات العرض المشتركة معلقة حتى تنهي المباراة بلا فائز أو تبدأ مباراة جديدة."
          : undefined
      }
      onAudienceQuestionChange={(visible) =>
        void updateAudienceQuestionVisibility(visible)
      }
      onHostAnswerChange={setShowHostAnswer}
      showHostAnswer={showHostAnswer}
    />
  ) : null;
  const correctionPending = state === "CORRECTION";
  const correctionDialogVisible = correctionDialogOpen || correctionPending;
  const resultState = resultRouteState(roomCode, role, state);
  const newMatchHref = sameSettingsNewMatchHref(projection.room.matchSettings);
  const canStartMatch = canDispatchLobbyStart(state, projection.room.canStart);
  const team = projection.self?.team;
  const cells = projection.board ?? previewBoardCells;
  const activeCell = cells.find((cell) => cell.id === projection.activeCellId);
  const activeCellCaption =
    activeCell?.kind === "category" && activeCell.categoryLabelAr
      ? `الفئة الحالية: ${activeCell.categoryLabelAr} · الترتيب ${activeCell.categoryOccurrence ?? "—"}`
      : activeCell?.kind === "surprise" && activeCell.revealedLetter
        ? `المفاجأة ${activeCell.visibleValue}: الحرف الحالي ${activeCell.revealedLetter}`
        : undefined;
  const incompleteEnd = Boolean(projection.endedWithoutWinner);
  const boardMotionEnabled =
    connection === "connected" && envelope.authoritative !== false;
  const boardMotionBaselineKey = `${connection}:${envelope.authoritative === false ? "cached" : "server"}`;
  const winner = matchWinner(projection);
  const victoryReason = matchReason(projection);
  const buzzText =
    connection === "offline"
      ? "انقطع الاتصال"
      : connection === "stale"
        ? "بانتظار تأكيد الخادم"
        : connection === "connecting" || connection === "reconnecting"
          ? "جارٍ تأكيد الاتصال"
          : projection.contentHold
            ? "توقف المحتوى"
            : projection.self?.canBuzz
              ? "اضغط الآن"
              : state === "FIRST_ANSWER" && projection.answeringTeam === team
                ? "أنت الأسرع — أجب"
                : state === "OPPONENT_CHANCE"
                  ? "الفرصة للفريق الآخر"
                  : "استعد";
  const playerTeam = team ?? "horizontal";
  const buzzerState = buzzSubmitting
    ? "pending"
    : connection === "offline"
      ? "offline"
      : connection === "stale"
        ? "stale"
        : connection === "connecting" || connection === "reconnecting"
          ? "reconnecting"
          : projection.self?.canBuzz
            ? "open"
            : projection.self?.isBuzzWinner
              ? "first"
              : "locked";
  const playerMessage = projection.self?.isBuzzWinner
    ? "أنت الأسرع — أجب الآن. قُفل البازر للجميع."
    : error ||
      (connection === "stale"
        ? "وصلت نسخة محفوظة. ننتظر تأكيد الخادم قبل فتح البازر."
        : connection === "connecting" || connection === "reconnecting"
          ? "جارٍ تأكيد أحدث حالة للمباراة."
          : projection.messageAr) ||
      (projection.contentHold
        ? "توقف اللعب لأن المحتوى المتاح لهذه الخطوة نفد. سيقرر المضيف إنهاء المباراة بلا فائز أو بدء مباراة جديدة."
        : state === "MATCH_COMPLETE"
          ? winner
            ? `المسار والمباراة اكتملَا لصالح ${winner}.`
            : "اكتملت المباراة."
          : projection.self?.canBuzz
            ? "البازر مفتوح لفريقك."
            : "سيظهر هنا وضعك التالي.");
  const lobbyGameKind = projection.room.matchSettings?.gameKind ?? "huroof";
  const lobbyCategories = projection.room.matchSettings?.categories ?? [];
  const lobbyScope =
    lobbyGameKind === "categories"
      ? `لعبة الفئات · ${lobbyCategories.length} فئات مختارة`
      : lobbyCategories.length
        ? `لعبة الحروف · ${lobbyCategories.length} فئات مختارة`
        : "لعبة الحروف · كل الفئات المتاحة";
  const submitBuzz = () => {
    if (
      buzzSubmittingRef.current ||
      !projection.self?.canBuzz ||
      connection !== "connected"
    )
      return;
    buzzSubmittingRef.current = true;
    setBuzzSubmitting(true);
    void send("BUZZ")
      .then(() => reportError(""))
      .catch((reason) => {
        buzzSubmittingRef.current = false;
        setBuzzSubmitting(false);
        reportError(readableError(reason));
      });
  };
  if (surface === "lobby")
    return (
      <main
        className="app-page spatial-shell spatial-shell--lobby"
        id="main-content"
      >
        <AppHeader />
        <section className="lobby-page spatial-lobby">
          <div className={`lobby-title${host ? " lobby-title--host" : ""}`}>
            <div className="lobby-title__identity">
              <p className="eyebrow">غرفة مباشرة</p>
              <h1>ردهة المباراة</h1>
              <p className="lobby-kind" title={lobbyCategories.join("، ")}>
                {lobbyScope}
              </p>
            </div>
            <div className="lobby-title__code">
              <p className="lobby-room-code">
                <span>رمز الغرفة</span>
                <bdi dir="ltr">{projection.room.roomCode}</bdi>
              </p>
              <div className="lobby-title__share-actions">
                <button
                  className="copy-button"
                  onClick={() => void copyRoomCode()}
                >
                  انسخ الرمز
                </button>
              </div>
            </div>
            {host && (
              <HostJoinInlineQr
                join={hostJoin}
                onOpen={() => setJoinDialogOpen(true)}
              />
            )}
            {host && (
              <div className="lobby-start">
                <button
                  className="button button--primary"
                  data-testid="start-match"
                  disabled={!canStartMatch || connection !== "connected"}
                  onClick={() => {
                    if (canStartMatch && connection === "connected")
                      action("START_MATCH");
                  }}
                >
                  ابدأ المباراة
                </button>
                <p data-testid="start-blocked">
                  {projection.room.startBlockedReason
                    ? "يلزم لاعبان في فريقين وجاهزية الجميع قبل البدء."
                    : projection.room.members?.some(
                          (member) => member.role === "player",
                        )
                      ? "المباراة جاهزة بعد اكتمال الفريقين."
                      : "وضع المضيف فقط جاهز: ستتحكم بالفريقين يدوياً."}
                </p>
              </div>
            )}
            <p aria-live="polite" className="form-message">
              {copyStatus}
            </p>
          </div>
          <div className="lobby-rosters">
            {(["horizontal", "vertical"] as const).map((axis) => (
              <section className={`roster roster--${axis}`} key={axis}>
                <h2>
                  <AxisMark axis={axis} /> {projection.room.teams?.[axis]}
                </h2>
                {(projection.room.members ?? []).filter(
                  (member) => member.team === axis,
                ).length > 0 ? (
                  (projection.room.members ?? [])
                    .filter((member) => member.team === axis)
                    .map((member) => (
                      <p
                        className="member-row"
                        key={`${axis}-${member.displayName}`}
                      >
                        <span>{member.displayName}</span>
                        <span>
                          {member.ready
                            ? "جاهز · تم اختبار البازر"
                            : "بانتظار الجاهزية"}
                        </span>
                      </p>
                    ))
                ) : (
                  <p>لاعب بانتظار الانضمام</p>
                )}
              </section>
            ))}
            <section className="lobby-ready">
              <ConnectionStatus value={connection} />
              <strong>
                {projection.room.readyCount}/{projection.room.memberCount}{" "}
                جاهزون
              </strong>
            </section>
          </div>
          {role === "player" && (
            <button
              className="button button--primary"
              data-testid="ready"
              disabled={connection !== "connected"}
              onClick={() =>
                action("LOBBY_SET_READY", { ready: !projection.self?.ready })
              }
            >
              {projection.self?.ready
                ? "إلغاء الجاهزية"
                : "اختبر البازر وأنا جاهز"}
            </button>
          )}
          <p aria-live="polite" className="form-message">
            {error}
          </p>
        </section>
          {host && (
            <HostJoinDialog
              join={hostJoin}
              onDismiss={() => setJoinDialogOpen(false)}
              open={joinDialogOpen}
            />
        )}
      </main>
    );
  if (surface === "play")
    return (
      <main
        className={`player-page spatial-player player-page--${playerTeam}`}
        data-buzzer-state={buzzerState}
        data-team={playerTeam}
        id="main-content"
      >
        <a className="skip-link" href="#main-content">
          تجاوز إلى المحتوى
        </a>
        <header className="player-page__header">
          <p className="player-page__team">
            {teamName(projection.room.teams?.[playerTeam])}{" "}
            <AxisMark axis={playerTeam} />
          </p>
          <ConnectionStatus value={connection} />
        </header>
        <section
          className="player-buzzer-zone"
          aria-describedby="player-buzzer-status"
        >
          <h1 className="sr-only">
            {connection !== "connected"
              ? buzzText
              : state === "MATCH_COMPLETE"
                ? winner
                  ? `اكتملت المباراة — فاز ${winner}`
                  : "اكتملت المباراة"
                : buzzText}
          </h1>
          <button
            aria-label={
              buzzSubmitting
                ? "جارٍ إرسال الضغط"
                : state === "MATCH_COMPLETE"
                  ? "اكتملت المباراة"
                  : buzzText
            }
            className="buzzer"
            data-state={buzzerState}
            disabled={
              buzzSubmitting ||
              !projection.self?.canBuzz ||
              connection !== "connected"
            }
            onClick={submitBuzz}
            type="button"
          >
            <span className="buzzer__content" aria-hidden="true">
              <small>{stateLabel(state)}</small>
              <strong>
                {buzzSubmitting ? (
                  <>
                    جارٍ إرسال
                    <br />
                    الضغط
                  </>
                ) : connection !== "connected" ? (
                  <>
                    {connection === "offline"
                      ? "انقطع"
                      : connection === "stale"
                        ? "بانتظار تأكيد"
                        : "جارٍ تأكيد"}
                    <br />
                    الخادم
                  </>
                ) : state === "MATCH_COMPLETE" ? (
                  <>
                    اكتملت
                    <br />
                    المباراة
                  </>
                ) : projection.self?.canBuzz ? (
                  <>
                    اضغط
                    <br />
                    الآن
                  </>
                ) : projection.self?.isBuzzWinner ? (
                  <>
                    أنت
                    <br />
                    الأسرع
                  </>
                ) : (
                  <>
                    البازر
                    <br />
                    مغلق
                  </>
                )}
              </strong>
            </span>
          </button>
          <p
            aria-live={connection === "offline" ? "assertive" : "polite"}
            className="player-buzzer-zone__message"
            id="player-buzzer-status"
          >
            {playerMessage}
          </p>
        </section>
        <Link className="player-page__exit" to={`/room/${roomCode}/lobby`}>
          العودة إلى الردهة
        </Link>
      </main>
    );
  if (surface === "display")
    return (
      <main
        className="stage spatial-stage game-arena"
        data-state={state}
        id="main-content"
      >
        <a className="skip-link" href="#main-content">
          تجاوز إلى المحتوى
        </a>
        <div aria-hidden="true" className="game-arena__decor">
          <span className="game-arena__rail game-arena__rail--left" />
          <span className="game-arena__rail game-arena__rail--right" />
          <span className="game-arena__hex game-arena__hex--left" />
          <span className="game-arena__hex game-arena__hex--right" />
        </div>
        {state === "FIRST_ANSWER" && projection.buzzWinner ? (
          <BuzzWinnerBanner winner={projection.buzzWinner} />
        ) : null}
        <header className="game-arena__header">
          <p className="game-arena__brand">
            <span>تحدي الخلية</span>
            <small>شاشة الجمهور</small>
          </p>
          <RoundTimerModule
            hasQuestion={Boolean(projection.question)}
            deadlineAt={projection.deadlineAt}
            onDeadline={reconcileDeadline}
            serverTime={envelope.serverTime}
          />
          <p className="game-arena__badge">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M8 3h8l-1 6h-6L8 3Z" />
              <path d="M9 5 5 7l4 5M15 5l4 2-4 5" />
              <path d="M8 10h8v3a4 4 0 0 1-8 0v-3Z" />
              <path d="M12 17v3M9 21h6" />
            </svg>
            بطولة الحروف
          </p>
        </header>
        <section className="stage-game" aria-label="لوحة المباراة والنتيجة">
          <TeamScoreCard
            axis="vertical"
            currentRound={projection.currentRound}
            points={projection.questionScores?.vertical ?? 0}
            roundResults={projection.roundResults}
            rounds={projection.roundWins?.vertical ?? 0}
            teamName={projection.room.teams?.vertical}
            variant="stage"
          />
          <div
            className={`stage-board-column ${activeCellCaption ? "stage-board-column--active-caption" : ""}`}
          >
            <GameBoard
              activeCellId={projection.activeCellId}
              cells={cells}
              className="stage-board"
              presentation="tactile"
              winningPath={projection.winningPath}
              motionBaselineKey={boardMotionBaselineKey}
              motionEnabled={boardMotionEnabled}
            />
            {activeCellCaption ? (
              <p className="active-cell-caption" role="status">
                {activeCellCaption}
              </p>
            ) : null}
            {state === "CELL_SELECTION" || state === "ROUND_SETUP" ? (
              <p className="stage-waiting" role="status">
                بانتظار اختيار المضيف للخلية التالية
              </p>
            ) : state === "QUESTION_FAILED" ? (
              <p className="stage-waiting" role="status">
                انتهت المحاولة بلا نقطة. بانتظار متابعة المضيف.
              </p>
            ) : null}
          </div>
          <TeamScoreCard
            axis="horizontal"
            currentRound={projection.currentRound}
            points={projection.questionScores?.horizontal ?? 0}
            roundResults={projection.roundResults}
            rounds={projection.roundWins?.horizontal ?? 0}
            teamName={projection.room.teams?.horizontal}
            variant="stage"
          />
        </section>
        <section
          className="question-band"
          aria-live="polite"
          style={{
            visibility: audienceQuestionBandVisible(
              audienceQuestionVisible,
              state,
              projection.question?.promptAr,
            )
              ? "visible"
              : "hidden",
          }}
        >
          <div className="question-band__heading">
            <span aria-hidden="true" className="question-band__line" />
            <svg
              aria-hidden="true"
              className="question-band__icon"
              viewBox="0 0 24 24"
            >
              <path d="M9 18h6M10 21h4M8.5 15.5C7.5 14.5 7 13.2 7 11.5a5 5 0 1 1 10 0c0 1.7-.5 3-1.5 4" />
              <path d="M9 15.5h6" />
            </svg>
            <h2>
              {state === "MATCH_COMPLETE"
                ? "نتيجة المباراة"
                : projection.question?.headerAr || "سؤال الجولة"}
            </h2>
            <span aria-hidden="true" className="question-band__line" />
          </div>
          {state === "MATCH_COMPLETE" ? (
            <>
              <p className="question-band__eyebrow">اكتمل المسار والمباراة</p>
              <h1>{winner ? `فاز ${winner}` : "انتهت المباراة"}</h1>
              {victoryReason && <p>{victoryReason}</p>}
            </>
          ) : (
            <>
              <h1>
                {projection.question?.promptAr ? (
                  state === "QUESTION_READING" || state === "OPPONENT_CHANCE" ? (
                    <QuestionReveal
                      prompt={projection.question.promptAr}
                      questionKey={[
                        roomCode ?? projection.room.roomCode,
                        projection.currentRound ?? "",
                        projection.activeCellId ?? "",
                        projection.question.promptAr,
                      ].join("|")}
                    />
                  ) : (
                    projection.question.promptAr
                  )
                ) : (
                  projection.messageAr || "بانتظار السؤال"
                )}
              </h1>
              {questionMediaVisible && projection.question?.media ? (
                <CurrentQuestionMedia
                  key={`${envelope.roomId}:${projection.activeCellId ?? ""}:${projection.question.media.mediaId}:${projection.question.media.assetSha256}`}
                  roomId={envelope.roomId}
                  media={projection.question.media}
                />
              ) : null}
              {projection.question?.revealedAnswer ? (
                <p className="question-band__revealed-answer" data-testid="shared-revealed-answer">
                  <b>الإجابة:</b> {projection.question.revealedAnswer}
                </p>
              ) : null}
            </>
          )}
        </section>
      </main>
    );
  if (surface === "results")
    return (
      <main
        className="app-page spatial-shell spatial-shell--results"
        id="main-content"
      >
        <AppHeader />
        <section className="results-page">
          <div>
            <p className="eyebrow">
              {incompleteEnd
                ? "مباراة غير مكتملة"
                : resultState.isFinal
                  ? "النتيجة النهائية"
                  : "المباراة مستمرة"}
            </p>
            <h1>
              {incompleteEnd
                ? "انتهت المباراة بلا فائز"
                : !resultState.isFinal
                  ? "لم تنته المباراة بعد"
                  : winner
                    ? `الفائز: ${winner}`
                    : projection.winningPath?.length
                      ? "اكتمل المسار الفائز"
                      : "نتيجة المباراة"}
            </h1>
            {!resultState.isFinal && !incompleteEnd && (
              <p>الحالة الحالية: {stateLabel(state)}</p>
            )}
            {incompleteEnd && (
              <p>
                نفد المحتوى المتاح قبل اكتمال مسار. احتُفظ بالنقاط وسجل الجولات
                دون إعلان فائز.
              </p>
            )}
            <p>
              الجولات: {teamName(projection.room.teams?.horizontal)}{" "}
              {projection.roundWins?.horizontal ?? 0} —{" "}
              {projection.roundWins?.vertical ?? 0}{" "}
              {teamName(projection.room.teams?.vertical)}
            </p>
            {victoryReason && <p>سبب الفوز: {victoryReason}</p>}
          </div>
          <GameBoard
            cells={cells}
            className="result-board"
            presentation="tactile"
            winningPath={projection.winningPath}
            motionBaselineKey={boardMotionBaselineKey}
            motionEnabled={boardMotionEnabled}
          />
          <div className="result-meta">
            <p>
              نقاط الإجابات: ↔ {projection.questionScores?.horizontal ?? 0} · ↕{" "}
              {projection.questionScores?.vertical ?? 0}
            </p>
            {projection.roundResults?.length ? (
              <p>
                تسلسل الجولات الفعّال:{" "}
                {projection.roundResults
                  .map(
                    (result) =>
                      `${result.round}: ${result.winner === "horizontal" ? "↔" : "↕"}`,
                  )
                  .join(" · ")}
              </p>
            ) : null}
            {resultState.isFinal || incompleteEnd ? (
              <>
                <p>قواعد احتساب النقاط</p>
                <ol>
                  <li>اختيار الخلية</li>
                  <li>إجابة صحيحة وتثبيت ملكيتها (+1 نقطة)</li>
                  <li>اكتمال المسار (+1 جولة)</li>
                </ol>
                <Link className="button button--primary" to={host ? newMatchHref : "/host/new"}>
                  مباراة جديدة
                </Link>
              </>
            ) : (
              <Link
                className="button button--primary"
                to={resultState.returnTo ?? "/"}
              >
                {role === "host"
                  ? "العودة إلى لوحة المضيف"
                  : role === "player"
                    ? "العودة إلى البازر"
                    : "العودة إلى شاشة الجمهور"}
              </Link>
            )}
            {host && (resultState.isFinal || incompleteEnd) && (
              <button
                className="button"
                data-testid="rematch-same-settings"
                disabled={rematchBusy}
                onClick={() => void rematch()}
              >
                {rematchBusy ? "جارٍ إنشاء الإعادة…" : "إعادة بنفس الإعدادات"}
              </button>
            )}
          </div>
          <p aria-live="polite" className="form-message">
            {error}
          </p>
        </section>
      </main>
    );
  return (
    <main
      className="app-page host-page spatial-shell spatial-shell--host game-arena game-arena--host"
      data-state={state}
      id="main-content"
    >
      <AppHeader />
      <h1 className="sr-only">لوحة المضيف</h1>
      <div aria-hidden="true" className="game-arena__decor">
        <span className="game-arena__rail game-arena__rail--left" />
        <span className="game-arena__rail game-arena__rail--right" />
        <span className="game-arena__hex game-arena__hex--left" />
        <span className="game-arena__hex game-arena__hex--right" />
      </div>
      <section className="host-layout">
        <div className="host-stage" aria-label="لوحة المباراة والنتيجة">
          <div className="host-board">
            <GameBoard
              activeCellId={projection.activeCellId}
              cells={cells}
              className="host-game-board"
              onSelect={(cellId) => action("SELECT_CELL", { cellId })}
              presentation="tactile"
              selectable={
                host && state === "CELL_SELECTION" && !projection.contentHold
              }
              winningPath={projection.winningPath}
              motionBaselineKey={boardMotionBaselineKey}
              motionEnabled={boardMotionEnabled}
            />
            {activeCellCaption ? (
              <p className="active-cell-caption" role="status">
                {activeCellCaption}
              </p>
            ) : null}
            {projection.room.matchSettings?.gameKind === "categories" ? (
              <button
                aria-expanded={expandedBoardOpen}
                className="host-board-expand"
                data-testid="expand-category-board"
                onClick={() => setExpandedBoardOpen(true)}
                ref={expandedBoardTriggerRef}
                type="button"
              >
                تكبير اللوحة لقراءة الفئات
              </button>
            ) : null}
            <section aria-live="polite" className="host-question-band">
              <div className="host-question-band__heading">
                <span aria-hidden="true" className="question-band__line" />
                <h2>{projection.question?.headerAr || "سؤال الجولة"}</h2>
                <span aria-hidden="true" className="question-band__line" />
              </div>
              {state === "MATCH_COMPLETE" ? (
                <p className="host-question-band__finished" role="status">
                  {incompleteEnd
                    ? "انتهت المباراة بلا فائز. أنشئ مباراة جديدة للعب من البداية."
                    : "اكتملت المباراة. أنشئ مباراة جديدة للعب من البداية."}
                </p>
              ) : state === "CELL_SELECTION" ? (
                <p>بانتظار اختيار الخلية</p>
              ) : (
                <>
                  <h3>
                    {projection.question?.promptAr ||
                      projection.messageAr ||
                      "بانتظار السؤال"}
                  </h3>
                  {questionMediaVisible && projection.question?.media ? (
                    <CurrentQuestionMedia
                      key={`${envelope.roomId}:${projection.activeCellId ?? ""}:${projection.question.media.mediaId}:${projection.question.media.assetSha256}`}
                      roomId={envelope.roomId}
                      media={projection.question.media}
                    />
                  ) : null}
                  {projection.question?.revealedAnswer ? (
                    <p className="host-question-band__revealed-answer" data-testid="shared-revealed-answer">
                      <b>الإجابة:</b> {projection.question.revealedAnswer}
                    </p>
                  ) : null}
                </>
              )}
            </section>
          </div>
        </div>
        <aside className="host-controls">
          {state === "LOBBY" ? (
            <>
              {host && (
                <section
                  className="host-controls__utility"
                  aria-label="انضمام اللاعبين"
                >
                  <span>انضمام اللاعبين</span>
                  <button
                    className="button host-join-trigger"
                    onClick={() => setJoinDialogOpen(true)}
                    type="button"
                  >
                    رمز QR للانضمام
                  </button>
                </section>
              )}
              <HostLobbyControls
                action={hostLobbyAction}
                busy={lobbyBusy}
                canStart={canStartMatch}
                connection={connection}
                error={error}
                fixture={fixtureRoom}
                presence={presence?.players}
                room={projection.room}
                visibilityControls={visibilityControls}
              />
            </>
          ) : (
            <>
              {host && (
                <section
                  className="host-controls__utility"
                  aria-label="انضمام اللاعبين"
                >
                  <span>انضمام اللاعبين</span>
                  <button
                    className="button host-join-trigger"
                    onClick={() => setJoinDialogOpen(true)}
                    type="button"
                  >
                    رمز QR للانضمام
                  </button>
                </section>
              )}
              <section className="host-score-pair" aria-label="نتيجة الفريقين">
                <TeamScoreCard
                  assignment={teamAssignment}
                  axis="vertical"
                  currentRound={projection.currentRound}
                  points={projection.questionScores?.vertical ?? 0}
                  roundResults={projection.roundResults}
                  rounds={projection.roundWins?.vertical ?? 0}
                  teamName={projection.room.teams?.vertical}
                  testId="host-score-vertical"
                  players={
                    projection.room.members?.filter(
                      (member) =>
                        member.role === "player" && member.team === "vertical",
                    ) ?? []
                  }
                  presence={presence?.players}
                  variant="host"
                />
                <TeamScoreCard
                  assignment={teamAssignment}
                  axis="horizontal"
                  currentRound={projection.currentRound}
                  points={projection.questionScores?.horizontal ?? 0}
                  roundResults={projection.roundResults}
                  rounds={projection.roundWins?.horizontal ?? 0}
                  teamName={projection.room.teams?.horizontal}
                  testId="host-score-horizontal"
                  players={
                    projection.room.members?.filter(
                      (member) =>
                        member.role === "player" &&
                        member.team === "horizontal",
                    ) ?? []
                  }
                  presence={presence?.players}
                  variant="host"
                />
              </section>
              <div className="host-controls__topline">
                {state === "FIRST_ANSWER" && projection.buzzWinner ? (
                  <BuzzWinnerBanner winner={projection.buzzWinner} />
                ) : projection.deadlineAt ? (
                  <Countdown
                    deadlineAt={projection.deadlineAt}
                    onDeadline={reconcileDeadline}
                    serverTime={envelope.serverTime}
                  />
                ) : null}
                {state === "FIRST_ANSWER" && projection.deadlineAt ? (
                  <div hidden>
                    <Countdown
                      deadlineAt={projection.deadlineAt}
                      onDeadline={reconcileDeadline}
                      serverTime={envelope.serverTime}
                    />
                  </div>
                ) : null}
                <HostActions
                  action={action}
                  entitledTeam={projection.entitledTeam}
                  playerCount={
                    projection.room.members?.filter(
                      (member) =>
                        member.role === "player" &&
                        member.participation !== "manual",
                    ).length ?? 0
                  }
                  state={state}
                  contentHold={projection.contentHold}
                  endedWithoutWinner={projection.endedWithoutWinner}
                  gameKind={projection.room.matchSettings?.gameKind}
                  newMatchHref={newMatchHref}
                  teams={
                    projection.room.teams ?? {
                      horizontal: "الأحمر",
                      vertical: "الأخضر",
                    }
                  }
                />
              </div>
              {visibilityControls}
              {projection.question?.occurrence && ["QUESTION_READING", "FIRST_ANSWER", "OPPONENT_CHANCE", "QUESTION_FAILED", "PAUSED"].includes(state) ? (
                <button
                  className="button button--quiet"
                  data-testid="shared-answer-reveal"
                  onClick={() => action("REVEAL_ANSWER", { occurrence: projection.question!.occurrence })}
                  type="button"
                >
                  إظهار الإجابة
                </button>
              ) : null}
              {shouldShowHostAnswers(showHostAnswer, projection.question) &&
                projection.question && (
                  <section className="private-question">
                    <div className="private-question__content">
                      <p className="private-question__answer">
                        <b>الإجابة:</b>{" "}
                        {projection.question.primaryAnswer || "—"}
                      </p>
                      <p className="private-question__alternatives">
                        <b>بدائل:</b>{" "}
                        {projection.question.acceptedAnswers
                          ?.filter(
                            (answer) =>
                              answer.trim() !==
                              projection.question?.primaryAnswer?.trim(),
                          )
                          .join("، ") || "—"}
                      </p>
                    </div>
                  </section>
                )}
              <button
                className="correction-trigger"
                data-testid="correction-trigger"
                onClick={() => setCorrectionDialogOpen(true)}
                ref={correctionTriggerRef}
                type="button"
              >
                {projection.contentHold
                  ? "سجل التدقيق (للقراءة فقط)"
                  : "تصحيح وسجل التدقيق"}
              </button>
              <CorrectionDialog
                audit={projection.audit}
                cells={cells}
                correction={projection.correction}
                error={error}
                readOnly={Boolean(projection.contentHold)}
                onBegin={(payload) => action("BEGIN_CORRECTION", payload)}
                onCancel={() => action("CANCEL_CORRECTION")}
                onConfirm={() => action("CONFIRM_CORRECTION")}
                onDismiss={() => setCorrectionDialogOpen(false)}
                open={correctionDialogVisible}
                pending={correctionPending}
                teams={
                  projection.room.teams ?? {
                    horizontal: "الأحمر",
                    vertical: "الأخضر",
                  }
                }
                triggerRef={correctionTriggerRef}
              />
              {error ? (
                <p aria-live="polite" className="form-message">
                  {error}
                </p>
              ) : null}
              <div className="host-controls__connection">
                <ConnectionStatus value={connection} />
              </div>
              <HostTeamManagementStatus state={state} />
              <HostPauseAction
                action={action}
                contentHold={Boolean(projection.contentHold)}
                state={state}
              />
            </>
          )}
          {host && (
            <Link
              aria-label="فتح شاشة العرض في تبويب جديد"
              className="button button--quiet host-controls__display"
              data-testid="host-display-link"
              rel="noopener noreferrer"
              target="_blank"
              to={`/room/${projection.room.roomCode}/display`}
            >
              شاشة العرض
            </Link>
          )}
        </aside>
        {host && (
          <HostJoinDialog
            join={hostJoin}
            onDismiss={() => setJoinDialogOpen(false)}
            open={joinDialogOpen}
          />
        )}
        {host && projection.room.matchSettings?.gameKind === "categories" ? (
          <dialog
            aria-modal="true"
            aria-labelledby="expanded-category-board-title"
            className="expanded-board-dialog"
            data-testid="expanded-category-board"
            onCancel={(event) => {
              event.preventDefault();
              closeExpandedBoard();
            }}
            onClose={restoreExpandedBoardFocus}
            ref={expandedBoardDialogRef}
          >
            <div className="expanded-board-dialog__surface">
              <div className="expanded-board-dialog__heading">
                <h2 id="expanded-category-board-title">لوحة الفئات المكبرة</h2>
                <button
                  aria-label="إغلاق اللوحة المكبرة"
                  className="button button--quiet"
                  onClick={closeExpandedBoard}
                  ref={expandedBoardCloseRef}
                  type="button"
                >
                  إغلاق
                </button>
              </div>
              <p>
                تظهر أسماء الفئات وأرقام الترتيب بوضوح. مرّر اللوحة أفقياً أو
                استخدم مفاتيح الأسهم للوصول إلى جميع الخلايا عندما تكون الجولة
                جاهزة.
              </p>
              <div
                aria-label="لوحة فئات قابلة للتمرير"
                className="expanded-board-dialog__board-scroll"
                tabIndex={0}
              >
                <GameBoard
                  activeCellId={projection.activeCellId}
                  cells={cells}
                  onSelect={(cellId) => {
                    void action("SELECT_CELL", { cellId }).then((accepted) => {
                      if (accepted) setExpandedBoardOpen(false);
                    });
                  }}
                  presentation="tactile"
                  selectable={
                    state === "CELL_SELECTION" && !projection.contentHold
                  }
                  winningPath={projection.winningPath}
                  motionBaselineKey={boardMotionBaselineKey}
                  motionEnabled={boardMotionEnabled}
                />
              </div>
            </div>
          </dialog>
        ) : null}
      </section>
    </main>
  );
}

export function CorrectionDialog({
  audit,
  cells,
  correction,
  error,
  readOnly = false,
  onBegin,
  onCancel,
  onConfirm,
  onDismiss,
  open,
  pending,
  teams,
  triggerRef,
}: {
  audit?: ViewProjection["audit"];
  cells: BoardCell[];
  correction?: SafeProjection["correction"];
  error: string;
  readOnly?: boolean;
  onBegin: (value: Record<string, unknown>) => Promise<boolean>;
  onCancel: () => Promise<boolean>;
  onConfirm: () => Promise<boolean>;
  onDismiss: () => void;
  open: boolean;
  pending: boolean;
  teams: NonNullable<SafeProjection["room"]["teams"]>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setNotice("");
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  const restoreFocus = () => {
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };
  const close = () => {
    if (pending) {
      setNotice("التصحيح قيد المراجعة. استخدم إلغاء التصحيح أو تأكيد التصحيح.");
      return;
    }
    if (typeof dialogRef.current?.close === "function")
      dialogRef.current.close();
    else dialogRef.current?.removeAttribute("open");
  };
  const settlePending = async (request: () => Promise<boolean>) => {
    const succeeded = await request();
    if (!succeeded) return;
    onDismiss();
    if (typeof dialogRef.current?.close === "function")
      dialogRef.current.close();
    else dialogRef.current?.removeAttribute("open");
    restoreFocus();
  };

  return (
    <dialog
      aria-labelledby="correction-dialog-title"
      className="correction-dialog"
      data-testid="correction-dialog"
      onCancel={(event) => {
        if (!pending) return;
        event.preventDefault();
        setNotice(
          "التصحيح قيد المراجعة. استخدم إلغاء التصحيح أو تأكيد التصحيح.",
        );
      }}
      onClose={() => {
        if (pending) return;
        onDismiss();
        restoreFocus();
      }}
      ref={dialogRef}
    >
      {open ? (
        <section className="correction-dialog__surface">
          <header className="correction-dialog__header">
            <div>
              <p>مراجعة المضيف</p>
              <h2 id="correction-dialog-title">تصحيح وسجل التدقيق</h2>
            </div>
            {!pending ? (
              <button
                aria-label="إغلاق التصحيح"
                className="correction-dialog__close"
                onClick={close}
                type="button"
              >
                ×
              </button>
            ) : null}
          </header>
          {pending ? (
            <CorrectionReview
              correction={correction}
              onCancel={() => settlePending(onCancel)}
              onConfirm={() => settlePending(onConfirm)}
              teams={teams}
            />
          ) : readOnly ? (
            <p className="form-message" role="status">
              توقف المحتوى: سجل التدقيق متاح للقراءة فقط، ولا يمكن بدء تصحيح قبل
              إنهاء المباراة بلا فائز أو إنشاء مباراة جديدة.
            </p>
          ) : (
            <CorrectionForm cells={cells} onCorrect={onBegin} teams={teams} />
          )}
          <section
            className="correction-dialog__audit"
            aria-labelledby="correction-audit-title"
          >
            <h3 id="correction-audit-title">سجل التدقيق</h3>
            {audit?.length ? (
              audit.map((entry) => (
                <p key={entry.revision}>
                  {entry.revision} · {stateLabel(entry.type)}
                </p>
              ))
            ) : (
              <p>لا توجد عمليات تصحيح مسجلة بعد.</p>
            )}
          </section>
          {error || notice ? (
            <p aria-live="polite" className="form-message">
              {error || notice}
            </p>
          ) : null}
        </section>
      ) : null}
    </dialog>
  );
}

function CorrectionForm({
  cells,
  onCorrect,
  teams,
}: {
  cells: BoardCell[];
  onCorrect: (value: Record<string, unknown>) => Promise<boolean>;
  teams: NonNullable<SafeProjection["room"]["teams"]>;
}) {
  const [cellId, setCellId] = useState("");
  const [owner, setOwner] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      className="correction-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (cellId && reason.trim())
          void onCorrect({
            cellId,
            owner: owner || undefined,
            reason: reason.trim(),
          });
      }}
    >
      <fieldset className="correction-form__board">
        <legend>الخلية المراد تصحيحها</legend>
        <GameBoard
          activeCellId={cellId || undefined}
          allowOwnedSelection
          cells={cells}
          className="correction-form__game-board"
          onSelect={setCellId}
          presentation="tactile"
          selectable
        />
        <p aria-live="polite">
          {cellId
            ? `الخلية المحددة: ${cells.find((cell) => cell.id === cellId)?.revealedLetter ?? cells.find((cell) => cell.id === cellId)?.visibleValue}`
            : "اختر خلية من اللوحة."}
        </p>
      </fieldset>
      <fieldset className="correction-form__owners">
        <legend>المالك بعد التصحيح</legend>
        <div aria-label="المالك بعد التصحيح">
          <button
            aria-pressed={owner === ""}
            className="correction-owner correction-owner--unowned"
            data-testid="correction-owner-unowned"
            onClick={() => setOwner("")}
            type="button"
          >
            غير مملوكة
          </button>
          <button
            aria-pressed={owner === "horizontal"}
            className="correction-owner correction-owner--horizontal"
            data-testid="correction-owner-horizontal"
            onClick={() => setOwner("horizontal")}
            type="button"
          >
            {teamName(teams.horizontal)}
          </button>
          <button
            aria-pressed={owner === "vertical"}
            className="correction-owner correction-owner--vertical"
            data-testid="correction-owner-vertical"
            onClick={() => setOwner("vertical")}
            type="button"
          >
            {teamName(teams.vertical)}
          </button>
        </div>
      </fieldset>
      <label>
        سبب التصحيح
        <textarea
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <button className="button" type="submit">
        معاينة التصحيح
      </button>
    </form>
  );
}
function CorrectionReview({
  correction,
  onConfirm,
  onCancel,
  teams,
}: {
  correction?: SafeProjection["correction"];
  onConfirm: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  teams: NonNullable<SafeProjection["room"]["teams"]>;
}) {
  if (!correction)
    return (
      <section className="correction">
        <h2>التصحيح قيد التحضير</h2>
        <p>تُراجع التأثيرات التابعة قبل التأكيد.</p>
      </section>
    );
  const owner =
    correction.owner === "horizontal"
      ? teamName(teams.horizontal)
      : correction.owner === "vertical"
        ? teamName(teams.vertical)
        : "غير مملوكة";
  const prior =
    correction.priorOwner === "horizontal"
      ? teamName(teams.horizontal)
      : correction.priorOwner === "vertical"
        ? teamName(teams.vertical)
        : "غير مملوكة";
  return (
    <section className="correction" data-testid="correction-review">
      <h2>مراجعة التصحيح</h2>
      <p>
        الخلية: {correction.cellId} · من {prior} إلى {owner}
      </p>
      <p>السبب المطلوب: {correction.reason}</p>
      <p>
        الأثر التابع: سيُعاد احتساب المسار الفائز ونتيجة الجولة قبل حفظ التصحيح.
      </p>
      <div className="control-grid">
        <button className="button button--primary" onClick={onConfirm}>
          تأكيد التصحيح
        </button>
        <button className="button" onClick={onCancel}>
          إلغاء التصحيح
        </button>
      </div>
    </section>
  );
}

export function HowToPlayRoute() {
  useDocumentTitle("كيف تلعب");
  return (
    <main
      className="app-page spatial-shell spatial-shell--rules"
      id="main-content"
    >
      <AppHeader />
      <section className="rules-page spatial-rules">
        <div>
          <p className="eyebrow">قواعد مختصرة</p>
          <h1>كيف تلعب؟</h1>
          <ol>
            <li>
              <b>اختر</b> خلية من اللوح.
            </li>
            <li>يظهر السؤال ويُفتح البازر تلقائيًا.</li>
            <li>
              <b>التقط</b> الخلية بإجابة صحيحة.
            </li>
            <li>
              <b>صِل</b> بين طرفي محرك.
            </li>
          </ol>
        </div>
        <div>
          <GameBoard
            activeCellId="cell-2-2"
            cells={previewBoardCells.map((cell) =>
              cell.id === "cell-2-2"
                ? { ...cell, owner: "horizontal" as const }
                : cell,
            )}
            presentation="tactile"
          />
          <p>
            <AxisMark axis="horizontal" /> يصل اليسار باليمين ·{" "}
            <AxisMark axis="vertical" /> يصل الأعلى بالأسفل
          </p>
        </div>
      </section>
    </main>
  );
}

type Item = {
  id: string;
  targetLetter: string;
  headerAr: string;
  promptAr?: string;
  canonicalAnswer?: string;
  acceptedAnswers?: string[];
  difficulty?: string;
  status: string;
  categoryId?: string;
  sourceUrl?: string;
  useCount?: number;
  objectionCount?: number;
  reviewError?: string;
  readOnly?: boolean;
};
const reviewStatusLabel = (status: string) =>
  ({ draft: "مسودة", approved: "معتمد", rejected: "مرفوض" })[status] ??
  "غير محددة";
export function QuestionsRoute() {
  useDocumentTitle("إدارة الأسئلة");
  const { questionId } = useParams();
  const location = useLocation();
  const editorId =
    questionId ?? (location.pathname.endsWith("/new") ? "new" : undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [letterFilter, setLetterFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [difficulty, setDifficulty] = useState("all");
  const [status, setStatus] = useState("all");
  const [sourceState, setSourceState] = useState("all");
  const [usage, setUsage] = useState("all");
  const [objections, setObjections] = useState("all");
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    void fetch("/api/admin/questions")
      .then((response) =>
        response.ok
          ? (response.json() as Promise<Item[]>)
          : Promise.reject(new Error()),
      )
      .then(setItems)
      .catch(() =>
        setLoadError("تعذر تحميل المخزون المحلي. تحقق من خدمة الإدارة."),
      );
  }, []);
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (!letterFilter || item.targetLetter === letterFilter) &&
          (categoryFilter === "all" || item.categoryId === categoryFilter) &&
          (difficulty === "all" || item.difficulty === difficulty) &&
          (status === "all" || item.status === status) &&
          (sourceState === "all" ||
            (sourceState === "complete"
              ? Boolean(item.sourceUrl)
              : !item.sourceUrl)) &&
          (usage === "all" ||
            (usage === "used"
              ? (item.useCount ?? 0) > 0
              : (item.useCount ?? 0) === 0)) &&
          (objections === "all" ||
            (objections === "has"
              ? (item.objectionCount ?? 0) > 0
              : (item.objectionCount ?? 0) === 0)),
      ),
    [
      categoryFilter,
      difficulty,
      items,
      letterFilter,
      objections,
      sourceState,
      status,
      usage,
    ],
  );
  return (
    <main className="app-page" id="main-content">
      <AppHeader />
      <section className="admin-page">
        <header className="admin-page__header">
          <div>
            <p className="admin-note">
              إدارة محلية فقط؛ مصادقة الإنتاج خارج نطاق هذه الواجهة.
            </p>
            <h1>{editorId ? "محرر السؤال" : "مخزون الأسئلة"}</h1>
          </div>
          {!editorId && (
            <Link className="button button--primary" to="/questions/new">
              مسودة جديدة
            </Link>
          )}
        </header>
        {editorId ? (
          <QuestionEditor id={editorId} />
        ) : (
          <div className="inventory-layout">
            <aside className="filter-rail">
              <label>
                الحرف
                <input
                  aria-label="الحرف"
                  maxLength={1}
                  placeholder="مثال: أ"
                  value={letterFilter}
                  onChange={(event) => setLetterFilter(event.target.value)}
                />
              </label>
              <label>
                الفئة
                <select
                  aria-label="الفئة"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="all">كل الفئات</option>
                  {categoryCatalog.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.displayNameAr}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                الحالة
                <select
                  aria-label="حالة المراجعة"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="all">كل الحالات</option>
                  <option value="draft">مسودة</option>
                  <option value="approved">معتمد</option>
                  <option value="rejected">مرفوض</option>
                </select>
              </label>
              <label>
                الصعوبة
                <select
                  aria-label="الصعوبة"
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value)}
                >
                  <option value="all">كل الصعوبات</option>
                  <option value="easy">سهل</option>
                  <option value="medium">متوسط</option>
                  <option value="hard">صعب</option>
                  <option value="سهل">سهل (قديم)</option>
                  <option value="متوسط">متوسط (قديم)</option>
                  <option value="صعب">صعب (قديم)</option>
                </select>
              </label>
              <label>
                حالة المصدر
                <select
                  aria-label="حالة المصدر"
                  value={sourceState}
                  onChange={(event) => setSourceState(event.target.value)}
                >
                  <option value="all">كل المصادر</option>
                  <option value="complete">مصدر مكتمل</option>
                  <option value="missing">مصدر ناقص</option>
                </select>
              </label>
              <label>
                عدد الاستخدام
                <select
                  aria-label="عدد الاستخدام"
                  value={usage}
                  onChange={(event) => setUsage(event.target.value)}
                >
                  <option value="all">كل الاستخدامات</option>
                  <option value="used">مستخدم</option>
                  <option value="unused">غير مستخدم</option>
                </select>
              </label>
              <label>
                الاعتراضات
                <select
                  aria-label="الاعتراضات"
                  value={objections}
                  onChange={(event) => setObjections(event.target.value)}
                >
                  <option value="all">كل الاعتراضات</option>
                  <option value="has">لديه اعتراضات</option>
                  <option value="none">بلا اعتراضات</option>
                </select>
              </label>
              <p>{categoryCatalog.length} فئة مستوردة</p>
            </aside>
            <div className="inventory-table">
              {loadError ? (
                <section
                  className="empty-state"
                  data-testid="admin-review-error"
                >
                  <h2>تعذر تحميل الأسئلة</h2>
                  <p>{loadError}</p>
                </section>
              ) : visible.length === 0 ? (
                <section className="empty-state">
                  <h2>لا توجد أسئلة مطابقة</h2>
                  <p>غيّر عوامل التصفية أو أنشئ مسودة محلية للمراجعة.</p>
                </section>
              ) : (
                <>
                  <div className="table-head">
                    <span>الحرف</span>
                    <span>العنوان</span>
                    <span>الحالة</span>
                    <span>الاستخدام / الاعتراضات</span>
                  </div>
                  {visible.slice(0, 100).map((item) => (
                    <Link
                      className="table-row"
                      key={item.id}
                      to={`/questions/${item.id}`}
                    >
                      <b>{item.targetLetter}</b>
                      <span>{item.headerAr}</span>
                      <span>{reviewStatusLabel(item.status)}</span>
                      <span>
                        {item.useCount ?? 0} / {item.objectionCount ?? 0}
                      </span>
                    </Link>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
function QuestionEditor({ id }: { id: string }) {
  const [item, setItem] = useState<Item | undefined>(
    id === "new"
      ? {
          id: "new",
          targetLetter: "",
          headerAr: "",
          status: "draft",
          difficulty: "متوسط",
        }
      : undefined,
  );
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    if (id === "new") return;
    void fetch(`/api/admin/questions/${encodeURIComponent(id)}`)
      .then((response) =>
        response.ok
          ? (response.json() as Promise<Item>)
          : Promise.reject(new Error()),
      )
      .then(setItem)
      .catch(() => setLoadError("تعذر تحميل هذا السؤال للمراجعة."));
  }, [id]);
  const readOnly = Boolean(item?.readOnly || item?.status === "approved");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: id === "new" ? undefined : id,
          promptAr: values.get("prompt"),
          canonicalAnswer: values.get("answer"),
          acceptedAnswers: String(values.get("alternatives") ?? "")
            .split("،")
            .filter(Boolean),
          targetLetter: values.get("letter"),
          sourceUrl: values.get("source"),
          versionNotes: note,
        }),
      });
      setSaved(
        response.ok
          ? "حُفظت كمسودة محلية؛ لا تُنشر تلقائياً."
          : "تعذر حفظ المسودة.",
      );
    } catch {
      setSaved("تعذر حفظ المسودة.");
    }
  }
  if (loadError)
    return (
      <section className="empty-state" data-testid="admin-review-error">
        <h2>تعذر تحميل السؤال</h2>
        <p>{loadError}</p>
      </section>
    );
  if (!item)
    return (
      <section className="empty-state">
        <p>جارٍ تحميل السؤال…</p>
      </section>
    );
  return (
    <form className="editor-layout" onSubmit={save}>
      <section>
        <p>
          السؤال: <bdi dir="ltr">{id === "new" ? "NEW" : id}</bdi>
        </p>
        {item.reviewError && (
          <p className="form-message" data-testid="review-error">
            خطأ مراجعة: {item.reviewError}
          </p>
        )}
        <label>
          السؤال
          <input
            defaultValue={item.promptAr ?? item.headerAr}
            disabled={readOnly}
            name="prompt"
            required
          />
        </label>
        <label>
          الإجابة الأساسية
          <input
            defaultValue={item.canonicalAnswer}
            disabled={readOnly}
            name="answer"
            required
          />
        </label>
        <label>
          بدائل الإجابة
          <input
            defaultValue={item.acceptedAnswers?.join("، ")}
            disabled={readOnly}
            name="alternatives"
          />
        </label>
        <label>
          الحرف المستهدف
          <input
            defaultValue={item.targetLetter}
            disabled={readOnly}
            maxLength={1}
            name="letter"
            required
          />
        </label>
        <label>
          الفئة
          <select
            defaultValue={item.categoryId}
            disabled={readOnly}
            name="category"
          >
            {categoryCatalog.map((category) => (
              <option key={category.id} value={category.id}>
                {category.displayNameAr}
              </option>
            ))}
          </select>
        </label>
        <label>
          الصعوبة
          <select
            defaultValue={item.difficulty ?? "متوسط"}
            disabled={readOnly}
            name="difficulty"
          >
            <option>متوسط</option>
            <option>سهل</option>
            <option>صعب</option>
          </select>
        </label>
        <label>
          المصدر / الرابط
          <input
            defaultValue={item.sourceUrl}
            disabled={readOnly}
            name="source"
            required
            type="url"
          />
        </label>
      </section>
      <aside>
        <h2>المراجعة والدليل</h2>
        {readOnly ? (
          <p data-testid="read-only-question">
            هذا السؤال معتمد للقراءة فقط؛ أنشئ مسودة محلية لتغييره.
          </p>
        ) : (
          <>
            <p>
              لا تنشر الأسئلة المولدة أو المسودات بلا مراجعة بشرية ومصدر مكتمل.
            </p>
            <label>
              ملاحظات الإصدار
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <button className="button button--primary" type="submit">
              احفظ كمسودة محلية
            </button>
          </>
        )}
        <p aria-live="polite">{saved || "المسودة غير منشورة."}</p>
      </aside>
    </form>
  );
}
export function NotFoundRoute() {
  useDocumentTitle("الصفحة غير موجودة");
  return (
    <main
      className="app-page spatial-shell spatial-shell--status"
      id="main-content"
    >
      <AppHeader />
      <section className="status-panel spatial-status-panel">
        <p className="eyebrow">404</p>
        <h1>الصفحة غير موجودة</h1>
        <p>ربما تغيّر الرابط أو انتهت الجلسة.</p>
        <Link className="button button--primary" to="/">
          العودة إلى الدخول
        </Link>
      </section>
    </main>
  );
}
