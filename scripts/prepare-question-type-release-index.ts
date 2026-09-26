import {
  buildQuestionTypeReleaseIndexFromChildrenJsonl,
  questionTypeIndexDocument,
} from "./question-type-release-index.js";

function flags(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index], value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || result[key.slice(2)] !== undefined) throw new Error("Use unique --name value pairs.");
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const input = flags(process.argv.slice(2));
  const required = ["children", "release-id", "root-sha256", "approved-count", "category-count", "children-sha256", "children-count"];
  if (Object.keys(input).length !== required.length || required.some((key) => !input[key])) throw new Error(`Required flags: ${required.map((key) => `--${key}`).join(" ")}.`);
  const number = (key: "approved-count" | "category-count" | "children-count") => {
    const value = Number(input[key]);
    if (!Number.isSafeInteger(value)) throw new Error(`--${key} must be an integer.`);
    return value;
  };
  const index = await buildQuestionTypeReleaseIndexFromChildrenJsonl({
    childrenPath: input.children,
    releaseId: input["release-id"],
    releaseRootSha256: input["root-sha256"],
    approvedQuestionCount: number("approved-count"),
    categoryCount: number("category-count"),
    expectedChildrenSha256: input["children-sha256"],
    expectedChildDocumentCount: number("children-count"),
  });
  // This command only emits a reviewable immutable document. It has no cloud
  // credentials and cannot publish or alter an active-release pointer.
  console.log(JSON.stringify(questionTypeIndexDocument(index), null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
