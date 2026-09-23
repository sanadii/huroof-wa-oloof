import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ChallengeProjection } from "./integration";
import type { IntentType } from "../runtime/contracts";

type Connection = "connected" | "connecting" | "reconnecting" | "offline" | "stale";
type Member = { uid?: string; manualParticipantId?: string; displayName: string; team?: "horizontal" | "vertical"; participation?: "manual" };

export type ChallengeStageProps = {
  challenge: ChallengeProjection;
  role: "host" | "player" | "audience";
  serverTime: string;
  connection: Connection;
  authoritative?: boolean;
  teams?: { horizontal: string; vertical: string };
  scores?: { horizontal: number; vertical: number };
  labelledColours?: boolean;
  members?: Member[];
  error?: string;
  onIntent: (type: IntentType, payload: Record<string, unknown>) => Promise<boolean>;
  /** Firebase has no local deadline ticker; request one authoritative reconciliation at zero. */
  onDeadline?: () => Promise<boolean> | boolean;
  /** Opens the existing audited board correction dialog only after CONTINUE is accepted. */
  onTerminalCorrection?: () => void;
};

type Tile = { row: number; column: number; id?: string; labelAr?: string; shape?: string; hex?: string; missing?: boolean };
type Option = { id: string; labelAr: string; shape: string; hex: string };
type MapStimulus = { mode: "identify" | "direction" | "order"; markers: { id: string; x: number; y: number }[]; optionIds: string[]; promptAr: string; namedPoints?: { id: string; nameAr: string }[]; reveal?: { answerIds?: string[] } };
type MemoryStimulus = { rows: number; columns: number; instructionAr?: string; cells?: { row: number; column: number; colorAr: string; hex: string; shapeAr: string }[]; palette?: { nameAr: string; hex: string }[]; promptAr?: string; answerSlots?: number; reveal?: { answers?: string[] } };
type NavigationStimulus = { rows: number; columns: number; start: { row: number; column: number }; current: { row: number; column: number }; goal?: { row: number; column: number }; blocked?: { row: number; column: number }[]; confirmedEdges?: string[]; reveal?: { directions?: readonly string[] } };
type Direction = "north" | "east" | "south" | "west";

const actionNames: Record<string, string> = {
  START: "ابدأ التحدّي", READY: "أعلن الجاهزية", ASSIGN: "ثبّت التعيين", PAUSE: "إيقاف مؤقت", RESUME: "استئناف", VOID: "إلغاء المحاولة",
  START_STEAL: "ابدأ فرصة الفريق الآخر", DECLINE_STEAL: "تخطَّ الفرصة", REVEAL: "إظهار الحل", CONTINUE: "العودة إلى اللوحة",
};
const kindTitle: Record<ChallengeProjection["kind"], string> = { missing_tile: "الجزء المفقود", qatar_map: "لوكيشن قطر", memory: "لون الصورة", navigation: "وجّه صاحبك" };

function format(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }

type TrustedChallengeClock = { seconds?: number; expired: boolean; deadlineKey: string };
type ClockBaseline = { deadlineAt?: string; timerKey: string; serverNow: number; monotonicNow: number };

/** One monotonic rendering clock drives both the visible timer and sensitive-stage concealment. */
function useTrustedChallengeClock({ deadlineAt, serverTime, trustworthy, active, timerKey }: { deadlineAt?: string; serverTime: string; trustworthy: boolean; active: boolean; timerKey: string }): TrustedChallengeClock {
  const [now, setNow] = useState(() => performance.now());
  const [baseline, setBaseline] = useState<ClockBaseline>(() => ({ deadlineAt, timerKey, serverNow: Date.parse(serverTime), monotonicNow: performance.now() }));
  useEffect(() => {
    const sample = Date.parse(serverTime);
    const sampledAt = performance.now();
    setBaseline((prior) => {
      // A new occurrence/stage or deadline is a distinct server clock. For a
      // retained exposure, only move the estimate forward: late snapshots can
      // otherwise reopen an already-concealed memory board.
      if (prior.timerKey !== timerKey || prior.deadlineAt !== deadlineAt)
        return { deadlineAt, timerKey, serverNow: sample, monotonicNow: sampledAt };
      const priorEstimate = prior.serverNow + sampledAt - prior.monotonicNow;
      return { deadlineAt, timerKey, serverNow: Number.isFinite(sample) ? Math.max(priorEstimate, sample) : priorEstimate, monotonicNow: sampledAt };
    });
  }, [deadlineAt, serverTime, timerKey]);
  useEffect(() => {
    setNow(performance.now());
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [deadlineAt, timerKey, trustworthy]);
  const remaining = !deadlineAt || !trustworthy || !active ? undefined : Date.parse(deadlineAt) - (baseline.serverNow + now - baseline.monotonicNow);
  const seconds = remaining === undefined ? undefined : Math.max(0, Math.ceil(remaining / 1000));
  return { seconds, expired: remaining !== undefined && remaining <= 0, deadlineKey: `${timerKey}:${deadlineAt}` };
}

function ChallengeTimer({ clock, active, onDeadline, retryKey = clock.deadlineKey }: { clock: TrustedChallengeClock; active: boolean; onDeadline?: () => Promise<boolean> | boolean; retryKey?: string }) {
  const syncAttempts = useRef(0);
  const retryTimer = useRef<number | undefined>(undefined);
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    syncAttempts.current = 0;
    if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
    retryTimer.current = undefined;
    return () => {
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
    };
  }, [active, retryKey]);
  useEffect(() => {
    if (clock.seconds !== 0 || !onDeadline || syncAttempts.current >= 3) return;
    syncAttempts.current += 1;
    let cancelled = false;
    void Promise.resolve(onDeadline()).then((transitioned) => {
      if (cancelled || transitioned === true || syncAttempts.current >= 3) return;
      retryTimer.current = window.setTimeout(() => setRetryTick((value) => value + 1), 1_000);
    }).catch(() => {
      if (cancelled || syncAttempts.current >= 3) return;
      retryTimer.current = window.setTimeout(() => setRetryTick((value) => value + 1), 1_000);
    });
    return () => { cancelled = true; };
  }, [retryKey, clock.seconds, onDeadline, retryTick]);
  if (clock.seconds === undefined) return null;
  return <p className="challenge-frame__timer" aria-label="الوقت المتبقي" role="timer">{format(clock.seconds)}</p>;
}

function RuleCard({ challenge }: { challenge: ChallengeProjection }) {
  const duration = challenge.kind === "missing_tile"
    ? challenge.timing.answerSeconds === 30 ? "30 ثانية" : challenge.timing.answerSeconds === 45 ? "45 ثانية لترتيب 3×3" : "60 ثانية لترتيب 4×4"
    : challenge.kind === "qatar_map" ? (challenge.timing.answerSeconds === 45 ? "45 ثانية للترتيب" : "30 ثانية")
    : challenge.kind === "memory" ? `الحفظ: ${challenge.timing.observationSeconds ?? 0} ثوانٍ · الإجابة: ${challenge.timing.answerSeconds ?? 0} ثانية`
    : `${challenge.timing.answerSeconds ?? challenge.timing.observationSeconds ?? 0} ثانية`;
  return <section className="challenge-rules" aria-label="قواعد التحدي"><h2>{kindTitle[challenge.kind]}</h2><p>{challenge.kind === "missing_tile" ? "اختر القطعة التي تكمل القاعدة. يمكنك تغيير اختيارك قبل التأكيد." : challenge.kind === "qatar_map" ? "اقرأ السؤال ثم اختر الحروف أو رتّبها. لا يحتاج الترتيب إلى سحب." : challenge.kind === "memory" ? "احفظ الألوان أولاً؛ سيظهر سؤال التذكّر بعد إخفاء اللوحة." : "يلزم هاتف خاص للدليل. يوجّه اللاعب بالكلام، بينما يتحرك اللاعب أو وكيل المضيف خطوة واحدة."}</p><p><strong>المدة: {duration}</strong></p></section>;
}

function TileGlyph({ shape, hex, label, selected }: { shape?: string; hex?: string; label?: string; selected?: boolean }) {
  const fill = hex ?? "transparent";
  const normalizedShape = ({ "دائرة": "circle", "مربع": "square", "مثلث": "triangle", "معين": "diamond", "نجمة": "star", "هلال": "crescent", "قلب": "heart", "سداسي": "hex" } as Record<string, string>)[shape ?? ""] ?? shape ?? "square";
  const className = `challenge-tile challenge-tile--${normalizedShape}${selected ? " is-selected" : ""}`;
  const common = { fill, stroke: "none" };
  return <svg className={className} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ height: "72%", width: "72%" } as CSSProperties} aria-label={label}>
    {normalizedShape === "circle" ? <circle cx="50" cy="50" r="44" {...common} /> : normalizedShape === "triangle" ? <path d="M50 5L96 94H4Z" {...common} /> : normalizedShape === "hex" || normalizedShape === "hexagon" ? <path d="M25 5H75L99 50L75 95H25L1 50Z" {...common} /> : normalizedShape === "heart" ? <path d="M50 91C39 79 8 59 8 31C8 7 38 3 50 23C62 3 92 7 92 31C92 59 61 79 50 91Z" {...common} /> : normalizedShape === "diamond" ? <path d="M50 2L98 50L50 98L2 50Z" {...common} /> : normalizedShape === "star" ? <path d="M50 3L61 36L96 36L68 57L79 91L50 71L21 91L32 57L4 36L39 36Z" {...common} /> : normalizedShape === "crescent" ? <path d="M72 9C43 12 28 36 34 59C39 78 60 89 79 79C61 78 49 64 49 47C49 29 59 16 72 9Z" {...common} /> : <rect x="6" y="6" width="88" height="88" {...common} />}
  </svg>;
}

function TileChallenge({ challenge, canSubmit, onSubmit, staticOptions = false }: { challenge: ChallengeProjection; canSubmit: boolean; onSubmit: (answers: string[]) => void; staticOptions?: boolean }) {
  const data = challenge.stimulus as { rows?: number; columns?: number; cells?: Tile[]; options?: Option[]; rule?: "vertical_mirror" | "latin"; promptAr?: string; reveal?: { correctOptionId?: string } } | undefined;
  const [draft, setDraft] = useState<string>();
  const draftKey = `${challenge.occurrence}:${challenge.assignmentGeneration}:${challenge.stage}`;
  useEffect(() => setDraft(undefined), [draftKey]);
  if (!data?.cells || !data.options) return <RuleCard challenge={challenge} />;
  const options = data.options;
  const reveal = data.reveal?.correctOptionId;
  return <section className="challenge-stimulus challenge-stimulus--tile" aria-label="لغز الخلية الناقصة">
    <p className="challenge-prompt">{data.promptAr}</p>
    <div className="challenge-tile-grid" style={{ gridTemplateColumns: `repeat(${data.columns ?? 3}, 1fr)` }} data-testid="tile-grid">
      {data.cells.map((cell) => { const preview = cell.missing ? options.find((option) => option.id === (reveal ?? draft)) : undefined; return <div className={`challenge-tile-cell${cell.missing ? " is-missing" : ""}${preview ? " is-preview" : ""}${reveal && cell.missing ? " is-solution" : ""}`} key={`${cell.row}:${cell.column}`}>{preview ? <TileGlyph hex={preview.hex} label={`${reveal ? "الحل" : "معاينة"} ${preview.labelAr}`} shape={preview.shape} selected={Boolean(reveal)} /> : cell.missing ? <span aria-label="خلية ناقصة">؟</span> : <TileGlyph hex={cell.hex} label={cell.labelAr} shape={cell.shape} />}</div>; })}
    </div>
    {reveal ? <p className="challenge-explanation" role="status">الحل: الخيار {options.find((item) => item.id === reveal)?.labelAr ?? "الصحيح"}. {data.rule === "vertical_mirror" ? "القطعة تقابل نظيرتها بالانعكاس العمودي." : "كل صف وعمود يكتمل بعنصر مختلف."}</p> : null}
    {(canSubmit || staticOptions) && !reveal ? <><fieldset className="challenge-options" disabled={staticOptions}><legend>{staticOptions ? "الخيارات" : "اختر قطعة واحدة"}</legend>{options.map((option, index) => { const sourceLetter = /^[أبجد]$/u.test(option.labelAr); return <button type="button" className={`challenge-option${draft === option.id ? " is-selected" : ""}`} aria-pressed={draft === option.id} key={option.id} onClick={() => setDraft(option.id)}>{sourceLetter ? <span className="challenge-option__letter">{option.labelAr}</span> : <><span className="challenge-option__letter">{["أ", "ب", "ج", "د"][index]}</span><span>{option.labelAr}</span></>}<TileGlyph hex={option.hex} shape={option.shape} /></button>; })}</fieldset>{canSubmit ? <button className="button button--primary" disabled={!draft} onClick={() => draft && onSubmit([draft])} type="button">تأكيد الإجابة</button> : null}</> : null}
  </section>;
}

function QatarOutline() { return <>
  <g aria-hidden="true" className="challenge-map-grid" stroke="#697e87" strokeWidth="1"><path d="M70 724.2H720M70 545.3H720M70 366.3H720M70 187.4H720" /><path d="M181.9 80V760M296.7 80V760M411.5 80V760M526.3 80V760M641.1 80V760" /></g>
  <path d="M 209.5,633.0 L 179.1,372.6 L 302.8,184.9 L 428.2,146.4 L 567.2,258.5 L 575.3,468.1 L 475.6,678.6 L 348.3,704.0 L 209.5,633.0 Z" fill="#e1dac3" stroke="#697e87" strokeWidth="2.5" />
  <path aria-label="الشمال" d="M725 143V77l-8 16M725 77l8 16" fill="none" stroke="#193f52" strokeWidth="3" />
</>; }

function MapChallenge({ challenge, canSubmit, onSubmit }: { challenge: ChallengeProjection; canSubmit: boolean; onSubmit: (answers: string[]) => void }) {
  const data = challenge.stimulus as MapStimulus | undefined;
  const [draft, setDraft] = useState<string[]>([]);
  const draftKey = `${challenge.occurrence}:${challenge.assignmentGeneration}:${challenge.stage}`;
  useEffect(() => setDraft([]), [draftKey]);
  if (!data?.markers) return <RuleCard challenge={challenge} />;
  const toggle = (id: string) => setDraft((prior) => data.mode === "order" ? (prior.includes(id) ? prior.filter((item) => item !== id) : [...prior, id].slice(0, 3)) : [id]);
  const move = (index: number, direction: -1 | 1) => setDraft((prior) => { const next = [...prior]; const swap = index + direction; if (swap < 0 || swap >= next.length) return prior; [next[index], next[swap]] = [next[swap]!, next[index]!]; return next; });
  const nameFor = (id: string) => data.namedPoints?.find((point) => point.id === id)?.nameAr ?? id;
  return <section className="challenge-stimulus challenge-stimulus--map" aria-label="خريطة قطر"><p className="challenge-prompt">{data.promptAr}</p><svg className="challenge-qatar-map" viewBox="0 0 800 840" role="img" aria-label="خريطة قطر التعليمية، الشمال للأعلى"><QatarOutline />{data.markers.map((marker) => <g key={marker.id} transform={`translate(${marker.x * 8},${marker.y * 8.4})`}><circle className="challenge-map-marker" r="19" /><text textAnchor="middle" y="6">{marker.id}</text></g>)}</svg>
    {data.reveal?.answerIds ? <p className="challenge-explanation" role="status">الحل: {data.reveal.answerIds.map(nameFor).join("، ")}</p> : null}
    {canSubmit && !data.reveal ? <><fieldset className="challenge-options"><legend>{data.mode === "order" ? "اضغط لترتيب النقاط" : "اختر الإجابة"}</legend>{data.optionIds.map((id) => <button type="button" className={`challenge-option${draft.includes(id) ? " is-selected" : ""}`} aria-pressed={draft.includes(id)} key={id} onClick={() => toggle(id)}>{data.mode === "identify" ? `النقطة ${id}` : nameFor(id)} <bdi dir="ltr">({id})</bdi></button>)}</fieldset>{data.mode === "order" && draft.length > 0 ? <ol className="challenge-order" aria-label="ترتيبك الحالي">{draft.map((id, index) => <li key={id}><span>{index + 1}. {nameFor(id)}</span><button type="button" aria-label={`حرّك ${nameFor(id)} للأعلى`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`حرّك ${nameFor(id)} للأسفل`} disabled={index === draft.length - 1} onClick={() => move(index, 1)}>↓</button></li>)}</ol> : null}<button className="button button--primary" disabled={data.mode === "order" ? draft.length !== 3 : draft.length !== 1} onClick={() => onSubmit(draft)} type="button">تأكيد الإجابة</button></> : null}
  </section>;
}

function MemoryChallenge({ challenge, canSubmit, concealed, labelledColours, onSubmit }: { challenge: ChallengeProjection; canSubmit: boolean; concealed: boolean; labelledColours: boolean; onSubmit: (answers: string[]) => void }) {
  const data = challenge.stimulus as MemoryStimulus | undefined;
  const [draft, setDraft] = useState<Array<string | undefined>>([]);
  const draftKey = `${challenge.occurrence}:${challenge.assignmentGeneration}:${challenge.stage}`;
  useEffect(() => setDraft([]), [draftKey]);
  if (!data) return <RuleCard challenge={challenge} />;
  const observation = challenge.stage === "observation" && data.cells && !concealed;
  if (observation) return <section className="challenge-stimulus challenge-stimulus--memory" aria-label="لوحة حفظ الألوان"><p className="challenge-prompt">{data.instructionAr ?? "احفظ الألوان"}</p><div className="challenge-memory-grid" data-testid="memory-observation-grid" style={{ gridTemplateColumns: `repeat(${data.columns}, 1fr)` }}>{data.cells!.slice().sort((left, right) => left.row - right.row || left.column - right.column).map((cell) => <div aria-label={labelledColours ? `${cell.shapeAr} بلون ${cell.colorAr}` : cell.shapeAr} className="challenge-memory-cell" key={`${cell.row}:${cell.column}`}><TileGlyph hex={cell.hex} label={labelledColours ? `${cell.shapeAr} ${cell.colorAr}` : cell.shapeAr} shape={cell.shapeAr} />{labelledColours ? <span className="challenge-memory-cell__label">{cell.colorAr}</span> : null}</div>)}</div></section>;
  if (challenge.stage === "observation") return <section className="challenge-stimulus challenge-stimulus--memory" aria-live="polite"><p className="challenge-state">انتهى وقت الحفظ. جارٍ تأكيد مرحلة التذكّر…</p></section>;
  const slots = data.answerSlots ?? 0;
  const palette = data.palette ?? [];
  const chosenCount = draft.filter((answer): answer is string => Boolean(answer)).length;
  const choose = (nameAr: string) => setDraft((prior) => {
    const slot = Array.from({ length: slots }, (_value, index) => prior[index]).findIndex((answer) => !answer);
    if (slot < 0) return prior;
    const next = [...prior];
    next[slot] = nameAr;
    return next;
  });
  const clear = (index: number) => setDraft((prior) => {
    const next = [...prior];
    next[index] = undefined;
    return next;
  });
  const answers = draft.slice(0, slots);
  const complete = answers.length === slots && answers.every((answer): answer is string => Boolean(answer));
  const completedAnswers = complete ? answers.filter((answer): answer is string => Boolean(answer)) : undefined;
  return <section className="challenge-stimulus challenge-stimulus--memory" aria-label="إجابة تذكّر الألوان"><p className="challenge-prompt">{data.promptAr ?? "استعد لسؤال التذكّر"}</p>{data.reveal?.answers ? <p className="challenge-explanation" role="status">الحل: {data.reveal.answers.join("، ")}</p> : null}{slots > 0 && !data.reveal ? <><ol className="challenge-memory-slots" aria-label="إجابتك المرتبة">{Array.from({ length: slots }, (_value, index) => <li key={index}><button aria-label={draft[index] ? `الخانة ${index + 1}: ${draft[index]}، اضغط للحذف` : `الخانة ${index + 1} فارغة`} disabled={!draft[index] || !canSubmit} onClick={() => clear(index)} type="button">{index + 1}. {draft[index] ?? "اختر لوناً"}</button></li>)}</ol><fieldset className="challenge-memory-palette" disabled={!canSubmit || chosenCount >= slots}><legend>لوحة الألوان الثابتة</legend>{palette.map((colour) => <button aria-label={`اختر ${colour.nameAr}`} className="challenge-option" key={colour.nameAr} onClick={() => choose(colour.nameAr)} type="button"><span aria-hidden="true" className="challenge-colour-swatch" style={{ backgroundColor: colour.hex }} />{colour.nameAr}</button>)}</fieldset>{canSubmit ? <button className="button button--primary" disabled={!completedAnswers} onClick={() => completedAnswers && onSubmit(completedAnswers)} type="button">تأكيد الإجابة</button> : null}</> : null}</section>;
}

const directionLabel: Record<Direction, string> = { north: "أعلى", east: "يمين", south: "أسفل", west: "يسار" };
const arrowDirection: Record<string, Direction | undefined> = { ArrowUp: "north", ArrowRight: "east", ArrowDown: "south", ArrowLeft: "west" };
const pointKey = (point: { row: number; column: number }) => `${point.row},${point.column}`;

function NavigationChallenge({ challenge, canMove, onMove }: { challenge: ChallengeProjection; canMove: boolean; onMove: (direction: Direction) => Promise<boolean | undefined> }) {
  const data = challenge.stimulus as NavigationStimulus | undefined;
  const [requested, setRequested] = useState<Direction>();
  const stateKey = `${challenge.occurrence}:${challenge.revision}:${challenge.stage}:${data?.current ? pointKey(data.current) : ""}`;
  useEffect(() => setRequested(undefined), [stateKey]);
  if (!data) return <RuleCard challenge={challenge} />;
  const guideView = Boolean(data.goal && data.blocked);
  const trail = new Set((data.confirmedEdges ?? []).flatMap((edge) => edge.split("/")));
  const boundary = (direction: Direction) => direction === "north" ? data.current.row === 0 : direction === "south" ? data.current.row === data.rows - 1 : direction === "west" ? data.current.column === 0 : data.current.column === data.columns - 1;
  const move = async (direction: Direction) => {
    if (!canMove || boundary(direction) || requested) return;
    setRequested(direction);
    const accepted = await onMove(direction);
    // A rejected authority response has no projection revision to clear the local
    // pending affordance. Keep the board at its last confirmed position and let
    // the mover try again after the visible error.
    if (!accepted) setRequested(undefined);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || !canMove) return;
    const direction = arrowDirection[event.key];
    if (!direction || boundary(direction)) return;
    event.preventDefault();
    void move(direction);
  };
  return <section className="challenge-stimulus challenge-stimulus--navigation" aria-label={guideView ? "لوحة الدليل الخاصة" : "لوحة حركة اللاعب"}><p className="challenge-prompt">{guideView ? "وجّه اللاعب بالكلام فقط؛ لا تظهر له هذه العلامات." : "حرّك العلامة خطوة واحدة حسب التوجيه."}</p><div aria-label={guideView ? "المسار الخاص بالدليل" : "المسار المؤكد"} className="challenge-navigation-grid" data-testid="navigation-grid" onKeyDown={onKeyDown} role="grid" style={{ gridTemplateColumns: `repeat(${data.columns}, 1fr)` }} tabIndex={canMove ? 0 : undefined}>{Array.from({ length: data.rows * data.columns }, (_value, index) => {
    const point = { row: Math.floor(index / data.columns), column: index % data.columns };
    const start = pointKey(point) === pointKey(data.start), current = pointKey(point) === pointKey(data.current), goal = guideView && pointKey(point) === pointKey(data.goal!), blocked = guideView && Boolean(data.blocked?.some((item) => pointKey(item) === pointKey(point))), confirmed = trail.has(pointKey(point));
    const label = goal ? "الهدف" : blocked ? "عائق" : current ? "موقع اللاعب الحالي" : start ? "البداية" : confirmed ? "مسار مؤكد" : "خانة فارغة";
    return <div aria-label={label} className={`challenge-navigation-cell${start ? " is-start" : ""}${current ? " is-current" : ""}${goal ? " is-goal" : ""}${blocked ? " is-blocked" : ""}${confirmed ? " is-trail" : ""}`} data-column={point.column} data-row={point.row} key={pointKey(point)} role="gridcell">{goal ? "★" : blocked ? "■" : current ? "●" : start ? "○" : ""}</div>;
  })}</div>{guideView ? <p className="challenge-guide-note">تظهر الهدف والعوائق للدليل وحده. استخدم التوجيه الكلامي ولا تشارك الشاشة.</p> : <p className="challenge-navigation-strikes" role="status">العوائق: {challenge.strikes} من 3</p>}{canMove ? <fieldset className="challenge-navigation-controls"><legend>تحكم الحركة</legend>{(["north", "west", "south", "east"] as Direction[]).map((direction) => <button aria-label={`تحرّك ${directionLabel[direction]}`} className={`challenge-navigation-control challenge-navigation-control--${direction}`} disabled={Boolean(requested) || boundary(direction)} key={direction} onClick={() => void move(direction)} type="button">{directionLabel[direction]}</button>)}</fieldset> : null}{requested ? <p role="status">جارٍ تأكيد الحركة…</p> : null}{data.reveal?.directions ? <p className="challenge-explanation" role="status">مسار مثال بعد الإغلاق: {data.reveal.directions.map((item) => directionLabel[item as Direction] ?? item).join(" ← ")}</p> : null}</section>;
}

function AssignmentControls({ challenge, members, send }: { challenge: ChallengeProjection; members: Member[]; send: (type: IntentType, value?: Record<string, unknown>) => void }) {
  const required = challenge.kind === "missing_tile" || challenge.kind === "qatar_map" ? ["captain", "stealCaptain"] : challenge.kind === "navigation" ? ["guide", "mover"] : ["captain"];
  const participantId = (member: Member) => member.manualParticipantId ? `manual:${member.manualParticipantId}` : member.uid ? `member:${member.uid}` : "";
  return <section className="challenge-assignments" aria-label="تعيين المشاركين"><h3>تعيين المشاركين</h3>{required.map((assignment) => { const expectedTeam = assignment === "stealCaptain" ? (challenge.entitledTeam === "horizontal" ? "vertical" : "horizontal") : challenge.entitledTeam; return <label key={assignment}>{assignment === "stealCaptain" ? "قائد فرصة الفريق الآخر" : assignment === "captain" ? "القائد" : assignment === "guide" ? "الدليل" : "اللاعب"}<select value={(challenge.assignments as Record<string, string | undefined>)[assignment] ?? ""} onChange={(event) => send("CHALLENGE_ASSIGN", { assignment, participantId: event.target.value })}><option value="">اختر مشاركاً</option>{members.filter((member) => participantId(member) && member.team === expectedTeam && !(assignment === "guide" && member.participation === "manual")).map((member) => <option key={participantId(member)} value={participantId(member)}>{member.displayName}{member.participation === "manual" ? " (تحكم يدوي)" : ""}</option>)}</select></label>; })}</section>;
}

export function ChallengeStage({ challenge, role, serverTime, connection, authoritative, teams, scores, members = [], error, labelledColours = false, onIntent, onTerminalCorrection, onDeadline }: ChallengeStageProps) {
  const [pending, setPending] = useState(false);
  const [rejected, setRejected] = useState(false);
  const trustworthy = connection === "connected" && authoritative !== false;
  const allowed = new Set(challenge.legalActions);
  const teamLabel = challenge.attemptsClosed ? undefined : (challenge.stage === "steal" || challenge.stage === "steal_offer" ? teams?.[challenge.answeringTeam] ?? "الفريق الآخر" : teams?.[challenge.entitledTeam] ?? "الفريق الحالي");
  const send = async (type: IntentType, extra: Record<string, unknown> = {}) => {
    if (pending || !trustworthy) return;
    setPending(true);
    try {
      const accepted = await onIntent(type, { occurrence: challenge.occurrence, challengeRevision: challenge.revision, stage: challenge.stage, ...extra });
      setRejected(!accepted);
      return accepted;
    }
    finally { setPending(false); }
  };
  const ready = () => send("CHALLENGE_READY", { participantId: challenge.recipient === "guide" ? challenge.assignments.guide : challenge.recipient === "mover" ? challenge.assignments.mover : challenge.recipient === "captain" ? challenge.assignments.captain : challenge.assignments.stealCaptain, readiness: { protocolHash: challenge.readiness.protocolHash, assignmentHash: challenge.readiness.assignmentHash, stimulusHash: challenge.readiness.stimulusHash } });
  const readyParticipant = (participantId: string) => send("CHALLENGE_READY", { participantId, readiness: { protocolHash: challenge.readiness.protocolHash, assignmentHash: challenge.readiness.assignmentHash, stimulusHash: challenge.readiness.stimulusHash } });
  const submit = (answers: string[]) => void send("CHALLENGE_SUBMIT", { answers });
  const move = (direction: Direction) => send("CHALLENGE_MOVE", { direction });
  const canSubmit = (challenge.recipient === "captain" || challenge.recipient === "stealCaptain" || (role === "host" && allowed.has("SUBMIT"))) && allowed.has("SUBMIT") && trustworthy && !pending;
  const canMove = (challenge.recipient === "mover" || (role === "host" && allowed.has("MOVE"))) && allowed.has("MOVE") && trustworthy && !pending;
  const clock = useTrustedChallengeClock({ active: !challenge.paused && !challenge.attemptsClosed, deadlineAt: challenge.deadlineAt, serverTime, timerKey: `${challenge.occurrence}:${challenge.stage}`, trustworthy });
  const common = <><p className="challenge-frame__phase">{challenge.stage === "setup" ? "استعد للتحدّي" : challenge.paused ? "التحدّي متوقف مؤقتًا" : challenge.attemptsClosed ? "نتيجة التحدّي" : challenge.stage === "steal_offer" ? "فرصة للفريق الآخر — ١٥ ثانية" : teamLabel ? `الفرصة لفريق ${teamLabel}` : ""}</p><ChallengeTimer active={!challenge.paused && !challenge.attemptsClosed} clock={clock} onDeadline={onDeadline} retryKey={`${clock.deadlineKey}:${challenge.revision}`} /></>;
  const disabled = !trustworthy || pending;
  const directControls = challenge.legalActions.filter((item) => ["START", "START_STEAL", "DECLINE_STEAL", "PAUSE", "RESUME", "VOID", "REVEAL", "CONTINUE"].includes(item));
  const continueForCorrection = async () => {
    if (await send("CHALLENGE_CONTINUE")) onTerminalCorrection?.();
  };
  return <main className={`challenge-frame challenge-frame--${role}`} data-testid="challenge-stage" data-kind={challenge.kind} data-stage={challenge.stage} id="main-content"><header className="challenge-frame__header"><p className="eyebrow">تحدّي مباشر</p><h1>{kindTitle[challenge.kind]}</h1>{common}</header>{!trustworthy ? <p className="challenge-state" role="status">{connection === "offline" ? "انقطع الاتصال. بانتظار تأكيد حالة التحدّي." : "جارٍ تأكيد أحدث حالة للتحدّي…"}</p> : null}{challenge.paused ? <p className="challenge-state" role="status">التحدّي متوقف مؤقتًا</p> : null}{error || rejected ? <p className="challenge-state" role="status">{error || "لم يقبل الخادم الإجراء. راجع الحالة وحاول مجدداً؛ لم يُرسل اختيارك للتصحيح."}</p> : null}
    <section className="challenge-frame__body">{!trustworthy || challenge.paused || challenge.stage === "setup" || challenge.stage === "countdown" ? <RuleCard challenge={challenge} /> : challenge.kind === "missing_tile" ? <TileChallenge challenge={challenge} canSubmit={canSubmit} onSubmit={submit} staticOptions={role === "audience"} /> : challenge.kind === "qatar_map" ? <MapChallenge challenge={challenge} canSubmit={canSubmit} onSubmit={submit} /> : challenge.kind === "memory" ? <MemoryChallenge challenge={challenge} canSubmit={canSubmit} concealed={clock.expired} labelledColours={labelledColours} onSubmit={submit} /> : <NavigationChallenge challenge={challenge} canMove={canMove} onMove={move} />}{challenge.attemptsClosed && challenge.result ? <p className="challenge-result" role="status">{challenge.result === "correct" ? `إجابة صحيحة — فاز فريق ${teams?.[challenge.answeringTeam] ?? "الفريق المستحق"}` : challenge.result === "void" ? "أُلغيت المحاولة دون احتساب نقاط" : "لم تنجح المحاولة"}</p> : null}<p className="challenge-score" aria-label="نتيجة الفريقين">{teams?.horizontal ?? "الأحمر"}: {scores?.horizontal ?? 0} · {teams?.vertical ?? "الأخضر"}: {scores?.vertical ?? 0}</p></section>
    <aside className="challenge-frame__controls" aria-label="إجراءات التحدّي">{role === "host" && allowed.has("ASSIGN") ? <AssignmentControls challenge={challenge} members={members} send={(type, payload) => void send(type, payload)} /> : null}{role === "host" && challenge.stage === "setup" ? <section className="challenge-manual-ready" aria-label="ملخص جاهزية المشاركين">{challenge.readinessSummary?.map((entry) => <p key={entry.participantId}>{members.find((member) => `manual:${member.manualParticipantId}` === entry.participantId || `member:${member.uid}` === entry.participantId)?.displayName ?? "مشارك"}: {entry.acknowledged ? "جاهز" : "بانتظار الجاهزية"}{allowed.has("READY") && entry.participantId.startsWith("manual:") && !entry.acknowledged ? <button className="button button--primary" disabled={disabled} onClick={() => void readyParticipant(entry.participantId)} type="button">أعلن جاهزية التحكم اليدوي</button> : null}</p>)}{!allowed.has("START") ? <p className="challenge-state">لا يمكن البدء حتى يؤكد كل مشارك مُعيَّن جاهزية المحتوى.</p> : null}</section> : null}{(challenge.recipient === "guide" || challenge.recipient === "mover" || challenge.recipient === "captain" || challenge.recipient === "stealCaptain") && allowed.has("READY") ? <><p>{challenge.recipient === "guide" ? "جهّز هاتف الدليل الخاص. ستظهر لوحة التوجيه بعد بدء العد التنازلي." : "راجع التعليمات وجهّز جهازك ثم أعلن الجاهزية."}</p><button className="button button--primary" disabled={disabled || challenge.readiness.acknowledged} onClick={() => void ready()} type="button">{challenge.readiness.acknowledged ? "تمت الجاهزية" : "فهمت التعليمات وأنا جاهز"}</button></> : null}{role === "host" && challenge.stage === "setup" && !allowed.has("START") ? <button className="button button--primary" disabled type="button">ابدأ التحدّي</button> : null}{directControls.map((item) => <button className={item === "CONTINUE" || item === "START" || item === "START_STEAL" ? "button button--primary" : "button button--quiet"} disabled={disabled} key={item} onClick={() => void send(`CHALLENGE_${item}` as IntentType)} type="button">{actionNames[item] ?? item}</button>)}{role === "host" && onTerminalCorrection && challenge.attemptsClosed && allowed.has("CONTINUE") ? <button className="button button--primary" disabled={disabled} onClick={() => void continueForCorrection()} type="button">العودة للوحة والتصحيح</button> : null}{pending ? <p role="status">جارٍ تأكيد الإجراء…</p> : null}{challenge.attemptsClosed && !challenge.solutionRevealed ? <p>النتيجة محفوظة حتى يختار المضيف إظهار الحل أو العودة إلى اللوحة.</p> : null}{role === "host" && challenge.attemptsClosed && allowed.has("CONTINUE") ? <p className="challenge-correction-note">يمكنك فتح التصحيح الموثّق اختيارياً بعد العودة إلى اللوحة.</p> : null}</aside>
  </main>;
}
