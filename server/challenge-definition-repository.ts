/** Server-only immutable definition repository used by local authority tests. */
import { createHash } from "node:crypto";
import {
  assertChallengeDefinitionBinding,
  parseChallengeDefinitionEnvelope,
  type ChallengeQuestionBinding,
  type ChallengeDefinitionEnvelope,
  type ChallengeDefinitionReference,
} from "../src/features/game/challenges/integration.js";
import type { CanonicalChallengeDefinition } from "../src/features/game/challenges/definition.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Definitions are injected explicitly by a server/test configuration. The
 * browser never imports this repository or a private source manifest.
 */
export class ChallengeDefinitionRepository {
  private readonly definitions = new Map<string, ChallengeDefinitionEnvelope>();

  constructor(envelopes: readonly ChallengeDefinitionEnvelope[] = []) {
    for (const envelope of envelopes) {
      const parsed = parseChallengeDefinitionEnvelope(envelope, sha256);
      const key = this.key(envelope.manifestSha256, envelope.id);
      if (this.definitions.has(key)) throw new Error("CHALLENGE_DEFINITION_DUPLICATE");
      // Validate before retaining the JSON so malformed data cannot become
      // available after a process restart.
      if (parsed.id !== envelope.id) throw new Error("CHALLENGE_DEFINITION_IDENTITY_MISMATCH");
      this.definitions.set(key, envelope);
    }
  }

  get hasDefinitions(): boolean { return this.definitions.size > 0; }

  resolve(reference: ChallengeDefinitionReference): CanonicalChallengeDefinition {
    const envelope = this.definitions.get(this.key(reference.manifestSha256, reference.id));
    if (!envelope) throw new Error("CHALLENGE_DEFINITION_MISSING");
    if (envelope.schemaVersion !== reference.schemaVersion || envelope.definitionSha256 !== reference.definitionSha256)
      throw new Error("CHALLENGE_DEFINITION_PIN_MISMATCH");
    return parseChallengeDefinitionEnvelope(envelope, sha256);
  }

  /** Applies the public release-child pins before the definition reaches the reducer. */
  resolveBound(question: ChallengeQuestionBinding): CanonicalChallengeDefinition {
    const reference = question.challenge?.definition;
    if (!reference) throw new Error("CHALLENGE_DEFINITION_MISSING");
    const definition = this.resolve(reference);
    assertChallengeDefinitionBinding(definition, question);
    return definition;
  }

  private key(manifestSha256: string, id: string) { return `${manifestSha256}\u0000${id}`; }
}
