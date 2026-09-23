/**
 * T36 canonical challenge-content boundary.
 *
 * These definitions deliberately keep delivery-safe data separate from server
 * grading data. Future runtime/projection code must choose one of the public
 * interfaces below; it must never forward a CanonicalChallengeDefinition.
 */
export const CHALLENGE_SCHEMA_VERSION = "t36-challenge-definition-v1" as const;
/** Additive, code-native Clean70 pack. T36 definitions remain byte-compatible. */
export const T37_CHALLENGE_SCHEMA_VERSION = "t37-clean70-challenge-definition-v1" as const;
/** Additive Topup100 word-search definitions. Earlier challenge contracts remain unchanged. */
export const T37_WORD_SEARCH_CHALLENGE_SCHEMA_VERSION = "t37-topup-word-search-definition-v1" as const;
export type ChallengeSchemaVersion = typeof CHALLENGE_SCHEMA_VERSION | typeof T37_CHALLENGE_SCHEMA_VERSION | typeof T37_WORD_SEARCH_CHALLENGE_SCHEMA_VERSION;

export type ChallengeKind = "navigation" | "missing_tile" | "memory" | "qatar_map" | "word_search";
export type CardDisposition = "ready" | "held" | "already_represented";
export type Direction = "north" | "east" | "south" | "west";
export type Point = readonly [number, number];

export interface SourcePin {
  sourceId: string;
  sourcePack: string;
  sourcePath: string;
  sourceRawSha256: string;
  sourceContextsSha256: string;
  mediaArchiveSha256: string;
}

/** Immutable references only; no archive code or raw media path is executable. */
export interface RoleSafeMediaRef {
  role: "guide" | "player" | "answer" | "question";
  visibility: "guide_only" | "player" | "host_only";
  originalObjectName: string;
  originalSha256: string;
  derivativeObjectName: string;
  derivativeSha256: string;
}

export interface ChallengeBase<TKind extends ChallengeKind, TPublic, TPrivate, TVersion extends ChallengeSchemaVersion = typeof CHALLENGE_SCHEMA_VERSION> {
  schemaVersion: TVersion;
  id: string;
  /** Hash of the canonical definition payload (without this field). */
  definitionSha256: string;
  kind: TKind;
  categoryId: "tahadani-games-120" | "tahadani-games-122" | "tahadani-games-127" | "tahadani-games-132" | "tahadani-games-326";
  ordinal: number;
  disposition: CardDisposition;
  dispositionReason?: string;
  source: SourcePin;
  media: readonly RoleSafeMediaRef[];
  /** Only this field is eligible for non-host projections in a later milestone. */
  publicData: TPublic;
  /** Server/admin-only grading material. */
  privateGrading: TPrivate;
  factFamilies: readonly string[];
  maxPerGameFamily: number;
}

export interface NavigationPublicData {
  rows: 5 | 6 | 7;
  columns: 5 | 6 | 7;
  start: Point;
  timeLimitSeconds: 60 | 75 | 90;
  promptAr: string;
}
export interface NavigationPrivateGrading {
  goal: Point;
  blocked: readonly Point[];
  canonicalDirections: readonly Direction[];
  canonicalPath: readonly Point[];
}
export type NavigationChallengeDefinition = ChallengeBase<"navigation", NavigationPublicData, NavigationPrivateGrading>;

/** `bitmask` is used only by the T37 4×4 code-native dot matrix. */
export interface TileOption { id: string; labelAr: string; shape: string; hex: string; bitmask?: number; }
export interface MissingTilePublicData {
  rows: 3 | 4;
  columns: 3 | 4;
  rule: "vertical_mirror" | "latin" | "xor_row_16_dot";
  cells: readonly (readonly (TileOption | null)[])[];
  missingCell: Point;
  options: readonly TileOption[];
  timeLimitSeconds: 30 | 40 | 45 | 60 | 80;
  promptAr: string;
}
export interface MissingTilePrivateGrading { correctOptionId: string; }
export type MissingTileChallengeDefinition = ChallengeBase<"missing_tile", MissingTilePublicData, MissingTilePrivateGrading>;
export type T37MissingTileChallengeDefinition = ChallengeBase<"missing_tile", MissingTilePublicData, MissingTilePrivateGrading, typeof T37_CHALLENGE_SCHEMA_VERSION>;

export interface MemoryPublicData {
  rows: 2 | 3 | 4;
  columns: 2 | 3 | 4;
  showSeconds: 6 | 8 | 10;
  answerSeconds: 20 | 30;
  /** The palette is fixed across cards and does not encode the answer. */
  palette: readonly { nameAr: string; hex: string }[];
}
export interface MemoryPrivateGrading {
  board: readonly (readonly string[])[];
  observationCells: readonly { row: number; column: number; colorAr: string; hex: string; shapeAr: string }[];
  targets: readonly Point[];
  targetAnswers: readonly string[];
  /** Stage-specific payload, never part of the default public observation projection. */
  recallData: { promptAr: string };
}
export type MemoryChallengeDefinition = ChallengeBase<"memory", MemoryPublicData, MemoryPrivateGrading>;
export type T37MemoryChallengeDefinition = ChallengeBase<"memory", MemoryPublicData, MemoryPrivateGrading, typeof T37_CHALLENGE_SCHEMA_VERSION>;
export type T37NavigationChallengeDefinition = ChallengeBase<"navigation", NavigationPublicData, NavigationPrivateGrading, typeof T37_CHALLENGE_SCHEMA_VERSION>;

export interface MapMarker { id: string; x: number; y: number; }
export interface QatarMapPublicData {
  mode: "identify" | "direction" | "order";
  timeLimitSeconds: 30 | 45;
  markers: readonly MapMarker[];
  /** Labels A/B/C only: names and answers remain private unless later staged delivery permits them. */
  optionIds: readonly string[];
  promptAr: string;
  /** Name mappings are safe only when the source question expressly names them. */
  namedPoints?: readonly { id: string; nameAr: string }[];
}
export interface QatarMapPrivateGrading {
  answerIds: readonly string[];
  answerFamilyId: string;
  canonicalDirection?: Direction;
  orderedAnswerIds?: readonly string[];
  rawIncorrectAnswerOrderMatters?: boolean;
  reviewedDerivedCorrection?: "ordered_answer_array_correct";
  geographicReview: "required" | "reviewed";
  pointMappings: readonly { markerId: string; placeId: string; nameAr: string; latitude: number; longitude: number }[];
  explanationBasis: { sourceRelationship: string; verificationStatus: string };
}
export type QatarMapChallengeDefinition = ChallengeBase<"qatar_map", QatarMapPublicData, QatarMapPrivateGrading>;

export interface WordSearchPublicData {
  rows: 8 | 9;
  columns: 8 | 9;
  /** Authored left-to-right coordinates stay fixed inside RTL presentations. */
  grid: readonly (readonly string[])[];
  clueAr: string;
  timeLimitSeconds: 60 | 75 | 90;
}
export interface WordSearchEndpoint { start: Point; end: Point; }
export interface WordSearchPrivateGrading {
  normalizedAnswer: string;
  /** Every physical straight answer path, de-duplicated regardless of direction. */
  acceptedPaths: readonly WordSearchEndpoint[];
  rawClaimedOccurrences: number;
  reviewedOccurrenceCorrection?: "source_claim_understates_physical_paths";
}
export type WordSearchChallengeDefinition = ChallengeBase<"word_search", WordSearchPublicData, WordSearchPrivateGrading, typeof T37_WORD_SEARCH_CHALLENGE_SCHEMA_VERSION>;

export type CanonicalChallengeDefinition =
  | NavigationChallengeDefinition
  | MissingTileChallengeDefinition
  | MemoryChallengeDefinition
  | QatarMapChallengeDefinition
  | T37NavigationChallengeDefinition
  | T37MissingTileChallengeDefinition
  | T37MemoryChallengeDefinition
  | WordSearchChallengeDefinition;

export type ChallengeValidationIssue = { code: string; message: string };
const isPoint = (value: unknown): value is Point =>
  Array.isArray(value) && value.length === 2 && value.every((item) => Number.isInteger(item));
const inBounds = (point: Point, rows: number, columns: number) =>
  point[0] >= 0 && point[0] < rows && point[1] >= 0 && point[1] < columns;
const key = ([row, column]: Point) => `${row}:${column}`;
const sameTile = (a: TileOption | null, b: TileOption | null) =>
  Boolean(a && b && a.shape === b.shape && a.hex === b.hex);
const directionDelta: Record<Direction, Point> = {
  north: [-1, 0], east: [0, 1], south: [1, 0], west: [0, -1],
};

/** Deterministic normalizer for the authored Arabic word-search alphabet. */
export function normalizeArabicWordSearch(value: string): string {
  return value.normalize("NFKC").replace(/[\u064B-\u065F\u0670\u0640]/gu, "").replace(/[أإآٱ]/gu, "ا").replace(/ؤ/gu, "و").replace(/ئ/gu, "ي").replace(/ى/gu, "ي").replace(/ة/gu, "ه").replace(/\s/gu, "");
}
function physicalPathKey({ start, end }: WordSearchEndpoint) { const first = key(start), last = key(end); return first < last ? `${first}/${last}` : `${last}/${first}`; }
export function straightWordSearchPath(start: Point, end: Point): readonly Point[] {
  const rowDelta = end[0] - start[0], columnDelta = end[1] - start[1], rowStep = Math.sign(rowDelta), columnStep = Math.sign(columnDelta);
  if (!(rowDelta === 0 || columnDelta === 0 || Math.abs(rowDelta) === Math.abs(columnDelta))) return [];
  return Array.from({ length: Math.max(Math.abs(rowDelta), Math.abs(columnDelta)) + 1 }, (_item, index) => [start[0] + rowStep * index, start[1] + columnStep * index] as Point);
}
function validateWordSearch(definition: WordSearchChallengeDefinition, issues: ChallengeValidationIssue[]) {
  const { rows, columns, grid, clueAr, timeLimitSeconds } = definition.publicData, privateData = definition.privateGrading;
  if (!([60, 75, 90] as number[]).includes(timeLimitSeconds) || grid.length !== rows || grid.some((row) => row.length !== columns) || rows !== columns || ![8, 9].includes(rows)) issues.push({ code: "WORD_SEARCH_GRID", message: "Word-search grid or timer is invalid." });
  if (!clueAr.trim() || !privateData.normalizedAnswer || normalizeArabicWordSearch(privateData.normalizedAnswer) !== privateData.normalizedAnswer) issues.push({ code: "WORD_SEARCH_TEXT", message: "Word-search clue or normalized answer is invalid." });
  const seen = new Set<string>();
  for (const candidate of privateData.acceptedPaths) {
    if (!isPoint(candidate.start) || !isPoint(candidate.end) || !inBounds(candidate.start, rows, columns) || !inBounds(candidate.end, rows, columns)) { issues.push({ code: "WORD_SEARCH_BOUNDS", message: "Word-search endpoint is outside the grid." }); continue; }
    const identity = physicalPathKey(candidate); if (seen.has(identity)) issues.push({ code: "WORD_SEARCH_DUPLICATE_PATH", message: "Word-search physical paths must be unique." }); seen.add(identity);
    const path = straightWordSearchPath(candidate.start, candidate.end), spelling = path.map(([row, column]) => grid[row]?.[column] ?? "").join(""), reverse = [...path].reverse().map(([row, column]) => grid[row]?.[column] ?? "").join("");
    if (!path.length || (normalizeArabicWordSearch(spelling) !== privateData.normalizedAnswer && normalizeArabicWordSearch(reverse) !== privateData.normalizedAnswer)) issues.push({ code: "WORD_SEARCH_PATH", message: "Word-search path does not spell the normalized answer." });
  }
  if (!privateData.acceptedPaths.length || (privateData.acceptedPaths.length !== privateData.rawClaimedOccurrences && privateData.reviewedOccurrenceCorrection !== "source_claim_understates_physical_paths")) issues.push({ code: "WORD_SEARCH_OCCURRENCES", message: "Word-search occurrence correction is missing." });
}

function validateNavigation(definition: Extract<CanonicalChallengeDefinition, { kind: "navigation" }>, issues: ChallengeValidationIssue[]) {
  const { rows, columns, start, timeLimitSeconds } = definition.publicData;
  const privateData = definition.privateGrading;
  if ((rows === 5 && timeLimitSeconds !== 60) || (rows === 6 && timeLimitSeconds !== 75) || (rows === 7 && timeLimitSeconds !== 90)) issues.push({ code: "NAV_PROFILE", message: "Navigation profile must use its locked timer." });
  if (![start, privateData.goal, ...privateData.blocked, ...privateData.canonicalPath].every((point) => isPoint(point) && inBounds(point, rows, columns))) issues.push({ code: "NAV_BOUNDS", message: "Navigation point is outside the board." });
  const blocked = new Set(privateData.blocked.map(key));
  if (blocked.has(key(start)) || blocked.has(key(privateData.goal))) issues.push({ code: "NAV_BLOCKED_ENDPOINT", message: "Navigation start or goal is blocked." });
  let at: Point = start;
  const travelled: Point[] = [at];
  for (const direction of privateData.canonicalDirections) {
    const delta = directionDelta[direction];
    if (!delta) { issues.push({ code: "NAV_DIRECTION", message: "Canonical direction is invalid." }); break; }
    at = [at[0] + delta[0], at[1] + delta[1]];
    if (!inBounds(at, rows, columns) || blocked.has(key(at))) issues.push({ code: "NAV_CANONICAL_PATH", message: "Canonical route leaves the safe board." });
    travelled.push(at);
  }
  if (key(at) !== key(privateData.goal)) issues.push({ code: "NAV_CANONICAL_GOAL", message: "Canonical route must end at the goal." });
  if (travelled.length !== privateData.canonicalPath.length || travelled.some((point, index) => key(point) !== key(privateData.canonicalPath[index]!))) issues.push({ code: "NAV_PATH_MISMATCH", message: "Canonical directions and path disagree." });
  const queue = [start], visited = new Set([key(start)]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) for (const delta of Object.values(directionDelta)) {
    const next: Point = [queue[cursor]![0] + delta[0], queue[cursor]![1] + delta[1]];
    if (inBounds(next, rows, columns) && !blocked.has(key(next)) && !visited.has(key(next))) { visited.add(key(next)); queue.push(next); }
  }
  if (!visited.has(key(privateData.goal))) issues.push({ code: "NAV_UNREACHABLE", message: "Goal has no safe route." });
}

function validateTile(definition: Extract<CanonicalChallengeDefinition, { kind: "missing_tile" }>, issues: ChallengeValidationIssue[]) {
  const data = definition.publicData, { rows, columns, cells, missingCell, options } = data;
  if (definition.schemaVersion === T37_CHALLENGE_SCHEMA_VERSION && ((data.rule === "vertical_mirror" && (rows !== 4 || columns !== 4 || data.timeLimitSeconds !== 40)) || (data.rule === "latin" && (rows !== 3 || columns !== 3 || data.timeLimitSeconds !== 60)))) issues.push({ code: "TILE_T37_PROFILE", message: "T37 tile profiles are 4×4 mirror/40 and 3×3 Latin/60." });
  if (definition.schemaVersion === CHALLENGE_SCHEMA_VERSION && ((data.rule === "vertical_mirror" && data.timeLimitSeconds !== 30) || (data.rule === "latin" && !((rows === 3 && columns === 3 && data.timeLimitSeconds === 45) || (rows === 4 && columns === 4 && data.timeLimitSeconds === 60))))) issues.push({ code: "TILE_T36_PROFILE", message: "T36 tile profiles are mirror/30, Latin 3×3/45, or Latin 4×4/60." });
  if (cells.length !== rows || cells.some((row) => row.length !== columns)) issues.push({ code: "TILE_DIMENSIONS", message: "Tile grid dimensions are invalid." });
  if (!isPoint(missingCell) || !inBounds(missingCell, rows, columns) || cells[missingCell[0]]?.[missingCell[1]] !== null) issues.push({ code: "TILE_MISSING", message: "Tile missing cell is invalid." });
  const optionValueKeys = data.rule === "xor_row_16_dot" ? options.map((option) => String(option.bitmask)) : options.map((option) => `${option.shape}\u0000${option.hex}`);
  if (new Set(options.map((option) => option.id)).size !== options.length || new Set(optionValueKeys).size !== options.length) issues.push({ code: "TILE_OPTIONS", message: "Tile options must have unique IDs and values." });
  if (options.length !== 4 || !options.some((option) => option.id === definition.privateGrading.correctOptionId)) issues.push({ code: "TILE_ANSWER", message: "Tile correct option must be one of four options." });
  if (data.rule === "vertical_mirror") {
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < Math.floor(columns / 2); column += 1) {
      const left = cells[row]?.[column] ?? null, right = cells[row]?.[columns - 1 - column] ?? null;
      if (left && right && !sameTile(left, right)) issues.push({ code: "TILE_MIRROR", message: "Mirror cells disagree." });
    }
    const mirror = cells[missingCell[0]]?.[columns - 1 - missingCell[1]] ?? null;
    const answer = options.find((option) => option.id === definition.privateGrading.correctOptionId) ?? null;
    if (!sameTile(answer, mirror)) issues.push({ code: "TILE_MIRROR_ANSWER", message: "Mirror answer does not match its counterpart." });
  } else if (data.rule === "latin") {
    if (rows !== columns || ![3, 4].includes(rows)) issues.push({ code: "TILE_LATIN_SIZE", message: "Latin tile must be 3×3 or 4×4." });
    const validOptions = options.filter((option) => {
      const sourceShapes = new Set(cells.flat().filter((cell): cell is TileOption => Boolean(cell)).map((cell) => cell.shape));
      const sourceHexes = new Set(cells.flat().filter((cell): cell is TileOption => Boolean(cell)).map((cell) => cell.hex));
      if (!sourceShapes.has(option.shape) || !sourceHexes.has(option.hex)) return false;
      const completed = cells.map((row, rowIndex) => row.map((cell, columnIndex) => rowIndex === missingCell[0] && columnIndex === missingCell[1] ? option : cell));
      return [...completed, ...Array.from({ length: columns }, (_, column) => completed.map((row) => row[column]!))].every((group) => group.every(Boolean) && new Set(group.map((cell) => cell!.shape)).size === group.length && new Set(group.map((cell) => cell!.hex)).size === group.length);
    });
    if (validOptions.length !== 1 || validOptions[0]?.id !== definition.privateGrading.correctOptionId) issues.push({ code: "TILE_LATIN", message: "Exactly one supplied option must complete the canonical Latin grid." });
  } else {
    if (definition.schemaVersion !== T37_CHALLENGE_SCHEMA_VERSION || rows !== 3 || columns !== 3 || data.timeLimitSeconds !== 80) issues.push({ code: "TILE_XOR_PROFILE", message: "XOR dot tile must be a T37 3×3 80-second profile." });
    const masks = (value: TileOption | null) => value?.bitmask;
    const answer = options.find((option) => option.id === definition.privateGrading.correctOptionId);
    if (cells.flat().some((cell) => cell && (!Number.isInteger(cell.bitmask) || cell.bitmask! < 0 || cell.bitmask! > 65_535)) || options.some((option) => !Number.isInteger(option.bitmask) || option.bitmask! < 0 || option.bitmask! > 65_535)) issues.push({ code: "TILE_XOR_MASK", message: "XOR dots must be unsigned 16-bit masks." });
    for (let row = 0; row < rows; row += 1) {
      const left = masks(cells[row]?.[0] ?? null), middle = masks(cells[row]?.[1] ?? null);
      const right = row === missingCell[0] && missingCell[1] === 2 ? answer?.bitmask : masks(cells[row]?.[2] ?? null);
      if (left === undefined || middle === undefined || right === undefined || (left ^ middle) !== right) issues.push({ code: "TILE_XOR", message: "Each XOR row must satisfy left XOR middle = right." });
    }
    const validOptions = options.filter((option) => {
      const completed = cells.map((row, rowIndex) => row.map((cell, columnIndex) => rowIndex === missingCell[0] && columnIndex === missingCell[1] ? option : cell));
      return completed.every((row) => row[0]?.bitmask !== undefined && row[1]?.bitmask !== undefined && row[2]?.bitmask !== undefined && ((row[0]!.bitmask! ^ row[1]!.bitmask!) === row[2]!.bitmask));
    });
    if (validOptions.length !== 1 || validOptions[0]?.id !== definition.privateGrading.correctOptionId) issues.push({ code: "TILE_XOR_UNIQUE", message: "Exactly one supplied option must complete every XOR row." });
  }
}

function validateMemory(definition: Extract<CanonicalChallengeDefinition, { kind: "memory" }>, issues: ChallengeValidationIssue[]) {
  const data = definition.publicData, privateData = definition.privateGrading;
  const t37 = definition.schemaVersion === T37_CHALLENGE_SCHEMA_VERSION;
  if (t37
    ? ((data.rows === 2 && (data.columns !== 3 || data.showSeconds !== 8 || data.answerSeconds !== 20)) || (data.rows === 3 && (data.columns !== 3 || data.showSeconds !== 8 || data.answerSeconds !== 20)) || (data.rows === 4 && (data.columns !== 4 || data.showSeconds !== 10 || data.answerSeconds !== 30)))
    : ((data.rows === 2 && (data.showSeconds !== 6 || data.answerSeconds !== 20)) || (data.rows === 3 && (data.showSeconds !== 8 || data.answerSeconds !== 20)) || (data.rows === 4 && (data.showSeconds !== 10 || data.answerSeconds !== 30)))) issues.push({ code: "MEMORY_PROFILE", message: "Memory board must use its locked timers." });
  if (privateData.board.length !== data.rows || privateData.board.some((row) => row.length !== data.columns)) issues.push({ code: "MEMORY_DIMENSIONS", message: "Memory board dimensions are invalid." });
  const palette = new Map(data.palette.map((colour) => [colour.nameAr, colour.hex]));
  if (data.palette.length !== (t37 ? 8 : 6) || new Set(data.palette.map((colour) => colour.nameAr)).size !== data.palette.length || privateData.board.some((row) => row.some((colour) => !palette.has(colour))) || privateData.observationCells.length !== data.rows * data.columns || privateData.observationCells.some((cell) => palette.get(cell.colorAr)?.toUpperCase() !== cell.hex.toUpperCase() || privateData.board[cell.row]?.[cell.column] !== cell.colorAr || !cell.shapeAr)) issues.push({ code: "MEMORY_PALETTE", message: "Memory observation must use the fixed source colour palette and exact cell stimuli." });
  if (privateData.targets.length < 1 || privateData.targets.length > 2 || privateData.targets.length !== privateData.targetAnswers.length) issues.push({ code: "MEMORY_TARGETS", message: "Memory needs one or two ordered targets." });
  privateData.targets.forEach((target, index) => {
    if (!isPoint(target) || !inBounds(target, data.rows, data.columns) || privateData.board[target[0]]?.[target[1]] !== privateData.targetAnswers[index]) issues.push({ code: "MEMORY_ANSWER", message: "Memory target answer disagrees with board." });
  });
  if (new Set(privateData.targets.map(key)).size !== privateData.targets.length) issues.push({ code: "MEMORY_DUPLICATE_TARGET", message: "Memory target coordinates must be unique." });
}

function validateMap(definition: QatarMapChallengeDefinition, issues: ChallengeValidationIssue[]) {
  const data = definition.publicData, privateData = definition.privateGrading;
  if ((data.mode === "order" && data.timeLimitSeconds !== 45) || (data.mode !== "order" && data.timeLimitSeconds !== 30)) issues.push({ code: "MAP_PROFILE", message: "Map mode must use its locked timer." });
  if (data.markers.length !== 3 || new Set(data.markers.map((marker) => marker.id)).size !== 3 || data.markers.map((marker) => marker.id).sort().join("") !== "ABC" || data.markers.some((marker) => !Number.isFinite(marker.x) || !Number.isFinite(marker.y) || marker.x < 0 || marker.x > 100 || marker.y < 0 || marker.y > 100)) issues.push({ code: "MAP_MARKERS", message: "Map markers must be exactly A/B/C with normalized SVG positions." });
  if (data.optionIds.length !== 3 || [...data.optionIds].sort().join("") !== "ABC") issues.push({ code: "MAP_OPTIONS", message: "Map options must be exactly A/B/C." });
  if (privateData.pointMappings.length !== 3 || privateData.pointMappings.some((point) => !data.markers.some((marker) => marker.id === point.markerId) || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude))) issues.push({ code: "MAP_MAPPING", message: "Map private point mapping is incomplete." });
  if (!privateData.answerFamilyId || privateData.answerIds.length < 1 || privateData.answerIds.some((id) => !data.markers.some((marker) => marker.id === id)) || (data.mode === "direction" && !privateData.canonicalDirection)) issues.push({ code: "MAP_ANSWER", message: "Map answer must refer to marker identities and a canonical direction where applicable." });
  if (data.mode === "order") {
    if (!privateData.orderedAnswerIds || privateData.orderedAnswerIds.length !== 3 || privateData.answerIds.join("|") !== privateData.orderedAnswerIds.join("|") || new Set(privateData.orderedAnswerIds).size !== privateData.orderedAnswerIds.length || privateData.orderedAnswerIds.some((id) => !data.markers.some((marker) => marker.id === id)) || privateData.reviewedDerivedCorrection !== "ordered_answer_array_correct" || privateData.rawIncorrectAnswerOrderMatters !== false) issues.push({ code: "MAP_ORDER", message: "Map ordering must retain its reviewed derived correction." });
    else {
      const bySvg = [...data.markers].sort((a, b) => a.y - b.y).map((marker) => marker.id);
      const byLatitude = [...privateData.pointMappings].sort((a, b) => b.latitude - a.latitude).map((point) => point.markerId);
      if (bySvg.join("|") !== privateData.orderedAnswerIds.join("|") || byLatitude.join("|") !== privateData.orderedAnswerIds.join("|")) issues.push({ code: "MAP_ORDER_GEOMETRY", message: "Ordered answer must agree with SVG geometry and source coordinates." });
    }
  }
  if (data.mode === "direction" && privateData.canonicalDirection) {
    const bySvg = [...data.markers].sort((a, b) => privateData.canonicalDirection === "north" ? a.y - b.y : privateData.canonicalDirection === "south" ? b.y - a.y : privateData.canonicalDirection === "east" ? b.x - a.x : a.x - b.x).map((marker) => marker.id);
    const byCoordinates = [...privateData.pointMappings].sort((a, b) => privateData.canonicalDirection === "north" ? b.latitude - a.latitude : privateData.canonicalDirection === "south" ? a.latitude - b.latitude : privateData.canonicalDirection === "east" ? b.longitude - a.longitude : a.longitude - b.longitude).map((point) => point.markerId);
    if (privateData.answerIds[0] !== bySvg[0] || privateData.answerIds[0] !== byCoordinates[0]) issues.push({ code: "MAP_DIRECTION_GEOMETRY", message: "Direction answer disagrees with SVG marker geometry or source coordinates." });
  }
  if (data.mode === "identify") {
    const mentioned = privateData.pointMappings.filter((point) => data.promptAr.includes(point.nameAr));
    if (mentioned.length !== 1 || privateData.answerIds[0] !== mentioned[0]?.markerId) issues.push({ code: "MAP_IDENTIFY_MAPPING", message: "Identification prompt target must map to exactly one correct marker." });
  }
}

/** Returns errors rather than coercing source data. Any error must hold a card. */
export function validateCanonicalChallengeDefinition(definition: CanonicalChallengeDefinition): ChallengeValidationIssue[] {
  const issues: ChallengeValidationIssue[] = [];
  const t37 = definition.schemaVersion === T37_CHALLENGE_SCHEMA_VERSION;
  const wordSearch = definition.schemaVersion === T37_WORD_SEARCH_CHALLENGE_SCHEMA_VERSION;
  if (![CHALLENGE_SCHEMA_VERSION, T37_CHALLENGE_SCHEMA_VERSION, T37_WORD_SEARCH_CHALLENGE_SCHEMA_VERSION].includes(definition.schemaVersion) || !/^[a-z0-9-]+$/u.test(definition.id) || !/^[a-f0-9]{64}$/u.test(definition.definitionSha256) || !/^[a-f0-9]{64}$/u.test(definition.source.sourceRawSha256) || !/^[a-f0-9]{64}$/u.test(definition.source.sourceContextsSha256) || !/^[a-f0-9]{64}$/u.test(definition.source.mediaArchiveSha256)) issues.push({ code: "BASE_PIN", message: "Definition identity or source pin is invalid." });
  if (!Number.isInteger(definition.ordinal) || definition.ordinal < 1 || definition.ordinal > 300 || !definition.factFamilies.length || definition.maxPerGameFamily !== 1) issues.push({ code: "BASE_FAMILY", message: "Definition ordinal or fact-family constraint is invalid." });
  if ((!t37 && !wordSearch && (!definition.media.length || definition.media.some((media) => !/^[a-f0-9]{64}$/u.test(media.originalSha256) || !/^[a-f0-9]{64}$/u.test(media.derivativeSha256) || !media.originalObjectName || !media.derivativeObjectName))) || ((t37 || wordSearch) && definition.media.length !== 0)) issues.push({ code: "MEDIA_REF", message: "T36 requires immutable media bindings; code-native definitions must have none." });
  const roleKeys = definition.media.map((media) => `${media.role}:${media.visibility}`).sort();
  const expectedRoles: Record<ChallengeKind, string[]> = { navigation: ["answer:host_only", "question:guide_only", "question:player"], missing_tile: ["answer:host_only", "question:player"], memory: ["question:player"], qatar_map: ["question:player"], word_search: [] };
  if (!t37 && !wordSearch && roleKeys.join("|") !== expectedRoles[definition.kind].join("|")) issues.push({ code: "MEDIA_ROLES", message: "Card does not have its exact role-safe media bindings." });
  switch (definition.kind) {
    case "navigation": validateNavigation(definition, issues); break;
    case "missing_tile": validateTile(definition, issues); break;
    case "memory": validateMemory(definition, issues); break;
    case "qatar_map": validateMap(definition, issues); break;
    case "word_search": validateWordSearch(definition, issues); break;
  }
  return issues;
}

/** Compile-time public allowlists. They intentionally cannot express private grading/source fields. */
export type NavigationProjectionData = NavigationPublicData;
export type MissingTileProjectionData = MissingTilePublicData;
export type MemoryObservationProjectionData = Pick<MemoryPublicData, "rows" | "columns" | "showSeconds" | "palette">;
export type QatarMapProjectionData = QatarMapPublicData;
export type WordSearchProjectionData = WordSearchPublicData;
