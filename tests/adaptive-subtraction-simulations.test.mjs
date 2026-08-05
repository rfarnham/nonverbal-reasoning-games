import assert from "node:assert/strict";
import test from "node:test";

import {
  createAttemptEvent,
  createRecognitionEvent,
} from "../app/lab/subtraction-flash/adaptive/attempts.ts";
import {
  deriveLearnerSkillState,
  deriveLearnerSkillStates,
  initialLearnerSkillState,
  isIndependentEvidence,
  isTimingEligible,
} from "../app/lab/subtraction-flash/adaptive/mastery.ts";
import {
  MAX_ADAPTIVE_SESSION_CARDS,
  SHORT_SESSION_CARD_COUNT,
  STANDARD_SESSION_CARD_COUNT,
  buildAdaptiveSessionPlan,
  buildEasyCloseCard,
  classifyAdaptiveError,
  detectSessionFatigue,
  remediationDecision,
  replanAfterAttempt,
} from "../app/lab/subtraction-flash/adaptive/planner.ts";
import { generateProblem } from "../app/lab/subtraction-flash/adaptive/problems.ts";
import {
  advanceAdaptiveSession,
  createAdaptiveSession,
  shortenAdaptiveSessionForFatigue,
  startAdaptiveSession,
} from "../app/lab/subtraction-flash/adaptive/session.ts";
import {
  SKILL_DEFINITIONS,
  SKILLS_BY_ID,
} from "../app/lab/subtraction-flash/adaptive/skills.ts";

const LEARNER_ID = "synthetic-learner";

function wrongAnswerFor(problem) {
  if (problem.expectedAnswer === "yes") return "no";
  if (problem.expectedAnswer === "no") return "yes";
  return problem.expectedAnswer + 1;
}

function makeAttempt({
  profile,
  skillId,
  index,
  count = 1,
  sessionCount = 2,
  problem = null,
  correct = true,
  responseMs = 2_000,
  answer,
  errorCode,
  recognitionConfidence = null,
  recognitionMargin = null,
  recognitionConfirmedByChild = false,
  recognizerCorrection = false,
  rawRecognizedValue = null,
  hintLevelUsed = 0,
  correctionCount = 0,
  skipped = false,
  appWasBackgrounded = false,
  interruptionDurationMs = 0,
  pauseUsed = false,
  workedAnswerVisible = false,
}) {
  const generated =
    problem ??
    generateProblem({
      skillId,
      seed: `simulation:${profile}:${skillId}:${index}`,
      format: index % 2 === 0 ? "horizontal" : "vertical",
    });
  const sessionNumber = Math.min(
    sessionCount - 1,
    Math.floor((index * sessionCount) / Math.max(1, count)),
  );
  const sessionId = `${profile}:session:${sessionNumber}`;
  const shownAt = 10_000_000 + sessionNumber * 1_000_000 + index * 50_000;
  const normalizedAnswer =
    answer !== undefined
      ? answer
      : correct
        ? generated.expectedAnswer
        : wrongAnswerFor(generated);
  const classifiedError =
    errorCode !== undefined
      ? errorCode
      : correct
        ? null
        : classifyAdaptiveError({
            problem: generated,
            answer: normalizedAnswer,
            recognitionUncertain:
              rawRecognizedValue !== null && normalizedAnswer === null,
            recognitionConfirmedByChild,
          });
  const firstInkAt = skipped ? null : shownAt + Math.min(900, Math.max(100, responseMs / 3));
  return createAttemptEvent({
    learnerId: LEARNER_ID,
    sessionId,
    sessionPosition: index,
    problem: generated,
    shownAt,
    firstInkAt,
    submittedAt: shownAt + responseMs,
    answer: normalizedAnswer,
    rawRecognizedValue,
    recognitionConfidence,
    recognitionMargin,
    recognitionConfirmedByChild,
    recognizerCorrection,
    firstAttemptCorrect: correct,
    eventuallyCorrect: correct || classifiedError !== "recognition_uncertain",
    hintLevelUsed,
    correctionCount,
    skipped,
    appWasBackgrounded,
    interruptionDurationMs,
    pauseUsed,
    workedAnswerVisible,
    errorCode: classifiedError,
  });
}

function attemptsForSkill({
  profile,
  skillId,
  count,
  sessionCount = 2,
  correctAt = () => true,
  responseAt = () => 2_000,
  errorAt = () => undefined,
}) {
  return Array.from({ length: count }, (_, index) =>
    makeAttempt({
      profile,
      skillId,
      index,
      count,
      sessionCount,
      correct: correctAt(index),
      responseMs: responseAt(index),
      errorCode: errorAt(index),
    }),
  );
}

function reduceSkill(skillId, attempts, previousState) {
  return deriveLearnerSkillState(SKILLS_BY_ID[skillId], attempts, {
    unlocked: true,
    previousState,
  });
}

const masteredStateCache = new Map();

function masteredState(skillId) {
  const existing = masteredStateCache.get(skillId);
  if (existing) return existing;
  const count = SKILLS_BY_ID[skillId].masteryPolicy.minIndependentAttempts;
  const attempts = attemptsForSkill({
    profile: `mastered-${skillId}`,
    skillId,
    count,
    sessionCount: 2,
    responseAt: () => 900,
  });
  const state = reduceSkill(skillId, attempts);
  assert.equal(state.conceptStatus, "mastered", `${skillId} synthetic prerequisite mastery`);
  masteredStateCache.set(skillId, state);
  return state;
}

function stateMap(masteredSkillIds, overrides = {}) {
  return {
    ...Object.fromEntries(masteredSkillIds.map((skillId) => [skillId, masteredState(skillId)])),
    ...overrides,
  };
}

function buildPlan({
  seed,
  skillStates,
  focusSkillId,
  dueReviewSkillIds,
  sessionLength = "standard",
  recentFatigueSessionCount = 0,
}) {
  return buildAdaptiveSessionPlan({
    learnerId: LEARNER_ID,
    seed,
    createdAt: 20_000_000,
    skillStates,
    focusSkillId,
    dueReviewSkillIds,
    sessionLength,
    recentFatigueSessionCount,
    optionalChallengeEnabled: true,
  });
}

function assertPlanSafety(plan, label) {
  assert.ok(plan.cards.length > 0, `${label}: nonempty session`);
  assert.ok(plan.cards.length <= MAX_ADAPTIVE_SESSION_CARDS, `${label}: bounded session`);
  assert.equal(plan.targetCardCount, plan.cards.length, `${label}: target matches cards`);
  assert.equal(
    new Set(plan.cards.map((card) => card.problem.fingerprint)).size,
    plan.cards.length,
    `${label}: fresh fingerprints`,
  );
  for (let index = 1; index < plan.cards.length; index += 1) {
    assert.notEqual(
      plan.cards[index - 1].problem.fingerprint,
      plan.cards[index].problem.fingerprint,
      `${label}: no immediate exact duplicate at ${index}`,
    );
  }
}

function runFiniteSession(plan, responseMs = 1_000) {
  let runtime = startAdaptiveSession(createAdaptiveSession(plan), 1_000);
  let now = 1_000;
  let transitions = 0;
  while (runtime.phase !== "complete" && runtime.phase !== "ended_early_for_fatigue") {
    assert.ok(runtime.currentProblem, "an active session always exposes a current problem");
    now += responseMs;
    runtime = advanceAdaptiveSession(runtime, now);
    transitions += 1;
    assert.ok(transitions <= MAX_ADAPTIVE_SESSION_CARDS, "session terminates within its card bound");
  }
  assert.equal(runtime.currentProblem, null);
  assert.ok(runtime.completedAt !== null);
  return runtime;
}

test("accurate but slow work masters concepts and unlocks dependents without claiming fluency", () => {
  const count = SKILLS_BY_ID.F01.masteryPolicy.minIndependentAttempts;
  const attempts = attemptsForSkill({
    profile: "accurate-slow",
    skillId: "F01",
    count,
    sessionCount: 2,
    responseAt: () => 7_500,
  });
  const states = deriveLearnerSkillStates(SKILL_DEFINITIONS, attempts);
  assert.equal(states.F01.conceptStatus, "mastered");
  assert.equal(states.F01.fluencyStatus, "developing");
  assert.equal(states.F01.weightedAccuracy, 1);
  assert.equal(states.F04.conceptStatus, "diagnostic", "concept mastery unlocks F04");

  const plan = buildPlan({
    seed: "accurate-slow-next-session",
    skillStates: states,
    focusSkillId: "F04",
  });
  assert.equal(plan.focusSkillId, "F04");
  assert.ok(plan.cards.some((card) => card.lane === "focus" && card.skillId === "F04"));
  assertPlanSafety(plan, "accurate-slow");
  assert.equal(runFiniteSession(plan).phase, "complete");
});

test("fast but inaccurate regrouping remains nonfluent and routes through R02 then R04", () => {
  const inaccuratePattern = [true, false, true, true, false, true, false, true];
  const r02Attempts = attemptsForSkill({
    profile: "fast-inaccurate-r02",
    skillId: "R02",
    count: inaccuratePattern.length,
    correctAt: (index) => inaccuratePattern[index],
    responseAt: () => 650,
  });
  const r04Attempts = attemptsForSkill({
    profile: "fast-inaccurate-r04",
    skillId: "R04",
    count: inaccuratePattern.length,
    correctAt: (index) => inaccuratePattern[index],
    responseAt: () => 700,
  });
  const r02 = reduceSkill("R02", r02Attempts);
  const r04 = reduceSkill("R04", r04Attempts);
  assert.equal(r02.conceptStatus, "learning");
  assert.equal(r04.conceptStatus, "learning");
  assert.equal(r02.fluencyStatus, "developing");
  assert.equal(r04.fluencyStatus, "developing");
  assert.notEqual(r02.fluencyStatus, "smooth");
  assert.notEqual(r04.fluencyStatus, "smooth");

  const beforeR02 = ["F01", "F02", "R01", "F04", "F03"];
  const r02Plan = buildPlan({
    seed: "fast-inaccurate-route-r02",
    skillStates: stateMap(beforeR02, { R02: r02 }),
  });
  assert.equal(r02Plan.focusSkillId, "R02");
  assertPlanSafety(r02Plan, "fast-inaccurate-r02");

  const beforeR04 = [...beforeR02, "R02", "R03"];
  const r04Plan = buildPlan({
    seed: "fast-inaccurate-route-r04",
    skillStates: stateMap(beforeR04, { R04: r04 }),
  });
  assert.equal(r04Plan.focusSkillId, "R04");
  assertPlanSafety(r04Plan, "fast-inaccurate-r04");
  assert.equal(runFiniteSession(r02Plan).phase, "complete");
  assert.equal(runFiniteSession(r04Plan).phase, "complete");
});

test("a fact bottleneck targets F04 and F05 instead of mastered place-value steps", () => {
  const outcomes = [true, false, true, true, true, false, true, true];
  const f04 = reduceSkill(
    "F04",
    attemptsForSkill({
      profile: "fact-bottleneck-f04",
      skillId: "F04",
      count: outcomes.length,
      correctAt: (index) => outcomes[index],
      responseAt: () => 6_000,
    }),
  );
  const f05 = reduceSkill(
    "F05",
    attemptsForSkill({
      profile: "fact-bottleneck-f05",
      skillId: "F05",
      count: outcomes.length,
      correctAt: (index) => outcomes[index],
      responseAt: () => 6_500,
    }),
  );
  assert.equal(f04.conceptStatus, "learning");
  assert.equal(f05.conceptStatus, "learning");
  assert.equal(masteredState("R02").conceptStatus, "mastered");
  assert.equal(masteredState("R04").conceptStatus, "mastered");

  const f04Plan = buildPlan({
    seed: "fact-bottleneck-route-f04",
    skillStates: stateMap(["F01", "F02", "R01", "R02", "R04"], { F04: f04 }),
  });
  assert.equal(f04Plan.focusSkillId, "F04");
  assert.equal(
    f04Plan.cards.some(
      (card) => card.lane === "focus" && (card.skillId === "R02" || card.skillId === "R04"),
    ),
    false,
  );
  assertPlanSafety(f04Plan, "fact-bottleneck-f04");

  const beforeF05 = ["F01", "F02", "R01", "F04", "F03", "R02", "R03", "R04", "R05"];
  const f05Plan = buildPlan({
    seed: "fact-bottleneck-route-f05",
    skillStates: stateMap(beforeF05, { F05: f05 }),
  });
  assert.equal(f05Plan.focusSkillId, "F05");
  assert.equal(
    f05Plan.cards.some(
      (card) => card.lane === "focus" && (card.skillId === "R02" || card.skillId === "R04"),
    ),
    false,
  );
  assertPlanSafety(f05Plan, "fact-bottleneck-f05");
  assert.equal(runFiniteSession(f05Plan).phase, "complete");
});

test("regrouped-state errors receive bounded R02/R04 scaffolding and full-problem integration", () => {
  const prerequisites = [
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
  ];
  const a03Learning = initialLearnerSkillState("A03", true);
  const plan = buildPlan({
    seed: "regrouped-state-plan",
    skillStates: stateMap(prerequisites, { A03: a03Learning }),
  });
  assert.equal(plan.focusSkillId, "A03");
  const failedIndex = plan.cards.findIndex(
    (card) => card.lane === "focus" && card.skillId === "A03",
  );
  assert.ok(failedIndex >= 0);
  const failed = plan.cards[failedIndex];
  const answer = failed.problem.expectedAnswer + 10;
  const errorCode = classifyAdaptiveError({ problem: failed.problem, answer });
  assert.equal(errorCode, "regrouped_state_lost");
  const attempt = makeAttempt({
    profile: "regrouped-state",
    skillId: "A03",
    index: failedIndex,
    problem: failed.problem,
    correct: false,
    answer,
    responseMs: 1_200,
    errorCode,
  });
  const priorSimilar = makeAttempt({
    profile: "regrouped-state-prior",
    skillId: "A03",
    index: 0,
    correct: false,
    responseMs: 1_100,
    errorCode: "regrouped_state_lost",
  });
  const decision = remediationDecision({
    problem: failed.problem,
    errorCode,
    recentComparableAttempts: [priorSimilar],
    seed: "regrouped-state-decision",
  });
  assert.equal(decision.probeSkillId, "R02");
  assert.deepEqual(decision.probeSkillIds, ["R02", "R04"]);
  assert.equal(decision.scaffoldCount, 2);
  assert.ok(decision.retryDelay >= 2 && decision.retryDelay <= 4);

  const replanned = replanAfterAttempt({
    plan,
    cardIndex: failedIndex,
    attempt,
    recentComparableAttempts: [priorSimilar],
  });
  const probes = replanned.cards.filter(
    (card) => card.remediationForProblemId === failed.problem.id,
  );
  const retries = replanned.cards.filter(
    (card) => card.delayedRetryForProblemId === failed.problem.id,
  );
  assert.equal(probes.length, 2);
  assert.deepEqual(
    probes.map((card) => card.skillId),
    ["R02", "R04"],
  );
  assert.equal(retries.length, 1);
  assert.equal(retries[0].skillId, "A03");
  assert.notEqual(retries[0].problem.fingerprint, failed.problem.fingerprint);
  assert.ok(replanned.cards.some((card) => card.lane === "integration"));
  assertPlanSafety(replanned, "regrouped-state-replan");
  assert.equal(runFiniteSession(replanned).phase, "complete");
});

test("one isolated execution slip preserves mastery and adds only one probe plus a fresh retry", () => {
  const correctCount = SKILLS_BY_ID.A03.masteryPolicy.minIndependentAttempts;
  const correctAttempts = attemptsForSkill({
    profile: "isolated-slip-mastery",
    skillId: "A03",
    count: correctCount,
    sessionCount: 2,
    responseAt: () => 7_000,
  });
  const slip = makeAttempt({
    profile: "isolated-slip-mastery",
    skillId: "A03",
    index: correctCount,
    count: correctCount + 1,
    sessionCount: 3,
    correct: false,
    responseMs: 7_200,
    errorCode: "execution_slip",
  });
  const state = reduceSkill("A03", [...correctAttempts, slip]);
  assert.equal(state.conceptStatus, "mastered");

  const prerequisites = [
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
  ];
  const plan = buildPlan({
    seed: "isolated-slip-plan",
    skillStates: stateMap(prerequisites, {
      A03: initialLearnerSkillState("A03", true),
    }),
  });
  assert.equal(plan.focusSkillId, "A03");
  const failedIndex = plan.cards.findIndex(
    (card) => card.lane === "focus" && card.skillId === "A03",
  );
  const failed = plan.cards[failedIndex];
  const planSlip = makeAttempt({
    profile: "isolated-slip-plan",
    skillId: "A03",
    index: failedIndex,
    problem: failed.problem,
    correct: false,
    responseMs: 7_200,
    errorCode: "execution_slip",
  });
  const replanned = replanAfterAttempt({ plan, cardIndex: failedIndex, attempt: planSlip });
  const probes = replanned.cards.filter(
    (card) => card.remediationForProblemId === failed.problem.id,
  );
  const retries = replanned.cards.filter(
    (card) => card.delayedRetryForProblemId === failed.problem.id,
  );
  assert.equal(probes.length, 1);
  assert.equal(retries.length, 1);
  assert.notEqual(retries[0].problem.fingerprint, failed.problem.fingerprint);
  const retryIndex = replanned.cards.indexOf(retries[0]);
  assert.ok(retryIndex - failedIndex >= 2 && retryIndex - failedIndex <= 4);
  assertPlanSafety(replanned, "isolated-slip-replan");
  assert.equal(runFiniteSession(replanned).phase, "complete");
});

test("late fatigue shortens to one easy close and automatically reduces the next target", () => {
  const states = stateMap(["F01", "F02", "R01"]);
  const plan = buildPlan({ seed: "fatigue-current-session", skillStates: states });
  assert.equal(plan.cards.length, STANDARD_SESSION_CARD_COUNT);
  assertPlanSafety(plan, "fatigue-original");

  let runtime = startAdaptiveSession(createAdaptiveSession(plan), 1_000);
  let now = 1_000;
  const attempts = [];
  const responseTimes = [2_000, 2_100, 1_900, 6_000, 6_500, 7_000];
  for (let index = 0; index < responseTimes.length; index += 1) {
    const problem = runtime.currentProblem;
    assert.ok(problem);
    attempts.push(
      makeAttempt({
        profile: "late-fatigue",
        skillId: problem.skillId,
        index,
        count: responseTimes.length,
        problem,
        correct: true,
        responseMs: responseTimes[index],
        correctionCount: index >= 3 ? 1 : 0,
      }),
    );
    now += responseTimes[index];
    if (index < responseTimes.length - 1) {
      runtime = advanceAdaptiveSession(runtime, now);
    }
  }
  const fatigue = detectSessionFatigue(attempts);
  assert.equal(fatigue.fatigued, true);
  assert.ok(fatigue.signals.includes("late_response_slowdown"));
  assert.ok(fatigue.signals.includes("late_correction_rise"));

  const easyClose = buildEasyCloseCard({
    seed: "fatigue-easy-close",
    skillStates: states,
    excludedFingerprints: plan.cards.map((card) => card.problem.fingerprint),
    cardIndex: runtime.currentCardIndex + 1,
  });
  const shortened = shortenAdaptiveSessionForFatigue(runtime, easyClose);
  assert.ok(shortened.targetCardCount < plan.targetCardCount);
  assert.equal(shortened.cards.at(-1).lane, "easy_close");
  assert.equal(shortened.cards.filter((card) => card.status === "planned").length, 1);
  runtime = advanceAdaptiveSession(shortened, now);
  assert.equal(runtime.phase, "easy_close");
  runtime = advanceAdaptiveSession(runtime, now + 1_000);
  assert.equal(runtime.phase, "ended_early_for_fatigue");

  const nextPlan = buildPlan({
    seed: "fatigue-next-session",
    skillStates: states,
    recentFatigueSessionCount: 2,
  });
  assert.equal(nextPlan.cards.length, SHORT_SESSION_CARD_COUNT);
  assert.ok(nextPlan.cards.length < plan.cards.length);
  assertPlanSafety(nextPlan, "fatigue-next-session");
  assert.equal(runFiniteSession(nextPlan).phase, "complete");
});

test("a slow accuracy plateau moves to bounded scheduled maintenance without more focused volume", () => {
  const attempts = attemptsForSkill({
    profile: "plateau-a03",
    skillId: "A03",
    count: 24,
    sessionCount: 4,
    responseAt: () => 30_000,
  });
  const plateau = reduceSkill("A03", attempts);
  assert.equal(plateau.conceptStatus, "mastered");
  assert.equal(plateau.fluencyStatus, "plateau");
  assert.equal(plateau.plateauExposureCount, 24);

  const beforeA03 = [
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
  ];
  const states = stateMap(beforeA03, { A03: plateau });
  const plan = buildPlan({
    seed: "plateau-maintenance-plan",
    skillStates: states,
    dueReviewSkillIds: ["A03"],
  });
  assert.notEqual(plan.focusSkillId, "A03");
  assert.equal(
    plan.cards.filter((card) => card.skillId === "A03" && card.lane === "focus").length,
    0,
  );
  const maintenanceCards = plan.cards.filter((card) => card.skillId === "A03");
  assert.equal(maintenanceCards.length, 1);
  assert.equal(maintenanceCards[0].lane, "review");
  assertPlanSafety(plan, "plateau-maintenance");
  assert.equal(runFiniteSession(plan).phase, "complete");
});

test("rejected low-confidence recognition changes no mastery, remediation, or timing evidence", () => {
  const prerequisites = [
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
  ];
  const startingState = initialLearnerSkillState("A03", true);
  const plan = buildPlan({
    seed: "recognition-rejected-plan",
    skillStates: stateMap(prerequisites, { A03: startingState }),
  });
  const cardIndex = plan.cards.findIndex(
    (card) => card.lane === "focus" && card.skillId === "A03",
  );
  const problem = plan.cards[cardIndex].problem;
  const attempt = makeAttempt({
    profile: "recognition-rejected",
    skillId: "A03",
    index: cardIndex,
    problem,
    correct: false,
    answer: null,
    responseMs: 2_800,
    rawRecognizedValue: "35",
    recognitionConfidence: 0.31,
    recognitionMargin: 0.02,
    recognitionConfirmedByChild: false,
    recognizerCorrection: false,
    errorCode: "recognition_uncertain",
  });
  const recognition = createRecognitionEvent({
    kind: "recognition_uncertain",
    learnerId: LEARNER_ID,
    sessionId: attempt.sessionId,
    problemId: problem.id,
    occurredAt: attempt.submittedAt,
    rawRecognizedValue: "35",
    normalizedRecognizedValue: null,
    recognitionConfidence: 0.31,
    recognitionMargin: 0.02,
    confirmedByChild: false,
  });
  assert.equal(recognition.kind, "recognition_uncertain");
  assert.equal(isIndependentEvidence(attempt), false);
  assert.equal(isTimingEligible(attempt), false);

  const state = reduceSkill("A03", [attempt], startingState);
  assert.equal(state.conceptStatus, startingState.conceptStatus);
  assert.equal(state.independentAttemptCount, 0);
  assert.equal(state.correctIndependentAttemptCount, 0);
  assert.equal(state.fluencyStatus, "not_started");
  assert.equal(state.initialCorrectMedianResponseMs, undefined);
  assert.equal(state.totalAttemptCount, 1, "raw event remains available for recognizer analytics");

  const replanned = replanAfterAttempt({ plan, cardIndex, attempt });
  assert.strictEqual(replanned, plan, "recognition uncertainty never inserts math remediation");
  assert.equal(
    replanned.cards.some(
      (card) =>
        card.remediationForProblemId === problem.id ||
        card.delayedRetryForProblemId === problem.id,
    ),
    false,
  );
  assertPlanSafety(plan, "recognition-rejected");
  assert.equal(runFiniteSession(plan).phase, "complete");
});
