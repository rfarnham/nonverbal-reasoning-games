import {
  ROUNDS,
  buildAuthoredDominoRounds,
  roundFingerprint,
  type AuthoredDominoRoundSpec,
  type Difficulty,
  type DominoRound,
} from "./game-engine.ts";

export type DominoJourneyExtraLevel =
  | "junior-2"
  | "expert-2"
  | "wizard-2";

// These authored inputs use the canonical v2 target-shape and pip grammar. The
// engine calculates every design, build witness, impossible near-match, and
// feedback classification. Alternate salts and answer schedules freeze a
// second, fingerprint-distinct challenge for each underlying curriculum idea.
const JUNIOR_2_SPECS: readonly AuthoredDominoRoundSpec[] = [
  { pieces: [["center", "corners"], ["edges", "center-corners"], ["center-edges", "ring"]], targetShapeId: "2x3-rect", layoutId: null, salt: 170 },
  { pieces: [["center", "edges"], ["corners", "center-edges"], ["ring", "all"]], targetShapeId: "2x3-rect", layoutId: null, salt: 197 },
  { pieces: [["center", "center-corners"], ["edges", "ring"], ["corners", "all"]], targetShapeId: "2x3-rect", layoutId: null, salt: 222 },
  { pieces: [["center", "center-edges"], ["corners", "ring"], ["center-corners", "all"]], targetShapeId: "2x4-ledge", layoutId: null, salt: 249 },
  { pieces: [["center", "ring"], ["edges", "all"], ["corners", "center-corners"]], targetShapeId: "3x3-stair", layoutId: null, salt: 278 },
  { pieces: [["center", "all"], ["corners", "center-edges"], ["edges", "ring"]], targetShapeId: "2x4-ledge", layoutId: null, salt: 307 },
  { pieces: [["corners", "edges"], ["center-corners", "center-edges"], ["ring", "all"]], targetShapeId: "2x3-rect", layoutId: null, salt: 330 },
  { pieces: [["corners", "center-corners"], ["edges", "center-edges"], ["center", "all"]], targetShapeId: "3x3-stair", layoutId: null, salt: 361 },
  { pieces: [["corners", "center-edges"], ["center-corners", "ring"], ["edges", "all"]], targetShapeId: "2x4-ledge", layoutId: null, salt: 390 },
  { pieces: [["corners", "ring"], ["edges", "center-corners"], ["center-edges", "all"]], targetShapeId: "3x3-stair", layoutId: null, salt: 411 },
  { pieces: [["corners", "all"], ["center", "center-edges"], ["center-corners", "ring"]], targetShapeId: "2x4-ledge", layoutId: null, salt: 440 },
  { pieces: [["edges", "center-edges"], ["center", "ring"], ["center-corners", "all"]], targetShapeId: "3x3-stair", layoutId: null, salt: 469 },
];

const EXPERT_2_SPECS: readonly AuthoredDominoRoundSpec[] = [
  { pieces: [["diag-two", "center"], ["diag-three", "corners"], ["top-pair", "corner-l"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 294 },
  { pieces: [["edge-single", "edges"], ["corner-single", "center-corners"], ["top-bar", "six"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "edge-single", preferredTrapTurn: 1, salt: 319 },
  { pieces: [["diag-two@1", "center-edges"], ["top-pair@1", "ring"], ["corner-l@2", "edge-single@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-pair", preferredTrapTurn: 3, salt: 348 },
  { pieces: [["diag-three@1", "all"], ["corner-single@1", "center"], ["top-bar@1", "six@1"]], targetShapeId: "2x4-ledge", layoutId: null, preferredTrapPattern: "diag-three", salt: 375 },
  { pieces: [["diag-two", "corners"], ["corner-l@1", "edges"], ["edge-single@3", "top-bar@2"]], targetShapeId: "3x3-stair", layoutId: null, preferredTrapPattern: "diag-two", salt: 406 },
  { pieces: [["diag-three@1", "center-corners"], ["top-pair@2", "center-edges"], ["corner-single@2", "six@1"]], targetShapeId: "2x4-ledge", layoutId: null, preferredTrapPattern: "corner-single", preferredTrapTurn: 3, salt: 427 },
  { pieces: [["edge-single@1", "ring"], ["top-bar@3", "all"], ["diag-two@1", "corner-l@3"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-bar", preferredTrapTurn: 1, salt: 464 },
  { pieces: [["corner-single@3", "center"], ["six", "corners"], ["diag-three", "top-pair@1"]], targetShapeId: "3x3-stair", layoutId: null, preferredTrapPattern: "six", salt: 497 },
  { pieces: [["top-bar@2", "edges"], ["corner-l", "center-corners"], ["edge-single@2", "diag-two"]], targetShapeId: "2x4-ledge", layoutId: null, preferredTrapPattern: "edge-single", preferredTrapTurn: 3, salt: 520 },
  { pieces: [["six@1", "center-edges"], ["diag-three@1", "ring"], ["top-pair@3", "corner-single"]], targetShapeId: "3x3-stair", layoutId: null, preferredTrapPattern: "diag-three", salt: 551 },
  { pieces: [["diag-two@1", "all"], ["edge-single@3", "center"], ["corner-l@2", "top-bar@1"]], targetShapeId: "2x4-ledge", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 1, salt: 580 },
  { pieces: [["diag-three", "corners"], ["six@1", "edges"], ["corner-single@1", "top-pair@2"]], targetShapeId: "3x3-stair", layoutId: null, preferredTrapPattern: "top-pair", preferredTrapTurn: 3, salt: 607 },
];

const WIZARD_2_SPECS: readonly AuthoredDominoRoundSpec[] = [
  { pieces: [["diag-two", "center"], ["corner-l@1", "corners"], ["diag-two", "corner-l@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 432 },
  { pieces: [["edge-single", "edges"], ["top-pair@1", "center-corners"], ["edge-single", "top-pair@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "edge-single", preferredTrapTurn: 1, salt: 467 },
  { pieces: [["top-pair@1", "center-edges"], ["edge-single@2", "ring"], ["top-pair@1", "edge-single@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-pair", preferredTrapTurn: 3, salt: 496 },
  { pieces: [["diag-three", "all"], ["corner-single@2", "center"], ["diag-three", "corner-single@2"]], targetShapeId: "2x4-ledge", layoutId: null, preferredTrapPattern: "diag-three", salt: 525 },
  { pieces: [["diag-two", "corners"], ["top-bar@3", "edges"], ["diag-two", "top-bar@3"]], targetShapeId: "3x3-stair", layoutId: null, preferredTrapPattern: "diag-two", salt: 556 },
  { pieces: [["corner-single@3", "center-corners"], ["six@1", "center-edges"], ["corner-single@3", "six@1"]], targetShapeId: "2x4-ledge", layoutId: null, preferredTrapPattern: "corner-single", preferredTrapTurn: 3, salt: 579 },
  { pieces: [["top-bar@2", "ring"], ["corner-l", "all"], ["top-bar@2", "corner-l"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-bar", preferredTrapTurn: 1, salt: 612 },
  { pieces: [["six", "center"], ["top-pair@1", "corners"], ["six", "top-pair@1"]], targetShapeId: "3x3-stair", layoutId: null, preferredTrapPattern: "six", salt: 637 },
  { pieces: [["corner-l@2", "edges"], ["edge-single@2", "center-corners"], ["corner-l@2", "edge-single@2"]], targetShapeId: "2x4-ledge", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 3, salt: 666 },
  { pieces: [["diag-three@1", "center-edges"], ["corner-single@1", "ring"], ["diag-three@1", "corner-single@1"]], targetShapeId: "3x3-stair", layoutId: null, preferredTrapPattern: "diag-three", salt: 693 },
  { pieces: [["edge-single@1", "all"], ["top-bar@2", "center"], ["edge-single@1", "top-bar@2"]], targetShapeId: "2x4-ledge", layoutId: null, preferredTrapPattern: "edge-single", preferredTrapTurn: 1, salt: 722 },
  { pieces: [["top-pair@3", "corners"], ["six", "edges"], ["top-pair@3", "six"]], targetShapeId: "3x3-stair", layoutId: null, preferredTrapPattern: "top-pair", preferredTrapTurn: 3, salt: 759 },
];

const ANSWERS: Readonly<
  Record<DominoJourneyExtraLevel, readonly number[]>
> = {
  "junior-2": [2, 0, 2, 1, 3, 2, 3, 0, 1, 0, 3, 1],
  "expert-2": [1, 2, 0, 2, 3, 2, 1, 3, 1, 0, 3, 0],
  "wizard-2": [3, 1, 3, 0, 1, 0, 2, 1, 2, 0, 3, 2],
};

const SPECS: Readonly<
  Record<DominoJourneyExtraLevel, readonly AuthoredDominoRoundSpec[]>
> = {
  "junior-2": JUNIOR_2_SPECS,
  "expert-2": EXPERT_2_SPECS,
  "wizard-2": WIZARD_2_SPECS,
};

const DIFFICULTY_BY_LEVEL: Readonly<
  Record<DominoJourneyExtraLevel, Difficulty>
> = {
  "junior-2": "Junior",
  "expert-2": "Expert",
  "wizard-2": "Wizard",
};

export function buildDominoJourneyExtraCampaignRounds(): Readonly<
  Record<DominoJourneyExtraLevel, readonly DominoRound[]>
> {
  const usedFingerprints = new Set(ROUNDS.map(roundFingerprint));
  const result = {} as Record<
    DominoJourneyExtraLevel,
    readonly DominoRound[]
  >;

  for (const level of [
    "junior-2",
    "expert-2",
    "wizard-2",
  ] as const) {
    const rounds = buildAuthoredDominoRounds(
      `journey-${level}`,
      DIFFICULTY_BY_LEVEL[level],
      SPECS[level],
      ANSWERS[level],
    );
    for (const round of rounds) {
      const fingerprint = roundFingerprint(round);
      if (usedFingerprints.has(fingerprint)) {
        throw new Error(
          `${level} repeats a standalone or Journey Domino Twist round.`,
        );
      }
      usedFingerprints.add(fingerprint);
    }
    result[level] = Object.freeze([...rounds]);
  }

  return Object.freeze(result);
}

export const JOURNEY_EXTRA_CAMPAIGN_ROUNDS =
  buildDominoJourneyExtraCampaignRounds();
