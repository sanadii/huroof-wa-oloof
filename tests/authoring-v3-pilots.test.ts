import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  canonicalJsonV31,
  difficultyLevelV31,
  difficultyScoreV31,
  sourceIdentityV31,
  validateQuestionPilotsV31,
} from '../scripts/validate-question-pilots-v3.1.js';
import { MAX_BODY_BYTES, MAX_UNIQUE_BODY_BYTES_PER_BATCH, evidenceBodyPath, inspectEvidenceBodies, responseBodyReference, writeEvidenceBody } from '../scripts/evidence-body-store-v3.1.js';
import { migratePilotEvidenceBodies } from '../scripts/migrate-pilot-evidence-bodies-v3.1.js';

type Json = Record<string, unknown>;
type Fixture = { root: string; bodyRoot: string; body: Buffer; question: Json; evidence: Json; report: Json; cleanup: () => Promise<void> };

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);

function factualArtifacts(categoryId = 'tahadani-001') {
  const body = Buffer.from('<html><title>Earth | NASA Science</title><p>Earth is our home planet.</p></html>', 'utf8');
  const excerpt = Buffer.from('Earth is our home planet.', 'utf8');
  const startByte = body.indexOf(excerpt);
  const source = {
    sourcePolicyId: 'nasa-science',
    canonicalUrl: 'https://science.nasa.gov/earth/',
    publisher: 'NASA',
    title: 'Earth | NASA Science',
    responseBodySha256: sha256(body),
  };
  const identity = sourceIdentityV31(source);
  const suffix = categoryId.replace('tahadani-', '');
  const claimId = `pilot-claim-${categoryId}-batch-001-${suffix}`;
  const packetId = `pilot-packet-${categoryId}-batch-001-${suffix}`;
  const question: Json = {
    id: `pilot-${categoryId}-batch-001-${suffix}`,
    schemaVersion: '3.1.0',
    categoryId,
    modality: 'classic',
    state: 'ready_for_human',
    headerAr: 'سؤال لغوي',
    promptAr: 'ما الكلمة التي تصف سفرا يبدأ وينتهي في مكان معلوم؟',
    canonicalAnswer: 'رِحلة',
    acceptedAnswers: ['الرِحلة'],
    targetLetter: 'ر',
    acceptDefiniteArticle: true,
    difficulty: 'easy',
    difficultyRationale: {
      difficulty: 'easy',
      rationale: 'مألوف وله قرائن مباشرة ولا يحتاج إلى معرفة متخصصة.',
      familiarity: 5,
      clueDirectness: 4,
      domainSpecificity: 1,
      retrievalBurden: 1,
      score: 5,
    },
    explanationAr: null,
    temporal: { kind: 'stable', checkedAt: '2026-09-04', validUntil: null },
    evidencePolicy: 'factual_sources_required',
    claimIds: [claimId],
    evidencePacketIds: [packetId],
    media: null,
    provenance: { authoringMethod: 'model_assisted', createdAt: '2026-09-04' },
    charadesReview: null,
  };
  const evidence: Json = {
    packetId,
    schemaVersion: '3.1.0',
    categoryId,
    claimId,
    sourcePolicyId: source.sourcePolicyId,
    sourceIdentityId: identity.id,
    sourceIdentitySha256: identity.sha256,
    canonicalUrl: source.canonicalUrl,
    publisher: source.publisher,
    title: source.title,
    locator: { kind: 'response_body_byte_range', startByte, endByte: startByte + excerpt.length },
    retrievedAt: '2026-09-04',
    httpStatus: 200,
    responseContentType: 'text/html; charset=utf-8',
    responseBody: responseBodyReference(body),
    responseBodySha256: source.responseBodySha256,
    excerptBase64: excerpt.toString('base64'),
    excerptSha256: sha256(excerpt),
    claimSupportTokens: ['home planet'],
    sourceTier: 'official',
    freshness: { class: 'stable', validUntil: null },
  };
  return { body, question, evidence };
}

function charadesQuestion(categoryId = 'tahadani-013'): Json {
  return {
    id: `pilot-${categoryId}-batch-001-01`,
    schemaVersion: '3.1.0',
    categoryId,
    modality: 'charades',
    state: 'ready_for_human',
    headerAr: 'مثّل العبارة',
    promptAr: 'مثّل بصمت شخصا يبحث عن مفتاح ضائع في الغرفة.',
    canonicalAnswer: 'البحث عن مفتاح ضائع',
    acceptedAnswers: ['البحث عن مفتاح ضائع'],
    difficulty: 'easy',
    difficultyRationale: {
      difficulty: 'easy',
      rationale: 'حركة يومية واضحة يسهل تمثيلها وتخمينها من دون تخصص.',
      familiarity: 5,
      clueDirectness: 5,
      domainSpecificity: 1,
      retrievalBurden: 1,
      score: 4,
    },
    explanationAr: null,
    temporal: { kind: 'stable', checkedAt: '2026-09-04', validUntil: null },
    evidencePolicy: 'not_applicable_charades',
    claimIds: [],
    evidencePacketIds: [],
    media: null,
    provenance: { authoringMethod: 'human', createdAt: '2026-09-04' },
    charadesReview: { originality: 'pending_human_review', suitability: 'pending_human_review' },
  };
}

function reportFor(categoryId: string, questions: Json[], evidence: Json[], issues: string[] = []): Json {
  const states = { draft: 0, evidence_ready: 0, ready_for_human: 0 };
  for (const question of questions) states[String(question.state) as keyof typeof states] += 1;
  const sourceIdentities = [...new Map(evidence.map((packet) => {
    const identity = sourceIdentityV31({
      sourcePolicyId: String(packet.sourcePolicyId),
      canonicalUrl: String(packet.canonicalUrl),
      publisher: String(packet.publisher),
      title: String(packet.title),
      responseBodySha256: String(packet.responseBodySha256),
    });
    return [identity.id, identity];
  })).values()].sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: '3.1.0',
    categoryId,
    batchId: 'batch-001',
    questionCount: questions.length,
    evidenceCount: evidence.length,
    states,
    issues: [...issues].sort(),
    sourceIdentities,
    integrityChecked: true,
    semanticEntailment: 'human_review_required',
    approved: 0,
    released: 0,
  };
}

async function writeBatch(root: string, categoryId: string, questions: Json[], evidence: Json[], report = reportFor(categoryId, questions, evidence)) {
  const directory = join(root, categoryId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'batch-001.questions.jsonl'), `${questions.map(canonicalJsonV31).join('\n')}\n`);
  await writeFile(join(directory, 'batch-001.evidence.jsonl'), evidence.length ? `${evidence.map(canonicalJsonV31).join('\n')}\n` : '');
  await writeFile(join(directory, 'batch-001.report.json'), canonicalJsonV31(report));
}

async function fixture(): Promise<Fixture> {
  const parent = await mkdtemp(join(tmpdir(), 'huroof-pilots-'));
  const root = join(parent, 'pilots');
  const bodyRoot = join(parent, 'evidence-bodies');
  const { body, question, evidence } = factualArtifacts();
  await writeEvidenceBody(bodyRoot, body);
  const report = reportFor('tahadani-001', [question], [evidence]);
  await writeBatch(root, 'tahadani-001', [question], [evidence], report);
  return { root, bodyRoot, body, question, evidence, report, cleanup: () => rm(parent, { recursive: true, force: true }) };
}

test('valid factual packets and explicit evidence-free charades validate without approval or release', async () => {
  const item = await fixture();
  try {
    const charades = charadesQuestion();
    await writeBatch(item.root, 'tahadani-013', [charades], [], reportFor('tahadani-013', [charades], []));
    const result = await validateQuestionPilotsV31(item.root);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.states, { draft: 0, evidence_ready: 0, ready_for_human: 2 });
    assert.equal(result.approved, 0);
    assert.equal(result.released, 0);
  } finally { await item.cleanup(); }
});

test('trusted source-policy registry is canonical and contains the approved narrow publisher prefixes', async () => {
  const path = join(process.cwd(), 'content/question-bank-v3/pilot-source-identities.v3.1.json');
  const raw = await readFile(path, 'utf8');
  const registry = JSON.parse(raw) as { identities: Array<{ id: string; canonicalUrlPrefix: string; publisher: string; sourceTiers: string[] }> };
  assert.equal(raw, `${canonicalJsonV31(registry)}\n`);
  const policies = new Map(registry.identities.map((policy) => [policy.id, policy]));
  const expected = {
    'fifa-inside': ['https://inside.fifa.com/', 'FIFA'],
    'fifa-publications': ['https://publications.fifa.com/', 'FIFA'],
    uefa: ['https://www.uefa.com/', 'UEFA'],
    'chelsea-fc': ['https://www.chelseafc.com/', 'Chelsea FC'],
    'golden-globes': ['https://goldenglobes.com/person/', 'Golden Globes'],
    'television-academy': ['https://www.televisionacademy.com/bios/', 'Television Academy'],
    'animal-diversity-web': ['https://animaldiversity.org/accounts/', 'Animal Diversity Web, University of Michigan Museum of Zoology'],
    'mbc-shahid-series': ['https://shahid.mbc.net/ar/series/', 'MBC Shahid'],
    'mbc-shahid-shows': ['https://shahid.mbc.net/ar/shows/', 'MBC Shahid'],
    'elcinema-work': ['https://elcinema.com/work/', 'ElCinema'],
  } as const;
  for (const [id, [prefix, publisher]] of Object.entries(expected)) {
    assert.deepEqual(policies.get(id), { canonicalUrlPrefix: prefix, id, publisher, sourceTiers: [id === 'animal-diversity-web' || id === 'elcinema-work' ? 'authoritative' : 'official'] });
  }
});

test('source identity is derived from trusted policy, page metadata, and verified response bytes', async () => {
  const item = await fixture();
  try {
    const evidence = clone(item.evidence);
    evidence.canonicalUrl = 'https://official-looking.evil.example/earth/';
    const identity = sourceIdentityV31({ sourcePolicyId: String(evidence.sourcePolicyId), canonicalUrl: String(evidence.canonicalUrl), publisher: String(evidence.publisher), title: String(evidence.title), responseBodySha256: String(evidence.responseBodySha256) });
    evidence.sourceIdentityId = identity.id;
    evidence.sourceIdentitySha256 = identity.sha256;
    await writeBatch(item.root, 'tahadani-001', [item.question], [evidence], reportFor('tahadani-001', [item.question], [evidence]));
    const result = await validateQuestionPilotsV31(item.root);
    assert.ok(result.issues.some((issue) => issue.includes(`evidence:${evidence.packetId}`)));
  } finally { await item.cleanup(); }
});

test('one canonical URL cannot silently acquire conflicting publisher or title metadata', async () => {
  const item = await fixture();
  try {
    const second = factualArtifacts('tahadani-002');
    second.question.promptAr = 'ما اللفظ الذي يصف انتقالا منظما بين موضعين معلومين؟';
    second.evidence.title = 'Invented conflicting title';
    const identity = sourceIdentityV31({ sourcePolicyId: String(second.evidence.sourcePolicyId), canonicalUrl: String(second.evidence.canonicalUrl), publisher: String(second.evidence.publisher), title: String(second.evidence.title), responseBodySha256: String(second.evidence.responseBodySha256) });
    second.evidence.sourceIdentityId = identity.id;
    second.evidence.sourceIdentitySha256 = identity.sha256;
    await writeBatch(item.root, 'tahadani-002', [second.question], [second.evidence], reportFor('tahadani-002', [second.question], [second.evidence]));
    const result = await validateQuestionPilotsV31(item.root);
    assert.ok(result.issues.some((issue) => issue.includes(`evidence:${identity.id}`)));
  } finally { await item.cleanup(); }
});

test('body, excerpt, hashes, and byte-range locator are checked against actual bytes', async () => {
  const item = await fixture();
  try {
    const forgedBody = Buffer.from('Earth is our home planet. forged', 'utf8');
    await writeFile(evidenceBodyPath(item.bodyRoot, String((item.evidence.responseBody as Json).sha256)), forgedBody);
    const result = await validateQuestionPilotsV31(item.root);
    assert.ok(result.issues.some((issue) => issue.includes(`evidence:${item.evidence.packetId}`)));
  } finally { await item.cleanup(); }
});

test('accepted answers use normalized definite-article semantics and only supported target letters', async () => {
  const item = await fixture();
  try {
    let result = await validateQuestionPilotsV31(item.root);
    assert.deepEqual(result.issues, []);
    const question = clone(item.question);
    question.acceptDefiniteArticle = false;
    question.targetLetter = 'ة';
    await writeBatch(item.root, 'tahadani-001', [question], [item.evidence], reportFor('tahadani-001', [question], [item.evidence]));
    result = await validateQuestionPilotsV31(item.root);
    assert.ok(result.issues.some((issue) => issue.includes(`question:${question.id}`)));
  } finally { await item.cleanup(); }
});

test('canonical and accepted aliases cannot leak through the displayed header or prompt', async () => {
  const item = await fixture();
  try {
    const leaked = clone(item.question); leaked.headerAr = 'تلميح مباشر: الرِحلة، معروفة.';
    await writeBatch(item.root, 'tahadani-001', [leaked], [item.evidence], reportFor('tahadani-001', [leaked], [item.evidence]));
    const result = await validateQuestionPilotsV31(item.root);
    assert.ok(result.issues.some((issue) => issue.includes(`question:${leaked.id}`)));
  } finally { await item.cleanup(); }
});

test('short aliases fail closed for header leaks, prompt leaks, and cross-question aliases without substring false positives', async () => {
  const headerItem = await fixture();
  try {
    const leaked = clone(headerItem.question); leaked.canonicalAnswer = 'رق'; leaked.acceptedAnswers = ['رق']; leaked.targetLetter = 'ر'; leaked.headerAr = 'تلميح مباشر: رق';
    await writeBatch(headerItem.root, 'tahadani-001', [leaked], [headerItem.evidence], reportFor('tahadani-001', [leaked], [headerItem.evidence]));
    assert.ok((await validateQuestionPilotsV31(headerItem.root)).issues.some((issue) => issue.includes(`question:${leaked.id}`)));
  } finally { await headerItem.cleanup(); }

  const promptItem = await fixture();
  try {
    const leaked = clone(promptItem.question); leaked.canonicalAnswer = 'غص'; leaked.acceptedAnswers = ['غص']; leaked.targetLetter = 'غ'; leaked.promptAr = 'ما الكلمة التي تساوي غص في هذا التلميح؟';
    await writeBatch(promptItem.root, 'tahadani-001', [leaked], [promptItem.evidence], reportFor('tahadani-001', [leaked], [promptItem.evidence]));
    assert.ok((await validateQuestionPilotsV31(promptItem.root)).issues.some((issue) => issue.includes(`question:${leaked.id}`)));
  } finally { await promptItem.cleanup(); }

  const collisionItem = await fixture();
  try {
    const first = clone(collisionItem.question); first.canonicalAnswer = 'رق'; first.acceptedAnswers = ['رق']; first.targetLetter = 'ر'; first.headerAr = 'وصف مستقل'; first.promptAr = 'ما اللفظ المختصر المطلوب هنا؟';
    const second = factualArtifacts('tahadani-002'); second.question.canonicalAnswer = 'رحيل'; second.question.acceptedAnswers = ['رحيل', 'رق']; second.question.targetLetter = 'ر'; second.question.headerAr = 'وصف آخر'; second.question.promptAr = 'ما الاسم الذي يصف مغادرة منظمة؟';
    await writeBatch(collisionItem.root, 'tahadani-001', [first], [collisionItem.evidence], reportFor('tahadani-001', [first], [collisionItem.evidence]));
    await writeBatch(collisionItem.root, 'tahadani-002', [second.question], [second.evidence], reportFor('tahadani-002', [second.question], [second.evidence]));
    const result = await validateQuestionPilotsV31(collisionItem.root);
    assert.ok(result.issues.some((issue) => issue.includes('duplicate:answer-alias:رق:') && issue.includes(String(first.id)) && issue.includes(String(second.question.id))));
  } finally { await collisionItem.cleanup(); }

  const positiveItem = await fixture();
  try {
    const distinct = clone(positiveItem.question); distinct.canonicalAnswer = 'رق'; distinct.acceptedAnswers = ['رق']; distinct.targetLetter = 'ر'; distinct.headerAr = 'وصف رقيق لا يكشف الإجابة'; distinct.promptAr = 'ما اللفظ المختصر المطلوب هنا؟';
    await writeBatch(positiveItem.root, 'tahadani-001', [distinct], [positiveItem.evidence], reportFor('tahadani-001', [distinct], [positiveItem.evidence]));
    assert.deepEqual((await validateQuestionPilotsV31(positiveItem.root)).issues, []);
  } finally { await positiveItem.cleanup(); }
});

test('answer aliases collide globally across canonical and accepted fields, but intentional local variants remain allowed', async () => {
  const cases: Array<{ label: string; configure: (question: Json) => void }> = [
    { label: 'canonical-canonical', configure: (question) => { question.canonicalAnswer = 'رِحلة'; question.acceptedAnswers = ['الرِحلة']; } },
    { label: 'canonical-accepted', configure: (question) => { question.canonicalAnswer = 'ركوب'; question.acceptedAnswers = ['الركوب', 'الرِحلة']; } },
    { label: 'accepted-accepted', configure: (question) => { question.canonicalAnswer = 'رحيل'; question.acceptedAnswers = ['الرحيل', 'الرِحلة']; } },
  ];
  for (const entry of cases) {
    const item = await fixture();
    try {
      const second = factualArtifacts('tahadani-002'); second.question.promptAr = `ما اللفظ البديل في حالة ${entry.label}؟`; second.question.headerAr = 'سؤال مستقل';
      entry.configure(second.question);
      await writeBatch(item.root, 'tahadani-002', [second.question], [second.evidence], reportFor('tahadani-002', [second.question], [second.evidence]));
      const result = await validateQuestionPilotsV31(item.root);
      const collision = result.issues.find((issue) => issue.includes('duplicate:answer-alias:') && issue.includes(String(item.question.id)) && issue.includes(String(second.question.id)));
      assert.ok(collision, entry.label);
    } finally { await item.cleanup(); }
  }

  const item = await fixture();
  try {
    const first = clone(item.question); first.canonicalAnswer = 'البيت الكبير'; first.acceptedAnswers = ['البيت الكبير']; first.targetLetter = 'ب'; first.headerAr = 'وصف منزل واسع'; first.promptAr = 'ما الاسم الذي يصف مسكنا فسيحا ذا غرف كثيرة؟';
    const second = factualArtifacts('tahadani-002'); second.question.canonicalAnswer = 'البيتزا الكبيرة'; second.question.acceptedAnswers = ['البيتزا الكبيرة']; second.question.targetLetter = 'ب'; second.question.headerAr = 'وصف طعام مختلف: بيتزا، كبيرة'; second.question.promptAr = 'ما اسم طعام دائري يقدم ساخنا في المطاعم؟';
    await writeBatch(item.root, 'tahadani-001', [first], [item.evidence], reportFor('tahadani-001', [first], [item.evidence]));
    await writeBatch(item.root, 'tahadani-002', [second.question], [second.evidence], reportFor('tahadani-002', [second.question], [second.evidence]));
    const result = await validateQuestionPilotsV31(item.root);
    assert.deepEqual(result.issues, []);
  } finally { await item.cleanup(); }
});

test('difficulty score and level are derived from all four rubric axes', async () => {
  assert.equal(difficultyScoreV31({ familiarity: 5, clueDirectness: 4, domainSpecificity: 1, retrievalBurden: 1 }), 5);
  assert.equal(difficultyLevelV31(5), 'easy');
  assert.equal(difficultyLevelV31(10), 'medium');
  assert.equal(difficultyLevelV31(15), 'hard');
  const item = await fixture();
  try {
    const question = clone(item.question);
    (question.difficultyRationale as Json).score = 6;
    await writeBatch(item.root, 'tahadani-001', [question], [item.evidence], reportFor('tahadani-001', [question], [item.evidence]));
    const result = await validateQuestionPilotsV31(item.root);
    assert.ok(result.issues.some((issue) => issue.includes(`question:${question.id}`)));
  } finally { await item.cleanup(); }
});

test('dated questions and evidence must be checked, unexpired, and internally ordered', async () => {
  const item = await fixture();
  try {
    const question = clone(item.question);
    question.temporal = { kind: 'dated', checkedAt: '2026-09-04', validUntil: '2026-09-03' };
    const evidence = clone(item.evidence);
    evidence.freshness = { class: 'dated', validUntil: '2026-09-03' };
    await writeBatch(item.root, 'tahadani-001', [question], [evidence], reportFor('tahadani-001', [question], [evidence]));
    const result = await validateQuestionPilotsV31(item.root);
    assert.ok(result.issues.some((issue) => issue.includes(`question:${question.id}`)));
    assert.ok(result.issues.some((issue) => issue.includes(`evidence:${evidence.packetId}`)));
  } finally { await item.cleanup(); }
});

test('duplicate IDs and prompts are detected globally across category batches', async () => {
  const item = await fixture();
  try {
    const second = factualArtifacts('tahadani-002');
    second.question.id = item.question.id;
    await writeBatch(item.root, 'tahadani-002', [second.question], [second.evidence], reportFor('tahadani-002', [second.question], [second.evidence]));
    const result = await validateQuestionPilotsV31(item.root);
    assert.ok(result.issues.filter((issue) => issue.includes(`duplicate:${item.question.id}`)).length >= 2);
  } finally { await item.cleanup(); }
});

test('report counts, states, issues, identities, and canonical serialization are not trusted declarations', async () => {
  const item = await fixture();
  try {
    const forged = { ...item.report, questionCount: 99, states: { draft: 1, evidence_ready: 0, ready_for_human: 0 }, approved: 1 };
    const directory = join(item.root, 'tahadani-001');
    await writeFile(join(directory, 'batch-001.report.json'), JSON.stringify(forged, null, 2));
    const result = await validateQuestionPilotsV31(item.root);
    assert.ok(result.issues.some((issue) => issue.includes('report is not canonical and validator-derived')));
    assert.equal(result.questions, 1);
    assert.deepEqual(result.states, { draft: 0, evidence_ready: 0, ready_for_human: 1 });
    assert.equal(result.approved, 0);
  } finally { await item.cleanup(); }
});

test('JSONL requires canonical compact rows, LF separators, and a final LF', async () => {
  const item = await fixture();
  try {
    const path = join(item.root, 'tahadani-001', 'batch-001.questions.jsonl');
    await writeFile(path, JSON.stringify(item.question, null, 2));
    const result = await validateQuestionPilotsV31(item.root);
    assert.ok(result.issues.some((issue) => issue.includes('canonical UTF-8 JSONL')));
  } finally { await item.cleanup(); }
});

test('closed body references reject inline bytes, traversal-shaped fields, missing files, wrong digest/length, and bad locators', async () => {
  const item = await fixture();
  try {
    const packet = clone(item.evidence);
    packet.responseBodyBase64 = item.body.toString('base64');
    await writeBatch(item.root, 'tahadani-001', [item.question], [packet], reportFor('tahadani-001', [item.question], [packet]));
    assert.ok((await validateQuestionPilotsV31(item.root)).issues.some((issue) => issue.includes(`evidence:${packet.packetId}`)));

    const traversal = clone(item.evidence); traversal.responseBody = { ...(traversal.responseBody as Json), path: '../../outside.bin' };
    await writeBatch(item.root, 'tahadani-001', [item.question], [traversal], reportFor('tahadani-001', [item.question], [traversal]));
    assert.ok((await validateQuestionPilotsV31(item.root)).issues.some((issue) => issue.includes(`evidence:${traversal.packetId}`)));

    await rm(evidenceBodyPath(item.bodyRoot, String((item.evidence.responseBody as Json).sha256)));
    assert.ok((await validateQuestionPilotsV31(item.root)).issues.some((issue) => issue.includes(`evidence:${item.evidence.packetId}`)));
    await writeEvidenceBody(item.bodyRoot, item.body);

    const wrong = clone(item.evidence); wrong.responseBody = { ...(wrong.responseBody as Json), sha256: '0'.repeat(64) };
    await writeBatch(item.root, 'tahadani-001', [item.question], [wrong], reportFor('tahadani-001', [item.question], [wrong]));
    assert.ok((await validateQuestionPilotsV31(item.root)).issues.some((issue) => issue.includes(`evidence:${wrong.packetId}`)));

    const wrongLength = clone(item.evidence); wrongLength.responseBody = { ...(wrongLength.responseBody as Json), byteLength: item.body.byteLength + 1 };
    await writeBatch(item.root, 'tahadani-001', [item.question], [wrongLength], reportFor('tahadani-001', [item.question], [wrongLength]));
    assert.ok((await validateQuestionPilotsV31(item.root)).issues.some((issue) => issue.includes(`evidence:${wrongLength.packetId}`)));

    const wrongRange = clone(item.evidence); (wrongRange.locator as Json).endByte = item.body.byteLength + 1;
    await writeBatch(item.root, 'tahadani-001', [item.question], [wrongRange], reportFor('tahadani-001', [item.question], [wrongRange]));
    assert.ok((await validateQuestionPilotsV31(item.root)).issues.some((issue) => issue.includes(`evidence:${wrongRange.packetId}`)));
  } finally { await item.cleanup(); }
});

test('deduplicates each digest across packets, enforces both byte budgets, and rejects orphan blobs', async () => {
  const item = await fixture();
  try {
    const second = factualArtifacts('tahadani-002'); second.question.promptAr = 'ما اللفظ الذي يصف مسارا منظما بين موضعين معلومين؟'; second.question.canonicalAnswer = 'ركوب'; second.question.acceptedAnswers = ['الركوب'];
    await writeBatch(item.root, 'tahadani-002', [second.question], [second.evidence], reportFor('tahadani-002', [second.question], [second.evidence]));
    const valid = await validateQuestionPilotsV31(item.root);
    assert.deepEqual(valid.issues, []);
    const repeated = await inspectEvidenceBodies([{ key: 'one', batchKey: 'batch', responseBody: item.evidence.responseBody }, { key: 'two', batchKey: 'batch', responseBody: second.evidence.responseBody }], item.bodyRoot);
    assert.equal(repeated.bodies.size, 1);

    const max = Buffer.alloc(MAX_BODY_BYTES, 0x61); assert.doesNotThrow(() => responseBodyReference(max));
    assert.throws(() => responseBodyReference(Buffer.alloc(MAX_BODY_BYTES + 1)), /exceeds/);
    const records = [] as Array<{ key: string; batchKey: string; responseBody: unknown }>;
    for (let index = 0; index < 9; index += 1) {
      const body = Buffer.concat([Buffer.alloc(MAX_BODY_BYTES - 1, 0x61), Buffer.from([index])]);
      records.push({ key: `large-${index}`, batchKey: 'large', responseBody: await writeEvidenceBody(item.bodyRoot, body) });
    }
    const overBudget = await inspectEvidenceBodies(records, item.bodyRoot);
    assert.ok(overBudget.issues.some((issue) => issue.includes(String(MAX_UNIQUE_BODY_BYTES_PER_BATCH))));

    const orphan = Buffer.from('orphan', 'utf8'); const orphanRef = responseBodyReference(orphan);
    await mkdir(join(item.bodyRoot, 'sha256', orphanRef.sha256.slice(0, 2)), { recursive: true });
    await writeFile(evidenceBodyPath(item.bodyRoot, orphanRef.sha256), orphan);
    assert.ok((await validateQuestionPilotsV31(item.root)).issues.some((issue) => issue.includes('orphan')));
  } finally { await item.cleanup(); }
});

test('one-time migration preserves identity, locators, and excerpts while reducing duplicate inline storage', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'huroof-evidence-migration-'));
  const pilots = join(parent, 'pilots'); const bodies = join(parent, 'evidence-bodies'); const backups = join(parent, 'backups'); const staging = join(parent, 'staging');
  try {
    const first = factualArtifacts(); const second = factualArtifacts('tahadani-002'); second.question.promptAr = 'ما العبارة التي تصف انتقالا منظما بين نقطتين معلومتين؟'; second.question.canonicalAnswer = 'ركوب'; second.question.acceptedAnswers = ['الركوب'];
    for (const [category, artifact] of [['tahadani-001', first], ['tahadani-002', second]] as const) {
      const legacy = clone(artifact.evidence); legacy.responseBodyBase64 = artifact.body.toString('base64'); delete legacy.responseBody;
      await writeBatch(pilots, category, [artifact.question], [legacy], reportFor(category, [artifact.question], [legacy]));
    }
    const summary = await migratePilotEvidenceBodies({ pilotsRoot: pilots, bodyStoreRoot: bodies, backupRoot: backups, stagingRoot: staging });
    assert.equal(summary.packets, 2); assert.equal(summary.uniqueBodies, 1); assert.ok(summary.storedBytes < summary.inlineBytes);
    const migrated = JSON.parse((await readFile(join(pilots, 'tahadani-001', 'batch-001.evidence.jsonl'), 'utf8')).trim()) as Json;
    assert.equal(migrated.responseBodyBase64, undefined); assert.equal(migrated.responseBodySha256, first.evidence.responseBodySha256);
    const body = await readFile(evidenceBodyPath(bodies, String((migrated.responseBody as Json).sha256)));
    const locator = migrated.locator as Json; const excerpt = Buffer.from(String(migrated.excerptBase64), 'base64');
    assert.ok(body.subarray(Number(locator.startByte), Number(locator.endByte)).equals(excerpt));
    assert.ok(await readFile(join(summary.backupPath, 'tahadani-001', 'batch-001.evidence.jsonl')));
  } finally { await rm(parent, { recursive: true, force: true }); }
});
