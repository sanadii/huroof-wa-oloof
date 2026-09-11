import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Availability = "ready" | "insufficient_questions" | "held_only";
type Category = {
  id: string;
  labelAr: string;
  sourceOnly: boolean;
  questionCount: number;
  heldQuestionCount: number;
  huroofQuestionCount: number;
  categoryGameEligible: boolean;
  availability: Availability;
};
type PublicInventory = {
  schemaVersion: 1;
  huroofAvailable: boolean;
  categories: Category[];
};

const target = resolve("src/data/category-inventory.public.json");
const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const input = inputIndex >= 0 ? args[inputIndex + 1] : undefined;
const write = args.includes("--write");
const check = args.includes("--check");

if (!input || ![write, check].some(Boolean) || (write && check)) {
  throw new Error(
    "Usage: tsx scripts/refresh-public-category-inventory.ts --input <metadata.json> --write|--check",
  );
}

const requireString = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${field}`);
  return value;
};
const requireCount = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid ${field}`);
  return value;
};
const requireBoolean = (value: unknown, field: string) => {
  if (typeof value !== "boolean") throw new Error(`Invalid ${field}`);
  return value;
};

function project(value: unknown): PublicInventory {
  if (!value || typeof value !== "object") throw new Error("Inventory must be an object");
  const inventory = value as { huroofAvailable?: unknown; categories?: unknown };
  if (!Array.isArray(inventory.categories)) throw new Error("Inventory categories must be an array");
  const ids = new Set<string>();
  const categories = inventory.categories.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`Invalid category at ${index}`);
    const category = value as Record<string, unknown>;
    const id = requireString(category.id, `categories[${index}].id`);
    if (ids.has(id)) throw new Error(`Duplicate category id: ${id}`);
    ids.add(id);
    const availability = requireString(category.availability, `categories[${index}].availability`);
    if (!(["ready", "insufficient_questions", "held_only"] as const).includes(availability as Availability))
      throw new Error(`Invalid categories[${index}].availability`);
    return {
      id,
      labelAr: requireString(category.labelAr, `categories[${index}].labelAr`),
      sourceOnly: requireBoolean(category.sourceOnly, `categories[${index}].sourceOnly`),
      questionCount: requireCount(category.questionCount, `categories[${index}].questionCount`),
      heldQuestionCount: requireCount(category.heldQuestionCount, `categories[${index}].heldQuestionCount`),
      huroofQuestionCount: requireCount(category.huroofQuestionCount, `categories[${index}].huroofQuestionCount`),
      categoryGameEligible: requireBoolean(category.categoryGameEligible, `categories[${index}].categoryGameEligible`),
      availability: availability as Availability,
    };
  });
  return {
    schemaVersion: 1,
    huroofAvailable: requireBoolean(inventory.huroofAvailable, "huroofAvailable"),
    categories,
  };
}

const projected = project(JSON.parse(await readFile(resolve(input), "utf8")));
const output = `${JSON.stringify(projected, null, 2)}\n`;
if (write) {
  await writeFile(target, output, "utf8");
  console.log(`Wrote ${projected.categories.length} public categories to ${target}`);
} else {
  const current = await readFile(target, "utf8");
  if (current !== output) throw new Error("Public category inventory is stale; run with --write using the approved metadata-only input.");
  console.log(`Verified ${projected.categories.length} public categories in ${target}`);
}
