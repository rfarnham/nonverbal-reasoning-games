import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const visualSource = await readFile(
  new URL("../app/games/libra/balance-visual.tsx", import.meta.url),
  "utf8",
);
const stylesSource = await readFile(
  new URL("../app/games/libra/libra.module.css", import.meta.url),
  "utf8",
);
const pageSource = await readFile(
  new URL("../app/games/libra/page.tsx", import.meta.url),
  "utf8",
);
const curriculumSource = await readFile(
  new URL("../app/games/libra/strategy-curriculum.ts", import.meta.url),
  "utf8",
);

function componentSource(name, nextName) {
  const startMarker = `function ${name}(`;
  const endMarker = `function ${nextName}(`;
  return sourceBetween(visualSource, startMarker, endMarker, name);
}

function sourceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${label} exists`);
  assert.notEqual(end, -1, `${label} has a bounded source block`);
  return source.slice(start, end);
}

test("the teaching proof renders actual scales for every operation", () => {
  assert.match(visualSource, /function ProofBalanceScale\(/);
  assert.match(visualSource, /<ScaleDrawing \/>/);
  assert.match(visualSource, /<ProofScalePan/);

  for (const role of [
    "source",
    "substitution-source",
    "substitution-before",
    "substitution-after",
    "add-receiver",
    "add-donor",
    "add-result",
    "subtract-working",
    "subtract-guide",
    "subtract-result",
    "cancel-before",
    "cancel-after",
    "regroup-before",
    "regroup-after",
    "split-grouped",
    "split-result",
    "conclusion",
  ]) {
    assert.match(
      visualSource,
      new RegExp(`(?:role|beforeRole|afterRole)="${role}"`),
      `${role} uses the shared real-scale renderer`,
    );
  }
});

test("substitution, adding, and division expose literal visual motion hooks", () => {
  assert.match(visualSource, /data-proof-motion="substitution"/);
  assert.match(visualSource, /data-proof-motion="substitute-load"/);
  assert.match(visualSource, /data-proof-load-state=\{group\.tone \?\? "plain"\}/);
  assert.match(visualSource, /sourceFromSide/);
  assert.match(visualSource, /sourceToSide/);

  assert.match(visualSource, /data-proof-motion="add-scales"/);
  assert.match(visualSource, /tone: "move" as const/);
  assert.match(visualSource, /\+ left &nbsp;&nbsp; \+ right/);

  assert.match(visualSource, /data-proof-motion="split-groups"/);
  assert.match(visualSource, /data-proof-motion="divide-sign"/);
  assert.match(visualSource, /groupIndex === 0 \? "keep" : "fade"/);
  assert.match(visualSource, /proofScaleDivideBadge/);
});

test("the real-scale choreography includes long holds and settled states", () => {
  for (const keyframe of [
    "proofCircleEqualLoads",
    "proofSubstitutionLoadTravel",
    "proofAddCargoTravel",
    "proofRemoveMatchedLoads",
    "proofBundleCircleIn",
    "proofDivideBadgeIn",
    "proofExtraGroupsFade",
    "proofKeptGroup",
  ]) {
    assert.match(stylesSource, new RegExp(`@keyframes ${keyframe}`));
  }
  assert.match(stylesSource, /var\(--proof-phase-duration\)/);
  assert.doesNotMatch(stylesSource, /var\(--proof-phase-delay\)/);
  assert.match(stylesSource, /data-proof-cue-state="active"/);
  assert.match(stylesSource, /data-proof-load-state="match"/);
  assert.match(stylesSource, /data-proof-load-state="move"/);
  assert.match(stylesSource, /data-proof-load-state="fade"/);
});

test("the animated proof uses one persistent canvas instead of swapping step cards", () => {
  assert.equal(
    visualSource.match(/data-proof-stage="persistent"/g)?.length ?? 0,
    1,
    "one fixed proof stage is mounted",
  );
  assert.match(visualSource, /className=\{styles\.proofPersistentStage\}/);
  assert.match(visualSource, /data-proof-phase=\{step\.kind\}/);
  assert.match(visualSource, /function ProofScaleRackScene\(/);
  assert.match(visualSource, /displayedProofScaleIndexes\(round\)\.map/);
  assert.match(visualSource, /proofScaleStatesBeforeStep\(/);
  assert.doesNotMatch(visualSource, /function TeachingProofSceneCard\(/);
  assert.doesNotMatch(visualSource, /<article\b/);
  assert.doesNotMatch(visualSource, /styles\.proofTeachingScene/);
});

test("proofs name the strategy and keep every numbered scale in view", () => {
  const proofVisual = sourceBetween(
    visualSource,
    "export function SolutionProofVisual(",
    "\nconst LESSON_ACCENTS",
    "SolutionProofVisual",
  );
  const rack = componentSource("ProofScaleRackScene", "TeachingProofPhase");

  assert.match(
    proofVisual,
    /`Using strategy \$\{PROOF_STRATEGY_NAMES\[activeStep\.strategyId\]\}`/,
  );
  assert.match(
    proofVisual,
    /<h3 className=\{styles\.proofStrategyHeading\}>/,
  );
  assert.match(
    curriculumSource,
    /"cancel-matches":\s*"Cancel"/,
  );
  assert.match(curriculumSource, /substitution:\s*"Substitution"/);
  assert.match(curriculumSource, /"create-combo":\s*"Combo"/);
  assert.match(curriculumSource, /"add-scales":\s*"Add scales"/);
  assert.match(curriculumSource, /"subtract-scales":\s*"Subtract scales"/);

  assert.match(rack, /displayedProofScaleIndexes\(round\)\.map/);
  assert.match(rack, /data-proof-scale-number=\{displayNumber\}/);
  assert.match(rack, /\(\{displayNumber\}\)/);
  assert.match(rack, /data-proof-scale-state=\{state\}/);
  assert.match(visualSource, /label="Working"/);
  assert.match(
    visualSource,
    /source\.copies > 1 \? `Use \$\{source\.copies\} copies` : "Use"/,
  );
  assert.match(stylesSource, /\.proofScaleLane\[data-proof-scale-state="working"\]/);
  assert.match(stylesSource, /\.proofScaleLane\[data-proof-scale-state="source"\]/);
  assert.match(
    proofVisual,
    /proofScaleStatesBeforeStep\(round, plan\.steps, displayedStepIndex\)/,
  );
  assert.match(
    proofVisual,
    /accessibleScaleStates\[workingScaleIndex\] = activeAfter/,
  );
  assert.doesNotMatch(
    proofVisual,
    /key=\{activeStep\.id\}/,
    "changing steps must not remount the persistent proof canvas",
  );
});

test("the local narration controller plays exactly one proof cue at a time", () => {
  const proofVisual = sourceBetween(
    visualSource,
    "export function SolutionProofVisual(",
    "\nconst LESSON_ACCENTS",
    "SolutionProofVisual",
  );

  assert.match(
    proofVisual,
    /\.play\(\[proofNarrationCueId\(step\)\]\)/,
  );
  assert.doesNotMatch(proofVisual, /\.play\(cueIds/);
  assert.doesNotMatch(proofVisual, /onCueStart/);
  assert.match(visualSource, /createGameNarrationPlayer\(LIBRA_PROOF_NARRATION/);
  assert.match(visualSource, /"--proof-phase-duration": `\$\{PROOF_MUTATION_MS\}ms`/);
  assert.match(visualSource, /data-proof-cue-state=/);
  assert.match(visualSource, /className=\{styles\.proofPhaseLayer\}/);
  assert.doesNotMatch(visualSource, /proofProgressTrack/);

  assert.match(
    stylesSource,
    /\.proofPersistentStage\s*\{[^}]*position:\s*relative;/s,
  );
  assert.match(
    stylesSource,
    /\.proofPhaseLayer\s*\{[^}]*position:\s*relative;/s,
  );
  assert.match(stylesSource, /\.proofPhaseLayer\s*\{[^}]*transition:\s*none;/s);
});

test("phase changes do not slide or zoom the persistent proof canvas", () => {
  assert.doesNotMatch(stylesSource, /@keyframes proofSceneCycle/);
  assert.doesNotMatch(stylesSource, /@keyframes proofFinalSceneCycle/);
  assert.doesNotMatch(stylesSource, /\.proofTeachingScene/);

  const phaseLayer = stylesSource.match(/\.proofPhaseLayer\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.match(phaseLayer, /position:\s*relative/);
  assert.match(phaseLayer, /transition:\s*none/);
  assert.doesNotMatch(phaseLayer, /\btranslate(?:X|Y)?\(/);
  assert.doesNotMatch(phaseLayer, /\bscale\(/);
  assert.doesNotMatch(stylesSource, /@keyframes proofPhaseCaption/);
  assert.doesNotMatch(visualSource, /timing\.delayMs/);
});

test("a morph keeps one scale frame and changes only its cargo layers", () => {
  const morph = componentSource("ProofMorphingBalanceScale", "InspectScaleScene");
  const animatedReturn = morph.slice(morph.lastIndexOf("\n  return ("));

  assert.equal(animatedReturn.match(/<ProofScaleFrame\b/g)?.length ?? 0, 1);
  assert.equal(animatedReturn.match(/<ProofScaleCargoLayer\b/g)?.length ?? 0, 2);
  assert.doesNotMatch(animatedReturn, /<ProofBalanceScale\b/);
  assert.match(animatedReturn, /className=\{styles\.proofMorphBefore\}/);
  assert.match(animatedReturn, /className=\{styles\.proofMorphAfter\}/);
});

test("routine proofs begin with the useful operation and end on its result", () => {
  const builder = curriculumSource.match(
    /export function buildTeachingProof[\s\S]*?\n\}\n\n\/\*\*/,
  )?.[0] ?? "";
  assert.doesNotMatch(builder, /\binspect\(/);
  assert.doesNotMatch(builder, /nextId\("conclude"\)/);
  assert.match(visualSource, /proofState === "settled" \? plan\.steps\.length - 1/);
});

test("one current caption stays visible and accessible below the scale", () => {
  const proofVisual = sourceBetween(
    visualSource,
    "export function SolutionProofVisual(",
    "\nconst LESSON_ACCENTS",
    "SolutionProofVisual",
  );
  const hiddenViewportEnd = proofVisual.indexOf(
    '<div className={styles.proofStepFooter}>',
  );
  const captionIndex = proofVisual.indexOf(
    "className={styles.proofNarrationCaption}",
  );

  assert.notEqual(hiddenViewportEnd, -1, "the hidden visual viewport closes");
  assert.ok(
    captionIndex > hiddenViewportEnd,
    "the current caption is outside the aria-hidden scale viewport",
  );
  assert.match(proofVisual, /proofNarrationCaption\(activeStep\)/);
  assert.match(
    proofVisual,
    /className=\{styles\.proofNarrationCaption\}[\s\S]{0,120}aria-live="polite"[\s\S]{0,100}aria-atomic="true"/,
  );
  assert.doesNotMatch(visualSource, /function ProofCallouts\(/);
  assert.doesNotMatch(visualSource, /proofProgressTrack/);
  assert.doesNotMatch(stylesSource, /proofCallout(?:First|Middle|Last)/);
  assert.doesNotMatch(stylesSource, /proofContinuousProgress/);
});

test("each proof step narrates, mutates, then waits for the learner", () => {
  const proofVisual = sourceBetween(
    visualSource,
    "export function SolutionProofVisual(",
    "\nconst LESSON_ACCENTS",
    "SolutionProofVisual",
  );

  assert.match(
    proofVisual,
    /useState<ProofCueStage>\([\s\S]*?"narrating"[\s\S]*?\.play\(\[proofNarrationCueId\(step\)\]\)[\s\S]*?result\.status !== "completed"[\s\S]*?setCueStage\("mutating"\)[\s\S]*?window\.setTimeout\([\s\S]*?setCueStage\("ready"\)[\s\S]*?PROOF_MUTATION_MS/,
  );
  assert.doesNotMatch(
    proofVisual,
    /aria-busy=/,
    "the live caption must not sit inside a busy subtree",
  );
  assert.match(proofVisual, /cueStage === "ready" \? \(/);
  assert.doesNotMatch(pageSource, /teachingProofDurationMs\(round\)/);
  assert.doesNotMatch(pageSource, /proofReplayTimerRef/);
});

test("Continue alone advances a proof and Done alone completes it", () => {
  const proofVisual = sourceBetween(
    visualSource,
    "export function SolutionProofVisual(",
    "\nconst LESSON_ACCENTS",
    "SolutionProofVisual",
  );
  const continueHandler = sourceBetween(
    proofVisual,
    "function continueExplanation()",
    "\n\n  return (",
    "continueExplanation",
  );

  assert.match(continueHandler, /if \(cueStage !== "ready"\) return/);
  assert.match(
    continueHandler,
    /if \(isLastStep\) \{[\s\S]*?onPlaybackCompleteRef\.current\?\.\(\);[\s\S]*?return;/,
  );
  assert.match(
    continueHandler,
    /setActiveStepIndex\(\(current\) => current \+ 1\)/,
  );
  assert.equal(
    proofVisual.match(/setActiveStepIndex\(\(current\) => current \+ 1\)/g)
      ?.length ?? 0,
    1,
    "no timer or narration callback advances to another step",
  );
  assert.match(
    proofVisual,
    /onClick=\{continueExplanation\}[\s\S]{0,180}\{isLastStep \? "Done" : "Continue"\}/,
  );
});

test("proof readiness only moves focus when the learner stayed on the proof", () => {
  const proofVisual = sourceBetween(
    visualSource,
    "export function SolutionProofVisual(",
    "\nconst LESSON_ACCENTS",
    "SolutionProofVisual",
  );

  assert.match(
    proofVisual,
    /document\.activeElement === proofRegionRef\.current[\s\S]*?continueButtonRef\.current\?\.focus\(\)/,
  );
});

test("correct answers never launch an automatic or reinforcement proof", () => {
  const chooseOption = sourceBetween(
    pageSource,
    "const chooseOption = useCallback(",
    "\n\n  const finishProofReplay",
    "chooseOption",
  );

  assert.match(
    chooseOption,
    /setPhase\(isCorrect \? "answered" : "animating"\)/,
  );
  assert.doesNotMatch(chooseOption, /setProofReplaying\(true\)/);
  assert.doesNotMatch(chooseOption, /replayProof\(/);
  assert.doesNotMatch(pageSource, /shouldExplainCorrectAnswer/);
  assert.doesNotMatch(pageSource, /reinforcementRoundIdsRef/);
  assert.doesNotMatch(pageSource, /proofPresented/);
  assert.doesNotMatch(pageSource, /finishCorrectProof/);
});

test("Explain problem sits beside Next problem and Next is locked during proof", () => {
  const answeredFeedback = pageSource.match(
    /phase === "answered" \? \([\s\S]*?\) : phase === "animating" && selectedCorrect/,
  )?.[0] ?? "";
  const goNext = sourceBetween(
    pageSource,
    "const goNext = useCallback(",
    "\n\n  const retryInfiniteGeneration",
    "goNext",
  );

  assert.match(
    answeredFeedback,
    /onClick=\{\(\) => replayProof\("live"\)\}[\s\S]*?Explain problem[\s\S]*?onClick=\{goNext\}[\s\S]*?Next problem/,
  );
  assert.equal(
    answeredFeedback.match(/disabled=\{proofReplaying\}/g)?.length ?? 0,
    2,
    "both sibling actions are locked while the proof is open",
  );
  assert.match(
    goNext,
    /phase !== "answered" \|\|[\s\S]*?proofReplaying[\s\S]*?\) \{[\s\S]*?return;/,
  );
});

test("Infinite cannot end while a manual explanation is active", () => {
  const endInfinite = sourceBetween(
    pageSource,
    "const endInfinite = useCallback(",
    "\n\n  const toggleSound",
    "endInfinite",
  );

  assert.match(
    endInfinite,
    /activeLessonStrategyId !== null \|\|[\s\S]*?proofReplaying/,
  );
  assert.match(
    pageSource,
    /className=\{styles\.endButton\}[\s\S]*?disabled=\{[\s\S]*?activeLessonStrategyId !== null \|\|[\s\S]*?proofReplaying/,
  );
});

test("historical review keeps its proof hidden until Explain problem", () => {
  const historicalReview = pageSource.match(
    /historicalSessionRound && historicalProgress \? \([\s\S]*?\) : round \? \(/,
  )?.[0] ?? "";

  assert.match(
    historicalReview,
    /proofState=\{proofReplaying \? "animating" : "hidden"\}/,
  );
  assert.match(
    historicalReview,
    /onClick=\{\(\) => replayProof\("historical"\)\}[\s\S]*?Explain problem/,
  );
  assert.doesNotMatch(historicalReview, /proofState="settled"/);
  assert.doesNotMatch(historicalReview, /proofState="animating"/);
});

test("strategy introductions use the same narrator and can be skipped immediately", () => {
  const strategyVisual = sourceBetween(
    visualSource,
    "export function StrategyLessonVisual(",
    "\nexport function PuzzleVisual(",
    "StrategyLessonVisual",
  );

  assert.match(visualSource, /strategyLessonNarrationCueId\(strategy\)/);
  assert.match(strategyVisual, /player\.play\(\[cueId\]\)/);
  assert.match(
    strategyVisual,
    /result\.status === "completed"[\s\S]*?setMotionRunKey\(lessonRunKey\)[\s\S]*?window\.setTimeout\([\s\S]*?onPlaybackStateChangeRef\.current\?\.\("settled"\)[\s\S]*?STRATEGY_LESSON_MUTATION_MS/,
  );
  assert.match(pageSource, /onPlaybackStateChange=\{setLessonPlaybackState\}/);
  assert.match(pageSource, /Skip & start/);
  assert.match(pageSource, /Skip all introductions/);
  assert.match(pageSource, /Watch & listen/);
  assert.match(pageSource, /controlledLessonPrimedRef/);
  assert.match(pageSource, /spatial-gym-libra-lesson-acknowledgements-v1/);
  assert.match(pageSource, /persistControlledLessonAcknowledgements\(/);
  assert.match(pageSource, /controlledLessonAcknowledgements\(/);
  assert.doesNotMatch(pageSource, /shouldReinforceAcknowledgedIntroduction/);
  assert.match(visualSource, /if \(!playbackRequested\) return/);
  assert.match(stylesSource, /--lesson-after-delay/);
  assert.match(stylesSource, /data-lesson-ready="true"/);
  assert.doesNotMatch(stylesSource, /lessonAfterIn 700ms 1\.72s/);

  const captionIndex = strategyVisual.indexOf(
    "className={styles.lessonNarrationCaption}",
  );
  const hiddenTimelineIndex = strategyVisual.indexOf(
    "className={styles.strategyLessonTimeline}",
  );
  assert.ok(
    captionIndex > hiddenTimelineIndex,
    "the strategy caption is visible outside the aria-hidden animation",
  );
});

test("proof replay cannot race a strategy lesson and restores keyboard focus", () => {
  assert.match(
    pageSource,
    /phase === "wrong-review" \|\|[\s\S]*?proofReplaying \|\|[\s\S]*?pendingLessons/,
  );
  assert.match(pageSource, /proofReplayOriginRef/);
  assert.match(pageSource, /replayButton\?\.focus\(\)/);
  assert.match(pageSource, /skipProofReplay[\s\S]*?finishProofReplay\(\)/);
  assert.match(
    pageSource,
    /closeCampaignReview[\s\S]*?proofNarrationPlayer\.cancel\(\)[\s\S]*?setProofReplaying\(false\)/,
  );
  assert.match(pageSource, /onClick=\{closeCampaignReview\}[\s\S]*?disabled=\{proofReplaying\}/);
});

test("reduced motion keeps the narrated persistent scale focus", () => {
  assert.match(
    stylesSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.proofSceneViewport[\s\S]*?display: block/,
  );
  assert.match(
    stylesSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.proofStoryboard[\s\S]*?display: none/,
  );
  assert.match(
    stylesSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.proofPhaseLayer[\s\S]*?transition: none/,
  );
  assert.match(
    stylesSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.proofStoryboard \.proofScaleTraveler[\s\S]*?animation: none !important/,
  );
  assert.match(
    stylesSource,
    /\.proofStoryboard \.proofScaleDivideBadge\s*\{[^}]*display:\s*grid;[^}]*opacity:\s*1;/s,
  );
  assert.match(visualSource, /data-proof-has-operator=\{children/);
});

test("responsive changes do not skip a correct narrated proof", () => {
  assert.match(pageSource, /if \(selectedCorrect\) return;/);
  assert.match(pageSource, /orientation shifts must not skip the narration/);
});

test("the visible hint and feedback derive from the exact proof plan", () => {
  assert.match(pageSource, /orderedStrategyIdsForRound\(round\)/);
  assert.match(pageSource, /buildTeachingProof\(round\)\.steps/);
  assert.doesNotMatch(
    pageSource.match(/function teachingProofFeedback[\s\S]*?\n\}/)?.[0] ?? "",
    /solutionStrategies/,
  );
});
