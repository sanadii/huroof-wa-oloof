import type { LocalQuestionInventory } from "./local-question-inventory";
import type { ApprovedReleaseCatalog, ChallengeMechanic } from "../features/game/runtime/contracts";

type BoardGameKind = "huroof" | "categories";
type LocalInventoryCategory = LocalQuestionInventory["categories"][number];
type ApprovedInventoryCategory = ApprovedReleaseCatalog["categories"][number];

/** Temporary, content-free T36 mapping until an immutable catalog row carries challengeKinds. */
const knownT36ChallengeKinds: Readonly<Record<string, readonly ChallengeMechanic[]>> = {
  "tahadani-games-120": ["navigation"],
  "tahadani-games-127": ["missing_tile"],
  "tahadani-games-132": ["memory"],
  "tahadani-games-326": ["qatar_map"],
};

export function categoryChallengeKinds(category: { id: string; challengeKinds?: readonly ChallengeMechanic[] } | undefined): readonly ChallengeMechanic[] {
  return category?.challengeKinds ?? knownT36ChallengeKinds[category?.id ?? ""] ?? [];
}

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
  enabledChallengeMechanics: readonly ChallengeMechanic[] = [],
) {
  if (category?.playable[gameKind] !== true) return false;
  // A successor may contain challenge-only categories before their staged
  // runtime flag is enabled. Existing ordinary categories with optional
  // selection metadata remain available regardless of capability flags.
  return category.challengeOnly !== true ||
    (category.challengeKinds?.length ?? 0) > 0 &&
    category.challengeKinds!.every((kind) => enabledChallengeMechanics.includes(kind));
}
