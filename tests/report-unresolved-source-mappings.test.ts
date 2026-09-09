import assert from "node:assert/strict";
import test from "node:test";
import { buildUnresolvedSourceMappingEvidence } from "../scripts/report-unresolved-source-mappings.js";

test("groups unresolved revisions by immutable occurrence provenance without inferring category identity", () => {
  const report = { sourceSha256: "a".repeat(64), questionRevisionCount: 3, dispositions: [
    { contentHash: "b".repeat(64), source: { mappingDisposition: "unresolved", rawIdentifiers: [], semanticKey: "record-b" } },
    { contentHash: "a".repeat(64), source: { mappingDisposition: "unresolved", rawIdentifiers: [], semanticKey: "record-a" } },
    { contentHash: "c".repeat(64), source: { mappingDisposition: "resolved", rawIdentifiers: ["tahadani-001"], semanticKey: "record-c" } },
  ] };
  const intake = [
    { path: `questionImports/b/occurrences/${"b".repeat(64)}`, data: { contentHash: "b".repeat(64), archive: "bundle.zip", entry: "qa/a.json", fileSha256: "f".repeat(64) } },
    { path: `questionImports/b/occurrences/${"a".repeat(64)}`, data: { contentHash: "a".repeat(64), archive: "bundle.zip", entry: "qa/a.json", fileSha256: "f".repeat(64) } },
  ];
  const evidence = buildUnresolvedSourceMappingEvidence(report, intake);
  assert.equal(evidence.unresolvedRevisionCount, 2);
  assert.equal(evidence.groups.length, 1);
  assert.deepEqual(evidence.groups[0].records.map((record) => record.semanticKey), ["record-a", "record-b"]);
  assert.match(evidence.groups[0].action, /do not infer/);
});
