import type { LocalQuestionInventory } from "./local-question-inventory";
import type { ApprovedReleaseCatalog } from "../features/game/runtime/contracts";

type BoardGameKind = "huroof" | "categories";
type LocalInventoryCategory = LocalQuestionInventory["categories"][number];
type ApprovedInventoryCategory = ApprovedReleaseCatalog["categories"][number];

/** Uses the same per-board availability metadata that powers room creation. */
export function localCategoryPlayable(
  category: LocalInventoryCategory | undefined,
  gameKind: BoardGameKind,
  huroofAvailable: boolean,
) {
  if (!category) return false;
  return gameKind === "categories"
    ? category.categoryGameEligible
    : huroofAvailable && category.huroofQuestionCount > 0;
}

export function approvedCategoryPlayable(
  category: ApprovedInventoryCategory | undefined,
  gameKind: BoardGameKind,
) {
  return category?.playable[gameKind] === true;
}
