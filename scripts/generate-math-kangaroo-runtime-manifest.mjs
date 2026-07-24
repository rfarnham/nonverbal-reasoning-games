#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dataDirectory = path.join(
  root,
  "app",
  "journey",
  "reviews",
  "math-kangaroo",
  "data",
);
const sourcePath = path.join(dataDirectory, "selection-manifest.json");
const outputPath = path.join(dataDirectory, "runtime-manifest.json");

function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function runtimeRound(round) {
  const source = requiredObject(round.source, `${round.id} source`);
  const asset = requiredObject(round.asset, `${round.id} asset`);
  const explanation = requiredObject(
    round.explanationPlan,
    `${round.id} explanation`,
  );
  const visual = requiredObject(
    explanation.visualExplanation,
    `${round.id} grounded visual explanation`,
  );
  if (
    !Array.isArray(visual.regions) ||
    !Array.isArray(visual.paths) ||
    !Array.isArray(visual.beats) ||
    visual.beats.length < 3
  ) {
    throw new Error(
      `${round.id} needs regions, paths, and at least three grounded beats.`,
    );
  }
  const reveals = visual.beats.filter(
    (beat) =>
      beat?.kind === "reveal" &&
      Number.isInteger(beat.verifiedChoiceIndex),
  );
  if (
    reveals.length === 0 ||
    reveals.at(-1).verifiedChoiceIndex !== round.correctIndex
  ) {
    throw new Error(
      `${round.id} grounded explanation must reveal the official answer.`,
    );
  }
  if (
    !Number.isInteger(asset.publicWidth) ||
    asset.publicWidth < 1 ||
    !Number.isInteger(asset.publicHeight) ||
    asset.publicHeight < 1
  ) {
    throw new Error(`${round.id} needs final public asset dimensions.`);
  }
  return {
    id: round.id,
    journeyLevel: round.journeyLevel,
    difficulty: round.difficulty,
    gradeBand: round.gradeBand,
    mechanic: round.mechanic,
    prompt: round.prompt,
    choices: round.choices.map(
      ({ label, accessibleLabel, displayText }) => ({
        label,
        accessibleLabel,
        ...(displayText === undefined ? {} : { displayText }),
      }),
    ),
    correctIndex: round.correctIndex,
    explanationPlan: {
      headline: explanation.headline,
      animation: explanation.animation,
      status: explanation.status,
      solutionSteps: explanation.solutionSteps,
      wrongAnswerHint: explanation.wrongAnswerHint,
      animationPlan: explanation.animationPlan,
      visualExplanation: visual,
    },
    source: {
      year: source.year,
      gradeBand: source.gradeBand,
      questionNumber: source.questionNumber,
      sourceDocument: source.sourceDocument,
      answer: source.answer,
      answerKeyDocument: source.answerKeyDocument,
      answerKeyVerified: source.answerKeyVerified,
    },
    asset: {
      targetPublicPath: asset.targetPublicPath,
      publicWidth: asset.publicWidth,
      publicHeight: asset.publicHeight,
      status: asset.status,
      qa: asset.qa,
    },
  };
}

async function main() {
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  if (source.schemaVersion !== 1 || !Array.isArray(source.rounds)) {
    throw new Error("Unsupported Math Kangaroo selection manifest.");
  }
  const ids = new Set();
  const rounds = source.rounds.map((round) => {
    requiredObject(round, "Math Kangaroo round");
    if (typeof round.id !== "string" || !round.id || ids.has(round.id)) {
      throw new Error(`Invalid or duplicate Math Kangaroo round ID: ${round.id}`);
    }
    ids.add(round.id);
    return runtimeRound(round);
  });
  if (rounds.length !== 168) {
    throw new Error(
      `Math Kangaroo runtime manifest needs 168 rounds; found ${rounds.length}.`,
    );
  }
  const output = {
    schemaVersion: 1,
    contentVersion: source.contentVersion,
    generatedBy: "scripts/generate-math-kangaroo-runtime-manifest.mjs",
    rounds,
  };
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, outputPath);
}

await main();
