import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ADAPTIVE_SESSION_CARDS,
  MAX_CARDS_PER_NARROW_SKILL,
  MAX_INITIAL_PRACTICE_CARDS_PER_NARROW_SKILL,
  buildAdaptiveSessionPlan,
  buildEasyCloseCard,
  classifyAdaptiveError,
  detectSessionFatigue,
  pendingCarryoverRemediation,
  remediationDecision,
  replanAfterAttempt,
} from "../app/lab/subtraction-flash/adaptive/planner.ts";
import {
  attemptWasEventuallyCorrect,
  createAttemptEvent,
} from "../app/lab/subtraction-flash/adaptive/attempts.ts";
import {
  generateProblem,
  generateProblemSet,
} from "../app/lab/subtraction-flash/adaptive/problems.ts";
import {
  enabledDefaultSkillIds,
  skillDefinition,
} from "../app/lab/subtraction-flash/adaptive/skills.ts";
import {
  ADAPTIVE_SESSION_SHOWS_COUNTDOWN,
  adaptiveSessionCompletedAsPlanned,
  advanceAdaptiveSession,
  backgroundAdaptiveSession,
  createAdaptiveSession,
  finishAdaptiveSession,
  foregroundAdaptiveSession,
  pauseAdaptiveSession,
  pendingAttemptForSession,
  resumeAdaptiveSession,
  shortenAdaptiveSessionForFatigue,
  startAdaptiveSession,
} from "../app/lab/subtraction-flash/adaptive/session.ts";

function state(skillId, overrides = {}) {
  return {
    skillId,
    conceptStatus: "learning",
    fluencyStatus: "developing",
    weightedAccuracy: 0.7,
    independentAttemptCount: 4,
    correctIndependentAttemptCount: 3,
    hintRate: 0,
    recentErrorCodes: [],
    plateauExposureCount: 0,
    consecutiveSuccessfulSessions: 0,
    recentIndependentResults: [true, false, true],
    ...overrides,
  };
}

function mastered(skillId, overrides = {}) {
  return state(skillId, {
    conceptStatus: "mastered",
    fluencyStatus: "smooth",
    weightedAccuracy: 0.96,
    independentAttemptCount: 16,
    correctIndependentAttemptCount: 15,
    recentIndependentResults: [true, true, true, true],
    ...overrides,
  });
}

function plan(changes = {}) {
  return buildAdaptiveSessionPlan({
    learnerId: "learner",
    seed: "planner-test",
    createdAt: 1_000,
    skillStates: {},
    ...changes,
  });
}

function counts(values) {
  return values.reduce((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

function arithmeticSignature(problem) {
  return JSON.stringify({
    skillId: problem.skillId,
    expectedAnswer: problem.expectedAnswer,
    operands: Object.fromEntries(Object.entries(problem.operands).sort()),
  });
}

function missedAttempt(planValue, cardIndex, changes = {}) {
  const card = planValue.cards[cardIndex];
  const expected = card.problem.expectedAnswer;
  const answer =
    expected === "yes" ? "no" : expected === "no" ? "yes" : expected + 1;
  return createAttemptEvent({
    learnerId: planValue.learnerId,
    sessionId: planValue.id,
    sessionPosition: cardIndex,
    sessionLane: card.lane,
    problem: card.problem,
    shownAt: 1_000 + cardIndex * 100,
    submittedAt: 1_050 + cardIndex * 100,
    answer,
    rawRecognizedValue: String(answer),
    firstAttemptCorrect: false,
    errorCode: card.skillId.startsWith("F")
      ? "fact_retrieval_error"
      : "unclassified_math_error",
    ...changes,
  });
}

test("diagnostic sessions follow their finite placement mixtures", () => {
  const first = plan({ seed: "diagnostic-1", diagnosticSessionNumber: 1 });
  assert.equal(first.kind, "diagnostic");
  assert.equal(first.cards.length, 10);
  assert.deepEqual(counts(first.cards.map((card) => card.skillId)), {
    F04: 2,
    A02: 3,
    R01: 2,
    F05: 2,
    T05: 1,
  });
  assert.deepEqual(
    first.cards
      .filter(({ skillId }) => skillId === "R01")
      .map(({ problem }) => problem.expectedAnswer)
      .sort(),
    ["no", "yes"],
  );

  const second = plan({ seed: "diagnostic-2", diagnosticSessionNumber: 2 });
  const secondCounts = counts(second.cards.map((card) => card.skillId));
  assert.ok(second.cards.length >= 8 && second.cards.length <= 10);
  assert.equal(secondCounts.R02, 2);
  assert.deepEqual(
    second.cards
      .filter(({ skillId }) => skillId === "R02")
      .map(({ problem }) => problem.metadata.renameQuestion)
      .sort(),
    ["renamed_ones", "renamed_tens"],
  );
  assert.equal(secondCounts.R03, 1);
  assert.equal(secondCounts.R04, 1);
  assert.equal(secondCounts.A03, 4);
  assert.equal(second.cards.at(-1).lane, "easy_close");

  const third = plan({ seed: "diagnostic-3", diagnosticSessionNumber: 3 });
  const thirdCounts = counts(third.cards.map((card) => card.skillId));
  assert.equal(third.cards.length, 10);
  assert.equal((thirdCounts.A02 ?? 0) + (thirdCounts.A03 ?? 0), 6);
  assert.equal(thirdCounts.A04, 1);
  assert.equal(thirdCounts.A05, 1);
  assert.equal(thirdCounts.T02, 1);
  assert.equal(thirdCounts.T05, 1);

  for (const diagnosticSessionNumber of [1, 2, 3]) {
    const short = plan({
      seed: `diagnostic-short-${diagnosticSessionNumber}`,
      diagnosticSessionNumber,
      sessionLength: "short",
    });
    assert.equal(short.cards.length, 8);
    assert.equal(short.cards.at(-1).lane, "easy_close");
  }
});

test("first-diagnostic T05 cards keep their T01 fallback introductory-safe", () => {
  for (let seedIndex = 0; seedIndex < 120; seedIndex += 1) {
    const diagnostic = plan({
      seed: `diagnostic-t05-safe-${seedIndex}`,
      diagnosticSessionNumber: 1,
    });
    const challenge = diagnostic.cards.find((card) => card.skillId === "T05");
    assert.ok(challenge);
    assert.equal(challenge.problem.difficulty, 3);
    if (challenge.problem.metadata.sourceSkillId === "T01") {
      assert.notEqual(challenge.problem.metadata.missingTerm, "left");
    }
  }
});

test("diagnosis stops probing a mastered or strongly demonstrated skill", () => {
  const demonstratedA02 = state("A02", {
    weightedAccuracy: 0.95,
    independentAttemptCount: 3,
    correctIndependentAttemptCount: 3,
    recentIndependentResults: [true, true, true],
  });
  const diagnostic = plan({
    seed: "skip-demonstrated",
    diagnosticSessionNumber: 1,
    skillStates: { A02: demonstratedA02, F04: mastered("F04") },
  });
  assert.ok(diagnostic.cards.length >= 8 && diagnostic.cards.length <= 10);
  assert.equal(
    diagnostic.cards.some(
      (card) =>
        card.lane === "diagnostic" && (card.skillId === "A02" || card.skillId === "F04"),
    ),
    false,
  );
});

test("normal plans are deterministic, finite, varied, and fresh", () => {
  const first = plan({ seed: "deterministic", sessionLength: "standard" });
  const again = plan({ seed: "deterministic", sessionLength: "standard" });
  assert.deepEqual(again, first);
  assert.equal(first.cards.length, 10);
  assert.equal(plan({ seed: "short", sessionLength: "short" }).cards.length, 8);
  assert.equal(new Set(first.cards.map((card) => card.problem.fingerprint)).size, 10);

  const perSkill = counts(first.cards.map((card) => card.skillId));
  assert.ok(
    Object.values(perSkill).every(
      (count) => count <= MAX_INITIAL_PRACTICE_CARDS_PER_NARROW_SKILL,
    ),
  );
  for (let index = 2; index < first.cards.length; index += 1) {
    const template = first.cards[index].problem.metadata.templateId;
    assert.equal(
      first.cards[index - 1].problem.metadata.templateId === template &&
        first.cards[index - 2].problem.metadata.templateId === template,
      false,
    );
  }

  const recentFingerprints = first.cards.slice(0, 4).map((card) => card.problem.fingerprint);
  const fresh = plan({ seed: "deterministic", recentFingerprints });
  assert.ok(
    fresh.cards.every((card) => !recentFingerprints.includes(card.problem.fingerprint)),
  );
});

test("only actually due skills use the spaced-review lane", () => {
  const noReviewDue = plan({
    seed: "no-review-due",
    skillStates: { F04: mastered("F04") },
  });
  assert.equal(noReviewDue.cards.some((card) => card.lane === "review"), false);

  const dueReview = plan({
    seed: "review-is-due",
    dueReviewSkillIds: ["F04"],
    skillStates: { F04: mastered("F04") },
  });
  const reviewCards = dueReview.cards.filter((card) => card.lane === "review");
  assert.equal(reviewCards.length, 1);
  assert.equal(reviewCards[0].skillId, "F04");
});

test("exhausted F01 history relaxes gracefully without a within-session repeat", () => {
  const historicalF01 = generateProblemSet({
    skillId: "F01",
    seed: "all-f01-pairs",
    count: 5,
  });
  assert.equal(new Set(historicalF01.map((problem) => problem.fingerprint)).size, 5);

  const planned = plan({
    seed: "f01-history-exhausted",
    focusSkillId: "F01",
    skillStates: { F01: state("F01") },
    recentFingerprints: historicalF01.map((problem) => problem.fingerprint),
  });
  const plannedF01 = planned.cards.filter((card) => card.skillId === "F01");
  assert.ok(plannedF01.length >= 2);
  assert.equal(
    new Set(plannedF01.map((card) => card.problem.fingerprint)).size,
    plannedF01.length,
  );
  assert.equal(
    new Set(planned.cards.map((card) => card.problem.fingerprint)).size,
    planned.cards.length,
  );

  const source = plan({
    seed: "f01-carryover-source",
    focusSkillId: "F01",
    skillStates: { F01: state("F01") },
  });
  const sourceIndex = source.cards.findIndex((card) => card.skillId === "F01");
  const miss = missedAttempt(source, sourceIndex);
  const carryover = plan({
    seed: "f01-carryover-history-exhausted",
    focusSkillId: "F01",
    skillStates: { F01: state("F01") },
    attemptEvents: [miss],
    recentFingerprints: historicalF01.map((problem) => problem.fingerprint),
  });
  assertLinkedCarryover(carryover, miss);
});

test("every normal focus reserves a fourth narrow-skill slot for adaptation", () => {
  const focusSkills = enabledDefaultSkillIds().filter((skillId) => skillId !== "T05");
  for (const focusSkillId of focusSkills) {
    for (const sessionLength of ["short", "standard"]) {
      for (let seedIndex = 0; seedIndex < 4; seedIndex += 1) {
        const planned = plan({
          seed: `reserve:${focusSkillId}:${sessionLength}:${seedIndex}`,
          focusSkillId,
          sessionLength,
          skillStates: { [focusSkillId]: state(focusSkillId) },
        });
        assert.ok(
          Object.values(counts(planned.cards.map((card) => card.skillId))).every(
            (count) => count <= MAX_INITIAL_PRACTICE_CARDS_PER_NARROW_SKILL,
          ),
          `${focusSkillId} ${sessionLength} reserves remediation capacity`,
        );
      }
    }
  }
});

test("T01 plans start with missing results or subtrahends before missing minuends", () => {
  for (let seedIndex = 0; seedIndex < 40; seedIndex += 1) {
    const introductory = plan({
      seed: `t01-introductory-band-${seedIndex}`,
      focusSkillId: "T01",
      skillStates: { T01: state("T01", { independentAttemptCount: 0 }) },
    });
    const introductoryCards = introductory.cards.filter(
      (card) => card.skillId === "T01",
    );
    assert.ok(introductoryCards.length > 0);
    assert.ok(introductoryCards.every((card) => card.problem.difficulty === 3));
    assert.ok(
      introductoryCards.every((card) => card.problem.metadata.missingTerm !== "left"),
    );

    const later = plan({
      seed: `t01-later-band-${seedIndex}`,
      focusSkillId: "T01",
      skillStates: { T01: state("T01", { independentAttemptCount: 4 }) },
    });
    const laterCards = later.cards.filter((card) => card.skillId === "T01");
    assert.ok(laterCards.length > 0);
    assert.ok(laterCards.every((card) => card.problem.difficulty === 4));
  }
});

test("T03 plans deliberately pair identical math across opposite formats", () => {
  for (let seedIndex = 0; seedIndex < 80; seedIndex += 1) {
    const planned = plan({
      seed: `t03-format-pair-${seedIndex}`,
      focusSkillId: "T03",
      skillStates: { T03: state("T03") },
    });
    const formatCards = planned.cards.filter((card) => card.skillId === "T03");
    assert.ok(formatCards.length >= 2);
    assert.equal(formatCards.length % 2, 0);
    for (let index = 0; index < formatCards.length; index += 2) {
      const first = formatCards[index];
      const second = formatCards[index + 1];
      assert.equal(second.problem.seed, first.problem.seed);
      assert.deepEqual(second.problem.operands, first.problem.operands);
      assert.equal(second.problem.expectedAnswer, first.problem.expectedAnswer);
      assert.deepEqual(
        new Set([
          first.problem.metadata.format,
          second.problem.metadata.format,
        ]),
        new Set(["horizontal", "vertical"]),
      );
      assert.notEqual(second.problem.fingerprint, first.problem.fingerprint);
    }
  }
});

test("T03 pair selection avoids a historically seen opposite-format partner", () => {
  const input = {
    seed: "t03-history",
    focusSkillId: "T03",
    skillStates: { T03: state("T03") },
  };
  const initial = plan(input);
  const initialPair = initial.cards.filter((card) => card.skillId === "T03");
  assert.ok(initialPair.length >= 2);
  const blockedPartner = initialPair[1].problem.fingerprint;

  const fresh = plan({ ...input, recentFingerprints: [blockedPartner] });
  const freshPair = fresh.cards.filter((card) => card.skillId === "T03");
  assert.ok(freshPair.length >= 2);
  assert.ok(
    freshPair.every((card) => card.problem.fingerprint !== blockedPartner),
  );
  assert.deepEqual(freshPair[0].problem.operands, freshPair[1].problem.operands);
  assert.notEqual(freshPair[0].problem.seed, initialPair[0].problem.seed);
});

test("a carried T03 retry stays fresh while retaining its cross-format pair", () => {
  const source = plan({
    seed: "t03-carry-source",
    focusSkillId: "T03",
    skillStates: { T03: state("T03") },
  });
  const sourceIndex = source.cards.findIndex((card) => card.skillId === "T03");
  const miss = missedAttempt(source, sourceIndex);
  const next = plan({
    seed: "t03-carry-next",
    focusSkillId: "F01",
    skillStates: { F01: state("F01"), T03: state("T03") },
    attemptEvents: [miss],
    recentFingerprints: [miss.problemFingerprint],
  });
  const retry = next.cards.find(
    (card) => card.delayedRetryForProblemId === miss.problemId,
  );
  assert.ok(retry);
  assert.notDeepEqual(retry.problem.operands, miss.operands);
  const paired = next.cards.filter(
    (card) =>
      card.skillId === "T03" && card.problem.seed === retry.problem.seed,
  );
  assert.equal(paired.length, 2);
  assert.deepEqual(paired[0].problem.operands, paired[1].problem.operands);
  assert.deepEqual(
    new Set(paired.map((card) => card.problem.metadata.format)),
    new Set(["horizontal", "vertical"]),
  );
});

test("concept mastery unlocks progress even while prior fluency is developing", () => {
  const masteredIds = [
    "F01",
    "F02",
    "F03",
    "F04",
    "F05",
    "R01",
    "R02",
    "R03",
    "R04",
    "R05",
    "A01",
    "A02",
  ];
  const skillStates = Object.fromEntries(
    masteredIds.map((skillId) => [skillId, mastered(skillId)]),
  );
  skillStates.A03 = mastered("A03", { fluencyStatus: "developing" });
  const next = plan({ seed: "concept-before-speed", skillStates });
  assert.equal(next.focusSkillId, "A04");
  assert.ok(next.cards.some((card) => card.skillId === "A04"));
});

test("weekly benchmarks are fresh 8–10 card mixes and never own a focus gate", () => {
  const initial = plan({
    seed: "benchmark",
    sessionKind: "benchmark",
    sessionLength: "standard",
    maxActiveDurationMs: 345_000,
  });
  assert.equal(initial.kind, "benchmark");
  assert.equal(initial.focusSkillId, null);
  assert.equal(initial.cards.length, 10);
  assert.equal(initial.maxActiveDurationMs, 345_000);
  assert.equal(initial.cards.filter((card) => card.skillId === "A04").length, 1);
  assert.ok(initial.cards.some((card) => card.skillId === "A02"));
  assert.ok(initial.cards.some((card) => card.skillId === "A03"));
  assert.ok(initial.cards.filter((card) => card.skillId === "A05").length <= 1);

  const short = plan({
    seed: "benchmark-short",
    sessionKind: "benchmark",
    sessionLength: "short",
  });
  assert.equal(short.cards.length, 8);
  assert.equal(short.cards.at(-1).lane, "easy_close");
  assert.equal(short.cards.filter((card) => card.skillId === "A04").length, 1);

  const prior = initial.cards.map((card) => card.problem.fingerprint);
  const fresh = plan({
    seed: "benchmark",
    sessionKind: "benchmark",
    recentFingerprints: prior,
  });
  assert.ok(fresh.cards.every((card) => !prior.includes(card.problem.fingerprint)));
});

test("two recent fatigue-shortened sessions reduce and soften the next plan", () => {
  const adjusted = plan({ seed: "fatigue-adjusted", recentFatigueSessionCount: 2 });
  assert.equal(adjusted.cards.length, 8);
  assert.equal(adjusted.maxActiveDurationMs, 8 * 60 * 1_000);
  assert.equal(adjusted.cards.filter((card) => card.lane === "warmup").length, 3);
  assert.equal(adjusted.cards.at(-1).lane, "easy_close");
});

test("error classification uses only strongly supported answer patterns", () => {
  const regrouping = generateProblem({ skillId: "A03", seed: "classify-regrouping" });
  assert.equal(typeof regrouping.expectedAnswer, "number");
  assert.equal(
    classifyAdaptiveError({
      problem: regrouping,
      answer: regrouping.expectedAnswer + 10,
      recognitionConfirmedByChild: true,
    }),
    "regrouped_state_lost",
  );
  assert.equal(
    classifyAdaptiveError({
      problem: regrouping,
      answer: regrouping.operands.minuend + regrouping.operands.subtrahend,
    }),
    "wrong_operation",
  );

  const answerText = String(regrouping.expectedAnswer);
  const reversed = Number([...answerText].reverse().join(""));
  if (reversed !== regrouping.expectedAnswer) {
    assert.equal(
      classifyAdaptiveError({ problem: regrouping, answer: reversed }),
      "digit_transposition",
    );
    assert.equal(
      classifyAdaptiveError({
        problem: regrouping,
        answer: reversed,
        recognitionConfirmedByChild: true,
      }),
      "digit_transposition",
    );
  }
  const endingZero = { ...regrouping, expectedAnswer: 20 };
  assert.equal(
    classifyAdaptiveError({
      problem: endingZero,
      answer: 2,
      rawAnswerText: "02",
      recognitionConfirmedByChild: true,
    }),
    "digit_transposition",
  );
  assert.equal(
    classifyAdaptiveError({
      problem: regrouping,
      answer: null,
      recognitionUncertain: true,
    }),
    "recognition_uncertain",
  );

  const fact = generateProblem({ skillId: "F04", seed: "classify-fact" });
  assert.equal(
    classifyAdaptiveError({ problem: fact, answer: Number(fact.expectedAnswer) + 1 }),
    "fact_retrieval_error",
  );
});

test("remediation uses one conservative probe, distinct bounded scaffolds on repeat", () => {
  const problem = generateProblem({ skillId: "A03", seed: "remediation" });
  const isolated = remediationDecision({
    problem,
    errorCode: "regrouped_state_lost",
    seed: "isolated",
  });
  assert.deepEqual(isolated.probeSkillIds, ["R02"]);
  assert.equal(isolated.scaffoldCount, 1);
  assert.ok(isolated.retryDelay >= 2 && isolated.retryDelay <= 4);

  const repeated = remediationDecision({
    problem,
    errorCode: "regrouped_state_lost",
    seed: "repeated",
    recentComparableAttempts: [{ errorCode: "regrouped_state_lost" }],
  });
  assert.deepEqual(repeated.probeSkillIds, ["R02", "R04"]);
  assert.equal(repeated.scaffoldCount, 2);

  const fact = generateProblem({ skillId: "F04", seed: "fact-remediation" });
  assert.deepEqual(
    remediationDecision({ problem: fact, errorCode: "fact_retrieval_error" })
      .probeSkillIds,
    ["F04"],
  );
});

test("a failed card gets fresh scaffolding and a nonidentical delayed retry", () => {
  const original = plan({ seed: "replan", sessionLength: "standard" });
  const failedIndex = original.cards.findIndex((card) => card.skillId === original.focusSkillId);
  const failed = original.cards[failedIndex];
  const attempt = {
    problemId: failed.problem.id,
    firstAttemptCorrect: false,
    errorCode: "regrouped_state_lost",
    normalizedRecognizedValue: Number(failed.problem.expectedAnswer) + 10,
    rawRecognizedValue: String(Number(failed.problem.expectedAnswer) + 10),
    recognitionConfirmedByChild: true,
  };
  const replanned = replanAfterAttempt({ plan: original, cardIndex: failedIndex, attempt });
  const retryIndex = replanned.cards.findIndex(
    (card) => card.delayedRetryForProblemId === failed.problem.id,
  );
  assert.ok(retryIndex - failedIndex >= 2 && retryIndex - failedIndex <= 4);
  assert.notEqual(replanned.cards[retryIndex].problem.fingerprint, failed.problem.fingerprint);
  assert.notEqual(
    arithmeticSignature(replanned.cards[retryIndex].problem),
    arithmeticSignature(failed.problem),
  );
  assert.notEqual(
    replanned.cards[failedIndex + 1].problem.fingerprint,
    failed.problem.fingerprint,
  );
  assert.ok(replanned.cards.length <= MAX_ADAPTIVE_SESSION_CARDS);
  assert.equal(replanned.cards.at(-1).lane, "easy_close");
  assert.equal(
    new Set(replanned.cards.map((card) => card.problem.fingerprint)).size,
    replanned.cards.length,
  );
  assert.ok(
    Object.values(counts(replanned.cards.map((card) => card.skillId))).every(
      (count) => count <= MAX_CARDS_PER_NARROW_SKILL,
    ),
  );

  const repeated = replanAfterAttempt({
    plan: original,
    cardIndex: failedIndex,
    attempt,
    recentComparableAttempts: [{ errorCode: "regrouped_state_lost" }],
  });
  assert.deepEqual(
    repeated.cards
      .filter((card) => card.remediationForProblemId === failed.problem.id)
      .map((card) => card.skillId),
    ["R02", "R04"],
  );
});

function assertLinkedCarryover(nextPlan, miss) {
  const probes = nextPlan.cards.filter(
    (card) => card.remediationForProblemId === miss.problemId,
  );
  const retries = nextPlan.cards.filter(
    (card) => card.delayedRetryForProblemId === miss.problemId,
  );
  assert.ok(probes.length >= 1);
  assert.equal(retries.length, 1);
  const probeIndex = nextPlan.cards.indexOf(probes[0]);
  const retryIndex = nextPlan.cards.indexOf(retries[0]);
  assert.ok(retryIndex - probeIndex >= 2 && retryIndex - probeIndex <= 4);
  assert.equal(retries[0].skillId, miss.skillId);
  assert.notEqual(retries[0].problem.fingerprint, miss.problemFingerprint);
  assert.equal(nextPlan.cards.length, nextPlan.targetCardCount);
}

test("an unresolved easy-close miss carries a linked probe and delayed fresh retry", () => {
  const source = plan({ seed: "carryover-easy-close", sessionLength: "short" });
  const closeIndex = source.cards.length - 1;
  assert.equal(source.cards[closeIndex].lane, "easy_close");
  const miss = missedAttempt(source, closeIndex);
  assert.equal(pendingCarryoverRemediation([miss]), miss);

  const next = plan({
    seed: "carryover-after-easy-close",
    sessionLength: "short",
    attemptEvents: [miss],
    recentFingerprints: [miss.problemFingerprint],
  });
  assertLinkedCarryover(next, miss);
});

test("a miss on the time-capped card carries over without adding late cards", () => {
  const source = plan({
    seed: "carryover-time-cap-source",
    sessionLength: "short",
    maxActiveDurationMs: 1,
  });
  const started = startAdaptiveSession(createAdaptiveSession(source), 1_000);
  const miss = missedAttempt(source, 0);
  const capped = advanceAdaptiveSession(started, 1_010);
  assert.equal(capped.phase, "complete");
  assert.equal(
    capped.cards.some((card) => card.remediationForProblemId === miss.problemId),
    false,
  );

  const next = plan({
    seed: "carryover-after-time-cap",
    attemptEvents: [miss],
    recentFingerprints: [miss.problemFingerprint],
  });
  assertLinkedCarryover(next, miss);
});

test("fatigue-related misses never start next-session remediation", () => {
  const source = plan({ seed: "fatigue-no-carryover", sessionLength: "short" });
  const miss = missedAttempt(source, 0, {
    errorCode: "fatigue_related_error",
  });
  assert.equal(pendingCarryoverRemediation([miss]), null);
  const next = plan({
    seed: "after-fatigue-no-carryover",
    attemptEvents: [miss],
  });
  assert.equal(
    next.cards.some(
      (card) =>
        card.remediationForProblemId === miss.problemId ||
        card.delayedRetryForProblemId === miss.problemId,
    ),
    false,
  );
});

test("retry chains keep the original miss as their append-only resolution root", () => {
  const source = plan({ seed: "retry-chain-root", sessionLength: "standard" });
  const originalIndex = source.cards.findIndex((card) => card.lane === "focus");
  const originalMiss = missedAttempt(source, originalIndex);
  const firstReplan = replanAfterAttempt({
    plan: source,
    cardIndex: originalIndex,
    attempt: originalMiss,
  });
  const firstRetryIndex = firstReplan.cards.findIndex(
    (card) => card.delayedRetryForProblemId === originalMiss.problemId,
  );
  assert.ok(firstRetryIndex > originalIndex);
  const firstRetryMiss = missedAttempt(firstReplan, firstRetryIndex, {
    relatedProblemId: originalMiss.problemId,
    relatedProblemRelation: "delayed_retry",
  });

  const secondReplan = replanAfterAttempt({
    plan: firstReplan,
    cardIndex: firstRetryIndex,
    attempt: firstRetryMiss,
  });
  const secondRetry = secondReplan.cards.find(
    (card) =>
      card.delayedRetryForProblemId === originalMiss.problemId &&
      card.problem.id !== firstRetryMiss.problemId,
  );
  assert.ok(secondRetry);
  assert.equal(secondRetry.delayedRetryForProblemId, originalMiss.problemId);
  const secondRetryCorrect = createAttemptEvent({
    learnerId: secondReplan.learnerId,
    sessionId: secondReplan.id,
    sessionPosition: secondReplan.cards.indexOf(secondRetry),
    sessionLane: secondRetry.lane,
    relatedProblemId: originalMiss.problemId,
    relatedProblemRelation: "delayed_retry",
    problem: secondRetry.problem,
    shownAt: 3_000,
    submittedAt: 3_050,
    answer: secondRetry.problem.expectedAnswer,
    rawRecognizedValue: String(secondRetry.problem.expectedAnswer),
    firstAttemptCorrect: true,
  });
  const events = [originalMiss, firstRetryMiss, secondRetryCorrect];
  assert.equal(attemptWasEventuallyCorrect(originalMiss, events), true);
  assert.equal(pendingCarryoverRemediation(events), null);
});

test("a failed component probe still recreates the original full-problem retry", () => {
  const source = plan({
    seed: "probe-chain-root",
    focusSkillId: "A03",
    skillStates: { A03: state("A03") },
  });
  const originalIndex = source.cards.findIndex((card) => card.skillId === "A03");
  const originalMiss = missedAttempt(source, originalIndex, {
    errorCode: "regrouped_state_lost",
  });
  const firstReplan = replanAfterAttempt({
    plan: source,
    cardIndex: originalIndex,
    attempt: originalMiss,
  });
  const probeIndex = firstReplan.cards.findIndex(
    (card) =>
      card.remediationForProblemId === originalMiss.problemId &&
      card.skillId === "R02",
  );
  assert.ok(probeIndex > originalIndex);
  const probeMiss = missedAttempt(firstReplan, probeIndex, {
    relatedProblemId: originalMiss.problemId,
    relatedProblemRelation: "remediation_probe",
    errorCode: "regrouped_state_lost",
  });

  const secondReplan = replanAfterAttempt({
    plan: firstReplan,
    cardIndex: probeIndex,
    attempt: probeMiss,
  });
  const rootRetry = secondReplan.cards.find(
    (card) =>
      card.delayedRetryForProblemId === originalMiss.problemId &&
      card.skillId === "A03",
  );
  assert.ok(rootRetry);
  const retryCorrect = createAttemptEvent({
    learnerId: secondReplan.learnerId,
    sessionId: secondReplan.id,
    sessionPosition: secondReplan.cards.indexOf(rootRetry),
    sessionLane: rootRetry.lane,
    relatedProblemId: originalMiss.problemId,
    relatedProblemRelation: "delayed_retry",
    problem: rootRetry.problem,
    shownAt: 4_000,
    submittedAt: 4_050,
    answer: rootRetry.problem.expectedAnswer,
    rawRecognizedValue: String(rootRetry.problem.expectedAnswer),
    firstAttemptCorrect: true,
  });
  const events = [originalMiss, probeMiss, retryCorrect];
  assert.equal(attemptWasEventuallyCorrect(originalMiss, events), true);
  assert.equal(pendingCarryoverRemediation(events), null);
});

test("a failed cross-session probe still retries the original full-problem skill", () => {
  const source = plan({
    seed: "cross-session-probe-root-source",
    focusSkillId: "A03",
    skillStates: { A03: state("A03") },
  });
  const originalIndex = source.cards.findIndex((card) => card.skillId === "A03");
  const originalMiss = missedAttempt(source, originalIndex, {
    errorCode: "regrouped_state_lost",
  });
  const carryover = plan({
    seed: "cross-session-probe-root-carryover",
    focusSkillId: "A03",
    skillStates: { A03: state("A03") },
    attemptEvents: [originalMiss],
    recentFingerprints: [originalMiss.problemFingerprint],
  });
  assert.equal(
    carryover.cards.some((card) => card.problem.id === originalMiss.problemId),
    false,
  );
  const probeIndex = carryover.cards.findIndex(
    (card) =>
      card.remediationForProblemId === originalMiss.problemId &&
      card.skillId === "R02",
  );
  assert.ok(probeIndex >= 0);
  assert.ok(
    carryover.cards.some(
      (card) =>
        card.delayedRetryForProblemId === originalMiss.problemId &&
        card.skillId === "A03",
    ),
  );

  const probeMiss = missedAttempt(carryover, probeIndex, {
    relatedProblemId: originalMiss.problemId,
    relatedProblemRelation: "remediation_probe",
    errorCode: "regrouped_state_lost",
  });
  const replanned = replanAfterAttempt({
    plan: carryover,
    cardIndex: probeIndex,
    attempt: probeMiss,
  });
  const rootRetry = replanned.cards.find(
    (card) =>
      card.delayedRetryForProblemId === originalMiss.problemId &&
      card.skillId === "A03",
  );
  assert.ok(rootRetry);
  const retryCorrect = createAttemptEvent({
    learnerId: replanned.learnerId,
    sessionId: replanned.id,
    sessionPosition: replanned.cards.indexOf(rootRetry),
    sessionLane: rootRetry.lane,
    relatedProblemId: originalMiss.problemId,
    relatedProblemRelation: "delayed_retry",
    problem: rootRetry.problem,
    shownAt: 5_000,
    submittedAt: 5_050,
    answer: rootRetry.problem.expectedAnswer,
    rawRecognizedValue: String(rootRetry.problem.expectedAnswer),
    firstAttemptCorrect: true,
  });
  const events = [originalMiss, probeMiss, retryCorrect];
  assert.equal(attemptWasEventuallyCorrect(originalMiss, events), true);
  assert.equal(pendingCarryoverRemediation(events), null);
});

test("T03 remediation probes arrive as a linked horizontal-vertical pair", () => {
  const source = plan({
    seed: "t03-remediation-pair",
    focusSkillId: "A03",
    skillStates: { A03: state("A03") },
  });
  const failedIndex = source.cards.findIndex((card) => card.skillId === "A03");
  const miss = missedAttempt(source, failedIndex, {
    errorCode: "digit_transposition",
  });
  const replanned = replanAfterAttempt({
    plan: source,
    cardIndex: failedIndex,
    attempt: miss,
  });
  const probes = replanned.cards.filter(
    (card) =>
      card.remediationForProblemId === miss.problemId &&
      card.skillId === "T03",
  );
  assert.equal(probes.length, 2);
  assert.equal(probes[0].problem.seed, probes[1].problem.seed);
  assert.deepEqual(probes[0].problem.operands, probes[1].problem.operands);
  assert.deepEqual(
    new Set(probes.map((card) => card.problem.metadata.format)),
    new Set(["horizontal", "vertical"]),
  );
  assert.ok(
    replanned.cards.some(
      (card) =>
        card.delayedRetryForProblemId === miss.problemId &&
        card.skillId === "A03",
    ),
  );
});

test("a T03 remediation too late for its pair and root retry is deferred whole", () => {
  const source = plan({
    seed: "late-t03-remediation-source",
    focusSkillId: "A03",
    skillStates: { A03: state("A03") },
  });
  const close = source.cards.at(-1);
  assert.equal(close.lane, "easy_close");
  const prefix = source.cards.filter((card) => card !== close);
  const excluded = new Set(prefix.map((card) => card.problem.fingerprint));
  const fillerProblems = generateProblemSet({
    skillIds: ["F02", "F03", "F04", "A01"],
    seed: "late-t03-remediation-fillers",
    count: 12 - prefix.length,
    excludedFingerprints: [...excluded],
  });
  for (const [index, problem] of fillerProblems.entries()) {
    prefix.push({
      id: `late-t03-filler-${index}`,
      lane: "integration",
      reason: "Fill the already-planned prefix for a capacity regression.",
      problem,
      skillId: problem.skillId,
      status: "planned",
      remediationForProblemId: null,
      delayedRetryForProblemId: null,
    });
    excluded.add(problem.fingerprint);
  }
  assert.equal(prefix.length, 12);
  const [failedProblem] = generateProblemSet({
    skillId: "A03",
    seed: "late-t03-remediation-failure",
    count: 1,
    excludedFingerprints: [...excluded, close.problem.fingerprint],
  });
  const failedCard = {
    id: "late-t03-failed-card",
    lane: "focus",
    reason: "Exercise the near-cap remediation boundary.",
    problem: failedProblem,
    skillId: failedProblem.skillId,
    status: "planned",
    remediationForProblemId: null,
    delayedRetryForProblemId: null,
  };
  const latePlan = {
    ...source,
    id: "late-t03-remediation-plan",
    targetCardCount: MAX_ADAPTIVE_SESSION_CARDS,
    cards: [...prefix, failedCard, close],
  };
  assert.equal(latePlan.cards.length, 14);
  const miss = missedAttempt(latePlan, 12, {
    errorCode: "digit_transposition",
  });

  const deferred = replanAfterAttempt({
    plan: latePlan,
    cardIndex: 12,
    attempt: miss,
  });
  assert.equal(deferred, latePlan);
  assert.equal(
    deferred.cards.some(
      (card) =>
        card.remediationForProblemId === miss.problemId ||
        card.delayedRetryForProblemId === miss.problemId,
    ),
    false,
  );
  assert.equal(pendingCarryoverRemediation([miss]), miss);

  const next = plan({
    seed: "late-t03-remediation-next-session",
    focusSkillId: "A03",
    skillStates: { A03: state("A03") },
    attemptEvents: [miss],
    recentFingerprints: [miss.problemFingerprint],
  });
  assertLinkedCarryover(next, miss);
  const probes = next.cards.filter(
    (card) =>
      card.remediationForProblemId === miss.problemId &&
      card.skillId === "T03",
  );
  assert.equal(probes.length, 2);
  assert.deepEqual(
    new Set(probes.map((card) => card.problem.metadata.format)),
    new Set(["horizontal", "vertical"]),
  );
});

test("benchmark misses never alter the fixed benchmark plan", () => {
  const benchmark = plan({
    seed: "benchmark-no-replan",
    sessionKind: "benchmark",
    sessionLength: "short",
  });
  const miss = missedAttempt(benchmark, 0);
  const replanned = replanAfterAttempt({
    plan: benchmark,
    cardIndex: 0,
    attempt: miss,
  });
  assert.equal(replanned, benchmark);
  assert.equal(replanned.cards.length, 8);
  assert.deepEqual(
    replanned.cards.map((card) => card.skillId),
    benchmark.cards.map((card) => card.skillId),
  );
});

test("remediation remains bounded and supplies a related probe plus delayed retry from every eligible card", () => {
  const focusSkills = enabledDefaultSkillIds().filter((skillId) => skillId !== "T05");
  for (const focusSkillId of focusSkills) {
    for (let seedIndex = 0; seedIndex < 3; seedIndex += 1) {
      const original = plan({
        seed: `replan-corpus-${focusSkillId}-${seedIndex}`,
        sessionLength: "standard",
        focusSkillId,
        skillStates: { [focusSkillId]: state(focusSkillId) },
      });
      for (const [cardIndex, failed] of original.cards.entries()) {
        const expected = failed.problem.expectedAnswer;
        const wrongAnswer =
          expected === "yes"
            ? "no"
            : expected === "no"
              ? "yes"
              : expected + 1;
        const replanned = replanAfterAttempt({
          plan: original,
          cardIndex,
          attempt: {
            problemId: failed.problem.id,
            firstAttemptCorrect: false,
            errorCode: failed.problem.skillId.startsWith("F")
              ? "fact_retrieval_error"
              : "unclassified_math_error",
            normalizedRecognizedValue: wrongAnswer,
            rawRecognizedValue: String(wrongAnswer),
            recognitionConfirmedByChild: true,
          },
          recentComparableAttempts: [
            {
              errorCode: failed.problem.skillId.startsWith("F")
                ? "fact_retrieval_error"
                : "unclassified_math_error",
            },
          ],
        });

        if (failed.lane !== "easy_close") {
          const probes = replanned.cards.filter(
            (card) => card.remediationForProblemId === failed.problem.id,
          );
          const retries = replanned.cards.filter(
            (card) => card.delayedRetryForProblemId === failed.problem.id,
          );
          assert.ok(
            probes.length >= 1,
            `${focusSkillId} card ${cardIndex} gets a probe`,
          );
          assert.equal(
            retries.length,
            1,
            `${focusSkillId} card ${cardIndex} gets one retry`,
          );
          const retryIndex = replanned.cards.indexOf(retries[0]);
          assert.ok(retryIndex - cardIndex >= 2 && retryIndex - cardIndex <= 4);
          assert.equal(retries[0].skillId, failed.skillId);
          assert.notEqual(retries[0].problem.fingerprint, failed.problem.fingerprint);

          const expectedDecision = remediationDecision({
            problem: failed.problem,
            errorCode: failed.problem.skillId.startsWith("F")
              ? "fact_retrieval_error"
              : "unclassified_math_error",
            recentComparableAttempts: [
              {
                errorCode: failed.problem.skillId.startsWith("F")
                  ? "fact_retrieval_error"
                  : "unclassified_math_error",
              },
            ],
          });
          const relatedSkills = new Set([
            ...expectedDecision.probeSkillIds,
            ...skillDefinition(failed.skillId).remediationSkillIds,
          ]);
          assert.ok(
            probes.some((probe) => relatedSkills.has(probe.skillId)),
            `${focusSkillId} card ${cardIndex} gets a mathematically related probe`,
          );
        }

        assert.equal(replanned.targetCardCount, replanned.cards.length);
        assert.ok(replanned.cards.length <= MAX_ADAPTIVE_SESSION_CARDS);
        assert.equal(
          new Set(replanned.cards.map(({ problem }) => problem.fingerprint)).size,
          replanned.cards.length,
        );
        assert.ok(
          Object.values(counts(replanned.cards.map(({ skillId }) => skillId))).every(
            (count) => count <= MAX_CARDS_PER_NARROW_SKILL,
          ),
        );
        for (let index = 2; index < replanned.cards.length; index += 1) {
          assert.notEqual(
            replanned.cards[index].problem.metadata.templateId ===
              replanned.cards[index - 1].problem.metadata.templateId &&
              replanned.cards[index - 1].problem.metadata.templateId ===
                replanned.cards[index - 2].problem.metadata.templateId,
            true,
          );
        }
      }
    }
  }
});

test("planned F01 practice never repeats the same complement pair", () => {
  for (let seedIndex = 0; seedIndex < 40; seedIndex += 1) {
    const planned = plan({ seed: `f01-plan-${seedIndex}` });
    const pairs = planned.cards
      .filter(({ skillId }) => skillId === "F01")
      .map(({ problem }) =>
        [problem.operands.missingValue, problem.operands.complement]
          .sort((left, right) => left - right)
          .join("+"),
      );
    assert.equal(new Set(pairs).size, pairs.length);
  }
});

function fatigueAttempt(index, changes = {}) {
  return {
    skipped: false,
    errorCode: null,
    firstAttemptCorrect: true,
    timingEligible: true,
    responseMs: 2_000,
    firstInkLatencyMs: 300,
    correctionCount: 0,
    problemId: `p${index}`,
    ...changes,
  };
}

test("fatigue requires meaningful late deterioration or a strong stop signal", () => {
  assert.equal(
    detectSessionFatigue(Array.from({ length: 8 }, (_, index) => fatigueAttempt(index)))
      .fatigued,
    false,
  );
  const deteriorating = [
    fatigueAttempt(0),
    fatigueAttempt(1),
    fatigueAttempt(2),
    fatigueAttempt(3, {
      firstAttemptCorrect: false,
      responseMs: 5_500,
      correctionCount: 1,
    }),
    fatigueAttempt(4, {
      firstAttemptCorrect: false,
      responseMs: 6_000,
      correctionCount: 1,
    }),
    fatigueAttempt(5, { responseMs: 5_800 }),
  ];
  const result = detectSessionFatigue(deteriorating);
  assert.equal(result.fatigued, true);
  assert.ok(result.signals.includes("late_accuracy_drop"));
  assert.ok(result.signals.includes("late_response_slowdown"));
  assert.equal(
    detectSessionFatigue([
      fatigueAttempt(0, { skipped: true }),
      fatigueAttempt(1, { skipped: true }),
    ]).fatigued,
    true,
  );
});

test("session transitions are pure, pause-safe, finite, and preserve planning context", () => {
  const sourcePlan = plan({
    seed: "session-reducer",
    sessionLength: "short",
    maxActiveDurationMs: 10_000,
  });
  const created = createAdaptiveSession(sourcePlan);
  assert.equal(created.createdAt, sourcePlan.createdAt);
  assert.equal(created.focusSkillId, sourcePlan.focusSkillId);
  assert.equal(ADAPTIVE_SESSION_SHOWS_COUNTDOWN, false);

  const started = startAdaptiveSession(created, 100);
  assert.equal(created.phase, "not_started");
  assert.equal(started.cards[0].status, "active");
  const explicitlyPaused = pauseAdaptiveSession(started, "explicit", 200);
  const backgrounded = backgroundAdaptiveSession(explicitlyPaused, 300);
  const explicitResumed = resumeAdaptiveSession(backgrounded, "explicit", 400);
  assert.equal(explicitResumed.phase, "paused");
  const foregrounded = foregroundAdaptiveSession(explicitResumed, 500);
  assert.notEqual(foregrounded.phase, "paused");
  const advanced = advanceAdaptiveSession(foregrounded, 600);
  assert.equal(advanced.activeElapsedMs, 200);
  assert.equal(advanced.cards[0].status, "completed");
  assert.equal(advanced.cards[1].status, "active");

  const manuallyFinished = finishAdaptiveSession(advanced, 700);
  assert.equal(manuallyFinished.phase, "complete");
  assert.equal(manuallyFinished.currentProblem, null);
  assert.equal(
    manuallyFinished.cards.some(
      (card) => card.status === "active" || card.status === "planned",
    ),
    false,
  );
  assert.equal(adaptiveSessionCompletedAsPlanned(manuallyFinished), false);

  const cappedPlan = plan({
    seed: "session-time-cap",
    sessionLength: "short",
    maxActiveDurationMs: 1,
  });
  const capped = advanceAdaptiveSession(
    startAdaptiveSession(createAdaptiveSession(cappedPlan), 1_000),
    1_010,
  );
  assert.equal(capped.phase, "complete");
  assert.equal(adaptiveSessionCompletedAsPlanned(capped), false);
});

test("a persisted answer restores the feedback boundary instead of accepting a duplicate", () => {
  const sourcePlan = plan({ seed: "resume-after-answer", sessionLength: "short" });
  const started = startAdaptiveSession(createAdaptiveSession(sourcePlan), 100);
  const matching = {
    id: "persisted-attempt",
    sessionId: started.id,
    problemId: started.currentProblem.id,
    sessionPosition: started.currentCardIndex,
  };

  assert.equal(pendingAttemptForSession(started, []), null);
  assert.equal(
    pendingAttemptForSession(started, [
      { ...matching, problemId: "another-problem" },
      matching,
    ]),
    matching,
  );
});

test("fatigue trimming retains exactly one easy close before ending early", () => {
  const sourcePlan = plan({ seed: "fatigue-session", sessionLength: "standard" });
  const started = startAdaptiveSession(createAdaptiveSession(sourcePlan), 0);
  const easyClose = buildEasyCloseCard({
    seed: sourcePlan.seed,
    excludedFingerprints: sourcePlan.cards.map((card) => card.problem.fingerprint),
  });
  const shortened = shortenAdaptiveSessionForFatigue(started, easyClose);
  assert.equal(shortened.fatigueFlag, true);
  assert.equal(shortened.cards.filter((card) => card.lane === "easy_close").length, 1);
  const closing = advanceAdaptiveSession(shortened, 100);
  assert.equal(closing.phase, "easy_close");
  const ended = advanceAdaptiveSession(closing, 200);
  assert.equal(ended.phase, "ended_early_for_fatigue");
  assert.equal(
    ended.cards.some((card) => card.status === "active" || card.status === "planned"),
    false,
  );
  assert.equal(adaptiveSessionCompletedAsPlanned(ended), false);
});
