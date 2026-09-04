/** Deterministic JSON used for release hashes and equality checks. */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Release data may not contain non-finite numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  throw new Error('Release data must be JSON-serializable.');
}

export function canonicalJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }

export const SAFE_DOCUMENT_ID = /^[A-Za-z0-9_-]{1,120}$/;

/** Parses, validates identifiers, key-sorts objects, and ID-sorts approved records. */
export function canonicalApprovedJsonl(raw: string): string {
  const records = raw.split(/\r?\n/).map((line, index) => ({ line, index })).filter(({ line }) => line.trim().length > 0).map(({ line, index }) => {
    let parsed: unknown;
    try { parsed = JSON.parse(line); }
    catch { throw new Error(`Invalid approved JSONL at line ${index + 1}.`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Approved JSONL record at line ${index + 1} must be an object.`);
    const id = (parsed as Record<string, unknown>).id;
    if (typeof id !== 'string' || !SAFE_DOCUMENT_ID.test(id)) throw new Error(`Approved JSONL record at line ${index + 1} has a path-unsafe id.`);
    return parsed as Record<string, unknown>;
  });
  const ids = new Set<string>();
  for (const record of records) {
    const id = record.id as string;
    if (ids.has(id)) throw new Error(`Approved JSONL contains duplicate id: ${id}.`);
    ids.add(id);
  }
  records.sort((left, right) => String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0);
  return records.map(canonicalJson).join('\n');
}
