import { CAMPAIGN_ROUNDS } from "./campaign-data.ts";
import {
  buildRound,
  compatiblePrograms,
  inferenceOptionIndexes,
  makePattern,
  programKey,
  roundFingerprint,
  type Difficulty,
  type MatrixRule,
  type MotifFill,
  type MotifScale,
  type MotifShape,
  type QuarterTurn,
  type Round,
  type TexturePhase,
} from "./rule-engine.ts";

export type PatternMatrixJourneyExtraLevel =
  | "junior-2"
  | "expert-2"
  | "wizard-2";

type PatternSpec = readonly [
  mask: number,
  shape: MotifShape,
  fill: MotifFill,
  scale: MotifScale,
  orientation: QuarterTurn,
  texturePhase: TexturePhase,
];

type JourneyRoundSpec = {
  id: string;
  difficulty: Difficulty;
  rule: MatrixRule;
  sources: readonly PatternSpec[];
  correctIndex: number;
};

// These source panels were selected with the canonical bounded generator and
// frozen here. buildRound still calculates every relation, answer, distractor,
// and feedback classification through Pattern Matrix's complete normalized
// rule grammar.
const JUNIOR_2_SPECS: readonly JourneyRoundSpec[] = [
  { id: "journey-junior-2-01", difficulty: "Medium", rule: { family: "combine", axis: "rows", operation: "right-minus-left", transform: "none" }, sources: [[8, "circle", "solid", 1, 0, 0], [15, "circle", "solid", 1, 0, 0], [6, "triangle", "outline", 1, 3, 0], [12, "triangle", "outline", 1, 3, 0], [1, "circle", "outline", 1, 0, 0], [3, "circle", "outline", 1, 0, 0]], correctIndex: 1 },
  { id: "journey-junior-2-02", difficulty: "Medium", rule: { family: "combine", axis: "columns", operation: "left-minus-right", transform: "none" }, sources: [[13, "square", "striped", 1, 0, 0], [7, "square", "striped", 1, 0, 0], [3, "circle", "solid", 2, 0, 0], [5, "circle", "solid", 2, 0, 0], [11, "circle", "striped", 0, 0, 2], [8, "circle", "striped", 0, 0, 2]], correctIndex: 3 },
  { id: "journey-junior-2-03", difficulty: "Medium", rule: { family: "combine", axis: "rows", operation: "join", transform: "none" }, sources: [[10, "triangle", "striped", 1, 2, 2], [3, "triangle", "striped", 1, 2, 2], [6, "bar", "striped", 2, 0, 2], [3, "bar", "striped", 2, 0, 2], [13, "circle", "striped", 2, 0, 2], [6, "circle", "striped", 2, 0, 2]], correctIndex: 0 },
  { id: "journey-junior-2-04", difficulty: "Medium", rule: { family: "combine", axis: "columns", operation: "overlap", transform: "none" }, sources: [[6, "bar", "outline", 2, 1, 0], [10, "bar", "outline", 2, 1, 0], [3, "bar", "outline", 0, 1, 0], [13, "bar", "outline", 0, 1, 0], [6, "triangle", "striped", 2, 1, 1], [12, "triangle", "striped", 2, 1, 1]], correctIndex: 2 },
  { id: "journey-junior-2-05", difficulty: "Medium", rule: { family: "combine", axis: "rows", operation: "cancel", transform: "none" }, sources: [[12, "circle", "outline", 1, 0, 0], [7, "circle", "outline", 1, 0, 0], [1, "circle", "striped", 2, 0, 3], [2, "circle", "striped", 2, 0, 3], [14, "bar", "striped", 1, 1, 1], [3, "bar", "striped", 1, 1, 1]], correctIndex: 1 },
  { id: "journey-junior-2-06", difficulty: "Medium", rule: { family: "combine", axis: "columns", operation: "right-minus-left", transform: "none" }, sources: [[13, "circle", "solid", 1, 0, 0], [14, "circle", "solid", 1, 0, 0], [3, "triangle", "outline", 2, 2, 0], [15, "triangle", "outline", 2, 2, 0], [12, "triangle", "solid", 1, 2, 0], [13, "triangle", "solid", 1, 2, 0]], correctIndex: 0 },
  { id: "journey-junior-2-07", difficulty: "Medium", rule: { family: "sequence", axis: "rows", step: "rotate-counterclockwise" }, sources: [[1, "triangle", "striped", 2, 0, 3], [1, "triangle", "striped", 1, 2, 1], [3, "bar", "striped", 2, 0, 2]], correctIndex: 3 },
  { id: "journey-junior-2-08", difficulty: "Medium", rule: { family: "sequence", axis: "columns", step: "rotate-clockwise" }, sources: [[12, "bar", "solid", 2, 0, 0], [9, "bar", "striped", 2, 0, 2], [7, "bar", "solid", 1, 1, 0]], correctIndex: 2 },
  { id: "journey-junior-2-09", difficulty: "Medium", rule: { family: "sequence", axis: "rows", step: "shrink" }, sources: [[2, "circle", "outline", 2, 0, 0], [5, "circle", "solid", 2, 0, 0], [13, "triangle", "solid", 2, 2, 0]], correctIndex: 0 },
  { id: "journey-junior-2-10", difficulty: "Medium", rule: { family: "sequence", axis: "columns", step: "grow" }, sources: [[6, "triangle", "solid", 0, 1, 0], [15, "triangle", "striped", 0, 1, 3], [7, "square", "outline", 0, 0, 0]], correctIndex: 2 },
  { id: "journey-junior-2-11", difficulty: "Medium", rule: { family: "sequence", axis: "rows", step: "rotate-clockwise" }, sources: [[1, "square", "striped", 2, 0, 0], [12, "triangle", "solid", 1, 2, 0], [2, "circle", "striped", 2, 0, 2]], correctIndex: 1 },
  { id: "journey-junior-2-12", difficulty: "Medium", rule: { family: "sequence", axis: "columns", step: "shrink" }, sources: [[11, "bar", "striped", 2, 0, 0], [1, "square", "striped", 2, 0, 1], [1, "square", "solid", 2, 0, 0]], correctIndex: 3 },
];

const EXPERT_2_SPECS: readonly JourneyRoundSpec[] = [
  { id: "journey-expert-2-01", difficulty: "Hard", rule: { family: "combine", axis: "rows", operation: "match", transform: "none" }, sources: [[5, "square", "outline", 2, 0, 0], [14, "square", "outline", 2, 0, 0], [11, "bar", "outline", 1, 0, 0], [11, "bar", "outline", 1, 0, 0], [12, "circle", "solid", 0, 0, 0], [2, "circle", "solid", 0, 0, 0]], correctIndex: 2 },
  { id: "journey-expert-2-02", difficulty: "Hard", rule: { family: "combine", axis: "columns", operation: "neither", transform: "none" }, sources: [[13, "square", "outline", 0, 0, 0], [5, "square", "outline", 0, 0, 0], [4, "square", "solid", 1, 0, 0], [12, "square", "solid", 1, 0, 0], [9, "bar", "outline", 2, 0, 0], [3, "bar", "outline", 2, 0, 0]], correctIndex: 0 },
  { id: "journey-expert-2-03", difficulty: "Hard", rule: { family: "combine", axis: "rows", operation: "join", transform: "rotate-half" }, sources: [[3, "triangle", "solid", 2, 1, 0], [8, "triangle", "solid", 2, 1, 0], [12, "triangle", "solid", 1, 3, 0], [12, "triangle", "solid", 1, 3, 0], [12, "bar", "outline", 1, 0, 0], [10, "bar", "outline", 1, 0, 0]], correctIndex: 3 },
  { id: "journey-expert-2-04", difficulty: "Hard", rule: { family: "combine", axis: "columns", operation: "overlap", transform: "rotate-clockwise" }, sources: [[6, "circle", "outline", 2, 0, 0], [7, "circle", "outline", 2, 0, 0], [14, "triangle", "solid", 2, 0, 0], [13, "triangle", "solid", 2, 0, 0], [6, "bar", "striped", 1, 0, 2], [2, "bar", "striped", 1, 0, 2]], correctIndex: 1 },
  { id: "journey-expert-2-05", difficulty: "Hard", rule: { family: "combine", axis: "rows", operation: "cancel", transform: "rotate-counterclockwise" }, sources: [[1, "bar", "solid", 0, 1, 0], [4, "bar", "solid", 0, 1, 0], [13, "circle", "striped", 1, 0, 2], [4, "circle", "striped", 1, 0, 2], [9, "bar", "solid", 1, 0, 0], [7, "bar", "solid", 1, 0, 0]], correctIndex: 2 },
  { id: "journey-expert-2-06", difficulty: "Hard", rule: { family: "combine", axis: "columns", operation: "left-minus-right", transform: "rotate-half" }, sources: [[15, "square", "striped", 1, 0, 0], [4, "square", "striped", 1, 0, 0], [4, "circle", "solid", 0, 0, 0], [1, "circle", "solid", 0, 0, 0], [11, "square", "striped", 0, 0, 1], [5, "square", "striped", 0, 0, 1]], correctIndex: 1 },
  { id: "journey-expert-2-07", difficulty: "Hard", rule: { family: "sequence", axis: "rows", step: "move-clockwise" }, sources: [[7, "square", "outline", 2, 0, 0], [8, "bar", "solid", 0, 0, 0], [13, "circle", "outline", 0, 0, 0]], correctIndex: 0 },
  { id: "journey-expert-2-08", difficulty: "Hard", rule: { family: "sequence", axis: "columns", step: "fill-cycle" }, sources: [[14, "circle", "outline", 0, 0, 0], [5, "square", "striped", 0, 0, 3], [9, "bar", "outline", 2, 0, 0]], correctIndex: 3 },
  { id: "journey-expert-2-09", difficulty: "Hard", rule: { family: "sequence", axis: "rows", step: "texture-shift" }, sources: [[7, "square", "striped", 0, 0, 2], [10, "square", "striped", 2, 0, 0], [2, "bar", "striped", 2, 0, 1]], correctIndex: 1 },
  { id: "journey-expert-2-10", difficulty: "Hard", rule: { family: "sequence", axis: "columns", step: "motif-turn" }, sources: [[7, "triangle", "striped", 2, 1, 2], [4, "triangle", "striped", 0, 3, 0], [15, "triangle", "solid", 0, 2, 0]], correctIndex: 3 },
  { id: "journey-expert-2-11", difficulty: "Hard", rule: { family: "grid", operation: "cancel", transform: "rotate-clockwise" }, sources: [[10, "circle", "striped", 0, 0, 3], [2, "circle", "striped", 0, 0, 3], [11, "circle", "striped", 0, 0, 3]], correctIndex: 2 },
  { id: "journey-expert-2-12", difficulty: "Hard", rule: { family: "grid", operation: "cancel", transform: "rotate-counterclockwise" }, sources: [[12, "square", "striped", 0, 0, 2], [14, "square", "striped", 0, 0, 2], [8, "square", "striped", 0, 0, 2]], correctIndex: 0 },
];

const WIZARD_2_SPECS: readonly JourneyRoundSpec[] = [
  { id: "journey-wizard-2-01", difficulty: "Wizard", rule: { family: "combine", axis: "columns", operation: "match", transform: "rotate-half" }, sources: [[14, "square", "outline", 2, 0, 0], [2, "square", "outline", 2, 0, 0], [14, "square", "outline", 1, 0, 0], [9, "square", "outline", 1, 0, 0], [5, "triangle", "solid", 0, 0, 0], [14, "triangle", "solid", 0, 0, 0]], correctIndex: 0 },
  { id: "journey-wizard-2-02", difficulty: "Wizard", rule: { family: "combine", axis: "rows", operation: "neither", transform: "rotate-clockwise" }, sources: [[4, "square", "outline", 2, 0, 0], [9, "square", "outline", 2, 0, 0], [8, "bar", "outline", 1, 1, 0], [9, "bar", "outline", 1, 1, 0], [2, "bar", "solid", 0, 1, 0], [7, "bar", "solid", 0, 1, 0]], correctIndex: 2 },
  { id: "journey-wizard-2-03", difficulty: "Wizard", rule: { family: "combine", axis: "columns", operation: "join", transform: "rotate-counterclockwise" }, sources: [[12, "triangle", "outline", 0, 2, 0], [3, "triangle", "outline", 0, 2, 0], [4, "bar", "outline", 1, 1, 0], [15, "bar", "outline", 1, 1, 0], [7, "circle", "outline", 0, 0, 0], [6, "circle", "outline", 0, 0, 0]], correctIndex: 3 },
  { id: "journey-wizard-2-04", difficulty: "Wizard", rule: { family: "combine", axis: "rows", operation: "overlap", transform: "rotate-half" }, sources: [[7, "triangle", "striped", 1, 2, 3], [9, "triangle", "striped", 1, 2, 3], [9, "square", "solid", 2, 0, 0], [1, "square", "solid", 2, 0, 0], [8, "square", "striped", 0, 0, 1], [8, "square", "striped", 0, 0, 1]], correctIndex: 1 },
  { id: "journey-wizard-2-05", difficulty: "Wizard", rule: { family: "combine", axis: "columns", operation: "cancel", transform: "rotate-clockwise" }, sources: [[15, "circle", "striped", 2, 0, 1], [3, "circle", "striped", 2, 0, 1], [12, "bar", "solid", 1, 1, 0], [9, "bar", "solid", 1, 1, 0], [12, "bar", "striped", 0, 1, 1], [1, "bar", "striped", 0, 1, 1]], correctIndex: 3 },
  { id: "journey-wizard-2-06", difficulty: "Wizard", rule: { family: "combine", axis: "rows", operation: "right-minus-left", transform: "rotate-counterclockwise" }, sources: [[8, "circle", "solid", 0, 0, 0], [2, "circle", "solid", 0, 0, 0], [10, "bar", "solid", 0, 1, 0], [6, "bar", "solid", 0, 1, 0], [3, "circle", "striped", 1, 0, 3], [4, "circle", "striped", 1, 0, 3]], correctIndex: 0 },
  { id: "journey-wizard-2-07", difficulty: "Wizard", rule: { family: "sequence", axis: "columns", step: "move-clockwise" }, sources: [[7, "circle", "outline", 2, 0, 0], [1, "bar", "outline", 0, 0, 0], [5, "bar", "outline", 1, 0, 0]], correctIndex: 1 },
  { id: "journey-wizard-2-08", difficulty: "Wizard", rule: { family: "sequence", axis: "rows", step: "shape-cycle" }, sources: [[14, "circle", "striped", 2, 0, 1], [11, "square", "striped", 0, 0, 1], [12, "bar", "striped", 0, 1, 3]], correctIndex: 2 },
  { id: "journey-wizard-2-09", difficulty: "Wizard", rule: { family: "sequence", axis: "columns", step: "motif-turn" }, sources: [[6, "triangle", "striped", 1, 2, 3], [4, "triangle", "outline", 2, 3, 0], [1, "triangle", "solid", 0, 3, 0]], correctIndex: 1 },
  { id: "journey-wizard-2-10", difficulty: "Wizard", rule: { family: "sequence", axis: "rows", step: "texture-shift" }, sources: [[5, "triangle", "striped", 0, 1, 3], [11, "circle", "striped", 0, 0, 1], [5, "triangle", "striped", 2, 0, 0]], correctIndex: 3 },
  { id: "journey-wizard-2-11", difficulty: "Wizard", rule: { family: "grid", operation: "cancel", transform: "rotate-counterclockwise" }, sources: [[14, "circle", "striped", 0, 0, 3], [15, "circle", "striped", 0, 0, 3], [8, "circle", "striped", 0, 0, 3]], correctIndex: 0 },
  { id: "journey-wizard-2-12", difficulty: "Wizard", rule: { family: "grid", operation: "cancel", transform: "rotate-clockwise" }, sources: [[7, "bar", "outline", 2, 1, 0], [15, "bar", "outline", 2, 1, 0], [4, "bar", "outline", 2, 1, 0]], correctIndex: 2 },
];

const SPECS: Readonly<
  Record<PatternMatrixJourneyExtraLevel, readonly JourneyRoundSpec[]>
> = {
  "junior-2": JUNIOR_2_SPECS,
  "expert-2": EXPERT_2_SPECS,
  "wizard-2": WIZARD_2_SPECS,
};

function patternFromSpec([
  mask,
  shape,
  fill,
  scale,
  orientation,
  texturePhase,
]: PatternSpec) {
  return makePattern(mask, {
    shape,
    fill,
    scale,
    orientation,
    texturePhase,
  });
}

function assertAnswerSchedule(
  level: PatternMatrixJourneyExtraLevel,
  rounds: readonly Round[],
): void {
  const positions = rounds.map(({ correctIndex }) => correctIndex);
  const counts = [0, 1, 2, 3].map(
    (position) => positions.filter((value) => value === position).length,
  );
  if (counts.some((count) => count !== 3)) {
    throw new Error(`${level} answer positions must balance 3/3/3/3.`);
  }
  if (
    positions.some(
      (position, index) =>
        index > 0 && positions[index - 1] === position,
    )
  ) {
    throw new Error(`${level} cannot repeat adjacent answer positions.`);
  }
  const blocks = [0, 4, 8].map((start) =>
    positions.slice(start, start + 4).join(","),
  );
  if (new Set(blocks).size !== blocks.length) {
    throw new Error(`${level} cannot repeat a four-position cycle.`);
  }
}

export function buildPatternMatrixJourneyExtraCampaignRounds(): Readonly<
  Record<PatternMatrixJourneyExtraLevel, readonly Round[]>
> {
  const usedFingerprints = new Set(
    CAMPAIGN_ROUNDS.map(roundFingerprint),
  );
  const result = {} as Record<
    PatternMatrixJourneyExtraLevel,
    readonly Round[]
  >;

  for (const level of [
    "junior-2",
    "expert-2",
    "wizard-2",
  ] as const) {
    const rounds = SPECS[level].map(
      ({ id, difficulty, rule, sources, correctIndex }) =>
        buildRound({
          id,
          difficulty,
          rule,
          sourcePatterns: sources.map(patternFromSpec),
          correctIndex,
        }),
    );
    assertAnswerSchedule(level, rounds);

    for (const round of rounds) {
      const compatible = compatiblePrograms(round.matrix);
      if (
        compatible.length !== 1 ||
        programKey(compatible[0]) !== programKey(round.rule) ||
        inferenceOptionIndexes(round.matrix, round.options).length !== 1 ||
        inferenceOptionIndexes(round.matrix, round.options)[0] !==
          round.correctIndex
      ) {
        throw new Error(
          `${round.id} is not unique under the complete rule grammar.`,
        );
      }
      const fingerprint = roundFingerprint(round);
      if (usedFingerprints.has(fingerprint)) {
        throw new Error(
          `${round.id} repeats a standalone or Journey round.`,
        );
      }
      usedFingerprints.add(fingerprint);
    }

    result[level] = Object.freeze([...rounds]);
  }

  return Object.freeze(result);
}

export const JOURNEY_EXTRA_CAMPAIGN_ROUNDS =
  buildPatternMatrixJourneyExtraCampaignRounds();
