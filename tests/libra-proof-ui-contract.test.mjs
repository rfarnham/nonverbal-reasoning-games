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
      new RegExp(`role="${role}"`),
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
  assert.match(stylesSource, /var\(--proof-scene-duration\)/);
  assert.match(stylesSource, /var\(--proof-scene-delay\)/);
  assert.match(stylesSource, /data-proof-load-state="match"/);
  assert.match(stylesSource, /data-proof-load-state="move"/);
  assert.match(stylesSource, /data-proof-load-state="fade"/);
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
});

test("the visible hint and feedback derive from the exact proof plan", () => {
  assert.match(pageSource, /orderedStrategyIdsForRound\(round\)/);
  assert.match(pageSource, /buildTeachingProof\(round\)\.steps/);
  assert.doesNotMatch(
    pageSource.match(/function teachingProofFeedback[\s\S]*?\n\}/)?.[0] ?? "",
    /solutionStrategies/,
  );
});
