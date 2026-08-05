import { generateProblem } from "./problems.ts";
import {
  createAdaptiveRandom,
  deriveAdaptiveSeed,
  randomIntBetween,
  stableSeedToken,
} from "./random.ts";
import {
  enabledDefaultSkillIds,
  skillDefinition,
  skillPrerequisitesMet,
} from "./skills.ts";
import type {
  AdaptiveSessionPlan,
  AttemptEvent,
  ErrorCode,
  GeneratedProblem,
  LearnerSkillState,
  PlannedCard,
  PlaceValueQuestion,
  ProblemAnswer,
  SessionLane,
  SessionKind,
  SkillId,
} from "./types.ts";

export const SHORT_SESSION_CARD_COUNT = 8;
export const STANDARD_SESSION_CARD_COUNT = 10;
export const MAX_ADAPTIVE_SESSION_CARDS = 14;
export const MAX_CARDS_PER_NARROW_SKILL = 4;
/**
 * Normal plans leave one slot free so a miss can still receive a fresh retry
 * without breaking the four-card narrow-skill ceiling.
 */
export const MAX_INITIAL_PRACTICE_CARDS_PER_NARROW_SKILL = 3;
export const MAX_CONSECUTIVE_IDENTICAL_TEMPLATES = 2;

const SHORT_SESSION_ACTIVE_MS = 8 * 60 * 1_000;
const STANDARD_SESSION_ACTIVE_MS = 12 * 60 * 1_000;

export type AdaptiveSkillStateMap = Readonly<
  Partial<Record<SkillId, LearnerSkillState>>
>;

export interface AdaptivePlanInput {
  learnerId: string;
  seed: string;
  createdAt: number;
  skillStates: AdaptiveSkillStateMap;
  recentFingerprints?: readonly string[];
  /** Append-only evidence used to derive one bounded unresolved carryover. */
  attemptEvents?: readonly AttemptEvent[];
  dueReviewSkillIds?: readonly SkillId[];
  sessionLength?: "short" | "standard";
  diagnosticSessionNumber?: 1 | 2 | 3;
  optionalChallengeEnabled?: boolean;
  focusSkillId?: SkillId;
  maxActiveDurationMs?: number;
  /** Benchmark plans look like practice and never choose or gate a focus skill. */
  sessionKind?: SessionKind;
  /** Two recent fatigue-shortened sessions make the next normal plan shorter. */
  recentFatigueSessionCount?: number;
}

export interface ClassifyAdaptiveErrorInput {
  problem: GeneratedProblem;
  answer: ProblemAnswer | null;
  rawAnswerText?: string | null;
  recognitionUncertain?: boolean;
  recognitionConfirmedByChild?: boolean;
}

export interface RemediationDecisionInput {
  problem: Pick<GeneratedProblem, "skillId" | "metadata" | "seed">;
  errorCode: ErrorCode;
  recentComparableAttempts?: readonly AttemptEvent[];
  seed?: string;
}

export interface RemediationDecision {
  probeSkillId: SkillId | null;
  probeSkillIds: readonly SkillId[];
  scaffoldCount: 0 | 1 | 2;
  retryDelay: 2 | 3 | 4;
  repeatedPattern: boolean;
}

export interface ReplanAfterAttemptInput {
  plan: AdaptiveSessionPlan;
  cardIndex: number;
  attempt: AttemptEvent;
  recentComparableAttempts?: readonly AttemptEvent[];
  recentFingerprints?: readonly string[];
  /** Fatigue takes priority over remediation and sends the reducer to a close. */
  fatigueDetected?: boolean;
}

export type FatigueSignal =
  | "two_consecutive_skips"
  | "explicit_fatigue_error"
  | "late_accuracy_drop"
  | "late_response_slowdown"
  | "late_correction_rise"
  | "late_starting_delay"
  | "late_repeated_pauses";

export interface SessionFatigueResult {
  fatigued: boolean;
  signals: readonly FatigueSignal[];
}

export interface BuildEasyCloseCardInput {
  learnerId?: string;
  seed: string;
  skillStates?: AdaptiveSkillStateMap;
  excludedFingerprints?: ReadonlySet<string> | readonly string[];
  cardIndex?: number;
}

interface CardRequest {
  skillId: SkillId;
  lane: SessionLane;
  reason: string;
  expectedAnswer?: ProblemAnswer;
  renameQuestion?: PlaceValueQuestion;
  difficulty?: number;
  remediationForProblemId?: string;
  delayedRetryForProblemId?: string;
  requiredExcludedFingerprint?: string;
  requiredDifferentOperandsSignature?: string;
}

const FOCUS_ORDER: readonly SkillId[] = [
  "F01",
  "F02",
  "R01",
  "F04",
  "F03",
  "R02",
  "R03",
  "R04",
  "R05",
  "F05",
  "A01",
  "A02",
  "A03",
  "A04",
  "A05",
  "A06",
  "T01",
  "T02",
  "T03",
];

const SAFE_FILLER_ORDER: readonly SkillId[] = [
  "F02",
  "R01",
  "A02",
  "F01",
  "F04",
  "T05",
  "R02",
  "A03",
];

function assertPlanInput(input: AdaptivePlanInput): void {
  if (!input.learnerId) throw new TypeError("Adaptive plans require a learner id.");
  if (!input.seed) throw new TypeError("Adaptive plans require a deterministic seed.");
  if (!Number.isFinite(input.createdAt) || input.createdAt < 0) {
    throw new RangeError("Adaptive plan creation time must be non-negative.");
  }
  if (
    input.maxActiveDurationMs !== undefined &&
    (!Number.isFinite(input.maxActiveDurationMs) || input.maxActiveDurationMs <= 0)
  ) {
    throw new RangeError("Adaptive session duration must be positive.");
  }
  if (
    input.recentFatigueSessionCount !== undefined &&
    (!Number.isSafeInteger(input.recentFatigueSessionCount) ||
      input.recentFatigueSessionCount < 0)
  ) {
    throw new RangeError("Recent fatigue session count must be a non-negative integer.");
  }
}

function masteredSkillIds(states: AdaptiveSkillStateMap): Set<SkillId> {
  return new Set(
    enabledDefaultSkillIds().filter(
      (skillId) => states[skillId]?.conceptStatus === "mastered",
    ),
  );
}

function skillDependsOn(
  skillId: SkillId,
  possiblePrerequisite: SkillId,
  visited = new Set<SkillId>(),
): boolean {
  if (visited.has(skillId)) return false;
  visited.add(skillId);
  return skillDefinition(skillId).prerequisites.some(
    (prerequisite) =>
      prerequisite === possiblePrerequisite ||
      skillDependsOn(prerequisite, possiblePrerequisite, new Set(visited)),
  );
}

function securelyImpliedByMasteredDescendant(
  skillId: SkillId,
  states: AdaptiveSkillStateMap,
): boolean {
  const state = states[skillId];
  if (
    state &&
    state.independentAttemptCount > 0 &&
    state.weightedAccuracy < 0.9
  ) {
    return false;
  }
  return enabledDefaultSkillIds().some(
    (candidate) =>
      states[candidate]?.conceptStatus === "mastered" &&
      skillDependsOn(candidate, skillId),
  );
}

/** A short run of strong independent evidence is enough to stop diagnosing. */
export function skillIsDemonstrated(
  state: LearnerSkillState | undefined,
): boolean {
  if (!state) return false;
  if (state.conceptStatus === "mastered") return true;
  const recent = state.recentIndependentResults ?? [];
  return (
    state.independentAttemptCount >= 3 &&
    state.weightedAccuracy >= 0.9 &&
    recent.length >= 3 &&
    recent.slice(-3).every(Boolean)
  );
}

function skillCanAppear(
  skillId: SkillId,
  states: AdaptiveSkillStateMap,
  mastered: ReadonlySet<SkillId>,
): boolean {
  const state = states[skillId];
  return (
    state?.conceptStatus === "diagnostic" ||
    state?.conceptStatus === "learning" ||
    state?.conceptStatus === "mastered" ||
    skillPrerequisitesMet(skillId, mastered)
  );
}

function request(
  skillId: SkillId,
  lane: SessionLane,
  reason: string,
  expectedAnswer?: ProblemAnswer,
  renameQuestion?: PlaceValueQuestion,
): CardRequest {
  return {
    skillId,
    lane,
    reason,
    ...(expectedAnswer === undefined ? {} : { expectedAnswer }),
    ...(renameQuestion === undefined ? {} : { renameQuestion }),
  };
}

function diagnosticRequests(
  sessionNumber: 1 | 2 | 3,
  states: AdaptiveSkillStateMap,
): CardRequest[] {
  const sessionOne: readonly CardRequest[] = [
    request("F04", "diagnostic", "Check subtraction facts that bridge through 10."),
    request("A02", "diagnostic", "Check two-digit subtraction without regrouping."),
    request("R01", "diagnostic", "Check whether regrouping is noticed.", "yes"),
    request("F05", "diagnostic", "Check mixed subtraction facts."),
    request("A02", "diagnostic", "Confirm subtraction without regrouping in a new layout."),
    request(
      "R01",
      "diagnostic",
      "Confirm the regrouping decision with new numbers.",
      "no",
    ),
    request("F04", "diagnostic", "Confirm bridge-through-10 facts."),
    request("A02", "diagnostic", "Confirm independent column subtraction."),
    request("F05", "diagnostic", "Confirm mixed fact readiness."),
    request("T05", "easy_close", "End with a low-pressure transfer card."),
  ];
  const strongPlacement = ["F04", "F05", "A02", "R01"].every((skillId) =>
    skillIsDemonstrated(states[skillId as SkillId]),
  );
  const sessionTwo: readonly CardRequest[] = [
    request(
      "R02",
      "diagnostic",
      "Check how many tens remain after the trade.",
      undefined,
      "renamed_tens",
    ),
    request(
      "R02",
      "diagnostic",
      "Check how many ones there are after the trade.",
      undefined,
      "renamed_ones",
    ),
    request("A03", "diagnostic", "Check a complete regrouping problem."),
    request("R03", "diagnostic", "Check subtraction with renamed ones."),
    request("A03", "diagnostic", "Confirm complete regrouping in a new layout."),
    request("R04", "diagnostic", "Check the changed tens column."),
    request("A03", "diagnostic", "Check regrouping with different numbers."),
    request("A03", "diagnostic", "Confirm the complete regrouping sequence."),
    ...(strongPlacement
      ? [
          request(
            "A04",
            "diagnostic",
            "Check regrouping from zero ones after the foundation is secure.",
          ),
        ]
      : []),
    request("F02", "easy_close", "Close with a familiar subtraction fact."),
  ];
  const sessionThree: readonly CardRequest[] = [
    request("A02", "diagnostic", "Check when regrouping is not needed."),
    request("A03", "diagnostic", "Check when regrouping is needed."),
    request("A04", "diagnostic", "Check regrouping from zero ones."),
    request("A02", "diagnostic", "Confirm a no-regrouping example."),
    request("A03", "diagnostic", "Confirm a regrouping example."),
    request("A05", "diagnostic", "Check regrouping with a one-digit result."),
    request("A02", "diagnostic", "Check one more no-regrouping example."),
    request("A03", "diagnostic", "Check one more regrouping example."),
    request("T02", "transfer", "Repair a worked subtraction example."),
    request("T05", "easy_close", "Finish with an interesting transfer card."),
  ];

  const source =
    sessionNumber === 1 ? sessionOne : sessionNumber === 2 ? sessionTwo : sessionThree;
  const filtered = source.filter(
    (item) =>
      item.lane !== "diagnostic" || !skillIsDemonstrated(states[item.skillId]),
  );
  const target = Math.max(8, Math.min(10, source.length));
  const originalClose = filtered.find((item) => item.lane === "easy_close") ?? null;
  const retained = originalClose
    ? filtered.filter((item) => item !== originalClose)
    : [...filtered];
  const counts = new Map<SkillId, number>();
  for (const item of retained) {
    counts.set(item.skillId, (counts.get(item.skillId) ?? 0) + 1);
  }
  let fillerIndex = 0;
  const fillerTarget = target - (originalClose ? 1 : 0);
  while (retained.length < fillerTarget) {
    let skillId: SkillId | undefined;
    for (let offset = 0; offset < SAFE_FILLER_ORDER.length; offset += 1) {
      const candidate =
        SAFE_FILLER_ORDER[(fillerIndex + offset) % SAFE_FILLER_ORDER.length]!;
      if (
        !skillIsDemonstrated(states[candidate]) &&
        (counts.get(candidate) ?? 0) < MAX_CARDS_PER_NARROW_SKILL
      ) {
        skillId = candidate;
        break;
      }
    }
    const fallback =
      skillId ??
      SAFE_FILLER_ORDER.find(
        (candidate) => (counts.get(candidate) ?? 0) < MAX_CARDS_PER_NARROW_SKILL,
      ) ??
      "T05";
    retained.push(
      request(
        fallback,
        !originalClose && retained.length === fillerTarget - 1
          ? "easy_close"
          : "warmup",
        "Replace an already-demonstrated probe with a light confidence card.",
      ),
    );
    counts.set(fallback, (counts.get(fallback) ?? 0) + 1);
    fillerIndex = (fillerIndex + 1) % SAFE_FILLER_ORDER.length;
  }
  if (originalClose) retained.push(originalClose);
  return retained.slice(0, 10);
}

function shortDiagnosticRequests(requests: readonly CardRequest[]): CardRequest[] {
  const easyClose = requests.findLast((item) => item.lane === "easy_close") ?? null;
  if (!easyClose) {
    throw new Error("Every diagnostic plan must provide an easy closing card.");
  }
  return [
    ...requests.filter((item) => item !== easyClose).slice(0, SHORT_SESSION_CARD_COUNT - 1),
    easyClose,
  ];
}

function benchmarkRequests(input: AdaptivePlanInput): CardRequest[] {
  const target = input.sessionLength === "short" ? 8 : 10;
  const mastered = masteredSkillIds(input.skillStates);
  const includeA05 = skillCanAppear("A05", input.skillStates, mastered);
  const requests: CardRequest[] = [
    request("A03", "focus", "Weekly check: subtract with regrouping."),
    request("A02", "integration", "Weekly check: subtract without regrouping."),
    request("A03", "focus", "Weekly check: solve a fresh regrouping problem."),
    request("A02", "integration", "Weekly check: solve a fresh no-regrouping problem."),
    request("A04", "integration", "Weekly check: regroup from zero ones."),
    request("A03", "focus", "Weekly check: use the regrouping sequence independently."),
    request("A02", "integration", "Weekly check: decide no trade is needed."),
    request(
      includeA05 ? "A05" : "A03",
      "integration",
      includeA05
        ? "Weekly check: regroup when the answer is one digit."
        : "Weekly check: solve another standard regrouping problem.",
    ),
    request("A02", "integration", "Weekly check: solve in the other layout."),
    request("A03", "easy_close", "Finish the weekly check with familiar regrouping."),
  ];
  if (target === STANDARD_SESSION_CARD_COUNT) return requests;
  return [
    requests[0]!,
    requests[1]!,
    requests[2]!,
    requests[3]!,
    requests[4]!,
    requests[5]!,
    requests[6]!,
    requests[9]!,
  ];
}

function chooseFocusSkill(input: AdaptivePlanInput): SkillId {
  const mastered = masteredSkillIds(input.skillStates);
  const isAvailable = (skillId: SkillId): boolean => {
    const definition = skillDefinition(skillId);
    const state = input.skillStates[skillId];
    return (
      definition.enabledByDefault &&
      skillId !== "T05" &&
      !securelyImpliedByMasteredDescendant(skillId, input.skillStates) &&
      state?.fluencyStatus !== "plateau" &&
      state?.conceptStatus !== "mastered" &&
      skillCanAppear(skillId, input.skillStates, mastered)
    );
  };
  if (input.focusSkillId && isAvailable(input.focusSkillId)) {
    return input.focusSkillId;
  }
  const diagnosedNeed = FOCUS_ORDER.find(
    (skillId) =>
      input.skillStates[skillId]?.conceptStatus === "learning" &&
      isAvailable(skillId),
  );
  if (diagnosedNeed) return diagnosedNeed;
  const nextConcept = FOCUS_ORDER.find(isAvailable);
  if (nextConcept) return nextConcept;

  // Fluency is deliberately secondary. A mastered-but-slow skill can receive
  // brief practice only after the next concept has been allowed to progress.
  const fluencyPractice = FOCUS_ORDER.find((skillId) => {
    const state = input.skillStates[skillId];
    return (
      state?.conceptStatus === "mastered" &&
      state.fluencyStatus !== "smooth" &&
      state.fluencyStatus !== "plateau"
    );
  });
  return fluencyPractice ?? "F02";
}

function chooseWarmupSkills(
  states: AdaptiveSkillStateMap,
  excludedSkillId?: SkillId,
): readonly [SkillId, SkillId] {
  const preferred: readonly SkillId[] = ["F02", "F04", "A02", "R01", "F01"];
  const demonstrated = preferred.filter((skillId) =>
    skillId !== excludedSkillId && skillIsDemonstrated(states[skillId]),
  );
  const fallbacks = preferred.filter((skillId) => skillId !== excludedSkillId);
  return [
    demonstrated[0] ?? fallbacks[0] ?? "F02",
    demonstrated[1] ?? demonstrated[0] ?? fallbacks[1] ?? fallbacks[0] ?? "R01",
  ];
}

function chooseIntegrationSkill(
  focus: SkillId,
  states: AdaptiveSkillStateMap,
  mastered: ReadonlySet<SkillId>,
): SkillId {
  const byFocus: Partial<Record<SkillId, readonly SkillId[]>> = {
    F01: ["F04", "A01"],
    F02: ["A02", "F03"],
    F03: ["F05", "A02"],
    F04: ["A01", "F05"],
    F05: ["A03", "A01"],
    R01: ["A02", "R02"],
    R02: ["R03", "A01"],
    R03: ["A01", "R05"],
    R04: ["R05", "A03"],
    R05: ["A03", "A01"],
    A01: ["A03", "R03"],
    A02: ["A06", "T03"],
    A03: ["A04", "A05", "A06"],
    A04: ["A06", "T02"],
    A05: ["A06", "T02"],
    A06: ["T01", "T03"],
    T01: ["A06", "T03"],
    T02: ["A03", "A06"],
    T03: ["A06", "T01"],
  };
  return (
    byFocus[focus]?.find(
      (skillId) =>
        skillId !== focus && skillCanAppear(skillId, states, mastered),
    ) ?? (focus === "A02" ? "F02" : "A02")
  );
}

function chooseReviewRequest(input: AdaptivePlanInput, focus: SkillId): CardRequest {
  const due = input.dueReviewSkillIds?.find(
    (skillId) => input.skillStates[skillId]?.conceptStatus === "mastered",
  );
  if (due) {
    return request(due, "review", "Revisit a skill whose spaced review is due.");
  }
  const fallback =
    FOCUS_ORDER.find((skillId) => {
      const state = input.skillStates[skillId];
      return (
        skillId !== focus &&
        state?.conceptStatus === "mastered" &&
        state.fluencyStatus !== "plateau"
      );
    }) ?? "F02";
  return request(
    fallback,
    "integration",
    "Use a varied supporting card while no spaced review is due.",
  );
}

function practiceRequests(input: AdaptivePlanInput, focus: SkillId): CardRequest[] {
  const fatigueAdjusted =
    input.sessionLength !== "short" && (input.recentFatigueSessionCount ?? 0) >= 2;
  const target = input.sessionLength === "short" || fatigueAdjusted ? 8 : 10;
  const mastered = masteredSkillIds(input.skillStates);
  const [warmupOne, warmupTwo] = chooseWarmupSkills(input.skillStates, focus);
  const integration = chooseIntegrationSkill(focus, input.skillStates, mastered);
  const review = chooseReviewRequest(input, focus);
  const transfer = input.optionalChallengeEnabled
    ? "T05"
    : skillCanAppear("T02", input.skillStates, mastered)
      ? "T02"
      : focus !== "T03" && skillCanAppear("T03", input.skillStates, mastered)
        ? "T03"
        : "A02";
  const close = warmupOne;
  const standard: CardRequest[] = [
    request(warmupOne, "warmup", "Begin with a familiar success."),
    request(warmupTwo, "warmup", "Warm up with another secure skill."),
    request(focus, "focus", "Practice the current learning edge."),
    request(integration, "integration", "Connect the focus skill to a nearby task."),
    request(focus, "focus", "Return to the focus with fresh numbers."),
    request(integration, "integration", "Use the idea again in context."),
    request(integration, "integration", "Confirm the idea in a complete problem."),
    review,
    request(transfer, "transfer", "Use subtraction in a different form."),
    request(close, "easy_close", "Finish with a familiar confidence card."),
  ];
  if (target === STANDARD_SESSION_CARD_COUNT) {
    return standard;
  }
  if (fatigueAdjusted) {
    return [
      standard[0]!,
      standard[1]!,
      request(warmupOne, "warmup", "Use an extra familiar card after recent fatigue."),
      standard[2]!,
      standard[3]!,
      standard[7]!,
      standard[8]!,
      standard[9]!,
    ];
  }
  return [
    standard[0]!,
    standard[1]!,
    standard[2]!,
    standard[3]!,
    standard[4]!,
    standard[7]!,
    standard[8]!,
    standard[9]!,
  ];
}

function transferDifficulty(input: AdaptivePlanInput): 3 | 4 {
  return (input.skillStates.T01?.independentAttemptCount ?? 0) >= 4 ? 4 : 3;
}

function applyTransferProgression(
  requests: readonly CardRequest[],
  input: AdaptivePlanInput,
): CardRequest[] {
  const difficulty = transferDifficulty(input);
  return requests.map((item) =>
    item.skillId === "T01" || item.skillId === "T05"
      ? { ...item, difficulty }
      : item,
  );
}

/**
 * Derive one bounded pending remediation from immutable attempt history. A
 * successful linked fresh retry resolves the original miss without rewriting
 * either event.
 */
export function pendingCarryoverRemediation(
  attempts: readonly AttemptEvent[],
): AttemptEvent | null {
  const ordered = [...attempts].sort(
    (left, right) => left.submittedAt - right.submittedAt,
  );
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const candidate = ordered[index]!;
    if (
      candidate.firstAttemptCorrect ||
      candidate.eventuallyCorrect ||
      candidate.skipped ||
      candidate.errorCode === null ||
      candidate.errorCode === "recognition_uncertain" ||
      candidate.errorCode === "fatigue_related_error" ||
      candidate.relatedProblemRelation !== null
    ) {
      continue;
    }
    const resolved = ordered.some(
      (event) =>
        event.relatedProblemRelation === "delayed_retry" &&
        event.relatedProblemId === candidate.problemId &&
        event.skillId === candidate.skillId &&
        event.firstAttemptCorrect &&
        !event.skipped &&
        event.submittedAt >= candidate.submittedAt,
    );
    if (!resolved) return candidate;
  }
  return null;
}

function applyCarryoverRemediation(
  requests: readonly CardRequest[],
  input: AdaptivePlanInput,
): CardRequest[] {
  const pending = pendingCarryoverRemediation(input.attemptEvents ?? []);
  if (!pending) return [...requests];
  const comparable = (input.attemptEvents ?? [])
    .filter(
      (event) =>
        event.skillId === pending.skillId &&
        event.submittedAt < pending.submittedAt,
    )
    .slice(-5);
  const decision = remediationDecision({
    problem: {
      skillId: pending.skillId,
      metadata: pending.metadata,
      seed: pending.problemSeed,
    },
    errorCode: pending.errorCode!,
    recentComparableAttempts: comparable,
    seed: deriveAdaptiveSeed(input.seed, "carryover", pending.problemId),
  });
  if (!decision.probeSkillId) return [...requests];

  const easyClose = requests.findLast((item) => item.lane === "easy_close") ?? null;
  let pool = requests.filter((item) => item !== easyClose);
  const carryover: CardRequest[] = [];
  for (let index = 0; index < decision.scaffoldCount; index += 1) {
    carryover.push({
      skillId: decision.probeSkillIds[index] ?? decision.probeSkillId,
      lane: "focus",
      reason:
        index === 0
          ? "Check one small step carried over from the previous session."
          : "Check one more related step before the fresh retry.",
      remediationForProblemId: pending.problemId,
    });
  }
  while (carryover.length < decision.retryDelay) {
    const bridgeIndex = pool.findIndex(
      (item) =>
        item.skillId !== pending.skillId &&
        item.lane !== "review" &&
        item.lane !== "easy_close",
    );
    const bridge = bridgeIndex >= 0 ? pool.splice(bridgeIndex, 1)[0] : null;
    carryover.push(
      bridge ??
        request(
          SAFE_FILLER_ORDER.find((skillId) => skillId !== pending.skillId) ?? "F02",
          "integration",
          "Use a brief different card before returning to the missed idea.",
        ),
    );
  }
  carryover.push({
    skillId: pending.skillId,
    lane: "focus",
    reason: "Retry the carried-over idea with fresh numbers.",
    delayedRetryForProblemId: pending.problemId,
    requiredExcludedFingerprint: pending.problemFingerprint,
    requiredDifferentOperandsSignature: JSON.stringify(pending.operands),
  });
  if (carryover.some((item) => item.skillId === "T03")) {
    pool = pool.filter(
      (item) =>
        item.skillId !== "T03" ||
        item.lane === "review" ||
        Boolean(item.remediationForProblemId) ||
        Boolean(item.delayedRetryForProblemId),
    );
  }

  const target = requests.length;
  const result = [...carryover];
  const fillTarget = target - (easyClose ? 1 : 0);
  while (result.length < fillTarget && pool.length > 0) {
    result.push(pool.shift()!);
  }
  let fillerIndex = 0;
  while (result.length < fillTarget) {
    const skillId = SAFE_FILLER_ORDER[fillerIndex % SAFE_FILLER_ORDER.length]!;
    fillerIndex += 1;
    result.push(
      request(
        skillId,
        "integration",
        "Keep the carried-over plan finite and varied.",
      ),
    );
  }
  if (easyClose) result.push(easyClose);
  return result.slice(0, target);
}

function excludedSet(
  value: ReadonlySet<string> | readonly string[] | undefined,
): Set<string> {
  return new Set(value ? [...value] : []);
}

function canUseTemplate(problem: GeneratedProblem, cards: readonly PlannedCard[]): boolean {
  const previous = cards.slice(-MAX_CONSECUTIVE_IDENTICAL_TEMPLATES);
  return !(
    previous.length === MAX_CONSECUTIVE_IDENTICAL_TEMPLATES &&
    previous.every((card) => card.problem.metadata.templateId === problem.metadata.templateId)
  );
}

function makeCard(params: {
  planSeed: string;
  index: number;
  request: CardRequest;
  excluded: Set<string>;
  precedingCards: readonly PlannedCard[];
  remediationForProblemId?: string | null;
  delayedRetryForProblemId?: string | null;
}): PlannedCard {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const cardSeed = deriveAdaptiveSeed(
      params.planSeed,
      "card",
      params.index,
      params.request.skillId,
      attempt,
    );
    try {
      const problem = generateProblem({
        skillId: params.request.skillId,
        seed: cardSeed,
        excludedFingerprints: params.excluded,
        format: (params.index + attempt) % 2 === 0 ? "horizontal" : "vertical",
        difficulty: params.request.difficulty,
      });
      if (
        params.request.expectedAnswer !== undefined &&
        problem.expectedAnswer !== params.request.expectedAnswer
      ) {
        continue;
      }
      if (
        params.request.renameQuestion !== undefined &&
        problem.metadata.renameQuestion !== params.request.renameQuestion
      ) {
        continue;
      }
      if (!canUseTemplate(problem, params.precedingCards)) continue;
      params.excluded.add(problem.fingerprint);
      return {
        id: `adaptive-card-${stableSeedToken(cardSeed)}`,
        lane: params.request.lane,
        reason: params.request.reason,
        problem,
        skillId: params.request.skillId,
        status: "planned",
        remediationForProblemId:
          params.remediationForProblemId ??
          params.request.remediationForProblemId ??
          null,
        delayedRetryForProblemId:
          params.delayedRetryForProblemId ??
          params.request.delayedRetryForProblemId ??
          null,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Unable to plan a fresh ${params.request.skillId} card.`);
}

function boundedRequests(
  requests: readonly CardRequest[],
  maxCardsPerSkill = MAX_CARDS_PER_NARROW_SKILL,
): CardRequest[] {
  const counts = new Map<SkillId, number>();
  const bounded: CardRequest[] = [];
  for (const item of requests) {
    let selected = item.skillId;
    if (
      item.lane === "review" &&
      (counts.get(selected) ?? 0) >= maxCardsPerSkill
    ) {
      const earlierIndex = bounded.findIndex(
        (candidate) =>
          candidate.skillId === selected && candidate.lane !== "review",
      );
      const replacement = SAFE_FILLER_ORDER.find(
        (candidate) =>
          candidate !== selected &&
          (counts.get(candidate) ?? 0) < maxCardsPerSkill,
      );
      if (earlierIndex >= 0 && replacement) {
        const earlier = bounded[earlierIndex]!;
        bounded[earlierIndex] = {
          ...earlier,
          skillId: replacement,
          difficulty: undefined,
          reason: `${earlier.reason} This card also preserves the due review slot.`,
        };
        counts.set(selected, (counts.get(selected) ?? 1) - 1);
        counts.set(replacement, (counts.get(replacement) ?? 0) + 1);
      }
    }
    if ((counts.get(selected) ?? 0) >= maxCardsPerSkill) {
      selected =
        SAFE_FILLER_ORDER.find(
          (candidate) => (counts.get(candidate) ?? 0) < maxCardsPerSkill,
        ) ?? "T05";
    }
    if (
      bounded.length >= 2 &&
      bounded[bounded.length - 1]?.skillId === selected &&
      bounded[bounded.length - 2]?.skillId === selected
    ) {
      const replacement = SAFE_FILLER_ORDER.find(
        (candidate) =>
          candidate !== selected &&
          (counts.get(candidate) ?? 0) < maxCardsPerSkill,
      );
      if (item.lane === "review" && replacement) {
        const earlierIndex = bounded.length - 1;
        const earlier = bounded[earlierIndex]!;
        bounded[earlierIndex] = {
          ...earlier,
          skillId: replacement,
          difficulty: undefined,
          reason: `${earlier.reason} This card also preserves the due review slot.`,
        };
        counts.set(selected, (counts.get(selected) ?? 1) - 1);
        counts.set(replacement, (counts.get(replacement) ?? 0) + 1);
      } else {
        selected = replacement ?? selected;
      }
    }
    counts.set(selected, (counts.get(selected) ?? 0) + 1);
    bounded.push(
      selected === item.skillId
      ? item
      : {
          ...item,
          skillId: selected,
          difficulty: undefined,
          reason: `${item.reason} This card also keeps the session varied.`,
        },
    );
  }
  return bounded;
}

function ensureT03RequestPairs(requests: readonly CardRequest[]): CardRequest[] {
  const paired = [...requests];
  const t03Indexes = paired
    .map((item, index) => (item.skillId === "T03" ? index : -1))
    .filter((index) => index >= 0);
  if (t03Indexes.length % 2 === 0) return paired;
  const anchor = t03Indexes.at(-1)!;
  const replacement = paired
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        item.skillId !== "T03" &&
        item.lane !== "review" &&
        item.lane !== "easy_close" &&
        !item.remediationForProblemId &&
        !item.delayedRetryForProblemId,
    )
    .sort(
      (left, right) =>
        Math.abs(left.index - anchor) - Math.abs(right.index - anchor),
    )[0];
  if (!replacement) {
    throw new Error("A T03 transfer card requires room for its opposite-format pair.");
  }
  const anchorRequest = paired[anchor]!;
  paired[replacement.index] = anchorRequest.remediationForProblemId
    ? {
        ...anchorRequest,
        reason: "Check the same remediation step in the other layout.",
      }
    : request(
        "T03",
        "transfer",
        "Solve the same subtraction in the other layout.",
      );
  return paired;
}

function makeT03FormatPair(params: {
  request: CardRequest;
  planSeed: string;
  index: number;
  excluded: ReadonlySet<string>;
  requiredDifferentOperandsSignatures: ReadonlySet<string>;
  precedingCards: readonly PlannedCard[];
}): Readonly<{ anchor: PlannedCard; partner: GeneratedProblem }> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const cardSeed = deriveAdaptiveSeed(
      params.planSeed,
      "card",
      params.index,
      "T03",
      attempt,
    );
    const anchorFormat = (params.index + attempt) % 2 === 0
      ? "horizontal"
      : "vertical";
    const difficulty =
      params.request.difficulty === undefined
        ? {}
        : { difficulty: params.request.difficulty };
    const anchor = generateProblem({
      skillId: "T03",
      seed: cardSeed,
      format: anchorFormat,
      ...difficulty,
    });
    const partner = generateProblem({
      skillId: "T03",
      seed: anchor.seed,
      format: anchorFormat === "horizontal" ? "vertical" : "horizontal",
      ...difficulty,
    });
    if (
      params.excluded.has(anchor.fingerprint) ||
      params.excluded.has(partner.fingerprint) ||
      params.requiredDifferentOperandsSignatures.has(
        JSON.stringify(anchor.operands),
      ) ||
      anchor.expectedAnswer !== partner.expectedAnswer ||
      JSON.stringify(anchor.operands) !== JSON.stringify(partner.operands) ||
      !canUseTemplate(anchor, params.precedingCards)
    ) {
      continue;
    }
    return {
      anchor: {
        id: `adaptive-card-${stableSeedToken(cardSeed)}`,
        lane: params.request.lane,
        reason: params.request.reason,
        problem: anchor,
        skillId: "T03",
        status: "planned",
        remediationForProblemId:
          params.request.remediationForProblemId ?? null,
        delayedRetryForProblemId:
          params.request.delayedRetryForProblemId ?? null,
      },
      partner,
    };
  }
  throw new Error("Unable to plan a historically fresh opposite-format T03 pair.");
}

function makeT03FormatPairCard(params: {
  problem: GeneratedProblem;
  request: CardRequest;
  planSeed: string;
  index: number;
  precedingCards: readonly PlannedCard[];
}): PlannedCard {
  if (!canUseTemplate(params.problem, params.precedingCards)) {
    throw new Error("Opposite-format T03 card would repeat a template three times.");
  }
  return {
    id: `adaptive-card-${stableSeedToken(
      deriveAdaptiveSeed(params.planSeed, "t03-pair", params.problem.id, params.index),
    )}`,
    lane: params.request.lane,
    reason: "Solve the same subtraction in the other layout.",
    problem: params.problem,
    skillId: "T03",
    status: "planned",
    remediationForProblemId: params.request.remediationForProblemId ?? null,
    delayedRetryForProblemId: params.request.delayedRetryForProblemId ?? null,
  };
}

function buildCards(
  seed: string,
  requests: readonly CardRequest[],
  recentFingerprints: readonly string[] = [],
  maxCardsPerSkill = MAX_CARDS_PER_NARROW_SKILL,
): PlannedCard[] {
  const historicalExcluded = new Set(recentFingerprints);
  const withinSessionExcluded = new Set<string>();
  const cards: PlannedCard[] = [];
  let pendingT03Partner: GeneratedProblem | null = null;
  const plannedRequests = boundedRequests(requests, maxCardsPerSkill);
  for (const [index, item] of plannedRequests.entries()) {
    const requiredExcluded = item.requiredExcludedFingerprint
      ? [item.requiredExcludedFingerprint]
      : [];
    const makePlannedCard = (excluded: Set<string>) =>
      makeCard({
        planSeed: seed,
        index,
        request: item,
        excluded,
        precedingCards: cards,
      });
    let card: PlannedCard;
    if (item.skillId === "T03" && pendingT03Partner) {
      card = makeT03FormatPairCard({
        problem: pendingT03Partner,
        request: item,
        planSeed: seed,
        index,
        precedingCards: cards,
      });
      pendingT03Partner = null;
    } else if (item.skillId === "T03") {
      const partnerRequest = plannedRequests
        .slice(index + 1)
        .find((candidate) => candidate.skillId === "T03");
      const pairRequiredExcluded = [
        ...requiredExcluded,
        ...(partnerRequest?.requiredExcludedFingerprint
          ? [partnerRequest.requiredExcludedFingerprint]
          : []),
      ];
      const requiredDifferentOperandsSignatures = new Set(
        [
          item.requiredDifferentOperandsSignature,
          partnerRequest?.requiredDifferentOperandsSignature,
        ].filter((value): value is string => Boolean(value)),
      );
      const pair = makeT03FormatPair({
        request: item,
        planSeed: seed,
        index,
        excluded: new Set([
          ...historicalExcluded,
          ...withinSessionExcluded,
          ...pairRequiredExcluded,
        ]),
        requiredDifferentOperandsSignatures,
        precedingCards: cards,
      });
      card = pair.anchor;
      pendingT03Partner = pair.partner;
    } else {
      try {
        card = makePlannedCard(
          new Set([
            ...historicalExcluded,
            ...withinSessionExcluded,
            ...requiredExcluded,
          ]),
        );
      } catch (error) {
        if (historicalExcluded.size === 0) throw error;
        // Small finite families such as F01 can exhaust their historical window.
        // Relax history for this card only; never relax uniqueness inside the run.
        card = makePlannedCard(
          new Set([...withinSessionExcluded, ...requiredExcluded]),
        );
      }
    }
    withinSessionExcluded.add(card.problem.fingerprint);
    cards.push(card);
  }
  if (pendingT03Partner) {
    throw new Error("T03 request balancing left an unpaired format-transfer card.");
  }
  return cards;
}

export function buildAdaptiveSessionPlan(
  input: AdaptivePlanInput,
): AdaptiveSessionPlan {
  assertPlanInput(input);
  const kind: SessionKind =
    input.sessionKind ??
    (input.diagnosticSessionNumber !== undefined ? "diagnostic" : "practice");
  if (kind === "diagnostic" && input.diagnosticSessionNumber === undefined) {
    throw new RangeError("Diagnostic plans require diagnosticSessionNumber 1, 2, or 3.");
  }
  const focus = kind === "practice" ? chooseFocusSkill(input) : null;
  let requests =
    kind === "diagnostic"
      ? diagnosticRequests(input.diagnosticSessionNumber!, input.skillStates)
      : kind === "benchmark"
        ? benchmarkRequests(input)
        : practiceRequests(input, focus!);
  if (kind === "diagnostic" && input.sessionLength === "short") {
    requests = shortDiagnosticRequests(requests);
  }
  if (kind !== "benchmark") {
    requests = applyCarryoverRemediation(requests, input);
  }
  requests = ensureT03RequestPairs(applyTransferProgression(requests, input));
  const cards = buildCards(
    input.seed,
    requests,
    input.recentFingerprints,
    kind === "practice"
      ? MAX_INITIAL_PRACTICE_CARDS_PER_NARROW_SKILL
      : MAX_CARDS_PER_NARROW_SKILL,
  );
  const fatigueAdjusted =
    kind === "practice" &&
    input.sessionLength !== "short" &&
    (input.recentFatigueSessionCount ?? 0) >= 2;
  const defaultDuration =
    input.sessionLength === "short" || fatigueAdjusted
      ? SHORT_SESSION_ACTIVE_MS
      : STANDARD_SESSION_ACTIVE_MS;
  return {
    id: `adaptive-session-${stableSeedToken(
      deriveAdaptiveSeed(input.seed, input.learnerId, kind, input.createdAt),
    )}`,
    learnerId: input.learnerId,
    kind,
    seed: input.seed,
    createdAt: input.createdAt,
    targetCardCount: cards.length,
    maxActiveDurationMs: input.maxActiveDurationMs ?? defaultDuration,
    focusSkillId: focus,
    cards,
  };
}

function subtractionOperands(problem: GeneratedProblem): {
  minuend: number;
  subtrahend: number;
} | null {
  const minuend = problem.operands.minuend;
  const subtrahend = problem.operands.subtrahend;
  return Number.isFinite(minuend) && Number.isFinite(subtrahend)
    ? { minuend, subtrahend }
    : null;
}

function isDigitTransposition(
  answer: number,
  expected: number,
  rawAnswerText?: string | null,
): boolean {
  const trimmedRaw = rawAnswerText?.trim();
  const answerText = trimmedRaw && /^\d+$/.test(trimmedRaw)
    ? trimmedRaw
    : String(answer);
  const expectedText = String(expected);
  return (
    answerText !== expectedText &&
    answerText.length === expectedText.length &&
    answerText === [...expectedText].reverse().join("")
  );
}

/**
 * Classify only patterns supported by the submitted answer and prompt. Broad
 * numerical guesses intentionally fall back to `unclassified_math_error`.
 */
export function classifyAdaptiveError(
  input: ClassifyAdaptiveErrorInput,
): ErrorCode | null {
  if (input.recognitionUncertain) return "recognition_uncertain";
  if (input.answer === null || input.answer === input.problem.expectedAnswer) return null;

  const expected = input.problem.expectedAnswer;
  if (expected === "yes" || expected === "no") {
    if (input.answer !== "yes" && input.answer !== "no") {
      return "unclassified_math_error";
    }
    return expected === "yes"
      ? "regrouping_not_detected"
      : "unnecessary_regrouping";
  }
  if (typeof input.answer !== "number") return "unclassified_math_error";

  const operands = subtractionOperands(input.problem);
  if (
    input.problem.metadata.operation === "subtraction" &&
    operands &&
    input.answer === operands.minuend + operands.subtrahend
  ) {
    return "wrong_operation";
  }
  const left = input.problem.operands.left;
  const right = input.problem.operands.right;
  if (
    input.problem.metadata.operation === "addition" &&
    typeof left === "number" &&
    typeof right === "number" &&
    input.answer === left - right
  ) {
    return "wrong_operation";
  }
  if (isDigitTransposition(input.answer, expected, input.rawAnswerText)) {
    return "digit_transposition";
  }
  if (
    input.problem.promptSpec.math.kind === "repair" &&
    input.answer === input.problem.promptSpec.math.shownAnswer
  ) {
    return input.problem.promptSpec.math.misconception;
  }

  switch (input.problem.skillId) {
    case "F01":
    case "F02":
    case "F03":
    case "F04":
    case "F05":
      return "fact_retrieval_error";
    case "R01":
      return "unclassified_math_error";
    case "R02":
      return "regrouped_state_lost";
    case "R03":
      return "ones_digit_error";
    case "R04":
      return "tens_digit_error";
    case "R05":
      return "place_value_assembly_error";
    default:
      break;
  }

  // Ten too high on a regrouping problem supports a lost regrouped state, but
  // not the narrower claim that a particular tens step was forgotten.
  if (
    input.problem.metadata.requiresRegrouping &&
    input.answer === expected + 10
  ) {
    return "regrouped_state_lost";
  }

  if (expected >= 10 && input.answer >= 0) {
    if (
      Math.floor(input.answer / 10) === Math.floor(expected / 10) &&
      input.answer % 10 !== expected % 10
    ) {
      return "ones_digit_error";
    }
    if (
      input.answer % 10 === expected % 10 &&
      Math.floor(input.answer / 10) !== Math.floor(expected / 10)
    ) {
      return "tens_digit_error";
    }
  }
  return "unclassified_math_error";
}

function probesForError(
  problem: Pick<GeneratedProblem, "skillId" | "metadata">,
  errorCode: ErrorCode,
  repeatedPattern: boolean,
): readonly SkillId[] {
  switch (errorCode) {
    case "recognition_uncertain":
      return [];
    case "wrong_operation":
      return ["T02"];
    case "fact_retrieval_error": {
      if (!problem.skillId.startsWith("F")) return ["F04"];
      const supportingFact =
        skillDefinition(problem.skillId).remediationSkillIds.find(
          (skillId) => skillId !== problem.skillId && skillId.startsWith("F"),
        ) ?? (problem.skillId === "F02" ? "F01" : "F02");
      return repeatedPattern
        ? [problem.skillId, supportingFact]
        : [problem.skillId];
    }
    case "ones_digit_error":
      return [problem.metadata.requiresRegrouping ? "R03" : "F02"];
    case "regrouping_not_detected":
    case "unnecessary_regrouping":
      return ["R01"];
    case "forgot_to_decrement_tens":
    case "tens_digit_error":
      return ["R04"];
    case "regrouped_state_lost":
      return repeatedPattern ? ["R02", "R04"] : ["R02"];
    case "place_value_assembly_error":
      return ["R05"];
    case "digit_transposition":
    case "copy_or_alignment_error":
      return ["T03"];
    case "execution_slip":
      return [skillDefinition(problem.skillId).remediationSkillIds[0] ?? "T02"];
    case "fatigue_related_error":
      return ["F02"];
    case "unclassified_math_error":
      return [
        problem.metadata.requiresRegrouping
          ? "R01"
          : (skillDefinition(problem.skillId).remediationSkillIds[0] ?? "R01"),
      ];
  }
}

export function remediationDecision(
  input: RemediationDecisionInput,
): RemediationDecision {
  const previousMatching = (input.recentComparableAttempts ?? [])
    .slice(-5)
    .filter((attempt) => attempt.errorCode === input.errorCode).length;
  const repeatedPattern = previousMatching >= 1;
  const requestedProbes = probesForError(
    input.problem,
    input.errorCode,
    repeatedPattern,
  );
  const probeSkillIds = requestedProbes.slice(0, 2);
  const probeSkillId = probeSkillIds[0] ?? null;
  const random = createAdaptiveRandom(
    input.seed ?? deriveAdaptiveSeed(input.problem.seed, input.errorCode, previousMatching),
  );
  const retryDelay = randomIntBetween(random, 2, 4) as 2 | 3 | 4;
  const scaffoldCount: 0 | 1 | 2 =
    probeSkillId === null
      ? 0
      : probeSkillIds.length === 2 || repeatedPattern
        ? 2
        : 1;
  return {
    probeSkillId,
    probeSkillIds,
    scaffoldCount,
    retryDelay,
    repeatedPattern,
  };
}

function makeRemediationCard(params: {
  plan: AdaptiveSessionPlan;
  index: number;
  skillId: SkillId;
  lane: SessionLane;
  reason: string;
  excluded: Set<string>;
  precedingCards: readonly PlannedCard[];
  failedProblemId: string;
  kind: "probe" | "retry" | "bridge";
  difficulty?: number;
}): PlannedCard {
  const cardRequest = request(
    params.skillId,
    params.lane,
    params.reason,
  );
  return makeCard({
    planSeed: deriveAdaptiveSeed(
      params.plan.seed,
      "replan",
      params.failedProblemId,
      params.kind,
    ),
    index: params.index,
    request:
      params.difficulty === undefined
        ? cardRequest
        : { ...cardRequest, difficulty: params.difficulty },
    excluded: params.excluded,
    precedingCards: params.precedingCards,
    remediationForProblemId:
      params.kind === "probe" ? params.failedProblemId : null,
    delayedRetryForProblemId:
      params.kind === "retry" ? params.failedProblemId : null,
  });
}

function plannedSkillCount(cards: readonly PlannedCard[], skillId: SkillId): number {
  return cards.filter((card) => card.skillId === skillId).length;
}

function canAppendPlannedCard(
  card: PlannedCard,
  cards: readonly PlannedCard[],
): boolean {
  return (
    plannedSkillCount(cards, card.skillId) < MAX_CARDS_PER_NARROW_SKILL &&
    canUseTemplate(card.problem, cards)
  );
}

/** Add bounded scaffolding and a fresh retry two to four card positions later. */
export function replanAfterAttempt(
  input: ReplanAfterAttemptInput,
): AdaptiveSessionPlan {
  if (
    input.plan.kind === "benchmark" ||
    input.attempt.firstAttemptCorrect ||
    input.fatigueDetected
  ) {
    return input.plan;
  }
  const failedIndex = input.plan.cards.findIndex(
    (card) => card.problem.id === input.attempt.problemId,
  );
  const cardIndex = failedIndex >= 0 ? failedIndex : input.cardIndex;
  const failedCard = input.plan.cards[cardIndex];
  if (!failedCard) return input.plan;
  if (failedCard.lane === "easy_close") return input.plan;
  const remediationRootProblemId =
    failedCard.delayedRetryForProblemId ??
    failedCard.remediationForProblemId ??
    failedCard.problem.id;
  const remediationRootCard =
    input.plan.cards.find(
      (card) => card.problem.id === remediationRootProblemId,
    ) ??
    input.plan.cards.find(
      (card) => card.delayedRetryForProblemId === remediationRootProblemId,
    ) ??
    failedCard;
  const retrySkillId = remediationRootCard.skillId;
  const errorCode =
    input.attempt.errorCode ??
    classifyAdaptiveError({
      problem: failedCard.problem,
      answer: input.attempt.normalizedRecognizedValue,
      recognitionUncertain:
        input.attempt.rawRecognizedValue !== null &&
        input.attempt.normalizedRecognizedValue === null,
      recognitionConfirmedByChild: input.attempt.recognitionConfirmedByChild,
    });
  if (errorCode === null || errorCode === "recognition_uncertain") return input.plan;

  const decision = remediationDecision({
    problem: failedCard.problem,
    errorCode,
    recentComparableAttempts: input.recentComparableAttempts,
    seed: deriveAdaptiveSeed(input.plan.seed, remediationRootProblemId, errorCode),
  });
  if (!decision.probeSkillId) return input.plan;

  const excluded = new Set([
    ...input.plan.cards.map((card) => card.problem.fingerprint),
    ...(input.recentFingerprints ?? []),
  ]);
  const prefix = [...input.plan.cards.slice(0, cardIndex + 1)];
  const future = input.plan.cards
    .slice(cardIndex + 1)
    .filter(
      (card) =>
        card.delayedRetryForProblemId !== remediationRootProblemId &&
        card.remediationForProblemId !== remediationRootProblemId,
    );
  const easyClose = future.find((card) => card.lane === "easy_close") ?? null;
  const ordinaryFuture = future.filter((card) => card !== easyClose);
  const sequence = [...prefix];

  const appendBridge = (): boolean => {
    const existingIndex = ordinaryFuture.findIndex((card) =>
      card.skillId !== retrySkillId &&
      canAppendPlannedCard(card, sequence),
    );
    if (existingIndex >= 0) {
      const [existing] = ordinaryFuture.splice(existingIndex, 1);
      if (existing) sequence.push(existing);
      return Boolean(existing);
    }
    for (const bridgeSkill of SAFE_FILLER_ORDER) {
      if (
        bridgeSkill === retrySkillId ||
        plannedSkillCount(sequence, bridgeSkill) >=
          MAX_CARDS_PER_NARROW_SKILL
      ) {
        continue;
      }
      try {
        const bridge = makeRemediationCard({
          plan: input.plan,
          index: sequence.length,
          skillId: bridgeSkill,
          lane: "integration",
          reason: "Space the retry with a brief, different success.",
          excluded,
          precedingCards: sequence,
          failedProblemId: remediationRootProblemId,
          kind: "bridge",
        });
        if (!canAppendPlannedCard(bridge, sequence)) continue;
        sequence.push(bridge);
        return true;
      } catch {
        // Try the next safe bridge family.
      }
    }
    return false;
  };

  const makeBoundedRemediation = (
    skillId: SkillId,
    lane: SessionLane,
    reason: string,
    kind: "probe" | "retry",
  ): PlannedCard | null => {
    if (
      plannedSkillCount(sequence, skillId) >= MAX_CARDS_PER_NARROW_SKILL
    ) {
      return null;
    }
    const build = () =>
      makeRemediationCard({
        plan: input.plan,
        index: sequence.length,
        skillId,
        lane,
        reason,
        excluded,
        precedingCards: sequence,
        failedProblemId: remediationRootProblemId,
        kind,
        difficulty:
          kind === "retry" && skillId === retrySkillId
            ? remediationRootCard.problem.difficulty
            : undefined,
      });
    try {
      return build();
    } catch {
      if (
        sequence.length >= MAX_ADAPTIVE_SESSION_CARDS - 1 ||
        !appendBridge()
      ) {
        return null;
      }
      try {
        return build();
      } catch {
        return null;
      }
    }
  };

  const appendT03ProbePair = (reason: string): boolean => {
    const retryReservation = retrySkillId === "T03" ? 1 : 0;
    if (
      sequence.length + 2 + 1 > MAX_ADAPTIVE_SESSION_CARDS ||
      plannedSkillCount(sequence, "T03") + 2 + retryReservation >
      MAX_CARDS_PER_NARROW_SKILL
    ) {
      return false;
    }
    try {
      const probeRequest: CardRequest = {
        skillId: "T03",
        lane: "focus",
        reason,
        remediationForProblemId: remediationRootProblemId,
      };
      const pair = makeT03FormatPair({
        request: probeRequest,
        planSeed: deriveAdaptiveSeed(
          input.plan.seed,
          "replan-t03-probe",
          remediationRootProblemId,
        ),
        index: sequence.length,
        excluded,
        requiredDifferentOperandsSignatures: new Set(),
        precedingCards: sequence,
      });
      const partner = makeT03FormatPairCard({
        problem: pair.partner,
        request: probeRequest,
        planSeed: input.plan.seed,
        index: sequence.length,
        precedingCards: [...sequence, pair.anchor],
      });
      sequence.push(pair.anchor, partner);
      excluded.add(pair.anchor.problem.fingerprint);
      excluded.add(partner.problem.fingerprint);
      return true;
    } catch {
      return false;
    }
  };

  let t03ProbeAdded = false;
  for (let index = 0; index < decision.scaffoldCount; index += 1) {
    const requestedSkill =
      decision.probeSkillIds[index] ?? decision.probeSkillId;
    const candidateSkills = [
      requestedSkill,
      ...skillDefinition(failedCard.skillId).remediationSkillIds,
      ...SAFE_FILLER_ORDER,
    ];
    const probeSkill = candidateSkills.find((skillId) => {
      const retryReservation = skillId === retrySkillId ? 1 : 0;
      const probeCost = skillId === "T03" ? 2 : 1;
      return (
        plannedSkillCount(sequence, skillId) + probeCost + retryReservation <=
        MAX_CARDS_PER_NARROW_SKILL
      );
    });
    if (!probeSkill) continue;
    const reason =
      index === 0
        ? "Check the smallest step related to the recent error."
        : "Use one more scaffold because the same error pattern repeated.";
    if (probeSkill === "T03") {
      if (!t03ProbeAdded) {
        // A format-transfer probe is one atomic horizontal/vertical lesson.
        // If the pair and its root retry cannot all fit, leave the miss
        // unresolved so append-only history carries it into the next session.
        if (!appendT03ProbePair(reason)) return input.plan;
        t03ProbeAdded = true;
      }
      continue;
    }
    const probe = makeBoundedRemediation(
      probeSkill,
      "focus",
      reason,
      "probe",
    );
    if (probe && canAppendPlannedCard(probe, sequence)) sequence.push(probe);
  }

  const retryDistance = Math.min(
    4,
    Math.max(decision.retryDelay, decision.scaffoldCount + 1),
  );
  while (
    sequence.length - cardIndex < retryDistance &&
    sequence.length < MAX_ADAPTIVE_SESSION_CARDS - 1
  ) {
    if (!appendBridge()) break;
  }
  const retry = makeBoundedRemediation(
    retrySkillId,
    remediationRootCard.lane,
    "Retry the same idea later with fresh numbers.",
    "retry",
  );
  if (!retry || !canAppendPlannedCard(retry, sequence)) return input.plan;
  sequence.push(retry);

  for (const card of ordinaryFuture) {
    if (sequence.length >= MAX_ADAPTIVE_SESSION_CARDS - 1) break;
    if (canAppendPlannedCard(card, sequence)) sequence.push(card);
  }
  if (sequence.length < MAX_ADAPTIVE_SESSION_CARDS) {
    const plannedClose = easyClose
      ? { ...easyClose, status: "planned" as const }
      : null;
    if (plannedClose && canAppendPlannedCard(plannedClose, sequence)) {
      sequence.push(plannedClose);
    } else {
      for (const closeSkill of SAFE_FILLER_ORDER) {
        if (
          closeSkill === retrySkillId ||
          plannedSkillCount(sequence, closeSkill) >=
            MAX_CARDS_PER_NARROW_SKILL
        ) {
          continue;
        }
        try {
          const close = makeRemediationCard({
            plan: input.plan,
            index: sequence.length,
            skillId: closeSkill,
            lane: "easy_close",
            reason: "Finish with a familiar success.",
            excluded,
            precedingCards: sequence,
            failedProblemId: remediationRootProblemId,
            kind: "bridge",
          });
          if (!canAppendPlannedCard(close, sequence)) continue;
          sequence.push(close);
          break;
        } catch {
          // Try another familiar close rather than expanding the plan.
        }
      }
    }
  }

  const boundedSequence = sequence.slice(0, MAX_ADAPTIVE_SESSION_CARDS);
  return {
    ...input.plan,
    targetCardCount: boundedSequence.length,
    cards: boundedSequence,
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/** Detect deterioration, never a single ordinary miss or merely slow work. */
export function detectSessionFatigue(
  attempts: readonly AttemptEvent[],
): SessionFatigueResult {
  const signals: FatigueSignal[] = [];
  const lastTwo = attempts.slice(-2);
  if (lastTwo.length === 2 && lastTwo.every((attempt) => attempt.skipped)) {
    signals.push("two_consecutive_skips");
  }
  if (attempts.slice(-3).some((attempt) => attempt.errorCode === "fatigue_related_error")) {
    signals.push("explicit_fatigue_error");
  }

  const meaningful = attempts.filter(
    (attempt) => !attempt.skipped && attempt.errorCode !== "recognition_uncertain",
  );
  if (meaningful.length >= 6) {
    const early = meaningful.slice(0, 3);
    const late = meaningful.slice(-3);
    const earlyCorrect = early.filter((attempt) => attempt.firstAttemptCorrect).length;
    const lateCorrect = late.filter((attempt) => attempt.firstAttemptCorrect).length;
    if (earlyCorrect >= 2 && lateCorrect <= 1) signals.push("late_accuracy_drop");

    const earlyTimes = early
      .filter((attempt) => attempt.timingEligible && attempt.responseMs !== null)
      .map((attempt) => attempt.responseMs!);
    const lateTimes = late
      .filter((attempt) => attempt.timingEligible && attempt.responseMs !== null)
      .map((attempt) => attempt.responseMs!);
    const earlyMedian = median(earlyTimes);
    const lateMedian = median(lateTimes);
    if (
      earlyMedian !== null &&
      lateMedian !== null &&
      earlyMedian > 0 &&
      lateMedian >= earlyMedian * 1.6
    ) {
      signals.push("late_response_slowdown");
    }

    const earlyCorrections = early.reduce(
      (total, attempt) => total + attempt.correctionCount,
      0,
    );
    const lateCorrections = late.reduce(
      (total, attempt) => total + attempt.correctionCount,
      0,
    );
    if (lateCorrections >= 2 && lateCorrections >= earlyCorrections + 2) {
      signals.push("late_correction_rise");
    }

    const earlyPauses = early.filter((attempt) => attempt.pauseUsed).length;
    const latePauses = late.filter((attempt) => attempt.pauseUsed).length;
    if (latePauses >= 2 && latePauses > earlyPauses) {
      signals.push("late_repeated_pauses");
    }

    const earlyStarts = early
      .filter((attempt) => attempt.timingEligible && attempt.firstInkLatencyMs !== null)
      .map((attempt) => attempt.firstInkLatencyMs!);
    const lateStarts = late
      .filter((attempt) => attempt.timingEligible && attempt.firstInkLatencyMs !== null)
      .map((attempt) => attempt.firstInkLatencyMs!);
    const earlyStartMedian = median(earlyStarts);
    const lateStartMedian = median(lateStarts);
    if (
      earlyStartMedian !== null &&
      lateStartMedian !== null &&
      lateStartMedian >= Math.max(earlyStartMedian * 2, earlyStartMedian + 1_000)
    ) {
      signals.push("late_starting_delay");
    }
  }

  const strongSignal = signals.some(
    (signal) =>
      signal === "two_consecutive_skips" ||
      signal === "explicit_fatigue_error" ||
      signal === "late_accuracy_drop",
  );
  return { fatigued: strongSignal || signals.length >= 2, signals };
}

export function buildEasyCloseCard(input: BuildEasyCloseCardInput): PlannedCard {
  if (!input.seed) throw new TypeError("Easy-close generation requires a seed.");
  const states = input.skillStates ?? {};
  const preferred = chooseWarmupSkills(states)[0];
  const excluded = excludedSet(input.excludedFingerprints);
  return makeCard({
    planSeed: deriveAdaptiveSeed(input.seed, "easy-close"),
    index: input.cardIndex ?? 0,
    request: request(preferred, "easy_close", "Finish with a familiar success."),
    excluded,
    precedingCards: [],
  });
}
