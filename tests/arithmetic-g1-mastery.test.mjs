import assert from "node:assert/strict";
import test from "node:test";

import {
  DAY_MS,
  MASTERY_PROFILE_THRESHOLDS,
  RETENTION_INTERVAL_DAYS,
  createG1AttemptEvent,
  deriveG1LearnerModel,
  deriveGradeCompletion,
  isG1AttemptEvent,
  isIndependentMasteryEvidence,
  masteryStateSatisfiesPrerequisite,
} from "../lib/arithmetic-fluency/mastery.ts";
import {
  G1_SKILLS,
} from "../lib/arithmetic-fluency/g1-curriculum.ts";
import {
  factKeyForQuestion,
  factUniverseForSkill,
  generateG1Question,
  requiredCoverageKeysForSkill,
} from "../lib/arithmetic-fluency/generator.ts";

const BASE_TIME = 2_000_000_000_000;

function exactInteger(question) {
  assert.equal(question.exactAnswer.kind, "integer");
  return question.exactAnswer.value;
}

function attempt({
  skillId = "G1-AS-01",
  index = 0,
  at = BASE_TIME + index * 10_000,
  sessionId = `session-${index % 2}`,
  correct = true,
  correctEventually = true,
  hintsRequested = 0,
  workedExampleShown = false,
  coverageKeys = [],
  excludedCoverageKeys = [],
  sessionKind = "practice",
  retentionIntervalDays = null,
  recognition = null,
} = {}) {
  let question;
  for (let candidateIndex = 0; candidateIndex < 1_000; candidateIndex += 1) {
    const candidate = generateG1Question({
      skillId,
      seed: `mastery-test-${skillId}-${index}-${at}:${candidateIndex}`,
      difficultyBand: 1,
      orientation: index % 2 ? "vertical" : "horizontal",
    });
    if (
      coverageKeys.every((key) => candidate.coverageTags.includes(key)) &&
      excludedCoverageKeys.every((key) => !candidate.coverageTags.includes(key))
    ) {
      question = candidate;
      break;
    }
  }
  assert.ok(question, `found ${skillId} question for ${coverageKeys.join(",")}`);
  const answer = exactInteger(question);
  const submissions = recognition
    ? [{
        submittedAt: at,
        inputMode: "handwriting",
        rawInput: recognition.raw,
        answer: recognition.answer,
        recognition,
      }]
    : [
        {
          submittedAt: at,
          inputMode: "tap",
          rawInput: String(correct ? answer : answer + 1),
          answer: correct ? answer : answer + 1,
        },
        ...(!correct && correctEventually
          ? [{
              submittedAt: at + 500,
              inputMode: "tap",
              rawInput: String(answer),
              answer,
            }]
          : []),
      ];
  return createG1AttemptEvent({
    id: `event-${skillId}-${index}-${at}`,
    learnerId: "learner-a",
    sessionId,
    question,
    startedAt: at - 1_000,
    completedAt: at + (submissions.length - 1) * 500,
    activeSolveTimeMs: 1_000,
    submissions,
    hintsRequested,
    hintsRequestedBeforeFirstAttempt: hintsRequested,
    workedExampleShown,
    workedExampleShownBeforeFirstAttempt: workedExampleShown,
    coverageKeys,
    sessionKind,
    retentionIntervalDays,
  });
}

function fluentConceptEvents() {
  const coverage = requiredCoverageKeysForSkill("G1-AS-01");
  return Array.from({ length: 16 }, (_, index) =>
    attempt({
      index,
      sessionId: `concept-session-${index % 2}`,
      coverageKeys: [coverage[index % coverage.length]],
    }),
  );
}

test("mastery profiles preserve the exact normative promotion thresholds", () => {
  assert.deepEqual(
    {
      concept: MASTERY_PROFILE_THRESHOLDS.CONCEPT,
      fact: MASTERY_PROFILE_THRESHOLDS.FACT,
      mental: MASTERY_PROFILE_THRESHOLDS.MENTAL,
      short: MASTERY_PROFILE_THRESHOLDS.ALGO_SHORT,
      long: MASTERY_PROFILE_THRESHOLDS.ALGO_LONG,
      rational: MASTERY_PROFILE_THRESHOLDS.RATIONAL,
      mixed: MASTERY_PROFILE_THRESHOLDS.MIXED,
    },
    {
      concept: {
        minimumIndependentAttempts: 16,
        minimumSessions: 2,
        minimumAccuracy: 0.9,
        maximumMedianActiveSolveTimeMs: null,
        maximumP90ActiveSolveTimeMs: null,
        criticalSubtypeMinimumAccuracy: 0.8,
        minimumOperationFamilyAccuracy: null,
      },
      fact: {
        minimumIndependentAttempts: 40,
        minimumSessions: 3,
        minimumAccuracy: 0.97,
        maximumMedianActiveSolveTimeMs: 3_000,
        maximumP90ActiveSolveTimeMs: 5_000,
        criticalSubtypeMinimumAccuracy: null,
        minimumOperationFamilyAccuracy: null,
      },
      mental: {
        minimumIndependentAttempts: 30,
        minimumSessions: 3,
        minimumAccuracy: 0.95,
        maximumMedianActiveSolveTimeMs: 8_000,
        maximumP90ActiveSolveTimeMs: 15_000,
        criticalSubtypeMinimumAccuracy: null,
        minimumOperationFamilyAccuracy: null,
      },
      short: {
        minimumIndependentAttempts: 25,
        minimumSessions: 3,
        minimumAccuracy: 0.95,
        maximumMedianActiveSolveTimeMs: null,
        maximumP90ActiveSolveTimeMs: null,
        criticalSubtypeMinimumAccuracy: 0.9,
        minimumOperationFamilyAccuracy: null,
      },
      long: {
        minimumIndependentAttempts: 20,
        minimumSessions: 3,
        minimumAccuracy: 0.95,
        maximumMedianActiveSolveTimeMs: null,
        maximumP90ActiveSolveTimeMs: null,
        criticalSubtypeMinimumAccuracy: 0.9,
        minimumOperationFamilyAccuracy: null,
      },
      rational: {
        minimumIndependentAttempts: 25,
        minimumSessions: 3,
        minimumAccuracy: 0.95,
        maximumMedianActiveSolveTimeMs: null,
        maximumP90ActiveSolveTimeMs: null,
        criticalSubtypeMinimumAccuracy: 0.9,
        minimumOperationFamilyAccuracy: null,
      },
      mixed: {
        minimumIndependentAttempts: 30,
        minimumSessions: 3,
        minimumAccuracy: 0.92,
        maximumMedianActiveSolveTimeMs: null,
        maximumP90ActiveSolveTimeMs: null,
        criticalSubtypeMinimumAccuracy: null,
        minimumOperationFamilyAccuracy: 0.85,
      },
    },
  );
});

test("events are immutable and corrected or hinted work cannot rewrite first-attempt evidence", () => {
  const corrected = attempt({ index: 40, correct: false, correctEventually: true });
  assert.equal(corrected.firstAttemptCorrect, false);
  assert.equal(corrected.finalCorrect, true);
  assert.equal(corrected.attemptCount, 2);
  assert.equal(isIndependentMasteryEvidence(corrected), true);
  assert.equal(Object.isFrozen(corrected), true);
  assert.equal(Object.isFrozen(corrected.submissions), true);
  assert.equal(Object.isFrozen(corrected.submissions[0]), true);

  const hinted = attempt({ index: 41, hintsRequested: 1 });
  assert.equal(hinted.firstAttemptCorrect, true);
  assert.equal(hinted.independentFirstAttempt, false);
  assert.equal(isIndependentMasteryEvidence(hinted), false);

  const worked = attempt({ index: 42, workedExampleShown: true });
  assert.equal(isIndependentMasteryEvidence(worked), false);
});

test("event creation normalizes the browser's fractional active-time edge exactly once", () => {
  const question = generateG1Question({
    skillId: "G1-AS-01",
    seed: "ui-first-typed-answer-clock-edge",
    difficultyBand: 1,
    orientation: "horizontal",
  });
  const answer = exactInteger(question);
  const event = createG1AttemptEvent({
    id: "ui-first-typed-answer-clock-edge",
    learnerId: "clean-browser-profile",
    sessionId: "clean-browser-session",
    question,
    // Date.now() can report the same integer millisecond even though
    // performance.now() measured a fractional interval.
    startedAt: BASE_TIME,
    completedAt: BASE_TIME,
    activeSolveTimeMs: 0.75,
    submissions: [{
      submittedAt: BASE_TIME,
      inputMode: "keyboard",
      rawInput: String(answer),
      answer,
      activeSolveTimeMs: 0.75,
    }],
  });
  assert.equal(event.activeSolveTimeMs, 0);
  assert.equal(event.firstAttemptActiveSolveTimeMs, 0);
  assert.equal(event.submissions[0].activeSolveTimeMs, 0);
  assert.equal(event.firstAttemptCorrect, true);
  assert.equal(event.timingEligible, true);
  assert.equal(isG1AttemptEvent(event), true);
});

test("event validation rejects semantically tampered summaries, submissions, and questions", () => {
  const valid = attempt({ index: 43, correct: false, correctEventually: true });
  assert.equal(isG1AttemptEvent(valid), true);
  const tamper = (mutate) => {
    const copy = JSON.parse(JSON.stringify(valid));
    mutate(copy);
    assert.equal(isG1AttemptEvent(copy), false);
  };
  tamper((event) => { event.firstAttemptCorrect = true; });
  tamper((event) => { event.finalCorrect = false; });
  tamper((event) => { event.attemptCount = 1; });
  tamper((event) => { event.submissionCount = 1; });
  tamper((event) => { event.mathematicalEvaluation = "incorrect"; });
  tamper((event) => { event.firstAnswer = valid.finalAnswer; });
  tamper((event) => { event.submissions[0].mathematicalEvaluation = "correct"; });
  tamper((event) => { event.submissions[1].answer = valid.question.exactAnswer.value + 2; });
  tamper((event) => { event.question.exactAnswer.value += 1; });
  tamper((event) => {
    if (event.question.promptAst.kind === "part-whole") event.question.promptAst.total += 1;
  });
  tamper((event) => { event.misconceptionTags = ["forged_mastery_tag"]; });
  tamper((event) => {
    event.submissions[0].activeSolveTimeMs = 900;
    event.submissions[1].activeSolveTimeMs = 800;
    event.firstAttemptActiveSolveTimeMs = 900;
  });
  tamper((event) => {
    event.difficultyBand = 4;
    event.question.difficultyBand = 4;
    event.question.coverageTags = [
      ...event.question.coverageTags.filter((tag) => !tag.startsWith("band_")),
      "band_4",
    ];
    event.coverageKeys = [...event.question.coverageTags].sort();
  });

  const historical = JSON.parse(JSON.stringify(attempt({ index: 44 })));
  historical.generatorVersion = "g1-v1";
  historical.question.generatorVersion = "g1-v1";
  assert.equal(isG1AttemptEvent(historical), true);
  historical.generatorVersion = "g1-v99";
  historical.question.generatorVersion = "g1-v99";
  assert.equal(isG1AttemptEvent(historical), false);

  const forgedTiming = JSON.parse(JSON.stringify(attempt({ index: 45 })));
  forgedTiming.submissions[0].activeSolveTimeMs = 0;
  forgedTiming.firstAttemptActiveSolveTimeMs = 0;
  assert.equal(isG1AttemptEvent(forgedTiming), false);
});

test("redemption re-probes remain in the raw ledger without double-counting mastery", () => {
  const question = generateG1Question({
    skillId: "G1-AS-01",
    seed: "redemption-evidence",
  });
  const answer = exactInteger(question);
  const redemption = createG1AttemptEvent({
    learnerId: "learner-a",
    sessionId: "redemption",
    question,
    startedAt: BASE_TIME,
    completedAt: BASE_TIME + 1_000,
    activeSolveTimeMs: 1_000,
    independentFirstAttempt: false,
    submissions: [{
      submittedAt: BASE_TIME + 1_000,
      inputMode: "tap",
      rawInput: String(answer),
      answer,
    }],
  });
  assert.equal(redemption.firstAttemptCorrect, true);
  assert.equal(redemption.independentFirstAttempt, false);
  assert.equal(isIndependentMasteryEvidence(redemption), false);
  assert.equal(redemption.submissions.length, 1);
});

test("recognition failures remain distinct from mathematics misses and preserve QA telemetry", () => {
  const failed = attempt({
    index: 50,
    recognition: {
      raw: "ambiguous-strokes",
      answer: null,
      recognizedAnswer: "17",
      confidence: 0.31,
      margin: 0.04,
      processingMs: 83,
      status: "failed",
    },
  });
  assert.equal(failed.firstAttemptCorrect, null);
  assert.equal(failed.mathematicalEvaluation, "not_evaluated");
  assert.equal(failed.attemptCount, 0);
  assert.equal(failed.recognitionRaw, "ambiguous-strokes");
  assert.equal(failed.recognitionConfidence, 0.31);
  assert.equal(failed.recognitionMargin, 0.04);
  assert.equal(failed.recognitionProcessingMs, 83);
  assert.equal(isIndependentMasteryEvidence(failed), false);

  const question = generateG1Question({
    skillId: "G1-AS-01",
    seed: "recognition-then-math",
  });
  const answer = exactInteger(question);
  const recovered = createG1AttemptEvent({
    learnerId: "learner-a",
    sessionId: "recognition-recovery",
    question,
    startedAt: BASE_TIME,
    completedAt: BASE_TIME + 2_000,
    activeSolveTimeMs: 2_000,
    submissions: [
      {
        submittedAt: BASE_TIME + 1_000,
        inputMode: "handwriting",
        rawInput: "ambiguous-strokes",
        answer: null,
        recognition: {
          raw: "ambiguous-strokes",
          recognizedAnswer: null,
          confidence: 0.2,
          margin: 0.01,
          processingMs: 80,
          status: "failed",
        },
      },
      {
        submittedAt: BASE_TIME + 2_000,
        inputMode: "tap",
        rawInput: String(answer),
        answer,
      },
    ],
  });
  assert.equal(recovered.firstAttemptCorrect, true);
  assert.equal(recovered.independentFirstAttempt, true);
  assert.equal(recovered.timingEligible, false);
  assert.equal(isIndependentMasteryEvidence(recovered), true);
});

test("replay unlocks only direct prerequisites that are at least fluent", () => {
  const before = deriveG1LearnerModel([], BASE_TIME, "learner-a");
  assert.equal(before.skills["G1-AS-01"].state, "AVAILABLE");
  assert.equal(before.skills["G1-AS-02"].state, "LOCKED");

  const events = fluentConceptEvents();
  const after = deriveG1LearnerModel(events, events.at(-1).timestamp + 1_000, "learner-a");
  assert.equal(after.skills["G1-AS-01"].state, "FLUENT");
  assert.equal(after.skills["G1-AS-02"].state, "AVAILABLE");
  assert.equal(after.skills["G1-AS-03"].state, "AVAILABLE");
  assert.equal(after.skills["G1-AS-04"].state, "LOCKED");
  assert.equal(masteryStateSatisfiesPrerequisite("REVIEW_DUE"), true);
});

test("a high average cannot conceal a failed critical subtype", () => {
  const coverage = requiredCoverageKeysForSkill("G1-AS-01");
  const events = Array.from({ length: 16 }, (_, index) =>
    attempt({
      index: 100 + index,
      correct: index !== 0,
      coverageKeys: [index < 2 ? coverage[0] : coverage[1 + (index % 2)]],
      excludedCoverageKeys: index < 2 ? [] : [coverage[0]],
    }),
  );
  const model = deriveG1LearnerModel(events, events.at(-1).timestamp + 1_000, "learner-a");
  assert.equal(model.skills["G1-AS-01"].accuracy, 15 / 16);
  assert.deepEqual(model.skills["G1-AS-01"].criticalSubtypeFailures, [coverage[0]]);
  assert.equal(model.skills["G1-AS-01"].state, "PRACTICING");
});

test("promotion enforces each declared coverage share inside the mastery window", () => {
  const coverage = requiredCoverageKeysForSkill("G1-AS-01");
  const events = Array.from({ length: 16 }, (_, index) => attempt({
    index: 200 + index,
    coverageKeys: [index === 0 ? coverage[0] : coverage[1 + (index % 2)]],
    excludedCoverageKeys: index === 0 ? [] : [coverage[0]],
  }));
  const model = deriveG1LearnerModel(events, events.at(-1).timestamp + 1, "learner-a");
  assert.ok(model.skills["G1-AS-01"].coverageMissing.includes(coverage[0]));
  assert.equal(model.skills["G1-AS-01"].state, "PRACTICING");
});

test("FACT speed gates require a representative timed sample", () => {
  const prerequisites = fluentConceptEvents();
  const coverage = requiredCoverageKeysForSkill("G1-AS-03");
  const factEvents = Array.from({ length: 40 }, (_, index) => {
    const wanted = coverage[index % coverage.length];
    let question;
    for (let candidateIndex = 0; candidateIndex < 1_000; candidateIndex += 1) {
      const candidate = generateG1Question({
        skillId: "G1-AS-03",
        seed: `timing-sample:${index}:${candidateIndex}`,
        difficultyBand: 1,
      });
      if (candidate.coverageTags.includes(wanted)) {
        question = candidate;
        break;
      }
    }
    assert.ok(question);
    const answer = exactInteger(question);
    const at = prerequisites.at(-1).timestamp + 10_000 + index * 10_000;
    const recognitionFirst = index > 0;
    return createG1AttemptEvent({
      id: `timing-sample-event:${index}`,
      learnerId: "learner-a",
      sessionId: `timing-session:${index % 3}`,
      question,
      startedAt: at - 1_000,
      completedAt: at,
      activeSolveTimeMs: 1_000,
      submissions: recognitionFirst
        ? [{
            submittedAt: at - 100,
            inputMode: "handwriting",
            rawInput: "unreadable",
            answer: null,
            recognition: {
              raw: "unreadable",
              recognizedAnswer: null,
              confidence: 0.1,
              status: "failed",
            },
          }, {
            submittedAt: at,
            inputMode: "tap",
            rawInput: String(answer),
            answer,
          }]
        : [{
            submittedAt: at,
            inputMode: "tap",
            rawInput: String(answer),
            answer,
          }],
    });
  });
  const model = deriveG1LearnerModel(
    [...prerequisites, ...factEvents],
    factEvents.at(-1).timestamp + 1,
    "learner-a",
  );
  assert.equal(factEvents.filter(({ timingEligible }) => timingEligible).length, 1);
  assert.equal(model.skills["G1-AS-03"].state, "PRACTICING");
});

test("retention uses 1/3/7/14/30-day offsets and failed probes become review due", () => {
  const fluent = fluentConceptEvents();
  const fluentAt = fluent.at(-1).timestamp;
  const beforeDue = deriveG1LearnerModel(fluent, fluentAt + DAY_MS - 1, "learner-a");
  assert.equal(beforeDue.skills["G1-AS-01"].state, "FLUENT");
  assert.equal(beforeDue.skills["G1-AS-01"].nextReviewAt, fluentAt + DAY_MS);

  const overdue = deriveG1LearnerModel(fluent, fluentAt + DAY_MS, "learner-a");
  assert.equal(overdue.skills["G1-AS-01"].state, "REVIEW_DUE");

  const failedProbe = attempt({
    index: 300,
    at: fluentAt + DAY_MS,
    correct: false,
    sessionKind: "retention",
    retentionIntervalDays: 1,
  });
  const failed = deriveG1LearnerModel([...fluent, failedProbe], fluentAt + DAY_MS, "learner-a");
  assert.equal(failed.skills["G1-AS-01"].state, "REVIEW_DUE");

  const probes = RETENTION_INTERVAL_DAYS.map((days, index) =>
    attempt({
      index: 400 + index,
      at: fluentAt + days * DAY_MS,
      sessionId: `retention-${days}`,
      sessionKind: "retention",
      retentionIntervalDays: days,
    }),
  );
  const retained = deriveG1LearnerModel(
    [...fluent, ...probes],
    fluentAt + 30 * DAY_MS,
    "learner-a",
  );
  assert.equal(retained.skills["G1-AS-01"].state, "RETAINED");
  assert.deepEqual(
    retained.skills["G1-AS-01"].completedRetentionIntervals,
    RETENTION_INTERVAL_DAYS,
  );
});

test("FACT skills use recent fluency evidence but require the full finite universe for retention", () => {
  const prerequisiteEvents = fluentConceptEvents();
  const universe = factUniverseForSkill("G1-AS-03");
  const questionsByFact = new Map();
  for (let index = 0; index < 5_000 && questionsByFact.size < universe.length; index += 1) {
    const question = generateG1Question({
      skillId: "G1-AS-03",
      seed: `fact-universe-${index}`,
    });
    questionsByFact.set(factKeyForQuestion(question), question);
  }
  assert.equal(questionsByFact.size, universe.length);
  const coverage = requiredCoverageKeysForSkill("G1-AS-03");
  const firstFactAt = prerequisiteEvents.at(-1).timestamp + 10_000;
  const eventForQuestion = (question, index, prefix = "fact-event") => {
    const answer = exactInteger(question);
    const at = firstFactAt + index * 10_000;
    return createG1AttemptEvent({
      id: `${prefix}-${index}`,
      learnerId: "learner-a",
      sessionId: `fact-session-${index % 3}`,
      question,
      startedAt: at - 1_000,
      completedAt: at,
      activeSolveTimeMs: 1_000,
      coverageKeys: [coverage[index % coverage.length]],
      submissions: [{
        submittedAt: at,
        inputMode: "tap",
        rawInput: String(answer),
        answer,
      }],
    });
  };
  const questionsByCoverage = new Map(coverage.map((key) => [
    key,
    [...questionsByFact.values()].filter(({ coverageTags }) => coverageTags.includes(key)),
  ]));
  const balancedInitialQuestions = coverage.flatMap((key) =>
    Array.from({ length: 7 }, (_, index) => {
      const pool = questionsByCoverage.get(key);
      assert.ok(pool?.length);
      return pool[index % pool.length];
    }));
  const mixedPool = questionsByCoverage.get("mixed_fact");
  assert.ok(mixedPool?.length);
  while (balancedInitialQuestions.length < 40) {
    balancedInitialQuestions.push(mixedPool[balancedInitialQuestions.length % mixedPool.length]);
  }
  const initialForty = balancedInitialQuestions.map((question, index) =>
    eventForQuestion(question, index, "fact-fluency"));
  const factEvents = universe.map((key, index) => {
    const question = questionsByFact.get(key);
    assert.ok(question);
    return eventForQuestion(question, 40 + index);
  });
  const fluentAt = initialForty.at(-1).timestamp;
  const fluent = deriveG1LearnerModel(
    [...prerequisiteEvents, ...initialForty],
    fluentAt + 1,
    "learner-a",
  );
  assert.equal(fluent.skills["G1-AS-03"].state, "FLUENT");
  assert.equal(fluent.skills["G1-AS-03"].factUniverseComplete, false);

  const probes = RETENTION_INTERVAL_DAYS.map((days, index) => {
    const question = questionsByFact.get(universe[index]);
    const answer = exactInteger(question);
    const at = fluentAt + days * DAY_MS;
    return createG1AttemptEvent({
      id: `fact-probe-${days}`,
      learnerId: "learner-a",
      sessionId: `fact-retention-${days}`,
      question,
      startedAt: at - 1_000,
      completedAt: at,
      activeSolveTimeMs: 1_000,
      sessionKind: "retention",
      retentionIntervalDays: days,
      submissions: [{
        submittedAt: at,
        inputMode: "tap",
        rawInput: String(answer),
        answer,
      }],
    });
  });
  const incomplete = deriveG1LearnerModel(
    [...prerequisiteEvents, ...initialForty, ...probes],
    fluentAt + 30 * DAY_MS,
    "learner-a",
  );
  assert.notEqual(incomplete.skills["G1-AS-03"].state, "RETAINED");

  const retained = deriveG1LearnerModel(
    [...prerequisiteEvents, ...initialForty, ...factEvents, ...probes],
    fluentAt + 30 * DAY_MS,
    "learner-a",
  );
  assert.equal(retained.skills["G1-AS-03"].factUniversePresented, universe.length);
  assert.equal(retained.skills["G1-AS-03"].state, "RETAINED");
});

test("grade completion ignores stretch skills but enforces retention and assessment gates", () => {
  const base = deriveG1LearnerModel([], BASE_TIME, "learner-a");
  const skills = Object.fromEntries(
    G1_SKILLS.map((skill) => [
      skill.id,
      {
        ...base.skills[skill.id],
        state: skill.tier === "core" ? "RETAINED" : "LOCKED",
      },
    ]),
  );
  const progress = deriveGradeCompletion(skills, {
    assessmentId: "grade-1-final",
    balanced: true,
    accuracy: 0.92,
    domainAccuracy: {
      addition: 0.92,
      subtraction: 0.9,
      multiplication: 1,
      division: 1,
    },
    domainCounts: { addition: 5, subtraction: 5, multiplication: 5, division: 5 },
    questionCount: 20,
  });
  assert.equal(progress.complete, true);
  assert.equal(progress.retainedRatio, 1);
  assert.equal(progress.stretchSkillStates["G1-M-03"], "LOCKED");

  const weakDomain = deriveGradeCompletion(skills, {
    assessmentId: "grade-1-final",
    balanced: true,
    accuracy: 0.96,
    domainAccuracy: { addition: 1, subtraction: 0.84, multiplication: 1, division: 1 },
    domainCounts: { addition: 5, subtraction: 5, multiplication: 5, division: 5 },
    questionCount: 20,
  });
  assert.equal(weakDomain.complete, false);
  assert.equal(weakDomain.majorDomainsPassed, false);
});
