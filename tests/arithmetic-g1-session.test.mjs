import assert from "node:assert/strict";
import test from "node:test";

import {
  DAY_MS,
  createG1AttemptEvent,
  deriveG1LearnerModel,
  deriveGradeAssessmentEvidence,
  RETENTION_INTERVAL_DAYS,
} from "../lib/arithmetic-fluency/mastery.ts";
import {
  DEFAULT_G1_SESSION_SIZE,
  G1_GRADE_ASSESSMENT_CARD_COUNT,
  G1_GRADE_ASSESSMENT_DOMAINS,
  G1_GRADE_ASSESSMENT_ITEMS_PER_DOMAIN,
  buildG1GradeAssessmentPlan,
  buildG1RemediationPlan,
  buildG1SessionPlan,
  createG1RetryCard,
  g1SessionComposition,
} from "../lib/arithmetic-fluency/session.ts";
import {
  factUniverseForSkill,
  factKeyForQuestion,
  generateG1FactQuestion,
  g1QuestionContentFingerprint,
  g1QuestionMathematicalFingerprint,
  generateG1Question,
  g1QuestionSemanticFingerprint,
  requiredCoverageKeysForSkill,
} from "../lib/arithmetic-fluency/generator.ts";
import { G1_SKILL_BY_ID } from "../lib/arithmetic-fluency/g1-curriculum.ts";

const BASE_TIME = 2_100_000_000_000;

function fluentFirstSkillEvents() {
  const coverage = requiredCoverageKeysForSkill("G1-AS-01");
  return Array.from({ length: 16 }, (_, index) => {
    const requiredKey = coverage[index % coverage.length];
    let question;
    for (let candidateIndex = 0; candidateIndex < 1_000; candidateIndex += 1) {
      const candidate = generateG1Question({
        skillId: "G1-AS-01",
        seed: `session-fluent-${index}:${candidateIndex}`,
        difficultyBand: 1,
        orientation: index % 2 ? "vertical" : "horizontal",
      });
      if (candidate.coverageTags.includes(requiredKey)) {
        question = candidate;
        break;
      }
    }
    assert.ok(question);
    assert.equal(question.exactAnswer.kind, "integer");
    const at = BASE_TIME + index * 10_000;
    return createG1AttemptEvent({
      id: `session-event-${index}`,
      learnerId: "learner-session",
      sessionId: `learning-${index % 2}`,
      question,
      startedAt: at - 1_000,
      completedAt: at,
      activeSolveTimeMs: 1_000,
      coverageKeys: [coverage[index % coverage.length]],
      submissions: [{
        submittedAt: at,
        inputMode: "tap",
        rawInput: String(question.exactAnswer.value),
        answer: question.exactAnswer.value,
      }],
    });
  });
}

function successfulCardEvent({
  card,
  learnerId = "learner-session",
  sessionId,
  id,
  at,
  sessionKind = "practice",
  assessmentId = null,
  retentionIntervalDays = null,
  independentFirstAttempt = true,
}) {
  assert.equal(card.question.exactAnswer.kind, "integer");
  const answer = card.question.exactAnswer.value;
  return createG1AttemptEvent({
    id,
    learnerId,
    sessionId,
    question: card.question,
    startedAt: at - 1_000,
    completedAt: at,
    activeSolveTimeMs: 1_000,
    independentFirstAttempt,
    sessionKind,
    assessmentId,
    retentionIntervalDays,
    submissions: [{
      submittedAt: at,
      inputMode: "tap",
      rawInput: String(answer),
      answer,
    }],
  });
}

test("default 15-card composition uses deterministic 60/25/15 rounding", () => {
  assert.equal(DEFAULT_G1_SESSION_SIZE, 15);
  assert.deepEqual(g1SessionComposition(), {
    target: 9,
    prerequisite: 4,
    review: 2,
  });
  assert.deepEqual(g1SessionComposition(15, true), {
    target: 5,
    prerequisite: 4,
    review: 6,
  });
});

test("the cumulative Grade 1 assessment is a deterministic, fingerprinted 5-per-domain plan", () => {
  const input = {
    learnerId: "assessment-learner",
    seed: "balanced-grade-check",
    events: [],
    now: BASE_TIME,
  };
  const plan = buildG1GradeAssessmentPlan(input);
  assert.deepEqual(plan, buildG1GradeAssessmentPlan(input));
  assert.equal(plan.cards.length, G1_GRADE_ASSESSMENT_CARD_COUNT);
  assert.equal(G1_GRADE_ASSESSMENT_CARD_COUNT, 20);
  assert.equal(G1_GRADE_ASSESSMENT_ITEMS_PER_DOMAIN, 5);
  assert.equal(plan.eligible, false);
  assert.ok(plan.assessmentId.endsWith(`:${plan.planFingerprint}`));
  assert.equal(
    new Set(plan.cards.map(({ question }) => g1QuestionContentFingerprint(question))).size,
    plan.cards.length,
  );
  assert.equal(
    new Set(plan.cards.map(({ question }) =>
      g1QuestionMathematicalFingerprint(question))).size,
    plan.cards.length,
  );
  for (const domain of G1_GRADE_ASSESSMENT_DOMAINS) {
    const cards = plan.cards.filter((card) => card.domain === domain);
    assert.equal(cards.length, 5);
    assert.equal(plan.domainCounts[domain], 5);
    assert.deepEqual(
      cards.reduce((counts, { question }) => ({
        ...counts,
        [question.difficultyBand]: (counts[question.difficultyBand] ?? 0) + 1,
      }), {}),
      { 3: 3, 4: 2 },
    );
    assert.ok(cards.every(({ skillId }) =>
      G1_SKILL_BY_ID[skillId].tier === "core" &&
      G1_SKILL_BY_ID[skillId].domain === domain));
  }
});

test("assessment evidence requires the exact complete plan and preserves an earlier pass after abandonment", () => {
  const plan = buildG1GradeAssessmentPlan({
    learnerId: "assessment-learner",
    seed: "complete-grade-check",
    events: [],
    now: BASE_TIME,
  });
  const complete = plan.cards.map((card, index) => successfulCardEvent({
    card,
    learnerId: plan.learnerId,
    sessionId: plan.assessmentId,
    id: `${plan.assessmentId}:event:${index}`,
    at: BASE_TIME + index * 1_000,
    sessionKind: "assessment",
    assessmentId: plan.assessmentId,
  }));
  const evidence = deriveGradeAssessmentEvidence(complete);
  assert.ok(evidence);
  assert.equal(evidence.assessmentId, plan.assessmentId);
  assert.equal(evidence.planFingerprint, plan.planFingerprint);
  assert.equal(evidence.balanced, true);
  assert.equal(evidence.questionCount, 20);

  const later = buildG1GradeAssessmentPlan({
    learnerId: "assessment-learner",
    seed: "abandoned-grade-check",
    events: [],
    now: BASE_TIME + 100_000,
  });
  const abandoned = later.cards.slice(0, 4).map((card, index) => successfulCardEvent({
    card,
    learnerId: later.learnerId,
    sessionId: later.assessmentId,
    id: `${later.assessmentId}:event:${index}`,
    at: BASE_TIME + 100_000 + index * 1_000,
    sessionKind: "assessment",
    assessmentId: later.assessmentId,
  }));
  assert.equal(deriveGradeAssessmentEvidence(abandoned)?.balanced, false);
  assert.equal(
    deriveGradeAssessmentEvidence([...complete, ...abandoned])?.assessmentId,
    plan.assessmentId,
  );

  const duplicateCards = [...plan.cards.slice(0, 19), plan.cards[0]];
  const duplicateEvents = duplicateCards.map((card, index) => successfulCardEvent({
    card,
    learnerId: plan.learnerId,
    sessionId: plan.assessmentId,
    id: `duplicate-assessment:event:${index}`,
    at: BASE_TIME + 200_000 + index * 1_000,
    sessionKind: "assessment",
    assessmentId: plan.assessmentId,
  }));
  assert.equal(
    deriveGradeAssessmentEvidence(duplicateEvents, plan.assessmentId)?.balanced,
    false,
  );

  const unassistedGap = complete.map((event, index) =>
    index === 0
      ? successfulCardEvent({
          card: plan.cards[0],
          learnerId: plan.learnerId,
          sessionId: plan.assessmentId,
          id: "non-independent-assessment:event:0",
          at: BASE_TIME + 300_000,
          sessionKind: "assessment",
          assessmentId: plan.assessmentId,
          independentFirstAttempt: false,
        })
      : event);
  assert.equal(
    deriveGradeAssessmentEvidence(unassistedGap, plan.assessmentId)?.balanced,
    false,
  );

  const forgedId = `${plan.assessmentId}-tampered`;
  const forged = plan.cards.map((card, index) => successfulCardEvent({
    card,
    learnerId: plan.learnerId,
    sessionId: forgedId,
    id: `${forgedId}:event:${index}`,
    at: BASE_TIME + 400_000 + index * 1_000,
    sessionKind: "assessment",
    assessmentId: forgedId,
  }));
  assert.equal(deriveGradeAssessmentEvidence(forged, forgedId)?.balanced, false);
});

test("the same seed and evidence produce the same non-repetitive session", () => {
  const input = {
    learnerId: "learner-session",
    targetSkillId: "G1-AS-01",
    seed: "stable-session-seed",
    events: [],
    now: BASE_TIME,
  };
  const first = buildG1SessionPlan(input);
  const second = buildG1SessionPlan(input);
  assert.deepEqual(first, second);
  assert.equal(first.cards.length, 15);
  assert.equal(new Set(first.cards.map(({ question }) => question.instanceId)).size, 15);
  assert.deepEqual(
    first.cards.reduce(
      (counts, { lane }) => ({ ...counts, [lane]: counts[lane] + 1 }),
      { target: 0, prerequisite: 0, review: 0 },
    ),
    first.composition,
  );

  for (let index = 3; index < first.cards.length; index += 1) {
    const forms = first.cards.slice(index - 3, index + 1).map(({ surfaceForm }) => surfaceForm);
    assert.ok(new Set(forms).size > 1, `four identical surface forms at card ${index + 1}`);
  }
});

test("a 15-card AS01 session ignores orientation for repeats, exhausts unique facts first, and caps spaced repeats at three", () => {
  const plan = buildG1SessionPlan({
    learnerId: "semantic-repeat-audit",
    targetSkillId: "G1-AS-01",
    seed: "as01-semantic-repeat-bound",
    events: [],
    now: BASE_TIME,
    count: 15,
  });
  const fingerprints = plan.cards.map(({ question }) =>
    g1QuestionSemanticFingerprint(question));
  const mathematicalFingerprints = plan.cards.map(({ question }) =>
    g1QuestionMathematicalFingerprint(question));
  const representations = plan.cards.map(({ question }) => {
    assert.equal(question.promptAst.kind, "part-whole");
    assert.equal(question.orientation, "horizontal");
    assert.equal(
      question.difficultyFeatures.surfaceForm,
      `part-whole:${question.promptAst.representation}`,
    );
    return question.promptAst.representation;
  });
  const counts = fingerprints.reduce((result, fingerprint) => {
    result.set(fingerprint, (result.get(fingerprint) ?? 0) + 1);
    return result;
  }, new Map());
  assert.equal(new Set(fingerprints.slice(0, 6)).size, 6, "the finite band-1 pool is exhausted before repeats");
  assert.equal(new Set(mathematicalFingerprints.slice(0, 6)).size, 6);
  assert.equal(new Set(fingerprints).size, 15, "representation variants remain semantically distinct");
  assert.ok([...counts.values()].every((count) => count <= 3));
  for (let index = 1; index < fingerprints.length; index += 1) {
    assert.notEqual(fingerprints[index], fingerprints[index - 1]);
    if (index >= 2) assert.notEqual(fingerprints[index], fingerprints[index - 2]);
  }
  for (let index = 3; index < representations.length; index += 1) {
    assert.ok(
      new Set(representations.slice(index - 3, index + 1)).size > 1,
      `four identical rendered part-whole representations at card ${index + 1}`,
    );
  }
  const horizontal = generateG1Question({
    skillId: "G1-AS-01",
    seed: "orientation-is-cosmetic",
    difficultyBand: 1,
    orientation: "horizontal",
  });
  const vertical = generateG1Question({
    skillId: "G1-AS-01",
    seed: "orientation-is-cosmetic",
    difficultyBand: 1,
    orientation: "vertical",
  });
  assert.equal(g1QuestionSemanticFingerprint(horizontal), g1QuestionSemanticFingerprint(vertical));
});

test("selecting a locked skill deterministically focuses its nearest available prerequisite", () => {
  const plan = buildG1SessionPlan({
    learnerId: "learner-session",
    targetSkillId: "G1-AS-17",
    seed: "locked-target",
    events: [],
    now: BASE_TIME,
  });
  assert.equal(plan.requestedTargetSkillId, "G1-AS-17");
  assert.equal(plan.focusSkillId, "G1-AS-01");
  assert.ok(plan.cards.every(({ skillId }) => skillId === "G1-AS-01"));
});

test("a fluent target shifts to 35/25/40 frontier-and-review composition", () => {
  const events = fluentFirstSkillEvents();
  const plan = buildG1SessionPlan({
    learnerId: "learner-session",
    targetSkillId: "G1-AS-01",
    seed: "fluent-target",
    events,
    now: events.at(-1).timestamp + 1_000,
  });
  assert.deepEqual(plan.composition, { target: 5, prerequisite: 4, review: 6 });
  assert.equal(plan.focusSkillId, "G1-AS-02");
  assert.ok(plan.cards.some(({ lane, skillId }) => lane === "review" && skillId === "G1-AS-01"));
});

test("review-due evidence always supplies a spaced-review card", () => {
  const events = fluentFirstSkillEvents();
  const fluentAt = events.at(-1).timestamp;
  const plan = buildG1SessionPlan({
    learnerId: "learner-session",
    targetSkillId: "G1-AS-02",
    seed: "due-review",
    events,
    now: fluentAt + DAY_MS,
  });
  const dueCard = plan.cards.find(
    ({ lane, skillId, reason }) =>
      lane === "review" && skillId === "G1-AS-01" && reason === "Spaced review due",
  );
  assert.ok(dueCard);
  assert.equal(dueCard.retentionIntervalDays, 1);
});

test("built sessions expose every FACT identity before completing 1/3/7/14/30-day retention", () => {
  let events = fluentFirstSkillEvents();
  let nextAt = events.at(-1).timestamp + 10_000;
  let sessionIndex = 0;

  for (; sessionIndex < 30; sessionIndex += 1) {
    const model = deriveG1LearnerModel(events, nextAt, "learner-session");
    if (["FLUENT", "REVIEW_DUE"].includes(model.skills["G1-AS-03"].state)) break;
    const plan = buildG1SessionPlan({
      learnerId: "learner-session",
      targetSkillId: "G1-AS-03",
      seed: `fact-fluency-session:${sessionIndex}`,
      events,
      now: nextAt,
    });
    const factCards = plan.cards.filter(({ skillId }) => skillId === "G1-AS-03");
    assert.ok(factCards.length > 0);
    const additions = factCards.map((card, index) => successfulCardEvent({
      card,
      sessionId: plan.id,
      id: `${plan.id}:event:${index}`,
      at: nextAt + index * 1_000,
    }));
    events = [...events, ...additions];
    nextAt += 60_000;
  }

  let model = deriveG1LearnerModel(events, nextAt, "learner-session");
  assert.equal(model.skills["G1-AS-03"].state, "FLUENT");
  assert.ok(model.skills["G1-AS-03"].independentAttempts >= 40);
  assert.equal(model.skills["G1-AS-03"].factUniverseComplete, false);
  const fluentAt = model.skills["G1-AS-03"].fluentAt;
  assert.ok(fluentAt);

  const presented = new Set(events
    .filter(({ learnerId, skillId, factKey }) =>
      learnerId === "learner-session" && skillId === "G1-AS-03" && factKey !== null)
    .map(({ factKey }) => factKey));
  const foreignFactKey = factUniverseForSkill("G1-AS-03").find((key) => !presented.has(key));
  assert.ok(foreignFactKey);
  const foreignQuestion = generateG1FactQuestion({
    skillId: "G1-AS-03",
    factKey: foreignFactKey,
    seed: "foreign-profile-fact",
  });
  assert.equal(factKeyForQuestion(foreignQuestion), foreignFactKey);
  const foreignEvent = successfulCardEvent({
    card: { question: foreignQuestion },
    learnerId: "another-learner",
    sessionId: "another-learner-session",
    id: "another-learner-fact-event",
    at: nextAt,
  });
  const isolatedInput = {
    learnerId: "learner-session",
    targetSkillId: "G1-AS-03",
    seed: "profile-isolated-unseen-facts",
    events,
    now: nextAt,
  };
  assert.deepEqual(
    buildG1SessionPlan({ ...isolatedInput, events: [...events, foreignEvent] }),
    buildG1SessionPlan(isolatedInput),
  );

  for (let completionIndex = 0; completionIndex < 30; completionIndex += 1) {
    const now = fluentAt + DAY_MS + completionIndex * 60_000;
    model = deriveG1LearnerModel(events, now, "learner-session");
    if (model.skills["G1-AS-03"].factUniverseComplete) break;
    const plan = buildG1SessionPlan({
      learnerId: "learner-session",
      targetSkillId: "G1-AS-03",
      seed: `fact-universe-completion:${completionIndex}`,
      events,
      now,
    });
    const factCards = plan.cards.filter(({ skillId }) => skillId === "G1-AS-03");
    assert.ok(factCards.length > 0, "incomplete FACT universes remain schedulable");
    const additions = factCards.map((card, index) => successfulCardEvent({
      card,
      sessionId: plan.id,
      id: `${plan.id}:event:${index}`,
      at: now + index * 1_000,
      sessionKind: card.retentionIntervalDays === null ? "practice" : "retention",
      retentionIntervalDays: card.retentionIntervalDays,
    }));
    events = [...events, ...additions];
  }

  model = deriveG1LearnerModel(events, fluentAt + DAY_MS + 2_000_000, "learner-session");
  const universe = factUniverseForSkill("G1-AS-03");
  assert.equal(model.skills["G1-AS-03"].factUniversePresented, universe.length);
  assert.equal(model.skills["G1-AS-03"].factUniverseComplete, true);
  assert.ok(events.some(({ question }) =>
    question.skillId === "G1-AS-03" && question.difficultyBand === 4));

  for (const days of RETENTION_INTERVAL_DAYS) {
    model = deriveG1LearnerModel(events, fluentAt + days * DAY_MS, "learner-session");
    if (model.skills["G1-AS-03"].completedRetentionIntervals.includes(days)) continue;
    const plan = buildG1SessionPlan({
      learnerId: "learner-session",
      targetSkillId: "G1-AS-03",
      seed: `fact-retention-session:${days}`,
      events,
      now: fluentAt + days * DAY_MS,
    });
    const probe = plan.cards.find(
      ({ skillId, retentionIntervalDays }) =>
        skillId === "G1-AS-03" && retentionIntervalDays === days,
    );
    assert.ok(probe, `session supplies the ${days}-day FACT probe`);
    events = [...events, successfulCardEvent({
      card: probe,
      sessionId: plan.id,
      id: `${plan.id}:retention:${days}`,
      at: fluentAt + days * DAY_MS,
      sessionKind: "retention",
      retentionIntervalDays: days,
    })];
  }

  const retained = deriveG1LearnerModel(
    events,
    fluentAt + 30 * DAY_MS + 1,
    "learner-session",
  );
  assert.equal(retained.skills["G1-AS-03"].state, "RETAINED");
  assert.deepEqual(
    retained.skills["G1-AS-03"].completedRetentionIntervals,
    RETENTION_INTERVAL_DAYS,
  );
});

test("retry and remediation metadata preserve the miss and eventually re-probe the original", () => {
  const plan = buildG1SessionPlan({
    learnerId: "learner-session",
    targetSkillId: "G1-AS-01",
    seed: "remediation",
    events: [],
    now: BASE_TIME,
  });
  const source = plan.cards[0];
  assert.equal(source.retryPolicy.retryUntilCorrect, true);
  assert.equal(source.retryPolicy.firstUnassistedAttemptOnlyForMastery, true);
  assert.equal(source.remediation.reProbeOriginalLater, true);

  const retry = createG1RetryCard(source, 1);
  assert.equal(retry.question, source.question);
  assert.equal(retry.retryOfCardId, source.id);
  assert.equal(retry.retryNumber, 1);

  const secondSimilar = buildG1RemediationPlan({
    card: source,
    seed: "second-error",
    similarErrorCount: 2,
  });
  assert.equal(secondSimilar.recordAsMathematicsMiss, true);
  assert.equal(secondSimilar.reduceDifficulty, true);
  assert.equal(secondSimilar.showWorkedExample, true);
  assert.ok(secondSimilar.workedExampleQuestion);
  assert.notEqual(
    g1QuestionContentFingerprint(secondSimilar.workedExampleQuestion),
    g1QuestionContentFingerprint(secondSimilar.contrastiveQuestions[0]),
  );
  assert.equal(secondSimilar.retryOriginal, true);
  assert.equal(secondSimilar.contrastiveQuestions.length, 1);

  const thirdSimilar = buildG1RemediationPlan({
    card: source,
    seed: "third-error",
    similarErrorCount: 3,
  });
  assert.equal(thirdSimilar.moveToPrerequisite, false);
  assert.equal(thirdSimilar.showWorkedExample, true);
  assert.equal(thirdSimilar.retryOriginal, true);

  const frontierPlan = buildG1SessionPlan({
    learnerId: "learner-session",
    targetSkillId: "G1-AS-02",
    seed: "prerequisite-remediation",
    events: fluentFirstSkillEvents(),
    now: BASE_TIME + 1_000_000,
  });
  const frontierCard = frontierPlan.cards.find(
    ({ lane, skillId }) => lane === "target" && skillId === "G1-AS-02",
  );
  assert.ok(frontierCard);
  const prerequisiteScaffold = buildG1RemediationPlan({
    card: frontierCard,
    seed: "third-error-with-prerequisite",
    similarErrorCount: 3,
  });
  assert.equal(prerequisiteScaffold.moveToPrerequisite, true);
  assert.equal(prerequisiteScaffold.contrastiveQuestions[0].skillId, "G1-AS-01");
  assert.equal(prerequisiteScaffold.retryOriginal, true);

  const recognition = buildG1RemediationPlan({
    card: source,
    seed: "recognition-error",
    similarErrorCount: 1,
    recognitionFailure: true,
  });
  assert.equal(recognition.recordAsMathematicsMiss, false);
  assert.equal(recognition.retryOriginal, true);
  assert.equal(recognition.workedExampleQuestion, null);
  assert.deepEqual(recognition.contrastiveQuestions, []);
});
