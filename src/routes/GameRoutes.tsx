import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
import { categoryCatalog, featuredCategories } from "../data/category-catalog";
import { GameBoard, type BoardCell } from "../features/board/game-board";
import { generateBoard } from "../features/game/domain/board";
import {
  matchModeOptions,
  parseSetupQuery,
} from "../features/game/setup-options";
import { connectionLabel, stateLabel } from "../features/ui/game-state";
import type {
  IntentType,
  ProjectionEnvelope,
  SafeProjection,
} from "../features/game/runtime/contracts";
import { gameRuntime } from "../features/game/runtime";

type StoredCapability = { token: string; role: "host" | "player" | "audience" };
type ViewProjection = SafeProjection & {
  question?: {
    headerAr?: string;
    promptAr?: string;
    primaryAnswer?: string;
    acceptedAnswers?: string[];
    revealedAnswer?: string;
    sources?: Array<{ title?: string; url?: string }>;
  };
  audit?: Array<{ revision: number; type: string; payload?: unknown }>;
};
const capabilityKey = (id: string) => `huroof:${id}`;
const capabilityFor = (id: string) => {
  try {
    const value = sessionStorage.getItem(capabilityKey(id));
    return value ? (JSON.parse(value) as StoredCapability) : undefined;
  } catch {
    return undefined;
  }
};
const saveCapability = (id: string, value: StoredCapability) =>
  sessionStorage.setItem(capabilityKey(id), JSON.stringify(value));
const readableError = (error: unknown) => {
  const message =
    error instanceof Error ? error.message.replace(/^Error:\s*/, "") : "";
  if (
    message === "QUESTION_SCOPE_INSUFFICIENT_COVERAGE" ||
    /(?:Insufficient 16 visible \+ 9 surprise letter coverage|Pinned release has insufficient 16 visible \+ 9 surprise coverage)/.test(
      message,
    )
  )
    return "لا تكفي الأسئلة في الفئات المختارة لتجهيز لوحة المباراة. اختر «كل الفئات» أو أضف «معلومات عامة».";
  return message || "تعذر إتمام العملية.";
};
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
function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | استوديو الحروف`;
  }, [title]);
}
const teamName = (name?: string) =>
  name?.trim().startsWith("فريق")
    ? name.trim()
    : `فريق ${name?.trim() || "غير محدد"}`;
export const canDispatchLobbyStart = (state: string, canStart?: boolean) =>
  state === "LOBBY" && canStart === true;

export function currentRoomDestination(
  roomCode: string | undefined,
  role: "host" | "player" | "audience" | undefined,
) {
  if (!roomCode || !role) return undefined;
  const surface = role === "host" ? "host" : role === "player" ? "play" : "display";
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
          استوديو الحروف
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

export function HostNewRoute() {
  useDocumentTitle("إنشاء مباراة");
  const navigate = useNavigate();
  const location = useLocation();
  const querySeed = useRef(parseSetupQuery(new URLSearchParams(location.search)));
  const [form, setForm] = useState({
    mode: querySeed.current.mode,
    horizontal: "الأحمر",
    vertical: "الأخضر",
    questionSeconds: 20,
    opponentSeconds: 10,
    demo: true,
    categories: querySeed.current.categories,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [unavailableCovers, setUnavailableCovers] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionLimitMessage, setSelectionLimitMessage] = useState("");
  const visibleCategories = useMemo(() => {
    const query = categoryQuery.trim().toLocaleLowerCase("ar");
    if (!query) return categoryCatalog;
    return categoryCatalog.filter((category) =>
      `${category.displayNameAr} ${category.id}`
        .toLocaleLowerCase("ar")
        .includes(query),
    );
  }, [categoryQuery]);
  const selectedCategories = useMemo(
    () =>
      form.categories.flatMap((id) => {
        const category = categoryCatalog.find((candidate) => candidate.id === id);
        return category ? [category] : [];
      }),
    [form.categories],
  );
  const update = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  const toggleCategory = (id: string) => {
    const isSelected = form.categories.includes(id);
    if (!isSelected && form.categories.length >= maximumSelectedCategories) {
      setSelectionLimitMessage(`يمكن اختيار ${maximumSelectedCategories} فئات كحد أقصى.`);
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
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const request = {
        displayName: "المضيف",
        demo: form.demo,
        mode: form.mode,
        modality: "classic" as const,
        questionSeconds: form.questionSeconds,
        opponentSeconds: form.opponentSeconds,
        teams: { horizontal: form.horizontal, vertical: form.vertical },
        categories: form.categories.length
          ? form.categories
          : categoryCatalog.map((category) => category.id),
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
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="app-page spatial-shell spatial-shell--setup" id="main-content">
      <AppHeader />
      <section className="setup-page spatial-setup" aria-labelledby="setup-title">
        <div>
          <p className="eyebrow">إعداد المباراة</p>
          <h1 id="setup-title">أنشئ مباراة</h1>
        </div>
        <form className="setup-form" id="match-setup-form" onSubmit={create}>
          <section>
            <h2>المباراة</h2>
            <div
              className="segmented"
              role="radiogroup"
              aria-label="نمط المباراة"
            >
              {matchModeOptions.map((mode) => (
                <button
                  aria-checked={form.mode === mode.id}
                  className={form.mode === mode.id ? "is-selected" : ""}
                  key={mode.id}
                  onClick={() => update("mode", mode.id)}
                  role="radio"
                  type="button"
                >
                  {mode.labelAr}
                </button>
              ))}
            </div>
            <p className="field-note">{matchModeOptions.find((mode) => mode.id === form.mode)?.descriptionAr}</p>
            <p className="field-note">
              تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات إجمالاً
            </p>
          </section>
          <section className="team-fields">
            <h2>الفريقان</h2>
            <label className="team-card team-card--horizontal">
              <span className="team-card__header">الفريق الأحمر <AxisMark axis="horizontal" /></span>
              <input
                aria-label="اسم الفريق الأحمر ↔ الأحمر"
                value={form.horizontal}
                onChange={(event) => update("horizontal", event.target.value)}
              />
            </label>
            <label className="team-card team-card--vertical">
              <span className="team-card__header">الفريق الأخضر <AxisMark axis="vertical" /></span>
              <input
                aria-label="اسم الفريق الأخضر ↕ الأخضر"
                value={form.vertical}
                onChange={(event) => update("vertical", event.target.value)}
              />
            </label>
          </section>
          <section>
            <h2>الفئات</h2>
            <p className="field-note">
              اختر فئات محددة، أو اترك الاختيار فارغاً لاستخدام كل الفئات في
              ترشيح الأسئلة.
            </p>
            <div className="category-filter" role="search">
              <label>
                <span>تصفية الفئات</span>
                <input
                  aria-label="تصفية الفئات"
                  onChange={(event) => setCategoryQuery(event.target.value)}
                  placeholder="ابحث باسم الفئة"
                  type="search"
                  value={categoryQuery}
                />
              </label>
              <div className="category-filter__meta">
                <small aria-live="polite">
                  {visibleCategories.length} من {categoryCatalog.length} فئة
                </small>
                <button
                  aria-pressed={form.categories.length === 0}
                  className="category-filter__all"
                  onClick={() => {
                    setSelectionLimitMessage("");
                    update("categories", []);
                  }}
                  type="button"
                >
                  كل الفئات
                </button>
              </div>
            </div>
            <p className="category-filter__scope" aria-live="polite">
              {form.categories.length === 0
                ? `كل الفئات (${categoryCatalog.length}) ستدخل في ترشيح الأسئلة.`
                : `سيجري ترشيح الأسئلة من ${form.categories.length} فئة مختارة.`}
            </p>
            <div className="category-grid">
              {visibleCategories.map((category) => (
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
                      alt={isFallbackCover ? `صورة افتراضية لفئة ${category.displayNameAr}` : category.cover.altAr}
                      onError={() => {
                        if (!isFallbackCover)
                          setUnavailableCovers((current) => new Set(current).add(category.id));
                      }}
                      src={isFallbackCover ? defaultCategoryCover : `/${category.cover.web320}`}
                    />
                      <span className="category-choice__title">{category.displayNameAr}</span>
                    </button>
                  );
                })()
              ))}
              {visibleCategories.length === 0 ? (
                <p className="category-filter__empty">لا توجد فئات مطابقة.</p>
              ) : null}
            </div>
          </section>
          {selectedCategories.length > 0 ? (
            <aside className="selected-categories-bar" aria-label="الفئات المختارة">
              <div className="selected-categories-bar__heading">
                <strong>الفئات المختارة</strong>
                <bdi dir="ltr">
                  {selectedCategories.length} / {maximumSelectedCategories}
                </bdi>
              </div>
              <ul className="selected-categories-bar__chips">
                {selectedCategories.map((category) => (
                  <li key={category.id}>
                    <button
                      aria-label={`إزالة ${category.displayNameAr}`}
                      onClick={() => toggleCategory(category.id)}
                      type="button"
                    >
                      {category.displayNameAr}
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p aria-live="polite">{selectionLimitMessage}</p>
            </aside>
          ) : null}
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
          {querySeed.current.notice && (
            <p className="form-message" data-testid="setup-query-notice">
              {querySeed.current.notice}
            </p>
          )}
          <label className="demo-control">
            <input
              checked={form.demo}
              onChange={(event) => update("demo", event.target.checked)}
              type="checkbox"
            />{" "}
            استخدم مسودات تجريبية صريحة؛ يمكن للمضيف تشغيل الفريقين دون لاعبين.
          </label>
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
              <dt>قاعدة الفوز</dt>
              <dd>
                تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات
                إجمالاً
              </dd>
            </div>
            <div>
              <dt>الفئات المختارة</dt>
              <dd>{form.categories.length || "كل الفئات"}</dd>
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
            disabled={busy || !form.demo}
            form="match-setup-form"
            title={!form.demo ? "لا يوجد مخزون معتمد كافٍ" : undefined}
            type="submit"
          >
            {busy ? "جارٍ الإنشاء…" : "أنشئ الغرفة التجريبية"}
          </button>
          <p aria-live="polite" className="form-message">
            {error ||
              (!form.demo
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
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "reconnecting" | "offline" | "stale"
  >("connecting");
  const [error, setError] = useState("");
  const retry = useRef<number | undefined>(undefined);
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
    const closeSocket = () => {
      const socket = socketRef.current;
      socketRef.current = undefined;
      connecting.current = false;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
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
        let cap = roomId ? capabilityFor(roomId) : undefined;
        if (!cap && autoAudience) {
          if (gameRuntime.kind === "firebase" && gameRuntime.joinAudience) {
            const audience = await gameRuntime.joinAudience(code);
            roomId = audience.roomId;
            saveCapability(roomId, { token: "", role: "audience" });
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
            saveCapability(roomId, { token: audience.token, role: "audience" });
          }
          sessionStorage.setItem(`huroof:code:${code}`, roomId);
          cap = roomId ? capabilityFor(roomId) : undefined;
        }
        if (!roomId || !cap)
          throw new Error("افتح الرابط بعد الانضمام أو من رابط المضيف.");
        const role = projectionRole ?? cap.role;
        if (gameRuntime.kind === "firebase") {
          const unsubscribe = gameRuntime.subscribeProjection(
            roomId,
            role,
            "",
            (value) => {
              if (!alive) return;
              setEnvelope(value as ProjectionEnvelope<ViewProjection>);
              setConnection("connected");
              setError("");
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
          const value = JSON.parse(
            String(event.data),
          ) as ProjectionEnvelope<ViewProjection> & { error?: string };
          if (value.error) {
            setError(value.error);
            return;
          }
          setEnvelope(value);
          setConnection("connected");
        };
        socket.onclose = () => {
          if (socketRef.current === socket) socketRef.current = undefined;
          connecting.current = false;
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
    window.addEventListener("offline", offline);
    window.addEventListener("online", reconnect);
    if (online()) void connect();
    else offline();
    return () => {
      alive = false;
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", reconnect);
      clearRetry();
      closeSocket();
    };
  }, [autoAudience, code, projectionRole]);
  const send = async (
    type: IntentType,
    payload: Record<string, unknown> = {},
  ) => {
    if (connection !== "connected") throw new Error("CONNECTION_UNAVAILABLE");
    if (!envelope) return;
    if (gameRuntime.kind === "firebase") {
      await gameRuntime.submitGameIntent(envelope.roomId, {
        type,
        payload,
        expectedRevision: envelope.revision,
        intentId: crypto.randomUUID(),
      });
      return;
    }
    const cap = capabilityFor(envelope.roomId);
    if (!cap) return;
    const response = await fetch(`/api/rooms/${envelope.roomId}/intents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cap.token}`,
      },
      body: JSON.stringify({
        type,
        payload,
        expectedRevision: envelope.revision,
        intentId: crypto.randomUUID(),
      }),
    });
    const result = (await response.json()) as {
      projection?: ProjectionEnvelope<ViewProjection>;
      error?: string;
    };
    if (!response.ok) throw new Error(result.error ?? "تعذر تنفيذ العملية.");
    if (result.projection) setEnvelope(result.projection);
  };
  return { envelope, connection, error, send, reportError: setError };
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
  currentRound,
  points,
  roundResults,
  rounds,
  testId,
  teamName: customName,
  variant,
}: {
  axis: TeamAxis;
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
      <span className={`${variant}-score__team`}>{label}</span>
      <div className="team-score__rounds">
        <strong
          data-testid={
            testId ? `${testId.replace("score", "round-wins")}` : undefined
          }
        >
          {rounds}
        </strong>
        <small>الجولات</small>
        <RoundMarkers
          axis={axis}
          currentRound={currentRound}
          roundResults={roundResults}
        />
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
    </section>
  );
}

function RoundTimerModule({
  currentRound,
  deadlineAt,
  onDeadline,
  serverTime,
  state,
}: {
  currentRound?: number;
  deadlineAt?: string;
  onDeadline?: () => void;
  serverTime: string;
  state: string;
}) {
  return (
    <section className="round-timer-module" aria-label="مؤقت الجولة">
      <span>
        {stateLabel(state)} · الجولة {currentRound ?? 0}
      </span>
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
      {winner.displayName} <AxisMark axis={winner.team} />
    </p>
  );
}
function HostActions({
  state,
  action,
  playerCount,
  teams,
  entitledTeam,
}: {
  state: string;
  action: (type: IntentType, payload?: Record<string, unknown>) => void;
  playerCount: number;
  teams: NonNullable<SafeProjection["room"]["teams"]>;
  entitledTeam?: "horizontal" | "vertical";
}) {
  const manualSelection =
    state === "QUESTION_READING" || state === "OPPONENT_CHANCE";
  const hostOnly = playerCount === 0;
  const primary: Partial<Record<string, [IntentType, string]>> = {
    ROUND_SETUP: ["ROUND_READY", "جهّز الجولة"],
    LETTER_REVEAL: ["LETTER_REVEALED", "اكشف الحرف"],
    ...(hostOnly ? {} : { QUESTION_READING: ["OPEN_QUESTION", "افتح البازر"] }),
    CELL_AWARDED: ["AWARD_CELL", "ثبّت الخلية (+1 نقطة)"],
    PATH_CHECK: ["CHECK_PATH", "تحقق من المسار"],
    ROUND_COMPLETE: ["START_NEXT_ROUND", "جولة جديدة"],
  };
  return (
    <div
      className={`control-grid ${manualSelection && !hostOnly ? "control-grid--player-override" : ""}`}
    >
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
          <button className="button" onClick={() => action("JUDGE_CORRECT")}>
            قبول بديل
          </button>
        </>
      )}
      {state === "QUESTION_FAILED" && (
        <>
          <button
            className="button button--primary"
            onClick={() => action("RETRY_CELL")}
          >
            أعد المحاولة
          </button>
          <button className="button" onClick={() => action("RETURN_CELL")}>
            أعد الخلية
          </button>
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
          <p>
            {hostOnly
              ? "تحكم المضيف: اختر الفريق المجيب مباشرة."
              : "تجاوز يدوي للمضيف: اختر الفريق المجيب."}
          </p>
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
                <AxisMark axis={team} />
              </button>
            ))}
          </div>
        </section>
      )}
      {state !== "CORRECTION" && state !== "MATCH_COMPLETE" && (
        <button
          className="button button--quiet"
          onClick={() => action(state === "PAUSED" ? "RESUME" : "PAUSE")}
        >
          {state === "PAUSED" ? "استئناف" : "إيقاف مؤقت"}
        </button>
      )}
    </div>
  );
}

export function RoomRoute({
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
  const { envelope, connection, error, send, reportError } = useRoom(
    roomCode,
    surface === "display",
    surface === "display" ? "audience" : undefined,
  );
  const navigate = useNavigate();
  const projection = envelope?.projection;
  const [copyStatus, setCopyStatus] = useState("");
  const [rematchBusy, setRematchBusy] = useState(false);
  const activeDestination = activeLobbyDestination(
    roomCode,
    surface,
    envelope?.role,
    projection?.room.state,
  );
  useEffect(() => {
    if (activeDestination) navigate(activeDestination, { replace: true });
  }, [activeDestination, navigate]);
  const action = (type: IntentType, payload?: Record<string, unknown>) =>
    void send(type, payload)
      .then(() => reportError(""))
      .catch((reason) => reportError(readableError(reason)));
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
      <main className="app-page spatial-shell spatial-shell--status" id="main-content">
        <AppHeader />
        <section className="status-panel spatial-status-panel">
          <h1>
            {error || connection === "offline"
              ? "تعذر فتح الغرفة"
              : "جارٍ الاتصال بالغرفة…"}
          </h1>
          <p>{error || "تحقق من رابط الغرفة ثم حاول الانضمام من صفحة الدخول."}</p>
          <Link className="button" to="/">
            العودة إلى الدخول
          </Link>
        </section>
      </main>
    );
  const role = envelope.role;
  const state = projection.room.state;
  const host = role === "host";
  const resultState = resultRouteState(roomCode, role, state);
  const canStartMatch = canDispatchLobbyStart(state, projection.room.canStart);
  const team = projection.self?.team;
  const cells = projection.board ?? previewBoardCells;
  const winner = matchWinner(projection);
  const victoryReason = matchReason(projection);
  const buzzText =
    connection === "offline"
      ? "انقطع الاتصال"
      : connection === "reconnecting"
        ? "جارٍ إعادة الاتصال"
        : projection.self?.canBuzz
          ? "اضغط الآن"
          : state === "FIRST_ANSWER" && projection.answeringTeam === team
            ? "أنت الأسرع — أجب"
            : state === "OPPONENT_CHANCE"
              ? "الفرصة للفريق الآخر"
              : "استعد";
  if (surface === "lobby")
    return (
      <main className="app-page spatial-shell spatial-shell--lobby" id="main-content">
        <AppHeader />
        <section className="lobby-page spatial-lobby">
          <div className="lobby-title">
            <div>
              <p className="eyebrow">غرفة مباشرة</p>
              <p className="lobby-room-code">
                <span>رمز الغرفة</span>
                <bdi dir="ltr">{projection.room.roomCode}</bdi>
              </p>
              <h1>ردهة المباراة</h1>
            </div>
            <div className="lobby-title__actions">
              <button
                className="copy-button"
                onClick={() => void copyRoomCode()}
              >
                انسخ الرمز
              </button>
            </div>
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
              <GameBoard cells={cells} className="motif-board" presentation="tactile" />
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
              onClick={() =>
                action("LOBBY_SET_READY", { ready: !projection.self?.ready })
              }
            >
              {projection.self?.ready
                ? "إلغاء الجاهزية"
                : "اختبر البازر وأنا جاهز"}
            </button>
          )}
          {host && (
            <div className="lobby-actions">
              <button
                className="button button--primary"
                data-testid="start-match"
                disabled={!canStartMatch}
                onClick={() => {
                  if (canStartMatch) action("START_MATCH");
                }}
              >
                ابدأ المباراة
              </button>
              <p data-testid="start-blocked">
                {projection.room.startBlockedReason
                  ? "عند وجود لاعبين، يلزم لاعبان في فريقين وجاهزية الجميع قبل البدء."
                  : projection.room.members?.some(
                        (member) => member.role === "player",
                      )
                    ? "المباراة جاهزة بعد اكتمال الفريقين."
                    : "وضع المضيف فقط جاهز: ستتحكم بالفريقين يدوياً."}
              </p>
              <Link className="button" to={`/room/${roomCode}/host`}>
                لوحة المضيف
              </Link>
              <button
                className="button"
                onClick={() => navigate(`/room/${roomCode}/display`)}
              >
                شاشة الجمهور
              </button>
            </div>
          )}
          <p aria-live="polite" className="form-message">
            {error}
          </p>
        </section>
      </main>
    );
  if (surface === "play")
    return (
      <main className="player-page spatial-player" id="main-content">
        <a className="skip-link" href="#main-content">
          تجاوز إلى المحتوى
        </a>
        <header>
          <p>
            {teamName(projection.room.teams?.[team ?? "horizontal"])}{" "}
            <AxisMark axis={team ?? "horizontal"} />
          </p>
          <ConnectionStatus value={connection} />
        </header>
        <section>
          <p className="eyebrow">{stateLabel(state)}</p>
          <h1>
            {connection !== "connected"
              ? buzzText
              : state === "MATCH_COMPLETE"
                ? winner
                  ? `اكتملت المباراة — فاز ${winner}`
                  : "اكتملت المباراة"
                : buzzText}
          </h1>
          <button
            aria-label={buzzText}
            className="buzzer"
            data-state={
              connection === "offline"
                ? "offline"
                : connection === "reconnecting"
                  ? "reconnecting"
                  : projection.self?.canBuzz
                    ? "open"
                    : projection.self?.isBuzzWinner
                      ? "first"
                      : "locked"
            }
            disabled={!projection.self?.canBuzz || connection !== "connected"}
            onClick={() => action("BUZZ")}
          >
            <span>
              {projection.self?.canBuzz ? (
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
            </span>
          </button>
          <p aria-live={connection === "offline" ? "assertive" : "polite"}>
            {projection.self?.isBuzzWinner
              ? "أنت الأسرع — أجب الآن. قُفل البازر للجميع."
              : projection.messageAr ||
                (state === "MATCH_COMPLETE"
                  ? winner
                    ? `المسار والمباراة اكتملَا لصالح ${winner}.`
                    : "اكتملت المباراة."
                  : projection.self?.canBuzz
                    ? "البازر مفتوح لفريقك."
                    : "سيظهر هنا وضعك التالي.")}
          </p>
        </section>
        <Link to={`/room/${roomCode}/lobby`}>العودة إلى الردهة</Link>
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
            <span>استوديو الحروف</span>
            <small>شاشة الجمهور</small>
          </p>
          <RoundTimerModule
            currentRound={projection.currentRound}
            deadlineAt={projection.deadlineAt}
            onDeadline={reconcileDeadline}
            serverTime={envelope.serverTime}
            state={state}
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
          <div className="stage-board-column">
            <GameBoard
              activeCellId={projection.activeCellId}
              cells={cells}
              className="stage-board"
              presentation="tactile"
              winningPath={projection.winningPath}
            />
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
        <section className="question-band" aria-live="polite">
          <div className="question-band__heading">
            <span aria-hidden="true" className="question-band__line" />
            <svg aria-hidden="true" className="question-band__icon" viewBox="0 0 24 24">
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
          ) : state === "CELL_SELECTION" ? (
            <p className="question-band__waiting">بانتظار اختيار الخلية</p>
          ) : (
            <>
              <h1>
                {projection.question?.promptAr ? (
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
                  projection.messageAr || "بانتظار السؤال"
                )}
              </h1>
              {projection.question?.revealedAnswer && (
                <p>الإجابة: {projection.question.revealedAnswer}</p>
              )}
            </>
          )}
        </section>
      </main>
    );
  if (surface === "results")
    return (
      <main className="app-page spatial-shell spatial-shell--results" id="main-content">
        <AppHeader />
        <section className="results-page">
          <div>
            <p className="eyebrow">
              {resultState.isFinal ? "النتيجة النهائية" : "المباراة مستمرة"}
            </p>
            <h1>
              {!resultState.isFinal
                ? "لم تنته المباراة بعد"
                : winner
                  ? `الفائز: ${winner}`
                  : projection.winningPath?.length
                    ? "اكتمل المسار الفائز"
                    : "نتيجة المباراة"}
            </h1>
            {!resultState.isFinal && (
              <p>الحالة الحالية: {stateLabel(state)}</p>
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
            {resultState.isFinal ? (
              <>
                <p>قواعد احتساب النقاط</p>
                <ol>
                  <li>اختيار الخلية</li>
                  <li>إجابة صحيحة وتثبيت ملكيتها (+1 نقطة)</li>
                  <li>اكتمال المسار (+1 جولة)</li>
                </ol>
                <Link className="button button--primary" to="/host/new">
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
            {host && resultState.isFinal && (
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
      {state === "FIRST_ANSWER" && projection.buzzWinner ? (
        <BuzzWinnerBanner winner={projection.buzzWinner} />
      ) : null}
      <section className="host-layout">
        <div className="host-stage" aria-label="لوحة المباراة والنتيجة">
          <div className="host-board">
            <p className="host-board__state">
              {stateLabel(state)} ·{" "}
              <AxisMark axis={projection.entitledTeam ?? "horizontal"} />
            </p>
            <GameBoard
              activeCellId={projection.activeCellId}
              cells={cells}
              className="host-game-board"
              onSelect={(cellId) => action("SELECT_CELL", { cellId })}
              presentation="tactile"
              selectable={host && state === "CELL_SELECTION"}
              winningPath={projection.winningPath}
            />
            <section aria-live="polite" className="host-question-band">
              <div className="host-question-band__heading">
                <span aria-hidden="true" className="question-band__line" />
                <h2>{projection.question?.headerAr || "سؤال الجولة"}</h2>
                <span aria-hidden="true" className="question-band__line" />
              </div>
              {state === "CELL_SELECTION" ? (
                <p>بانتظار اختيار الخلية</p>
              ) : (
                <h3>
                  {projection.question?.promptAr ||
                    projection.messageAr ||
                    "بانتظار السؤال"}
                </h3>
              )}
            </section>
          </div>
        </div>
        <aside className="host-controls">
          <section className="host-score-pair" aria-label="نتيجة الفريقين">
            <TeamScoreCard
              axis="vertical"
              currentRound={projection.currentRound}
              points={projection.questionScores?.vertical ?? 0}
              roundResults={projection.roundResults}
              rounds={projection.roundWins?.vertical ?? 0}
              teamName={projection.room.teams?.vertical}
              testId="host-score-vertical"
              variant="host"
            />
            <TeamScoreCard
              axis="horizontal"
              currentRound={projection.currentRound}
              points={projection.questionScores?.horizontal ?? 0}
              roundResults={projection.roundResults}
              rounds={projection.roundWins?.horizontal ?? 0}
              teamName={projection.room.teams?.horizontal}
              testId="host-score-horizontal"
              variant="host"
            />
          </section>
          <div className="host-controls__topline">
            <ConnectionStatus value={connection} />
            <p className="phase-label">{stateLabel(state)}</p>
            <Countdown
              deadlineAt={projection.deadlineAt}
              onDeadline={reconcileDeadline}
              serverTime={envelope.serverTime}
            />
          </div>
          <HostActions
            action={action}
            entitledTeam={projection.entitledTeam}
            playerCount={
              projection.room.members?.filter(
                (member) => member.role === "player",
              ).length ?? 0
            }
            state={state}
            teams={
              projection.room.teams ?? {
                horizontal: "الأحمر",
                vertical: "الأخضر",
              }
            }
          />
          {projection.question && (
            <section className="private-question">
              <p className="private-question__header">مرجع المضيف · {projection.question.headerAr}</p>
              <div className="private-answer">
                <b>الإجابة الخاصة</b>
                <p>
                  {projection.question.primaryAnswer ||
                    "تظهر للمضيف فقط عند وصول السؤال."}
                </p>
                <p>
                  البدائل:{" "}
                  {projection.question.acceptedAnswers?.join("، ") || "—"}
                </p>
              </div>
              <p className="source-note">
                المصدر:{" "}
                {projection.question.sources
                  ?.map((source) => source.title)
                  .join(" · ") || "غير متاح"}
              </p>
            </section>
          )}
          {state === "CORRECTION" ? (
            <CorrectionReview
              correction={projection.correction}
              onCancel={() => action("CANCEL_CORRECTION")}
              onConfirm={() => action("CONFIRM_CORRECTION")}
            />
          ) : (
            <details className="correction">
              <summary>تصحيح وسجل التدقيق</summary>
              <CorrectionForm
                cells={cells}
                onCorrect={(payload) => action("BEGIN_CORRECTION", payload)}
              />
              {projection.audit?.map((entry) => (
                <p key={entry.revision}>
                  {entry.revision} · {stateLabel(entry.type)}
                </p>
              ))}
            </details>
          )}
          <p aria-live="polite" className="form-message">
            {error}
          </p>
        </aside>
      </section>
    </main>
  );
}

function CorrectionForm({
  cells,
  onCorrect,
}: {
  cells: BoardCell[];
  onCorrect: (value: Record<string, unknown>) => void;
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
          onCorrect({
            cellId,
            owner: owner || undefined,
            reason: reason.trim(),
          });
      }}
    >
      <label>
        الخلية
        <select
          required
          value={cellId}
          onChange={(event) => setCellId(event.target.value)}
        >
          <option value="">اختر خلية</option>
          {cells.map((cell) => (
            <option key={cell.id} value={cell.id}>
              {cell.visibleValue} ({cell.id})
            </option>
          ))}
        </select>
      </label>
      <label>
        المالك
        <select
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        >
          <option value="">غير مملوكة</option>
          <option value="horizontal">الفريق الأفقي</option>
          <option value="vertical">الفريق العمودي</option>
        </select>
      </label>
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
}: {
  correction?: SafeProjection["correction"];
  onConfirm: () => void;
  onCancel: () => void;
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
      ? "الفريق الأفقي"
      : correction.owner === "vertical"
        ? "الفريق العمودي"
        : "غير مملوكة";
  const prior =
    correction.priorOwner === "horizontal"
      ? "الفريق الأفقي"
      : correction.priorOwner === "vertical"
        ? "الفريق العمودي"
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
    <main className="app-page spatial-shell spatial-shell--rules" id="main-content">
      <AppHeader />
      <section className="rules-page spatial-rules">
        <div>
          <p className="eyebrow">قواعد مختصرة</p>
          <h1>كيف تلعب؟</h1>
          <ol>
            <li>
              <b>اختر</b> خلية من اللوح.
            </li>
            <li>
              <b>اسأل</b> وافتح البازر.
            </li>
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
            {featuredCategories.map((category) => (
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
    <main className="app-page spatial-shell spatial-shell--status" id="main-content">
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
