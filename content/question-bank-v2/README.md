# Question-bank v2 authoring contract

This directory is a versioned, evidence-first authoring backlog. Its 20,832
records are slots, not questions: 17,808 classic slots, 1,344 media-blocked
image slots, and 1,680 separate-mode charades slots. The only real v2 content
is the one structural fixture draft. There are no v2 approved records.

Pipeline: `slots -> source packets -> draft -> structural validation -> review
queue -> promotion -> immutable release manifest`. `plan:authoring` is
deterministic. `validate:authoring -- --as-of YYYY-MM-DD` verifies new artifacts
and v1 baseline receipts without regenerating the pilot. `promote:authoring`
appends only a fully gated approval and is the sole approved-output writer.

## Non-negotiable controls

C1: “Generated or model-assisted output must be schema-constrained to draft status. Only the promotion command may create an approved record, and it must reject missing, stale, or policy-incomplete review receipts.”

C2: “Every one of the 62 category IDs must map to exactly one versioned category policy and exactly one modality partition; do not infer category ownership from array position or generic prompt wording.”

C3: “Authoring slots are backlog records, not questions. Never populate prompt, answer, source, review, or approval fields with placeholders, and never count slots as drafted, reviewed, approved, playable, or source-grounded.”

C4: “Do not use an all-pairs near-duplicate loop at catalog scale. Use deterministic exact hashes and indexed candidate generation before similarity scoring, and block releases with unresolved high-confidence duplicate clusters.”

C5: “Readiness and runtime inventory must include only schema-valid, approved, non-expired, policy-valid records and must be computed for the exact selected category pack, not global inventory or draft presence.”

C6: “Use 336 as the balanced long-term target per category, but retain 224 approved items—8 per each of 28 letters—as the classic standalone activation threshold. Charades has no letter-based readiness and must report separately.”

C7: “Classic text, image-question, and charades content must use separate schemas and outputs. All four image categories remain blocked until question-specific media is locally stored and explicitly publishable; all five charades categories are forbidden from the classic inventory.”

C8: “Structural validation may prove schema, counts, provenance shape, expiry, hashes, and review-record presence; it must never claim that a factual assertion, Arabic phrasing, religious interpretation, category relevance, or media right is correct without the required human review evidence.”
