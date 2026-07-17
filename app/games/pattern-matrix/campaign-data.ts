import {
  buildRound,
  makePattern,
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

type PatternSpec = readonly [
  mask: number,
  shape: MotifShape,
  fill: MotifFill,
  scale: MotifScale,
  orientation: QuarterTurn,
  texturePhase: TexturePhase,
];

type CampaignSpec = {
  id: string;
  difficulty: Difficulty;
  rule: MatrixRule;
  sources: readonly PatternSpec[];
  correctIndex: number;
};

/**
 * Frozen source panels for the authored curriculum. The third panel in every
 * relation, the missing answer, and all options are derived by rule-engine.
 */
const CAMPAIGN_SPECS: readonly CampaignSpec[] = [
  { id: "campaign-easy-1", difficulty: "Easy", rule: { family: "combine", axis: "rows", operation: "join", transform: "none" }, sources: [[1, "circle", "solid", 1, 0, 0], [2, "circle", "solid", 1, 0, 0], [3, "circle", "solid", 1, 0, 0], [10, "circle", "solid", 1, 0, 0], [12, "circle", "solid", 1, 0, 0], [7, "circle", "solid", 1, 0, 0]], correctIndex: 0 },
  { id: "campaign-easy-2", difficulty: "Easy", rule: { family: "combine", axis: "rows", operation: "join", transform: "none" }, sources: [[9, "square", "outline", 1, 0, 0], [12, "square", "outline", 1, 0, 0], [6, "square", "solid", 1, 0, 0], [3, "square", "solid", 1, 0, 0], [3, "circle", "outline", 1, 0, 0], [5, "circle", "outline", 1, 0, 0]], correctIndex: 1 },
  { id: "campaign-easy-3", difficulty: "Easy", rule: { family: "combine", axis: "rows", operation: "join", transform: "none" }, sources: [[7, "square", "outline", 1, 0, 0], [11, "square", "outline", 1, 0, 0], [4, "circle", "solid", 1, 0, 0], [1, "circle", "solid", 1, 0, 0], [6, "square", "solid", 1, 0, 0], [3, "square", "solid", 1, 0, 0]], correctIndex: 2 },
  { id: "campaign-easy-4", difficulty: "Easy", rule: { family: "combine", axis: "rows", operation: "overlap", transform: "none" }, sources: [[13, "circle", "solid", 1, 0, 0], [3, "circle", "solid", 1, 0, 0], [6, "circle", "solid", 1, 0, 0], [3, "circle", "solid", 1, 0, 0], [13, "circle", "solid", 1, 0, 0], [6, "circle", "solid", 1, 0, 0]], correctIndex: 3 },
  { id: "campaign-easy-5", difficulty: "Easy", rule: { family: "combine", axis: "rows", operation: "overlap", transform: "none" }, sources: [[10, "square", "solid", 1, 0, 0], [7, "square", "solid", 1, 0, 0], [10, "square", "outline", 1, 0, 0], [12, "square", "outline", 1, 0, 0], [6, "circle", "solid", 1, 0, 0], [3, "circle", "solid", 1, 0, 0]], correctIndex: 1 },
  { id: "campaign-easy-6", difficulty: "Easy", rule: { family: "combine", axis: "rows", operation: "overlap", transform: "none" }, sources: [[5, "square", "solid", 1, 0, 0], [6, "square", "solid", 1, 0, 0], [14, "circle", "solid", 1, 0, 0], [5, "circle", "solid", 1, 0, 0], [10, "circle", "solid", 1, 0, 0], [12, "circle", "solid", 1, 0, 0]], correctIndex: 3 },
  { id: "campaign-easy-7", difficulty: "Easy", rule: { family: "combine", axis: "rows", operation: "cancel", transform: "none" }, sources: [[10, "circle", "solid", 1, 0, 0], [8, "circle", "solid", 1, 0, 0], [7, "circle", "solid", 1, 0, 0], [10, "circle", "solid", 1, 0, 0], [4, "circle", "solid", 1, 0, 0], [2, "circle", "solid", 1, 0, 0]], correctIndex: 0 },
  { id: "campaign-easy-8", difficulty: "Easy", rule: { family: "combine", axis: "rows", operation: "cancel", transform: "none" }, sources: [[13, "square", "solid", 1, 0, 0], [9, "square", "solid", 1, 0, 0], [14, "square", "outline", 1, 0, 0], [5, "square", "outline", 1, 0, 0], [2, "square", "solid", 1, 0, 0], [10, "square", "solid", 1, 0, 0]], correctIndex: 2 },
  { id: "campaign-easy-9", difficulty: "Easy", rule: { family: "combine", axis: "rows", operation: "cancel", transform: "none" }, sources: [[1, "circle", "outline", 1, 0, 0], [10, "circle", "outline", 1, 0, 0], [4, "circle", "solid", 1, 0, 0], [12, "circle", "solid", 1, 0, 0], [7, "square", "solid", 1, 0, 0], [11, "square", "solid", 1, 0, 0]], correctIndex: 3 },
  { id: "campaign-easy-10", difficulty: "Easy", rule: { family: "combine", axis: "rows", operation: "left-minus-right", transform: "none" }, sources: [[13, "circle", "solid", 1, 0, 0], [6, "circle", "solid", 1, 0, 0], [6, "circle", "solid", 1, 0, 0], [12, "circle", "solid", 1, 0, 0], [6, "circle", "solid", 1, 0, 0], [3, "circle", "solid", 1, 0, 0]], correctIndex: 0 },
  { id: "campaign-easy-11", difficulty: "Easy", rule: { family: "combine", axis: "rows", operation: "left-minus-right", transform: "none" }, sources: [[9, "circle", "solid", 1, 0, 0], [3, "circle", "solid", 1, 0, 0], [13, "square", "solid", 1, 0, 0], [5, "square", "solid", 1, 0, 0], [5, "square", "outline", 1, 0, 0], [3, "square", "outline", 1, 0, 0]], correctIndex: 2 },
  { id: "campaign-easy-12", difficulty: "Easy", rule: { family: "combine", axis: "rows", operation: "left-minus-right", transform: "none" }, sources: [[11, "square", "solid", 1, 0, 0], [5, "square", "solid", 1, 0, 0], [11, "square", "outline", 1, 0, 0], [14, "square", "outline", 1, 0, 0], [14, "square", "solid", 1, 0, 0], [2, "square", "solid", 1, 0, 0]], correctIndex: 1 },
  { id: "campaign-medium-1", difficulty: "Medium", rule: { family: "combine", axis: "rows", operation: "right-minus-left", transform: "none" }, sources: [[13, "circle", "outline", 1, 0, 0], [11, "circle", "outline", 1, 0, 0], [7, "circle", "striped", 1, 0, 0], [14, "circle", "striped", 1, 0, 0], [9, "square", "outline", 2, 0, 0], [3, "square", "outline", 2, 0, 0]], correctIndex: 2 },
  { id: "campaign-medium-2", difficulty: "Medium", rule: { family: "combine", axis: "rows", operation: "right-minus-left", transform: "none" }, sources: [[10, "triangle", "striped", 1, 1, 3], [14, "triangle", "striped", 1, 1, 3], [13, "triangle", "solid", 1, 1, 0], [11, "triangle", "solid", 1, 1, 0], [7, "triangle", "solid", 2, 1, 0], [11, "triangle", "solid", 2, 1, 0]], correctIndex: 0 },
  { id: "campaign-medium-3", difficulty: "Medium", rule: { family: "combine", axis: "rows", operation: "right-minus-left", transform: "none" }, sources: [[11, "circle", "outline", 1, 0, 0], [5, "circle", "outline", 1, 0, 0], [13, "triangle", "solid", 1, 2, 0], [15, "triangle", "solid", 1, 2, 0], [9, "square", "outline", 1, 0, 0], [3, "square", "outline", 1, 0, 0]], correctIndex: 3 },
  { id: "campaign-medium-4", difficulty: "Medium", rule: { family: "sequence", axis: "rows", step: "rotate-clockwise" }, sources: [[15, "triangle", "solid", 1, 3, 0], [9, "square", "striped", 2, 0, 1], [8, "triangle", "outline", 2, 2, 0]], correctIndex: 1 },
  { id: "campaign-medium-5", difficulty: "Medium", rule: { family: "sequence", axis: "rows", step: "rotate-clockwise" }, sources: [[3, "square", "striped", 0, 0, 2], [12, "circle", "outline", 2, 0, 0], [3, "circle", "striped", 0, 0, 1]], correctIndex: 0 },
  { id: "campaign-medium-6", difficulty: "Medium", rule: { family: "sequence", axis: "rows", step: "rotate-clockwise" }, sources: [[8, "triangle", "solid", 0, 2, 0], [9, "triangle", "solid", 1, 0, 0], [6, "circle", "striped", 2, 0, 0]], correctIndex: 2 },
  { id: "campaign-medium-7", difficulty: "Medium", rule: { family: "sequence", axis: "rows", step: "grow" }, sources: [[12, "circle", "striped", 0, 0, 3], [8, "square", "outline", 0, 0, 0], [13, "triangle", "striped", 0, 2, 3]], correctIndex: 1 },
  { id: "campaign-medium-8", difficulty: "Medium", rule: { family: "sequence", axis: "rows", step: "grow" }, sources: [[3, "square", "solid", 0, 0, 0], [2, "triangle", "solid", 0, 1, 0], [2, "circle", "solid", 0, 0, 0]], correctIndex: 3 },
  { id: "campaign-medium-9", difficulty: "Medium", rule: { family: "sequence", axis: "rows", step: "grow" }, sources: [[6, "bar", "striped", 0, 0, 0], [7, "triangle", "striped", 0, 3, 3], [3, "triangle", "outline", 0, 0, 0]], correctIndex: 2 },
  { id: "campaign-medium-10", difficulty: "Medium", rule: { family: "combine", axis: "columns", operation: "join", transform: "none" }, sources: [[12, "circle", "solid", 1, 0, 0], [5, "circle", "solid", 1, 0, 0], [8, "circle", "striped", 0, 0, 2], [1, "circle", "striped", 0, 0, 2], [2, "square", "solid", 0, 0, 0], [8, "square", "solid", 0, 0, 0]], correctIndex: 1 },
  { id: "campaign-medium-11", difficulty: "Medium", rule: { family: "combine", axis: "columns", operation: "overlap", transform: "none" }, sources: [[11, "circle", "outline", 0, 0, 0], [14, "circle", "outline", 0, 0, 0], [10, "circle", "solid", 1, 0, 0], [12, "circle", "solid", 1, 0, 0], [7, "bar", "striped", 1, 0, 2], [9, "bar", "striped", 1, 0, 2]], correctIndex: 3 },
  { id: "campaign-medium-12", difficulty: "Medium", rule: { family: "combine", axis: "columns", operation: "cancel", transform: "none" }, sources: [[1, "triangle", "striped", 1, 0, 3], [15, "triangle", "striped", 1, 0, 3], [10, "square", "striped", 2, 0, 0], [6, "square", "striped", 2, 0, 0], [14, "bar", "striped", 1, 1, 3], [7, "bar", "striped", 1, 1, 3]], correctIndex: 0 },
  { id: "campaign-hard-1", difficulty: "Hard", rule: { family: "combine", axis: "rows", operation: "match", transform: "none" }, sources: [[4, "triangle", "outline", 1, 2, 0], [10, "triangle", "outline", 1, 2, 0], [12, "square", "striped", 0, 0, 2], [7, "square", "striped", 0, 0, 2], [12, "triangle", "outline", 0, 3, 0], [6, "triangle", "outline", 0, 3, 0]], correctIndex: 1 },
  { id: "campaign-hard-2", difficulty: "Hard", rule: { family: "combine", axis: "columns", operation: "match", transform: "none" }, sources: [[1, "triangle", "striped", 2, 0, 1], [4, "triangle", "striped", 2, 0, 1], [11, "square", "striped", 1, 0, 1], [12, "square", "striped", 1, 0, 1], [2, "square", "striped", 0, 0, 0], [7, "square", "striped", 0, 0, 0]], correctIndex: 3 },
  { id: "campaign-hard-3", difficulty: "Hard", rule: { family: "combine", axis: "rows", operation: "neither", transform: "none" }, sources: [[12, "circle", "solid", 1, 0, 0], [14, "circle", "solid", 1, 0, 0], [6, "square", "outline", 1, 0, 0], [1, "square", "outline", 1, 0, 0], [2, "triangle", "striped", 0, 0, 2], [8, "triangle", "striped", 0, 0, 2]], correctIndex: 0 },
  { id: "campaign-hard-4", difficulty: "Hard", rule: { family: "combine", axis: "columns", operation: "neither", transform: "none" }, sources: [[9, "circle", "solid", 1, 0, 0], [11, "circle", "solid", 1, 0, 0], [1, "square", "solid", 1, 0, 0], [7, "square", "solid", 1, 0, 0], [11, "circle", "outline", 0, 0, 0], [11, "circle", "outline", 0, 0, 0]], correctIndex: 2 },
  { id: "campaign-hard-5", difficulty: "Hard", rule: { family: "combine", axis: "rows", operation: "join", transform: "rotate-clockwise" }, sources: [[1, "triangle", "solid", 1, 3, 0], [2, "triangle", "solid", 1, 3, 0], [12, "circle", "solid", 0, 0, 0], [4, "circle", "solid", 0, 0, 0], [12, "square", "striped", 2, 0, 1], [8, "square", "striped", 2, 0, 1]], correctIndex: 3 },
  { id: "campaign-hard-6", difficulty: "Hard", rule: { family: "combine", axis: "columns", operation: "overlap", transform: "rotate-half" }, sources: [[6, "bar", "outline", 1, 1, 0], [3, "bar", "outline", 1, 1, 0], [3, "square", "solid", 2, 0, 0], [2, "square", "solid", 2, 0, 0], [12, "triangle", "striped", 1, 1, 2], [14, "triangle", "striped", 1, 1, 2]], correctIndex: 1 },
  { id: "campaign-hard-7", difficulty: "Hard", rule: { family: "combine", axis: "rows", operation: "cancel", transform: "rotate-counterclockwise" }, sources: [[13, "bar", "outline", 1, 1, 0], [1, "bar", "outline", 1, 1, 0], [6, "triangle", "striped", 0, 0, 2], [1, "triangle", "striped", 0, 0, 2], [7, "bar", "solid", 0, 0, 0], [14, "bar", "solid", 0, 0, 0]], correctIndex: 2 },
  { id: "campaign-hard-8", difficulty: "Hard", rule: { family: "combine", axis: "columns", operation: "left-minus-right", transform: "rotate-clockwise" }, sources: [[9, "bar", "outline", 0, 0, 0], [14, "bar", "outline", 0, 0, 0], [14, "triangle", "solid", 0, 1, 0], [10, "triangle", "solid", 0, 1, 0], [3, "circle", "striped", 2, 0, 3], [5, "circle", "striped", 2, 0, 3]], correctIndex: 0 },
  { id: "campaign-hard-9", difficulty: "Hard", rule: { family: "combine", axis: "rows", operation: "right-minus-left", transform: "rotate-half" }, sources: [[6, "square", "outline", 2, 0, 0], [8, "square", "outline", 2, 0, 0], [11, "triangle", "solid", 0, 1, 0], [15, "triangle", "solid", 0, 1, 0], [9, "circle", "solid", 2, 0, 0], [12, "circle", "solid", 2, 0, 0]], correctIndex: 1 },
  { id: "campaign-hard-10", difficulty: "Hard", rule: { family: "sequence", axis: "rows", step: "shape-cycle" }, sources: [[3, "circle", "solid", 1, 0, 0], [5, "square", "outline", 0, 0, 0], [9, "triangle", "striped", 2, 1, 2]], correctIndex: 2 },
  { id: "campaign-hard-11", difficulty: "Hard", rule: { family: "grid", operation: "cancel", transform: "rotate-clockwise" }, sources: [[9, "square", "striped", 0, 0, 1], [11, "square", "striped", 0, 0, 1], [8, "square", "striped", 0, 0, 1]], correctIndex: 0 },
  { id: "campaign-hard-12", difficulty: "Hard", rule: { family: "grid", operation: "cancel", transform: "rotate-counterclockwise" }, sources: [[11, "bar", "striped", 0, 0, 0], [15, "bar", "striped", 0, 0, 0], [9, "bar", "striped", 0, 0, 0]], correctIndex: 3 },
  { id: "campaign-wizard-1", difficulty: "Wizard", rule: { family: "combine", axis: "columns", operation: "match", transform: "rotate-counterclockwise" }, sources: [[12, "circle", "outline", 1, 0, 0], [15, "circle", "outline", 1, 0, 0], [9, "bar", "striped", 0, 1, 1], [2, "bar", "striped", 0, 1, 1], [7, "triangle", "solid", 2, 3, 0], [14, "triangle", "solid", 2, 3, 0]], correctIndex: 3 },
  { id: "campaign-wizard-2", difficulty: "Wizard", rule: { family: "grid", operation: "cancel", transform: "rotate-clockwise" }, sources: [[3, "triangle", "outline", 1, 1, 0], [15, "triangle", "outline", 1, 1, 0], [2, "triangle", "outline", 1, 1, 0]], correctIndex: 1 },
  { id: "campaign-wizard-3", difficulty: "Wizard", rule: { family: "combine", axis: "rows", operation: "left-minus-right", transform: "rotate-half" }, sources: [[10, "square", "outline", 1, 0, 0], [6, "square", "outline", 1, 0, 0], [13, "circle", "solid", 0, 0, 0], [11, "circle", "solid", 0, 0, 0], [13, "triangle", "striped", 1, 1, 3], [6, "triangle", "striped", 1, 1, 3]], correctIndex: 2 },
  { id: "campaign-wizard-4", difficulty: "Wizard", rule: { family: "combine", axis: "columns", operation: "join", transform: "rotate-clockwise" }, sources: [[14, "bar", "outline", 2, 1, 0], [15, "bar", "outline", 2, 1, 0], [4, "circle", "solid", 2, 0, 0], [5, "circle", "solid", 2, 0, 0], [14, "triangle", "striped", 1, 2, 0], [11, "triangle", "striped", 1, 2, 0]], correctIndex: 0 },
  { id: "campaign-wizard-5", difficulty: "Wizard", rule: { family: "combine", axis: "rows", operation: "neither", transform: "rotate-counterclockwise" }, sources: [[7, "circle", "outline", 2, 0, 0], [5, "circle", "outline", 2, 0, 0], [12, "circle", "solid", 1, 0, 0], [5, "circle", "solid", 1, 0, 0], [9, "triangle", "striped", 2, 2, 1], [11, "triangle", "striped", 2, 2, 1]], correctIndex: 2 },
  { id: "campaign-wizard-6", difficulty: "Wizard", rule: { family: "grid", operation: "cancel", transform: "rotate-counterclockwise" }, sources: [[3, "circle", "striped", 2, 0, 2], [1, "circle", "striped", 2, 0, 2], [15, "circle", "striped", 2, 0, 2]], correctIndex: 0 },
  { id: "campaign-wizard-7", difficulty: "Wizard", rule: { family: "combine", axis: "columns", operation: "cancel", transform: "rotate-clockwise" }, sources: [[9, "square", "outline", 0, 0, 0], [2, "square", "outline", 0, 0, 0], [8, "triangle", "solid", 0, 2, 0], [9, "triangle", "solid", 0, 2, 0], [13, "triangle", "striped", 0, 3, 1], [1, "triangle", "striped", 0, 3, 1]], correctIndex: 3 },
  { id: "campaign-wizard-8", difficulty: "Wizard", rule: { family: "combine", axis: "rows", operation: "right-minus-left", transform: "rotate-half" }, sources: [[1, "bar", "outline", 1, 1, 0], [13, "bar", "outline", 1, 1, 0], [5, "bar", "solid", 2, 1, 0], [3, "bar", "solid", 2, 1, 0], [12, "circle", "striped", 0, 0, 1], [6, "circle", "striped", 0, 0, 1]], correctIndex: 1 },
  { id: "campaign-wizard-9", difficulty: "Wizard", rule: { family: "combine", axis: "columns", operation: "overlap", transform: "rotate-counterclockwise" }, sources: [[15, "bar", "striped", 0, 0, 0], [9, "bar", "striped", 0, 0, 0], [13, "bar", "solid", 1, 0, 0], [13, "bar", "solid", 1, 0, 0], [14, "triangle", "outline", 0, 0, 0], [4, "triangle", "outline", 0, 0, 0]], correctIndex: 0 },
  { id: "campaign-wizard-10", difficulty: "Wizard", rule: { family: "grid", operation: "cancel", transform: "rotate-clockwise" }, sources: [[12, "bar", "striped", 0, 1, 2], [14, "bar", "striped", 0, 1, 2], [4, "bar", "striped", 0, 1, 2]], correctIndex: 3 },
  { id: "campaign-wizard-11", difficulty: "Wizard", rule: { family: "combine", axis: "rows", operation: "match", transform: "rotate-clockwise" }, sources: [[14, "bar", "outline", 1, 0, 0], [14, "bar", "outline", 1, 0, 0], [6, "circle", "striped", 2, 0, 1], [8, "circle", "striped", 2, 0, 1], [7, "bar", "striped", 0, 0, 3], [1, "bar", "striped", 0, 0, 3]], correctIndex: 1 },
  { id: "campaign-wizard-12", difficulty: "Wizard", rule: { family: "combine", axis: "columns", operation: "left-minus-right", transform: "rotate-half" }, sources: [[6, "bar", "solid", 1, 0, 0], [10, "bar", "solid", 1, 0, 0], [14, "circle", "striped", 2, 0, 0], [12, "circle", "striped", 2, 0, 0], [12, "square", "outline", 0, 0, 0], [2, "square", "outline", 0, 0, 0]], correctIndex: 2 },
];

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

export const CAMPAIGN_ROUNDS: readonly Round[] = CAMPAIGN_SPECS.map(
  ({ id, difficulty, rule, sources, correctIndex }) =>
    buildRound({
      id,
      difficulty,
      rule,
      sourcePatterns: sources.map(patternFromSpec),
      correctIndex,
    }),
);

const campaignFingerprints = new Set(
  CAMPAIGN_ROUNDS.map(roundFingerprint),
);

if (
  CAMPAIGN_ROUNDS.length !== 48 ||
  campaignFingerprints.size !== CAMPAIGN_ROUNDS.length
) {
  throw new Error("Pattern Matrix Campaign must contain 48 unique rounds.");
}
