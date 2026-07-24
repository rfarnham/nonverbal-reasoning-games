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
  const start = visualSource.indexOf(startMarker);
  const end = visualSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${name} exists`);
  assert.notEqual(end, -1, `${name} has a bounded source block`);
  return visualSource.slice(start, end);
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
  assert.doesNotMatch(visualSource, /function TeachingProofSceneCard\(/);
  assert.doesNotMatch(visualSource, /<article\b/);
  assert.doesNotMatch(visualSource, /styles\.proofTeachingScene/);
});

test("the local narration controller advances in-place phase layers", () => {
  assert.match(
    visualSource,
    /"--proof-phase-duration"[\s\S]{0,180}clip\.minimumVisualMs/,
  );
  assert.match(visualSource, /createGameNarrationPlayer\(LIBRA_PROOF_NARRATION/);
  assert.match(visualSource, /onCueStart:[\s\S]{0,140}setActiveStepIndex\(index\)/);
  assert.match(visualSource, /data-proof-cue-state=/);
  assert.match(visualSource, /className=\{styles\.proofPhaseLayer\}/);
  assert.doesNotMatch(visualSource, /proofProgressTrack/);

  assert.match(
    stylesSource,
    /\.proofPersistentStage\s*\{[^}]*position:\s*relative;/s,
  );
  assert.match(
    stylesSource,
    /\.proofPhaseLayer\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/s,
  );
  assert.match(stylesSource, /\.proofPhaseLayer\s*\{[^}]*transition:\s*opacity/s);
});

test("phase changes do not slide or zoom the persistent proof canvas", () => {
  assert.doesNotMatch(stylesSource, /@keyframes proofSceneCycle/);
  assert.doesNotMatch(stylesSource, /@keyframes proofFinalSceneCycle/);
  assert.doesNotMatch(stylesSource, /\.proofTeachingScene/);

  const phaseLayer = stylesSource.match(/\.proofPhaseLayer\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.match(phaseLayer, /transition:\s*opacity/);
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

test("one calm caption replaces cycling callouts and the cursor bar", () => {
  assert.match(visualSource, /className=\{styles\.proofNarrationCaption\}/);
  assert.match(visualSource, /proofNarrationCaption\(activeStep\)/);
  assert.doesNotMatch(visualSource, /function ProofCallouts\(/);
  assert.doesNotMatch(visualSource, /proofProgressTrack/);
  assert.doesNotMatch(stylesSource, /proofCallout(?:First|Middle|Last)/);
  assert.doesNotMatch(stylesSource, /proofContinuousProgress/);
});

test("proof completion follows local narration instead of a page timeout", () => {
  assert.match(visualSource, /result\.status === "completed"/);
  assert.match(visualSource, /onPlaybackCompleteRef\.current\?\.\(\)/);
  assert.match(pageSource, /onProofPlaybackComplete=/);
  assert.doesNotMatch(pageSource, /teachingProofDurationMs\(round\)/);
  assert.doesNotMatch(pageSource, /proofReplayTimerRef/);
});

test("the page primes one reusable narrator from direct gestures", () => {
  assert.match(pageSource, /proofNarrationPlayer\.prime\(\)/);
  assert.match(
    pageSource,
    /if \(shouldExplainCorrectAnswer\) \{[\s\S]*?proofNarrationPlayer\.prime\(\)/,
  );
  assert.match(pageSource, /narrationPlayer=\{proofNarrationPlayer\}/);
});

test("proofs are optional after mastery and skippable whenever they play", () => {
  assert.match(pageSource, /const shouldExplainCorrectAnswer =/);
  assert.match(pageSource, /reinforcementRoundIdsRef/);
  assert.match(pageSource, /wasMissed \|\|/);
  assert.match(
    pageSource,
    /isCorrect && !shouldExplainCorrectAnswer[\s\S]*?"answered"/,
  );
  assert.match(pageSource, /phase === "answered" && proofPresented/);
  assert.match(pageSource, /setProofPresented\(isCorrect && shouldExplainCorrectAnswer\)/);
  assert.match(visualSource, />\s*Skip explanation\s*</);
  assert.match(pageSource, /proofNarrationPlayer\.cancel\(\);[\s\S]*?finishCorrectProof\(\)/);
  assert.match(pageSource, />\s*Explain\s*</);
});

test("strategy introductions use the same narrator and can be skipped immediately", () => {
  assert.match(visualSource, /strategyLessonNarrationCueId\(strategy\)/);
  assert.match(visualSource, /player\.play\(\[cueId\]\)/);
  assert.match(pageSource, /onPlaybackStateChange=\{setLessonPlaybackState\}/);
  assert.match(pageSource, /Skip & start/);
  assert.match(pageSource, /Skip all introductions/);
  assert.match(pageSource, /Watch & listen/);
  assert.match(pageSource, /controlledLessonPrimedRef/);
  assert.match(pageSource, /spatial-gym-libra-lesson-acknowledgements-v1/);
  assert.match(pageSource, /persistControlledLessonAcknowledgements\(/);
  assert.match(pageSource, /controlledLessonAcknowledgements\(/);
  assert.match(pageSource, /shouldReinforceAcknowledgedIntroduction/);
  assert.match(
    pageSource,
    /shouldReinforceAcknowledgedIntroduction[\s\S]*?reinforcementRoundIdsRef\.current\.add\(currentPlayId\)/,
  );
  assert.match(visualSource, /if \(!playbackRequested\) return/);
  assert.match(stylesSource, /--lesson-after-delay/);
  assert.match(stylesSource, /data-lesson-ready="true"/);
  assert.doesNotMatch(stylesSource, /lessonAfterIn 700ms 1\.72s/);
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
