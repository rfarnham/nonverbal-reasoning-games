import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { exactIntegerValue } from "../lib/arithmetic-fluency/exact-number.ts";
import { generateG1Question } from "../lib/arithmetic-fluency/generator.ts";
import {
  createG1AttemptEvent,
  deriveG1LearnerModel,
} from "../lib/arithmetic-fluency/mastery.ts";
import {
  appendArithmeticAttempt,
  loadArithmeticFluencyDiagnostic,
} from "../lib/arithmetic-fluency/storage.ts";

const [page, styles, flashPage, handwriting, handwritingStyles, profiles] = await Promise.all([
  readFile(
    new URL(
      "../app/lab/subtraction-flash/curriculum/page.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../app/lab/subtraction-flash/curriculum/g1-curriculum.module.css",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../app/lab/subtraction-flash/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../app/lab/subtraction-flash/flash-handwriting.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../app/lab/subtraction-flash/flash-handwriting.module.css",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../app/lab/subtraction-flash/borrow-flash-profiles.ts",
      import.meta.url,
    ),
    "utf8",
  ),
]);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("Borrow Flash prominently links to the separate Grade 1 curriculum", () => {
  assert.match(
    flashPage,
    /className=\{styles\.curriculumLink\}[\s\S]*href="\/lab\/subtraction-flash\/curriculum\/"[\s\S]*Grade 1[\s\S]*Arithmetic curriculum/,
  );
  assert.doesNotMatch(flashPage, /AdaptiveSubtractionCurriculum|Adaptive practice/);
});

test("the curriculum is grade-first with G1 active and future grades disabled", () => {
  assert.match(page, /Array\.from\(\{ length: 6 \}/);
  assert.match(page, /aria-current=\{grade === 1 \? "page" : undefined\}/);
  assert.match(page, /disabled=\{grade !== 1\}/);
  assert.match(page, /Grade \$\{grade\}, coming later/);
  assert.match(page, /G1_SKILLS\.filter/);
  assert.doesNotMatch(
    page,
    /G1-AS-01\s*\|\s*core/,
    "normative curriculum rows stay out of the UI component",
  );
});

test("every required skill-card status field is exposed", () => {
  const card = section(page, "function SkillCard", "function GradeOneArithmeticCurriculumPage");
  for (const marker of [
    "skill.tier",
    "displayState(mastery.state)",
    "formatAccuracy(mastery.accuracy)",
    "formatDuration(mastery.medianActiveSolveTimeMs)",
    "mastery.currentBand",
    "formatTrend(mastery)",
    "retentionLabel(mastery)",
    "formatReviewDate(mastery.nextReviewAt)",
    "skill.prerequisites",
  ]) {
    assert.ok(card.includes(marker), `missing card field: ${marker}`);
  }
  assert.match(card, /disabled=\{!mastery\.unlocked\}/);
  assert.match(card, /Finish prerequisites/);
});

test("Type or Draw is selected before a fixed 15-question session", () => {
  assert.match(page, /type CurriculumInputMode = "type" \| "draw"/);
  assert.match(page, /<legend>Answer with<\/legend>/);
  assert.match(page, /aria-pressed=\{inputMode === "type"\}/);
  assert.match(page, /aria-pressed=\{inputMode === "draw"\}/);
  assert.match(page, /buildG1SessionPlan\(\{[\s\S]*count: 15/);

  const live = section(page, 'if (view === "playing" && session)', 'if (view === "results"');
  assert.doesNotMatch(live, /setInputMode|Answer with/);
  assert.match(live, /Home — all games/);
  assert.match(live, /Back to Grade 1 curriculum/);
});

test("sound stays available as a compact, accessible control during play", () => {
  const live = section(page, 'if (view === "playing" && session)', 'if (view === "results"');
  assert.match(
    live,
    /className=\{styles\.liveSoundButton\}[\s\S]*aria-pressed=\{soundEnabled\}[\s\S]*aria-label=\{`Sound \$\{soundEnabled \? "on" : "off"\}\. Toggle sound\.`\}[\s\S]*onClick=\{handleSoundToggle\}/,
  );
  assert.match(live, /<SoundIcon enabled=\{soundEnabled\} \/>/);
  assert.match(styles, /\.liveSoundButton\s*\{[\s\S]*width:\s*44px;[\s\S]*min-width:\s*44px;[\s\S]*height:\s*44px;/);
  assert.match(styles, /\.liveSoundButton:focus-visible/);
});

test("typed answers submit only on native Done or Enter", () => {
  const numeric = section(page, "function NumericInput", "function SkillCard");
  assert.match(numeric, /maxLength=\{3\}/);
  assert.match(numeric, /event\.key === "Enter"/);
  assert.match(numeric, /enterKeyHint="done"/);
  assert.match(numeric, /Answer\. Press Done to submit\./);
  assert.match(numeric, /digits\.replace\(\/\^0\+\(\?=\\d\)\//);
  assert.doesNotMatch(numeric, /setTimeout|TYPE_AUTO_SUBMIT_MS/);
  assert.doesNotMatch(numeric, /answerDigitCount|expectedAnswer/);
});

test("draw capacity is fixed by skill rather than the exact answer", () => {
  const twoDigitAnswer = generateG1Question({
    skillId: "G1-AS-10",
    seed: "slots-0",
    difficultyBand: 4,
    orientation: "horizontal",
  });
  const threeDigitAnswer = generateG1Question({
    skillId: "G1-AS-10",
    seed: "slots-4",
    difficultyBand: 4,
    orientation: "horizontal",
  });
  assert.equal(String(exactIntegerValue(twoDigitAnswer.exactAnswer)).length, 2);
  assert.equal(String(exactIntegerValue(threeDigitAnswer.exactAnswer)).length, 3);
  assert.match(page, /digitCount=\{currentCard \? skillAnswerCapacity\(currentCard\.skillId\) : 1\}/);
  assert.match(page, /entryMode="right-aligned"/);
  assert.doesNotMatch(page, /answerDigitCount\(currentQuestion\)/);
});

test("structured prompts keep the input in the natural missing-number position", () => {
  assert.match(page, /switch \(ast\.kind\)/);
  assert.match(page, /case "equation"/);
  assert.match(page, /case "equal-groups"/);
  assert.match(page, /case "division-model"/);
  assert.match(page, /case "part-whole"/);
  assert.match(page, /ast\.unknown === "result" \? \([\s\S]*answer/);
  assert.match(page, /index === unknownOperand \? answer/);
  assert.match(page, /className=\{styles\.verticalRule\}/);
  assert.match(page, /role="group"/);
  assert.doesNotMatch(page, /role="img"/);
  assert.doesNotMatch(
    page,
    /className=\{styles\.modelEquation\}\s+aria-hidden="true"/,
    "interactive answer controls stay exposed to assistive technology",
  );
  assert.match(styles, /\.equation[\s\S]*font-size:\s*clamp\(4\.8rem/);
  assert.match(styles, /\.numericInput[\s\S]*font-size:\s*clamp\(4\.2rem/);
});

test("zero piles and unknown part-whole groups remain visually distinct", () => {
  assert.match(page, /count === 0 \? \([\s\S]*styles\.zeroPile[\s\S]*>0</);
  const partWhole = section(page, "function PartWholeProblem", "function StructuredProblem");
  assert.match(partWhole, /ast\.representation === "equation"/);
  assert.match(partWhole, /ast\.representation === "number-bond"/);
  assert.match(partWhole, /styles\.dotPartsModel/);
  assert.match(partWhole, /styles\.numberBond/);
  assert.match(partWhole, /styles\.modelEquation/);
  assert.match(partWhole, /styles\.dotPartsAnswer/);
  assert.match(partWhole, /styles\.numberBondAnswer/);
  assert.doesNotMatch(partWhole, /className=\{styles\.groupModel\}[\s\S]*className=\{styles\.modelEquation\}/);
  assert.match(styles, /\.dotPartsAnswer,[\s\S]*\.numberBondAnswer[\s\S]*border:\s*3px dashed var\(--teal\)/);
  assert.match(styles, /\.numberBondStem[\s\S]*border-bottom:\s*4px solid var\(--teal\)/);
  assert.match(styles, /\.zeroPile[\s\S]*font-weight:\s*920/);
});

test("unsupported vertical requests resolve to renderer-honest horizontal cards", () => {
  for (const skillId of ["G1-AS-08", "G1-AS-18"]) {
    const question = generateG1Question({
      skillId,
      seed: `horizontal-only-${skillId}`,
      difficultyBand: 3,
      orientation: "vertical",
    });
    assert.equal(question.orientation, "horizontal");
    assert.equal(question.promptAst.orientation, "horizontal");
  }

  for (const seed of ["part-whole-a", "part-whole-b", "part-whole-c"]) {
    const question = generateG1Question({
      skillId: "G1-AS-02",
      seed,
      difficultyBand: 2,
      orientation: "vertical",
    });
    assert.equal(question.orientation, "horizontal");
    assert.equal(question.promptAst.kind, "part-whole");
    assert.match(question.promptAst.representation, /^(dot-parts|number-bond|equation)$/);
  }

  const equation = section(page, "function EquationProblem", "function DotPile");
  assert.match(equation, /ast\.operands\.length === 2/);
});

test("multiplication concepts render groups, arrays, and repeated addition honestly", () => {
  const equalGroups = section(page, "function EqualGroupsProblem", "function DivisionModelProblem");
  assert.match(equalGroups, /ast\.representation === "array"/);
  assert.match(equalGroups, /styles\.arrayModel/);
  assert.match(equalGroups, /gridTemplateColumns:\s*`repeat\(\$\{ast\.groupSize\}, 14px\)`/);
  assert.match(equalGroups, /ast\.representation === "repeated-addition"/);
  assert.match(equalGroups, /styles\.repeatedAddition/);
  assert.match(equalGroups, /Array\.from\(\{ length: ast\.groupCount \}/);
  assert.match(equalGroups, /styles\.groupModel/);
  assert.match(styles, /\.arrayModel[\s\S]*display:\s*grid/);
  assert.match(styles, /\.repeatedAddition[\s\S]*flex-wrap:\s*wrap/);
});

test("wrong answers visibly retry the same question and every response is saved", () => {
  assert.match(page, /const WRONG_FEEDBACK_MS = 900/);
  assert.match(page, /setFeedback\(correct \? "correct" : "incorrect"\)/);
  assert.match(page, /className=\{styles\.retryFeedback\}[\s\S]*Try again/);
  assert.match(styles, /\.retryFeedback[\s\S]*color:\s*var\(--incorrect\)/);
  assert.match(page, /setInputNonce\(\(value\) => value \+ 1\)/);

  const submit = section(page, "const submitAnswer = useCallback", "const handleTypedAnswer");
  assert.doesNotMatch(
    submit.slice(submit.indexOf("if (correct)")),
    /setCardIndex/,
    "wrong submissions do not advance the deck",
  );
  assert.match(page, /submissions:\s*nextSubmissions/);
  assert.match(page, /appendArithmeticAttempt\(event, storageRef\.current\)/);
  assert.ok(
    submit.indexOf("persistAttempt({") < submit.indexOf("if (correct)"),
    "the first wrong row is persisted before retry feedback",
  );
  assert.match(page, /independentFirstAttempt[\s\S]*mathAttemptIndex === 0/);
  assert.doesNotMatch(
    page,
    /factKey:\s*currentQuestion\.difficultyFeatures/,
    "non-fact skills let the event factory derive a safe null fact identity",
  );
});

test("a first miss survives reload and its correction is not duplicate mastery", () => {
  const question = generateG1Question({
    skillId: "G1-AS-01",
    seed: "ui-first-miss-reload",
    difficultyBand: 1,
    orientation: "horizontal",
  });
  const correctAnswer = exactIntegerValue(question.exactAnswer);
  assert.notEqual(correctAnswer, null);
  const wrongAnswer = correctAnswer === 9 ? 8 : correctAnswer + 1;
  const memory = new Map();
  const storage = {
    getItem(key) {
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
    },
    removeItem(key) {
      memory.delete(key);
    },
  };
  const miss = createG1AttemptEvent({
    id: "ui-reload:miss",
    learnerId: "ui-reload",
    sessionId: "ui-reload-session",
    question,
    startedAt: 1_000,
    completedAt: 1_500,
    activeSolveTimeMs: 500,
    submissions: [{
      submittedAt: 1_500,
      inputMode: "keyboard",
      rawInput: String(wrongAnswer),
      answer: wrongAnswer,
    }],
    independentFirstAttempt: true,
  });
  assert.equal(appendArithmeticAttempt(miss, storage, undefined, 1_500).ok, true);
  const afterReload = loadArithmeticFluencyDiagnostic(storage);
  assert.equal(afterReload.store.attemptEvents.length, 1);
  assert.equal(afterReload.store.attemptEvents[0].firstAttemptCorrect, false);

  const correction = createG1AttemptEvent({
    id: "ui-reload:correction",
    learnerId: "ui-reload",
    sessionId: "ui-reload-session",
    question,
    startedAt: 1_600,
    completedAt: 1_900,
    activeSolveTimeMs: 300,
    submissions: [{
      submittedAt: 1_900,
      inputMode: "keyboard",
      rawInput: String(correctAnswer),
      answer: correctAnswer,
    }],
    independentFirstAttempt: false,
  });
  assert.equal(appendArithmeticAttempt(correction, storage, undefined, 1_900).ok, true);
  const reloaded = loadArithmeticFluencyDiagnostic(storage);
  const model = deriveG1LearnerModel(reloaded.store.attemptEvents, 2_000, "ui-reload");
  assert.equal(reloaded.store.attemptEvents.length, 2);
  assert.equal(model.skills[question.skillId].independentAttempts, 1);
  assert.equal(model.skills[question.skillId].accuracy, 0);
});

test("a non-fact AS01 answer resolves without an explicit fact identity", () => {
  const question = generateG1Question({
    skillId: "G1-AS-01",
    seed: "ui-as01-non-fact-persistence",
    difficultyBand: 1,
    orientation: "horizontal",
  });
  const answer = exactIntegerValue(question.exactAnswer);
  assert.notEqual(answer, null);
  const event = createG1AttemptEvent({
    learnerId: "ui-test",
    sessionId: "ui-test-session",
    question,
    startedAt: 1_000,
    completedAt: 1_500,
    activeSolveTimeMs: 500,
    submissions: [
      {
        submittedAt: 1_500,
        inputMode: "keyboard",
        rawInput: String(answer),
        answer,
        activeSolveTimeMs: 500,
      },
    ],
  });
  assert.equal(event.firstAttemptCorrect, true);
  assert.equal(event.finalCorrect, true);
  assert.equal(event.factKey, null);
});

test("handwriting rejection telemetry is preserved without becoming a math miss", () => {
  assert.match(handwriting, /onRecognitionRejected\?/);
  assert.match(handwriting, /rawRecognition:\s*raw/);
  assert.match(handwriting, /recognitionConfidence:\s*confidence/);
  assert.match(handwriting, /recognitionMargin:\s*margin/);
  assert.match(handwriting, /recognitionProcessingMs/);
  assert.match(page, /onRecognitionRejected=\{handleRejectedRecognition\}/);
  assert.match(page, /answer:\s*null[\s\S]*status:\s*"failed"/);
  assert.match(page, /margin:\s*evidence\.recognitionMargin/);
  assert.match(page, /processingMs:\s*evidence\.recognitionProcessingMs/);
  assert.match(page, /rejectedRecognitionMode="confirm"/);
  assert.match(page, /status:\s*evidence\.recognitionStatus/);
  assert.match(page, /confirmedAnswer:\s*evidence\.confirmedAnswer/);
});

test("misses receive one shared untimed redemption pass without new mastery evidence", () => {
  assert.match(page, /RedemptionIntroPanel/);
  assert.match(page, /Here’s your chance at redemption|missedCount=\{redemptionQueue\.length\}/);
  assert.match(page, /mathAttemptIndex === 0/);
  assert.match(page, /queueAfterAnswer = \[\.\.\.queueAfterAnswer, currentCard\]/);
  assert.match(page, /sessionStage === "main"[\s\S]*mathAttemptIndex === 0/);
  assert.doesNotMatch(page, /workedExampleShownBeforeFirstAttempt:\s*isRedemption/);
  assert.match(page, /sessionStage === "redemption"[\s\S]*redemption-/);
  assert.match(page, /Untimed/);
});

test("results use active solve time and retention cards log their probe interval", () => {
  assert.match(page, /sessionActiveMsRef\.current \+= activeSolveTimeMs/);
  assert.match(page, /elapsedMs:\s*sessionActiveMsRef\.current/);
  assert.doesNotMatch(page, /Date\.now\(\) - sessionStartedAt/);
  assert.match(page, /supportExampleOpen \|\|[\s\S]*sessionStage === "redemption-intro"/);
  assert.match(page, /retentionIntervalDays !== null[\s\S]*\? "retention"/);
  assert.match(page, /retentionIntervalDays,/);
  assert.match(page, /assessmentId:/);
});

test("handwriting solve time stops at ink completion instead of OCR completion", () => {
  const drawn = section(
    page,
    "const handleDrawnAnswer = useCallback",
    "const handleRejectedRecognition",
  );
  const submit = section(page, "const submitAnswer = useCallback", "const handleTypedAnswer");
  assert.match(drawn, /answeredAt: number/);
  assert.doesNotMatch(drawn, /_answeredAt/);
  assert.match(drawn, /evidence\.recognitionStatus === "accepted"[\s\S]*\? answeredAt/);
  assert.match(drawn, /performance\.now\(\) - evidence\.recognitionProcessingMs/);
  assert.match(drawn, /performanceCompletedAt,/);
  assert.match(submit, /performanceCompletedAt\?: number/);
  assert.match(submit, /const measuredActiveSolveTimeMs = pauseActiveTime\(timingEnd\)/);
  assert.match(submit, /const activeSolveTimeMs = activeSolveTimeInsideWindow\(/);
});

test("a real typed first answer shares one validator-safe active duration", () => {
  const submit = section(page, "const submitAnswer = useCallback", "const handleTypedAnswer");
  assert.match(
    page,
    /function activeSolveTimeInsideWindow\([\s\S]*completedAt - startedAt[\s\S]*Math\.min\(Math\.max\(0, measuredActiveSolveTimeMs\), wallClockTimeMs\)/,
  );
  assert.match(submit, /submission\.submittedAt,[\s\S]*submissionsRef\.current\.map/);
  assert.match(submit, /\{ \.\.\.submission, activeSolveTimeMs \}/);
  assert.match(submit, /persistAttempt\(\{[\s\S]*activeSolveTimeMs,[\s\S]*completedAt,/);

  const question = generateG1Question({
    skillId: "G1-AS-01",
    seed: "ui-typed-first-answer-clock-edge",
    difficultyBand: 1,
    orientation: "horizontal",
  });
  const answer = exactIntegerValue(question.exactAnswer);
  assert.notEqual(answer, null);

  // Date.now() can remain in one millisecond while performance.now() advances.
  // The UI clamps once, then assigns the same duration to both levels.
  const startedAt = 5_000;
  const completedAt = 5_000;
  const measuredActiveSolveTimeMs = 0.75;
  const activeSolveTimeMs = Math.min(
    Math.max(0, measuredActiveSolveTimeMs),
    completedAt - startedAt,
  );
  const event = createG1AttemptEvent({
    learnerId: "ui-typed-profile",
    sessionId: "ui-typed-session",
    question,
    startedAt,
    completedAt,
    activeSolveTimeMs,
    submissions: [{
      submittedAt: completedAt,
      inputMode: "keyboard",
      rawInput: String(answer),
      answer,
      activeSolveTimeMs,
    }],
    independentFirstAttempt: true,
  });
  assert.equal(event.firstAttemptCorrect, true);
  assert.equal(event.activeSolveTimeMs, 0);
  assert.equal(event.submissions[0].activeSolveTimeMs, event.activeSolveTimeMs);
});

test("grade checks use the balanced core assessment plan and assessment evidence", () => {
  assert.match(page, /buildG1GradeAssessmentPlan\(\{/);
  assert.match(page, /if \(!learnerModel\.grade\.allCoreFluent\) return/);
  assert.match(page, /kind:\s*"assessment"/);
  assert.match(page, /sessionKind[\s\S]*session\.kind === "assessment"[\s\S]*"assessment"/);
  assert.match(page, /assessmentId:[\s\S]*session\.assessmentId/);
  assert.match(page, /disabled=\{!learnerModel\.grade\.allCoreFluent\}/);
  assert.match(page, /Start grade check with/);
  assert.match(page, /learnerModel\.grade\.complete/);
  assert.match(page, /learnerModel\.grade\.retentionRequirementMet/);
  assert.match(page, /learnerModel\.grade\.majorDomainsPassed/);
  assert.match(page, /assessmentEvidence\.domainAccuracy\[domain\]/);
  assert.match(page, /assessmentEvidence\.accuracy >= 0\.92/);
});

test("repeated math errors take bounded instructional detours then re-probe", () => {
  assert.match(
    page,
    /errorCount === 2 \|\| \(errorCount >= 3 && errorCount % 2 === 1\)/,
  );
  assert.match(page, /buildG1RemediationPlan\(\{/);
  assert.match(page, /plan\.contrastiveQuestions\[0\]/);
  assert.match(page, /plan\.workedExampleQuestion/);
  assert.match(page, /workedExampleQuestion,/);
  assert.match(page, /question=\{supportDetour\.workedExampleQuestion\}/);
  assert.match(page, /solutionTrace\.find\(\(\{ expression \}\) => expression\)/);
  assert.match(page, /continueRef\.current\?\.focus\(\)/);
  assert.match(page, /const beginSupportPractice[\s\S]*startQuestionTimer\(\)/);
  assert.match(page, /originalMathAttemptCount:\s*errorCount/);
  assert.match(page, /supportThresholdsRef\.current\.has\(errorCount\)/);
  assert.match(page, /function remediationCardFor\(card: CurriculumCard\): G1SessionCard/);
  assert.match(page, /const remediationCard = remediationCardFor\(currentCard\)/);
  assert.doesNotMatch(
    page,
    /session\.kind === "practice"[\s\S]{0,140}isRemediationCheckpoint\(errorCount\)/,
    "assessment and redemption source cards receive the same bounded support",
  );
  assert.match(page, /supportErrorCount:\s*0/);
  assert.match(page, /supportDetour\.supportErrorCount \+ 1/);
  assert.match(page, /supportDetour\.supportRound \+ 1/);
  assert.match(page, /buildDistinctSupportPlan\([\s\S]*supportDetour\.supportCard/);
  assert.match(page, /nested-support:\$\{supportRound\}:errors:\$\{supportErrorCount\}/);
  assert.match(page, /setSupportDetour\(continuingSupportDetour\)/);
  assert.match(page, /supportDetour !== null[\s\S]*"Quick practice"/);
  assert.match(page, /supportDetour === null[\s\S]*independentFirstAttempt/);
  assert.match(
    page,
    /supportDetour === null &&[\s\S]*sessionStage === "main" &&[\s\S]*mathAttemptIndex === 0/,
    "only an unassisted main-card first answer becomes independent evidence",
  );
  assert.match(page, /content_gap_after_three_same_structure_attempts/);
  assert.match(page, /detour\.threshold >= 3\) setReprobeScaffold\(true\)/);
  assert.match(page, /3 \+ index \* 2/);
  assert.match(page, /supportHint=\{[\s\S]*currentQuestion\.solutionTrace\[0\]/);
  assert.doesNotMatch(
    page,
    /detour\.threshold === 3[\s\S]{0,180}advanceAfterCorrect/,
    "the unsolved source question remains until the learner succeeds",
  );
});

test("unrecognized wrong values receive a stable math-error classification", () => {
  assert.match(page, /matched\.length \? matched : \["unclassified_math_error"\]/);
  assert.match(page, /misconceptionTagsForAnswer\(currentQuestion, answer\)/);
});

test("curriculum data follows the selected Borrow Flash profile and clears with it", () => {
  assert.match(page, /createBorrowFlashProfileStorage\(profileId\)/);
  assert.match(page, /loadArithmeticFluencyDiagnostic\(scopedStorage\)/);
  assert.match(page, /learnerId:\s*activeProfileId/);
  assert.match(page, /Change player in Borrow Flash/);
  assert.match(profiles, /ARITHMETIC_FLUENCY_STORAGE_KEY/);
  assert.match(
    profiles,
    /BORROW_FLASH_CHILD_DATA_KEYS[\s\S]*ARITHMETIC_FLUENCY_STORAGE_KEY/,
  );
});

test("the curriculum and three-digit drawing surface adapt at iPad and phone widths", () => {
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.skillGrid[\s\S]*repeat\(2/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.skillGrid[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(handwriting, /digitCount: 1 \| 2 \| 3/);
  assert.match(handwritingStyles, /data-digit-count="3"[\s\S]*repeat\(3/);
  assert.match(
    handwritingStyles,
    /@media \(min-width: 701px\) and \(max-width: 900px\)[\s\S]*data-digit-count="1"[\s\S]*min\(40vw, 310px\)[\s\S]*data-digit-count="3"[\s\S]*min\(74vw, 570px\)/,
  );
  assert.match(styles, /\.drawAnswer\s*\{[\s\S]*min-width:\s*0/);
  assert.doesNotMatch(styles, /\.drawAnswer\s*\{[\s\S]*min-width:\s*min\(70vw/);
});
