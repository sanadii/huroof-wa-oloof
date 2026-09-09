import { readFile } from "node:fs/promises";
import {
  validateCorpusV33,
  type V33Corpus,
  type V33TrustRoot,
} from "../src/question-bank-v3.3.js";
const json = <T>(path: string) =>
  readFile(path, "utf8").then((x) => JSON.parse(x) as T);
/** Strict CLI adapter: callers supply the hash-bound aggregate artifacts rather than a count manifest. */
export async function validateV33Paths(paths: {
  corpus: string;
  trustRoot?: string;
}) {
  const corpus = await json<V33Corpus>(paths.corpus);
  const trust = paths.trustRoot
    ? await json<V33TrustRoot>(paths.trustRoot)
    : undefined;
  return { corpus, report: validateCorpusV33(corpus, trust) };
}
if (
  process.argv[1]?.endsWith("validate-question-bank-v3.3.ts") &&
  process.argv[2]
)
  validateV33Paths({
    corpus: process.argv[2],
    trustRoot: process.argv[3],
  }).then((x) => {
    console.log(JSON.stringify(x.report, null, 2));
    if (x.report.counts.error) process.exitCode = 1;
  });
