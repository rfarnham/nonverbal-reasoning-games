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

function cssKeyframes(name) {
  const marker = `@keyframes ${name}`;
  const start = stylesSource.indexOf(marker);
  assert.notEqual(start, -1, `${name} keyframes exist`);
  const openingBrace = stylesSource.indexOf("{", start + marker.length);
  assert.notEqual(openingBrace, -1, `${name} keyframes open`);
  let depth = 0;
  for (let index = openingBrace; index < stylesSource.length; index += 1) {
    if (stylesSource[index] === "{") depth += 1;
    if (stylesSource[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return stylesSource.slice(start, index + 1);
  }
  assert.fail(`${name} keyframes close`);
}

function componentSource(name, nextName) {
  const startMarker = `function ${name}(`;
  const endMarker = `function ${nextName}(`;
  const start = visualSource.indexOf(startMarker);
  const end = visualSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${name} exists`);
  assert.notEqual(end, -1, `${name} has a bounded source block`);
  return visualSource.slice(start, end);
}

function opacityKeyframes(name) {
  const source = cssKeyframes(name);
  const points = [];
  const blockPattern = /((?:(?:\d+(?:\.\d+)?%|from|to)\s*,?\s*)+)\{([^{}]*)\}/g;
  for (const match of source.matchAll(blockPattern)) {
    const opacity = match[2].match(/opacity:\s*(\d*\.?\d+)/)?.[1];
    if (opacity === undefined) continue;
    for (const selector of match[1].matchAll(/\d+(?:\.\d+)?%|from|to/g)) {
      points.push({
        percent:
          selector[0] === "from"
            ? 0
            : selector[0] === "to"
              ? 100
              : Number.parseFloat(selector[0]),
        opacity: Number.parseFloat(opacity),
      });
    }
  }
  assert.ok(points.length >= 2, `${name} defines an opacity window`);
  return points.sort((left, right) => left.percent - right.percent);
}

function interpolatedOpacity(points, percent) {
  const rightIndex = points.findIndex((point) => point.percent >= percent);
  if (rightIndex <= 0) return points[Math.max(0, rightIndex)].opacity;
  if (rightIndex === -1) return points.at(-1).opacity;
  const left = points[rightIndex - 1];
  const right = points[rightIndex];
  if (right.percent === left.percent) return right.opacity;
  const progress = (percent - left.percent) / (right.percent - left.percent);
  return left.opacity + (right.opacity - left.opacity) * progress;
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
  assert.match(stylesSource, /var\(--proof-phase-delay\)/);
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

test("the cumulative proof timeline schedules in-place phase layers", () => {
  assert.match(
    visualSource,
    /"--proof-phase-delay"[\s\S]{0,160}timing\.delayMs/,
  );
  assert.match(
    visualSource,
    /"--proof-phase-duration"[\s\S]{0,160}timing\.durationMs/,
  );
  assert.match(visualSource, /plan\.timeline/);
  assert.match(visualSource, /className=\{styles\.proofPhaseLayer\}/);
  assert.doesNotMatch(visualSource, /stepIndex\s*\*\s*[A-Z_]+/);

  assert.match(
    stylesSource,
    /\.proofPersistentStage\s*\{[^}]*position:\s*relative;/s,
  );
  assert.match(
    stylesSource,
    /\.proofPhaseLayer\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/s,
  );
  assert.match(
    stylesSource,
    /\.proofPhaseEnter\s*\{[^}]*proofPhaseEnter/s,
  );
  assert.match(
    stylesSource,
    /data-proof-exits="true"[\s\S]*?\.proofPhaseExit\s*\{[^}]*proofPhaseExit/s,
  );
});

test("phase changes do not slide or zoom the persistent proof canvas", () => {
  assert.doesNotMatch(stylesSource, /@keyframes proofSceneCycle/);
  assert.doesNotMatch(stylesSource, /@keyframes proofFinalSceneCycle/);
  assert.doesNotMatch(stylesSource, /\.proofTeachingScene/);

  const phaseEnter = cssKeyframes("proofPhaseEnter");
  const phaseExit = cssKeyframes("proofPhaseExit");
  assert.match(phaseEnter, /opacity:/);
  assert.match(phaseExit, /opacity:/);
  assert.match(visualSource, /const crossfadeHalfMs = 240/);
  assert.match(visualSource, /timing\.delayMs - crossfadeHalfMs/);
  assert.match(
    visualSource,
    /timing\.delayMs \+ timing\.durationMs - crossfadeHalfMs/,
  );
  assert.match(visualSource, /data-proof-exits=\{exitsAcrossBoundary/);
  for (const phaseFade of [phaseEnter, phaseExit]) {
    assert.doesNotMatch(phaseFade, /\btransform\s*:/);
    assert.doesNotMatch(phaseFade, /\btranslate(?:X|Y)?\(/);
    assert.doesNotMatch(phaseFade, /\bscale\(/);
  }
  assert.match(stylesSource, /@keyframes proofPhaseCaption/);
  assert.match(
    stylesSource,
    /\.proofPhaseLayer[\s\S]*?\.proofScaleFigure[\s\S]*?> figcaption\s*\{[^}]*proofPhaseCaption/s,
  );
});

test("a morph keeps one scale frame and changes only its cargo layers", () => {
  const morph = componentSource("ProofMorphingBalanceScale", "ProofCallouts");
  const animatedReturn = morph.slice(morph.lastIndexOf("\n  return ("));

  assert.equal(animatedReturn.match(/<ProofScaleFrame\b/g)?.length ?? 0, 1);
  assert.equal(animatedReturn.match(/<ProofScaleCargoLayer\b/g)?.length ?? 0, 2);
  assert.doesNotMatch(animatedReturn, /<ProofBalanceScale\b/);
  assert.match(animatedReturn, /className=\{styles\.proofMorphBefore\}/);
  assert.match(animatedReturn, /className=\{styles\.proofMorphAfter\}/);
});

test("the conclusion decorates the prior result instead of mounting a new scale", () => {
  const conclusion = componentSource(
    "ConclusionScaleScene",
    "TeachingProofSceneVisual",
  );
  const animatedReturn = conclusion.slice(conclusion.lastIndexOf("\n  return ("));

  assert.match(animatedReturn, /styles\.proofConclusionOverlay/);
  assert.doesNotMatch(animatedReturn, /<ProofBalanceScale\b/);
  assert.match(
    visualSource,
    /data-proof-holds-final=\{[\s\S]{0,100}stepIndex === stepCount - 2/,
  );
  assert.match(
    stylesSource,
    /\.proofPhaseLayer\[data-proof-holds-final="true"\]/,
  );
  assert.match(
    stylesSource,
    /data-proof-state="settled"[\s\S]*?data-proof-holds-final="true"[\s\S]*?\.proofMorphBefore\s*\{[^}]*opacity:\s*0/s,
  );
  assert.match(
    stylesSource,
    /data-proof-state="settled"[\s\S]*?data-proof-holds-final="true"[\s\S]*?\.proofMorphAfter\s*\{[^}]*opacity:\s*1/s,
  );
  for (const helperClass of [
    "proofDonorScale",
    "proofGuideScale",
    "substitution-source",
  ]) {
    assert.match(
      stylesSource,
      new RegExp(
        `data-proof-state="settled"[\\s\\S]*?data-proof-holds-final="true"[\\s\\S]*?${helperClass}[\\s\\S]*?opacity:\\s*0`,
      ),
    );
  }
});

test("only one callout is visible at any instant", () => {
  for (const names of [
    ["proofCalloutFirst", "proofCalloutLast"],
    [
      "proofCalloutFirstOfThree",
      "proofCalloutMiddle",
      "proofCalloutLastOfThree",
    ],
  ]) {
    const curves = names.map(opacityKeyframes);
    for (let percent = 0; percent <= 100; percent += 0.25) {
      const visible = curves.filter(
        (curve) => interpolatedOpacity(curve, percent) > 0.001,
      );
      assert.ok(
        visible.length <= 1,
        `${names.join(", ")} overlap at ${percent}%`,
      );
    }
  }
});

test("reduced motion keeps the static scale storyboard and removes travel", () => {
  assert.match(
    stylesSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.proofSceneViewport[\s\S]*?display: none/,
  );
  assert.match(
    stylesSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.proofStoryboard[\s\S]*?display: grid/,
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

test("the visible hint and feedback derive from the exact proof plan", () => {
  assert.match(pageSource, /orderedStrategyIdsForRound\(round\)/);
  assert.match(pageSource, /buildTeachingProof\(round\)\.steps/);
  assert.doesNotMatch(
    pageSource.match(/function teachingProofFeedback[\s\S]*?\n\}/)?.[0] ?? "",
    /solutionStrategies/,
  );
});
