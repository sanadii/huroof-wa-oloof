import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Revision = { contentHash: string; source: { mappingDisposition: string; rawIdentifiers: string[]; semanticKey: string } };
type Report = { sourceSha256: string; questionRevisionCount: number; dispositions: Revision[] };
type IntakeRow = { path: string; data: { contentHash?: string; archive?: string; entry?: string; fileSha256?: string } };
type EvidenceGroup = { occurrenceProvenance: { archive: string; entry: string; fileSha256?: string }[]; rawIdentifiers: string[]; reason: "source_category_mapping_unresolved"; action: string; records: { contentHash: string; semanticKey: string }[] };

const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(",")}]` : value && typeof value === "object" ? `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(",")}}` : JSON.stringify(value);

/**
 * Retains immutable occurrence provenance for revisions with no source category
 * identifier. It deliberately makes no question/title/answer-based inference.
 */
export function buildUnresolvedSourceMappingEvidence(report: Report, intakeRows: IntakeRow[]) {
  const occurrences = new Map<string, { archive: string; entry: string; fileSha256?: string }[]>();
  for (const row of intakeRows) if (row.path.includes("/occurrences/") && row.data.contentHash) {
    const current = occurrences.get(row.data.contentHash) ?? [];
    current.push({ archive: row.data.archive ?? "unknown", entry: row.data.entry ?? "unknown", fileSha256: row.data.fileSha256 });
    occurrences.set(row.data.contentHash, current);
  }
  const groups = new Map<string, EvidenceGroup>();
  for (const revision of report.dispositions.filter((item) => item.source.mappingDisposition === "unresolved")) {
    const occurrenceProvenance = [...new Map((occurrences.get(revision.contentHash) ?? []).map((item) => [stable(item), item])).values()].sort((left, right) => stable(left).localeCompare(stable(right)));
    const rawIdentifiers = [...new Set(revision.source.rawIdentifiers)].sort();
    const key = stable({ occurrenceProvenance, rawIdentifiers });
    const group = groups.get(key) ?? { occurrenceProvenance, rawIdentifiers, reason: "source_category_mapping_unresolved", action: "Require a source-supplied category ID or an authenticated source-file-to-registry association; do not infer from question text, title, or answer.", records: [] };
    group.records.push({ contentHash: revision.contentHash, semanticKey: revision.source.semanticKey });
    groups.set(key, group);
  }
  const evidence = [...groups.values()].map((group) => ({ ...group, records: group.records.sort((left, right) => left.contentHash.localeCompare(right.contentHash)) })).sort((left, right) => stable({ occurrenceProvenance: left.occurrenceProvenance, rawIdentifiers: left.rawIdentifiers }).localeCompare(stable({ occurrenceProvenance: right.occurrenceProvenance, rawIdentifiers: right.rawIdentifiers })));
  return { schemaVersion: "t14.3-unresolved-source-mappings-v1", reconciliationSourceSha256: report.sourceSha256, questionRevisionCount: report.questionRevisionCount, unresolvedRevisionCount: evidence.reduce((count, group) => count + group.records.length, 0), groups: evidence };
}

export async function reportUnresolvedSourceMappings(reconciliationPath = resolve("tmp/bundle-import-20260908/t14.3-mapping-reconciliation-v1.json"), intakePath = resolve("tmp/bundle-import-20260908/bundle-question-import.documents.jsonl"), outputPath = resolve("tmp/bundle-import-20260908/t14.3-unresolved-source-mappings-v1.json")) {
  const report = JSON.parse(await readFile(reconciliationPath, "utf8")) as Report;
  const intakeRows = (await readFile(intakePath, "utf8")).toString().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as IntakeRow);
  const evidence = buildUnresolvedSourceMappingEvidence(report, intakeRows);
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, `${stable(evidence)}\n`);
  return evidence;
}

if (process.argv[1]?.endsWith("report-unresolved-source-mappings.ts")) reportUnresolvedSourceMappings().then((result) => console.log(JSON.stringify({ unresolvedRevisionCount: result.unresolvedRevisionCount, groups: result.groups.length, productionWrite: false }))).catch((error) => { console.error(error); process.exitCode = 1; });
