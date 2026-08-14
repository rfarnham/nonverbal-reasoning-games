import {
  G1_SKILLS,
  getG1Skill,
  type G1SkillId,
} from "./g1-curriculum.ts";
import {
  factKeyForQuestion,
  factUniverseForSkill,
  g1AssessmentQuestionSetFingerprint,
  generateG1FactQuestion,
  generateG1Question,
  g1QuestionContentFingerprint,
  g1QuestionMathematicalFingerprint,
} from "./generator.ts";
import {
  deriveG1LearnerModel,
  isIndependentMasteryEvidence,
  masteryStateSatisfiesPrerequisite,
  RETENTION_INTERVAL_DAYS,
  type G1AttemptEvent,
  type G1DifficultyBand,
  type G1LearnerModel,
  type G1MasteryState,
  type RetentionIntervalDays,
} from "./mastery.ts";
import type { Domain, QuestionInstance } from "./types.ts";

export const DEFAULT_G1_SESSION_SIZE = 15;

export type G1SessionLane = "target" | "prerequisite" | "review";

export type G1RetryPolicy = Readonly<{
  retryUntilCorrect: true;
  firstUnassistedAttemptOnlyForMastery: true;
  maximumSameStructureAttempts: 3;
  suppressWrongScoreOnRetry: true;
}>;

export type G1RemediationMetadata = Readonly<{
  classifyMisconception: true;
  preserveOriginalFirstAttempt: true;
  distinguishRecognitionFailure: true;
  contrastiveItemCount: number;
  reProbeOriginalLater: true;
  reduceOneDifficultyDimensionAfterSimilarErrors: number;
  showWorkedExampleAfterSimilarErrors: number;
  moveToPrerequisiteAfterSameStructureAttempts: number;
}>;

export type G1SessionCard = Readonly<{
  id: string;
  position: number;
  lane: G1SessionLane;
  skillId: G1SkillId;
  question: QuestionInstance;
  surfaceForm: string;
  reason: string;
  retryOfCardId: string | null;
  retryNumber: number;
  retryPolicy: G1RetryPolicy;
  remediation: G1RemediationMetadata;
  /** Present when this card is the currently due spaced-retention probe. */
  retentionIntervalDays: RetentionIntervalDays | null;
}>;

export type G1SessionComposition = Readonly<{
  target: number;
  prerequisite: number;
  review: number;
}>;

export type G1SessionPlan = Readonly<{
  id: string;
  learnerId: string;
  seed: string;
  requestedTargetSkillId: G1SkillId;
  focusSkillId: G1SkillId;
  createdAt: number;
  targetCardCount: number;
  composition: G1SessionComposition;
  cards: readonly G1SessionCard[];
  modelAtBuild: G1LearnerModel;
}>;

export type BuildG1SessionPlanInput = Readonly<{
  learnerId?: string;
  targetSkillId: G1SkillId;
  seed: string;
  events: readonly G1AttemptEvent[];
  now?: number;
  count?: number;
}>;

export type BuildG1RemediationPlanInput = Readonly<{
  card: G1SessionCard;
  seed: string;
  similarErrorCount: number;
  recognitionFailure?: boolean;
}>;

export type G1RemediationPlan = Readonly<{
  sourceCardId: string;
  recognitionFailure: boolean;
  recordAsMathematicsMiss: boolean;
  retryOriginal: boolean;
  reduceDifficulty: boolean;
  showWorkedExample: boolean;
  moveToPrerequisite: boolean;
  /** Solved interstitial; never reuse this card as the interactive transfer. */
  workedExampleQuestion: QuestionInstance | null;
  contrastiveQuestions: readonly QuestionInstance[];
  reProbeSeed: string;
}>;

export const G1_GRADE_ASSESSMENT_ITEMS_PER_DOMAIN = 5;
export const G1_GRADE_ASSESSMENT_CARD_COUNT = 20;
export const G1_GRADE_ASSESSMENT_DOMAINS = [
  "addition",
  "subtraction",
  "multiplication",
  "division",
] as const satisfies readonly Domain[];

export type G1GradeAssessmentDomain =
  (typeof G1_GRADE_ASSESSMENT_DOMAINS)[number];

export type G1GradeAssessmentCard = Readonly<{
  id: string;
  position: number;
  domain: G1GradeAssessmentDomain;
  skillId: G1SkillId;
  question: QuestionInstance;
}>;

export type G1GradeAssessmentPlan = Readonly<{
  assessmentId: string;
  planFingerprint: string;
  learnerId: string;
  seed: string;
  createdAt: number;
  eligible: boolean;
  eligibility: Readonly<{
    allCoreFluent: boolean;
    retentionRequirementMet: boolean;
  }>;
  domainCounts: Readonly<Record<G1GradeAssessmentDomain, number>>;
  cards: readonly G1GradeAssessmentCard[];
}>;

export type BuildG1GradeAssessmentPlanInput = Readonly<{
  learnerId?: string;
  seed: string;
  events?: readonly G1AttemptEvent[];
  now?: number;
}>;

const RETRY_POLICY: G1RetryPolicy = Object.freeze({
  retryUntilCorrect: true,
  firstUnassistedAttemptOnlyForMastery: true,
  maximumSameStructureAttempts: 3,
  suppressWrongScoreOnRetry: true,
});

const REMEDIATION_METADATA: G1RemediationMetadata = Object.freeze({
  classifyMisconception: true,
  preserveOriginalFirstAttempt: true,
  distinguishRecognitionFailure: true,
  contrastiveItemCount: 1,
  reProbeOriginalLater: true,
  reduceOneDifficultyDimensionAfterSimilarErrors: 2,
  showWorkedExampleAfterSimilarErrors: 2,
  moveToPrerequisiteAfterSameStructureAttempts: 3,
});

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must be non-empty.`);
  return normalized;
}

function checkedTime(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Session creation time must be finite and non-negative.");
  }
  return value;
}

function checkedCount(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new RangeError("Session count must be an integer from 1 through 100.");
  }
  return value;
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function createRandom(seed: string): () => number {
  let state = stableHash(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function deterministicShuffle<T>(values: readonly T[], seed: string): T[] {
  const random = createRandom(seed);
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

/** Largest-remainder allocation keeps the ratios honest for configurable sizes. */
export function g1SessionComposition(
  count = DEFAULT_G1_SESSION_SIZE,
  targetAlreadyFluent = false,
): G1SessionComposition {
  const size = checkedCount(count);
  const ratios = targetAlreadyFluent
    ? { target: 0.35, prerequisite: 0.25, review: 0.4 }
    : { target: 0.6, prerequisite: 0.25, review: 0.15 };
  const entries = Object.entries(ratios) as [keyof G1SessionComposition, number][];
  const result: Record<keyof G1SessionComposition, number> = {
    target: 0,
    prerequisite: 0,
    review: 0,
  };
  const remainders = entries.map(([key, ratio]) => {
    const exact = ratio * size;
    result[key] = Math.floor(exact);
    return { key, remainder: exact - Math.floor(exact) };
  });
  let remaining = size - Object.values(result).reduce((sum, value) => sum + value, 0);
  remainders.sort(
    (left, right) =>
      right.remainder - left.remainder ||
      entries.findIndex(([key]) => key === left.key) -
        entries.findIndex(([key]) => key === right.key),
  );
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    result[remainders[index % remainders.length]!.key] += 1;
  }
  return Object.freeze(result);
}

function stateAlreadyFluent(state: G1MasteryState): boolean {
  return state === "FLUENT" || state === "RETAINED" || state === "REVIEW_DUE";
}

function closestAvailablePrerequisite(
  skillId: G1SkillId,
  model: G1LearnerModel,
): G1SkillId {
  const skill = getG1Skill(skillId);
  for (const prerequisite of skill.prerequisites) {
    const id = prerequisite as G1SkillId;
    const state = model.skills[id].state;
    if (!masteryStateSatisfiesPrerequisite(state)) {
      return model.skills[id].unlocked
        ? id
        : closestAvailablePrerequisite(id, model);
    }
  }
  return skillId;
}

function nextFrontier(targetSkillId: G1SkillId, model: G1LearnerModel): G1SkillId {
  const directDependent = G1_SKILLS.find(
    (skill) =>
      skill.tier === "core" &&
      skill.prerequisites.includes(targetSkillId) &&
      model.skills[skill.id as G1SkillId].unlocked &&
      !stateAlreadyFluent(model.skills[skill.id as G1SkillId].state),
  );
  if (directDependent) return directDependent.id as G1SkillId;
  const anyFrontier = G1_SKILLS.find(
    (skill) =>
      skill.tier === "core" &&
      model.skills[skill.id as G1SkillId].unlocked &&
      !stateAlreadyFluent(model.skills[skill.id as G1SkillId].state),
  );
  return (anyFrontier?.id ?? targetSkillId) as G1SkillId;
}

function prerequisitePool(focusSkillId: G1SkillId, model: G1LearnerModel): G1SkillId[] {
  const focus = getG1Skill(focusSkillId);
  const direct = focus.prerequisites.map((id) => id as G1SkillId);
  const focusIndex = G1_SKILLS.findIndex(({ id }) => id === focusSkillId);
  const neighbors = G1_SKILLS.filter(
    (skill, index) =>
      skill.domain === focus.domain &&
      Math.abs(index - focusIndex) <= 2 &&
      skill.id !== focusSkillId &&
      model.skills[skill.id as G1SkillId].unlocked,
  ).map(({ id }) => id as G1SkillId);
  return [...new Set([...direct, ...neighbors])].filter(
    (id) => model.skills[id].state !== "LOCKED",
  );
}

function reviewPool(model: G1LearnerModel): G1SkillId[] {
  const due = G1_SKILLS.filter(
    ({ id }) => model.skills[id as G1SkillId].state === "REVIEW_DUE",
  ).map(({ id }) => id as G1SkillId);
  const incompleteFactUniverses = G1_SKILLS.filter(({ id }) => {
    const view = model.skills[id as G1SkillId];
    return view.factUniverseSize > 0 &&
      !view.factUniverseComplete &&
      masteryStateSatisfiesPrerequisite(view.state);
  }).map(({ id }) => id as G1SkillId);
  if (due.length || incompleteFactUniverses.length) {
    return [...new Set([...due, ...incompleteFactUniverses])];
  }
  return G1_SKILLS.filter(({ id }) =>
    masteryStateSatisfiesPrerequisite(model.skills[id as G1SkillId].state),
  ).map(({ id }) => id as G1SkillId);
}

function cyclePool(pool: readonly G1SkillId[], count: number, seed: string): G1SkillId[] {
  if (!pool.length) return [];
  const ordered = deterministicShuffle(pool, seed);
  return Array.from({ length: count }, (_, index) => ordered[index % ordered.length]!);
}

function surfaceForm(question: QuestionInstance, orientation: "horizontal" | "vertical"): string {
  const explicit = question.difficultyFeatures.surfaceForm;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const prompt = question.promptAst as unknown as Record<string, unknown>;
  const kind = typeof prompt.kind === "string" ? prompt.kind : "arithmetic";
  const representation =
    (typeof prompt.representation === "string" ? prompt.representation : null) ??
    question.difficultyFeatures.representation;
  return `${kind}:${typeof representation === "string" ? representation : orientation}`;
}

function cardReason(lane: G1SessionLane, state: G1MasteryState): string {
  if (lane === "target") return "Current learning target";
  if (lane === "review") return state === "REVIEW_DUE" ? "Spaced review due" : "Cumulative review";
  return "Immediate prerequisite or neighboring transfer";
}

type PendingCard = Readonly<{ lane: G1SessionLane; skillId: G1SkillId }>;

function isWrittenSkill(skillId: G1SkillId): boolean {
  return getG1Skill(skillId).masteryProfile === "ALGO_LONG";
}

function ensureWrittenMixIsFeasible(
  cards: readonly PendingCard[],
  model: G1LearnerModel,
  focusSkillId: G1SkillId,
  seed: string,
): PendingCard[] {
  const result = [...cards];
  const focus = getG1Skill(focusSkillId);
  const replacements = deterministicShuffle(
    G1_SKILLS.filter(
      (skill) =>
        skill.tier === "core" &&
        !isWrittenSkill(skill.id as G1SkillId) &&
        model.skills[skill.id as G1SkillId].unlocked,
    )
      .sort((left, right) => {
        const leftPriority = focus.prerequisites.includes(left.id)
          ? 0
          : left.domain === focus.domain ? 1 : 2;
        const rightPriority = focus.prerequisites.includes(right.id)
          ? 0
          : right.domain === focus.domain ? 1 : 2;
        return leftPriority - rightPriority || left.id.localeCompare(right.id);
      })
      .map(({ id }) => id as G1SkillId),
    `${seed}:written-replacements`,
  );
  if (replacements.length === 0) return result;

  let replacementIndex = 0;
  const writtenCount = () => result.filter(({ skillId }) => isWrittenSkill(skillId)).length;
  while (writtenCount() > 2 * (result.length - writtenCount() + 1)) {
    const replaceAt = result
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => isWrittenSkill(card.skillId))
      .sort((left, right) => {
        const priority = (lane: G1SessionLane) =>
          lane === "prerequisite" ? 0 : lane === "review" ? 1 : 2;
        return priority(left.card.lane) - priority(right.card.lane) ||
          right.index - left.index;
      })[0]?.index;
    if (replaceAt === undefined) break;
    result[replaceAt] = Object.freeze({
      ...result[replaceAt]!,
      skillId: replacements[replacementIndex % replacements.length]!,
    });
    replacementIndex += 1;
  }
  return result;
}

function arrangeWithoutLaneClumps(cards: readonly PendingCard[], seed: string): PendingCard[] {
  const remaining = deterministicShuffle(cards, seed);
  const arranged: PendingCard[] = [];
  while (remaining.length) {
    const recent = arranged.slice(-3);
    const blockedLane =
      recent.length === 3 && recent.every(({ lane }) => lane === recent[0]!.lane)
        ? recent[0]!.lane
        : null;
    const candidateIndex = remaining.findIndex(({ lane }) => lane !== blockedLane);
    arranged.push(remaining.splice(candidateIndex < 0 ? 0 : candidateIndex, 1)[0]!);
  }
  return arranged;
}

function generateUniqueQuestion(
  skillId: G1SkillId,
  seed: string,
  band: G1DifficultyBand,
  orientation: "horizontal" | "vertical",
  contentCounts: Map<string, number>,
  mathematicalCounts: Map<string, number>,
  recentContent: readonly string[],
  recentMathematics: readonly string[],
): QuestionInstance {
  let leastUsed: Readonly<{
    question: QuestionInstance;
    contentFingerprint: string;
    mathematicalFingerprint: string;
    contentCount: number;
    mathematicalCount: number;
  }> | null = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const question = generateG1Question({
      skillId,
      seed: attempt === 0 ? seed : `${seed}:candidate:${attempt}`,
      difficultyBand: band,
      orientation,
    });
    const contentFingerprint = g1QuestionContentFingerprint(question);
    const mathematicalFingerprint = g1QuestionMathematicalFingerprint(question);
    const contentCount = contentCounts.get(contentFingerprint) ?? 0;
    const mathematicalCount = mathematicalCounts.get(mathematicalFingerprint) ?? 0;
    if (
      recentContent.includes(contentFingerprint) ||
      recentMathematics.includes(mathematicalFingerprint) ||
      contentCount >= 3
    ) continue;
    if (contentCount === 0 && mathematicalCount === 0) {
      contentCounts.set(contentFingerprint, 1);
      mathematicalCounts.set(mathematicalFingerprint, 1);
      return question;
    }
    if (
      leastUsed === null ||
      mathematicalCount < leastUsed.mathematicalCount ||
      (mathematicalCount === leastUsed.mathematicalCount &&
        contentCount < leastUsed.contentCount)
    ) {
      leastUsed = {
        question,
        contentFingerprint,
        mathematicalFingerprint,
        contentCount,
        mathematicalCount,
      };
    }
  }
  if (leastUsed !== null) {
    contentCounts.set(leastUsed.contentFingerprint, leastUsed.contentCount + 1);
    mathematicalCounts.set(
      leastUsed.mathematicalFingerprint,
      leastUsed.mathematicalCount + 1,
    );
    return leastUsed.question;
  }
  throw new Error(`Unable to build a non-repetitive session for ${skillId}.`);
}

function generateUnseenFactQuestion(
  skillId: G1SkillId,
  seed: string,
  orientation: "horizontal" | "vertical",
  unseenFactKeys: readonly string[],
  contentCounts: Map<string, number>,
  mathematicalCounts: Map<string, number>,
  recentContent: readonly string[],
  recentMathematics: readonly string[],
): QuestionInstance | null {
  for (const factKey of deterministicShuffle(unseenFactKeys, `${seed}:unseen-facts`)) {
    const question = generateG1FactQuestion({ skillId, factKey, seed, orientation });
    const contentFingerprint = g1QuestionContentFingerprint(question);
    const mathematicalFingerprint = g1QuestionMathematicalFingerprint(question);
    const count = contentCounts.get(contentFingerprint) ?? 0;
    if (
      recentContent.includes(contentFingerprint) ||
      recentMathematics.includes(mathematicalFingerprint) ||
      count >= 3
    ) continue;
    contentCounts.set(contentFingerprint, count + 1);
    mathematicalCounts.set(
      mathematicalFingerprint,
      (mathematicalCounts.get(mathematicalFingerprint) ?? 0) + 1,
    );
    return question;
  }
  return null;
}

function isWrittenCard(card: G1SessionCard): boolean {
  return getG1Skill(card.skillId).masteryProfile === "ALGO_LONG";
}

function enforceSurfaceLimit(cards: readonly G1SessionCard[]): G1SessionCard[] {
  const sequenceLimitsSatisfied = (ordered: readonly G1SessionCard[]) =>
    ordered.every((card, index) => {
      const priorThree = ordered.slice(Math.max(0, index - 3), index);
      const priorTwo = ordered.slice(Math.max(0, index - 2), index);
      const mathematicalFingerprint = g1QuestionMathematicalFingerprint(card.question);
      return !(
        priorThree.length === 3 &&
        priorThree.every(({ surfaceForm }) => surfaceForm === card.surfaceForm)
      ) && !(
        priorThree.length === 3 &&
        priorThree.every(({ lane }) => lane === card.lane)
      ) && !(
        priorTwo.length === 2 &&
        isWrittenCard(card) &&
        priorTwo.every(isWrittenCard)
      ) && !priorTwo.some(
        (prior) => g1QuestionMathematicalFingerprint(prior.question) === mathematicalFingerprint,
      );
    });
  if (sequenceLimitsSatisfied(cards)) {
    return cards.map((card, position) => Object.freeze({
      ...card,
      position,
      id: `${card.id.split(":card:")[0]}:card:${position}`,
    }));
  }
  let searchNodes = 0;
  const search = (
    remaining: readonly G1SessionCard[],
    arranged: readonly G1SessionCard[],
  ): readonly G1SessionCard[] | null => {
    searchNodes += 1;
    if (searchNodes > 250_000) return null;
    if (remaining.length === 0) return arranged;
    const lastThree = arranged.slice(-3);
    const blockedSurface =
      lastThree.length === 3 &&
      lastThree.every(({ surfaceForm: form }) => form === lastThree[0]!.surfaceForm)
        ? lastThree[0]!.surfaceForm
        : null;
    const blockedLane =
      lastThree.length === 3 &&
      lastThree.every(({ lane }) => lane === lastThree[0]!.lane)
        ? lastThree[0]!.lane
        : null;
    const writtenBlocked = arranged.length >= 2 && arranged.slice(-2).every(isWrittenCard);
    const recentMathematics = new Set(
      arranged.slice(-2).map(({ question }) => g1QuestionMathematicalFingerprint(question)),
    );
    const seenMathematics = new Set(
      arranged.map(({ question }) => g1QuestionMathematicalFingerprint(question)),
    );
    const counts = (card: G1SessionCard) =>
      remaining.filter((candidate) => candidate.surfaceForm === card.surfaceForm).length * 100 +
      remaining.filter((candidate) => candidate.lane === card.lane).length * 10 +
      (isWrittenCard(card) ? remaining.filter(isWrittenCard).length : 0);
    const candidatesWithoutRecentMathematics = remaining
      .map((card, index) => ({ card, index }))
      .filter(({ card }) =>
        card.surfaceForm !== blockedSurface &&
        card.lane !== blockedLane &&
        (!writtenBlocked || !isWrittenCard(card)) &&
        !recentMathematics.has(g1QuestionMathematicalFingerprint(card.question)),
      );
    const candidates = candidatesWithoutRecentMathematics.sort((left, right) => {
      const leftSeen = seenMathematics.has(
        g1QuestionMathematicalFingerprint(left.card.question),
      );
      const rightSeen = seenMathematics.has(
        g1QuestionMathematicalFingerprint(right.card.question),
      );
      return Number(leftSeen) - Number(rightSeen) ||
        counts(right.card) - counts(left.card) ||
        left.index - right.index;
    });
    for (const { card, index } of candidates) {
      const resolved = search(
        [...remaining.slice(0, index), ...remaining.slice(index + 1)],
        [...arranged, card],
      );
      if (resolved !== null) return resolved;
    }
    return null;
  };
  const arranged = search(cards, []);
  if (arranged === null) {
    throw new Error("Unable to satisfy Grade 1 session sequencing limits.");
  }
  return arranged.map((card, position) =>
    Object.freeze({
      ...card,
      position,
      id: `${card.id.split(":card:")[0]}:card:${position}`,
    }),
  );
}

function assessmentQuestion(
  skillId: G1SkillId,
  seed: string,
  band: 3 | 4,
  orientation: "horizontal" | "vertical",
  seen: Set<string>,
): QuestionInstance {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const question = generateG1Question({
      skillId,
      seed: attempt === 0 ? seed : `${seed}:candidate:${attempt}`,
      difficultyBand: band,
      orientation,
    });
    const fingerprint = g1QuestionMathematicalFingerprint(question);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    return question;
  }
  throw new Error(`Unable to build a unique Grade 1 assessment card for ${skillId}.`);
}

/**
 * Deterministic cumulative assessment: five unique, core-only band 3/4 cards
 * in each of the four Grade 1 arithmetic domains.
 */
export function buildG1GradeAssessmentPlan(
  input: BuildG1GradeAssessmentPlanInput,
): G1GradeAssessmentPlan {
  const seed = requiredText(input.seed, "Assessment seed");
  const events = input.events ?? [];
  const learnerId = input.learnerId?.trim() || events[0]?.learnerId || "device-learner";
  const now = checkedTime(input.now ?? Date.now());
  const model = deriveG1LearnerModel(events, now, learnerId);
  const assessmentBaseId = `g1-assessment:${stableHash(`${learnerId}:${seed}`).toString(36)}`;
  const seen = new Set<string>();
  const byDomain = new Map<G1GradeAssessmentDomain, G1GradeAssessmentCard[]>();
  for (const domain of G1_GRADE_ASSESSMENT_DOMAINS) {
    const skillPool = deterministicShuffle(
      G1_SKILLS.filter((skill) => skill.tier === "core" && skill.domain === domain)
        .map((skill) => skill.id as G1SkillId),
      `${seed}:${domain}:skills`,
    );
    if (skillPool.length === 0) throw new Error(`Grade 1 has no core ${domain} assessment skills.`);
    const cards = Array.from(
      { length: G1_GRADE_ASSESSMENT_ITEMS_PER_DOMAIN },
      (_, domainIndex): G1GradeAssessmentCard => {
        const skillId = skillPool[domainIndex % skillPool.length]!;
        const band = (domainIndex % 2 === 0 ? 3 : 4) as 3 | 4;
        const question = assessmentQuestion(
          skillId,
          `${seed}:${domain}:${domainIndex}`,
          band,
          domainIndex % 2 === 0 ? "horizontal" : "vertical",
          seen,
        );
        return {
          id: `${assessmentBaseId}:draft:${domain}:${domainIndex}`,
          position: -1,
          domain,
          skillId,
          question,
        };
      },
    );
    byDomain.set(domain, cards);
  }
  const cards: G1GradeAssessmentCard[] = [];
  for (let round = 0; round < G1_GRADE_ASSESSMENT_ITEMS_PER_DOMAIN; round += 1) {
    const domainOrder = deterministicShuffle(
      G1_GRADE_ASSESSMENT_DOMAINS,
      `${seed}:assessment-domain-order:${round}`,
    );
    for (const domain of domainOrder) cards.push(byDomain.get(domain)![round]!);
  }
  const planFingerprint = g1AssessmentQuestionSetFingerprint(
    cards.map(({ question }) => question),
  );
  const assessmentId = `${assessmentBaseId}:${planFingerprint}`;
  const positioned = Object.freeze(cards.map((card, position) => Object.freeze({
    ...card,
    id: `${assessmentId}:card:${position}`,
    position,
  })));
  const domainCounts = Object.freeze(Object.fromEntries(
    G1_GRADE_ASSESSMENT_DOMAINS.map((domain) => [domain, G1_GRADE_ASSESSMENT_ITEMS_PER_DOMAIN]),
  ) as Record<G1GradeAssessmentDomain, number>);
  const eligibility = Object.freeze({
    allCoreFluent: model.grade.allCoreFluent,
    retentionRequirementMet: model.grade.retentionRequirementMet,
  });
  return Object.freeze({
    assessmentId,
    planFingerprint,
    learnerId,
    seed,
    createdAt: now,
    // The cumulative check becomes available at fluency. Retention remains a
    // separate grade-completion gate and may mature after the assessment.
    eligible: eligibility.allCoreFluent,
    eligibility,
    domainCounts,
    cards: positioned,
  });
}

export function buildG1SessionPlan(input: BuildG1SessionPlanInput): G1SessionPlan {
  const seed = requiredText(input.seed, "Session seed");
  getG1Skill(input.targetSkillId);
  const learnerId = input.learnerId?.trim() || input.events[0]?.learnerId || "device-learner";
  const now = checkedTime(input.now ?? Date.now());
  const count = checkedCount(input.count ?? DEFAULT_G1_SESSION_SIZE);
  const model = deriveG1LearnerModel(input.events, now, learnerId);
  const requestedState = model.skills[input.targetSkillId].state;
  const unlockedFocus = closestAvailablePrerequisite(input.targetSkillId, model);
  const requestedFactUniverseIncomplete =
    model.skills[input.targetSkillId].factUniverseSize > 0 &&
    !model.skills[input.targetSkillId].factUniverseComplete;
  const focusSkillId = stateAlreadyFluent(requestedState) && !requestedFactUniverseIncomplete
    ? nextFrontier(unlockedFocus, model)
    : unlockedFocus;
  const composition = g1SessionComposition(count, stateAlreadyFluent(requestedState));
  const prerequisiteSkills = prerequisitePool(focusSkillId, model);
  const reviewSkills = reviewPool(model);
  const rawPending: PendingCard[] = [
    ...cyclePool([focusSkillId], composition.target, `${seed}:target`).map((skillId) => ({
      lane: "target" as const,
      skillId,
    })),
    ...cyclePool(
      prerequisiteSkills.length ? prerequisiteSkills : [focusSkillId],
      composition.prerequisite,
      `${seed}:prerequisite`,
    ).map((skillId) => ({ lane: "prerequisite" as const, skillId })),
    ...cyclePool(
      reviewSkills.length ? reviewSkills : [focusSkillId],
      composition.review,
      `${seed}:review`,
    ).map((skillId) => ({ lane: "review" as const, skillId })),
  ];
  const pending = ensureWrittenMixIsFeasible(
    rawPending,
    model,
    focusSkillId,
    seed,
  );
  const arranged = arrangeWithoutLaneClumps(pending, `${seed}:lane-order`);
  const sessionId = `g1:${stableHash(`${learnerId}:${input.targetSkillId}:${seed}`).toString(36)}`;
  const contentCounts = new Map<string, number>();
  const mathematicalCounts = new Map<string, number>();
  const contentHistory: string[] = [];
  const mathematicalHistory: string[] = [];
  const presentedFactKeys = new Map<G1SkillId, Set<string>>();
  for (const event of input.events) {
    if (
      event.learnerId !== learnerId ||
      !isIndependentMasteryEvidence(event) ||
      event.factKey === null
    ) continue;
    const skillFacts = presentedFactKeys.get(event.skillId) ?? new Set<string>();
    skillFacts.add(event.factKey);
    presentedFactKeys.set(event.skillId, skillFacts);
  }
  const generated = arranged.map(({ lane, skillId }, position): G1SessionCard => {
    const stateBand = model.skills[skillId].currentBand;
    const band = Math.max(
      1,
      Math.min(4, position % 3 === 1 ? stateBand - 1 : stateBand),
    ) as G1DifficultyBand;
    const orientation = position % 2 === 0 ? "horizontal" : "vertical";
    const questionSeed = `${seed}:card:${position}:${lane}:${skillId}`;
    const factUniverse = factUniverseForSkill(skillId);
    const presentedForSkill = presentedFactKeys.get(skillId) ?? new Set<string>();
    const unseenFactKeys = factUniverse.filter((factKey) => !presentedForSkill.has(factKey));
    const shouldCompleteFactUniverse =
      unseenFactKeys.length > 0 &&
      ["FLUENT", "REVIEW_DUE"].includes(model.skills[skillId].state);
    const question =
      (shouldCompleteFactUniverse
        ? generateUnseenFactQuestion(
            skillId,
            questionSeed,
            orientation,
            unseenFactKeys,
            contentCounts,
            mathematicalCounts,
            contentHistory.slice(-2),
            mathematicalHistory.slice(-2),
          )
        : null) ??
      generateUniqueQuestion(
        skillId,
        questionSeed,
        band,
        orientation,
        contentCounts,
        mathematicalCounts,
        contentHistory.slice(-2),
        mathematicalHistory.slice(-2),
      );
    const plannedFactKey = factKeyForQuestion(question);
    if (plannedFactKey !== null && factUniverse.includes(plannedFactKey)) {
      presentedForSkill.add(plannedFactKey);
      presentedFactKeys.set(skillId, presentedForSkill);
    }
    contentHistory.push(g1QuestionContentFingerprint(question));
    mathematicalHistory.push(g1QuestionMathematicalFingerprint(question));
    return Object.freeze({
      id: `${sessionId}:card:${position}`,
      position,
      lane,
      skillId,
      question,
      surfaceForm: surfaceForm(question, question.orientation),
      reason: cardReason(lane, model.skills[skillId].state),
      retryOfCardId: null,
      retryNumber: 0,
      retryPolicy: RETRY_POLICY,
      remediation: REMEDIATION_METADATA,
      retentionIntervalDays:
        lane === "review" && model.skills[skillId].state === "REVIEW_DUE"
          ? (RETENTION_INTERVAL_DAYS[
              model.skills[skillId].completedRetentionIntervals.length
            ] ?? null)
          : null,
    });
  });
  const cards = Object.freeze(enforceSurfaceLimit(generated));
  return Object.freeze({
    id: sessionId,
    learnerId,
    seed,
    requestedTargetSkillId: input.targetSkillId,
    focusSkillId,
    createdAt: now,
    targetCardCount: count,
    composition,
    cards,
    modelAtBuild: model,
  });
}

export function createG1RetryCard(
  card: G1SessionCard,
  retryNumber: number,
): G1SessionCard {
  if (!Number.isInteger(retryNumber) || retryNumber < 1) {
    throw new RangeError("Retry number must be a positive integer.");
  }
  return Object.freeze({
    ...card,
    id: `${card.id}:retry:${retryNumber}`,
    retryOfCardId: card.retryOfCardId ?? card.id,
    retryNumber,
  });
}

export function buildG1RemediationPlan(
  input: BuildG1RemediationPlanInput,
): G1RemediationPlan {
  const seed = requiredText(input.seed, "Remediation seed");
  const count = Math.max(0, Math.floor(input.similarErrorCount));
  const recognitionFailure = input.recognitionFailure ?? false;
  if (recognitionFailure) {
    return Object.freeze({
      sourceCardId: input.card.id,
      recognitionFailure: true,
      recordAsMathematicsMiss: false,
      retryOriginal: true,
      reduceDifficulty: false,
      showWorkedExample: false,
      moveToPrerequisite: false,
      workedExampleQuestion: null,
      contrastiveQuestions: [],
      reProbeSeed: `${seed}:recognition-retry`,
    });
  }
  const reduceDifficulty = count >= 2;
  const sourceSkill = getG1Skill(input.card.skillId);
  const prerequisite = sourceSkill.prerequisites[0] as G1SkillId | undefined;
  const moveToPrerequisite = count >= 3 && prerequisite !== undefined;
  const remediationSkillId = moveToPrerequisite && prerequisite
    ? prerequisite
    : input.card.skillId;
  const band = Math.max(
    1,
    input.card.question.difficultyBand - (reduceDifficulty ? 1 : 0),
  ) as G1DifficultyBand;
  const distinctQuestion = (
    purpose: "worked" | "contrastive",
    blocked: ReadonlySet<string>,
  ): QuestionInstance => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const question = generateG1Question({
      skillId: remediationSkillId,
        seed: `${seed}:${purpose}:${attempt}`,
      difficultyBand: band,
      orientation: "horizontal",
      });
      if (!blocked.has(g1QuestionMathematicalFingerprint(question))) return question;
    }
    throw new Error(`Unable to build distinct ${purpose} remediation for ${remediationSkillId}.`);
  };
  const sourceFingerprint = g1QuestionMathematicalFingerprint(input.card.question);
  const workedExampleQuestion = count >= 2
    ? distinctQuestion("worked", new Set([sourceFingerprint]))
    : null;
  const blocked = new Set([sourceFingerprint]);
  if (workedExampleQuestion) {
    blocked.add(g1QuestionMathematicalFingerprint(workedExampleQuestion));
  }
  const contrastiveQuestions = [distinctQuestion("contrastive", blocked)];
  return Object.freeze({
    sourceCardId: input.card.id,
    recognitionFailure: false,
    recordAsMathematicsMiss: true,
    retryOriginal: true,
    reduceDifficulty,
    showWorkedExample: count >= 2,
    moveToPrerequisite,
    workedExampleQuestion,
    contrastiveQuestions: Object.freeze(contrastiveQuestions),
    reProbeSeed: `${seed}:re-probe:${input.card.question.seed}`,
  });
}

/** UI-friendly alias: generation is internal and deterministic from the seed. */
export const buildPracticeSession = buildG1SessionPlan;
