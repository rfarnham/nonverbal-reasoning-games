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

// These authored inputs use the canonical v3 rectangular-target and pip
// grammar. The
// engine calculates every design, build witness, impossible near-match, and
// feedback classification. Alternate salts and answer schedules freeze a
// second, fingerprint-distinct challenge for each underlying curriculum idea.
const JUNIOR_2_SPECS: readonly AuthoredDominoRoundSpec[] = [
  { pieces: [["diag-two", "diag-three"], ["top-pair@2", "corner-l@3"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 170 },
  { pieces: [["diag-two", "diag-three@1"], ["top-pair@3", "corner-l"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 180 },
  { pieces: [["diag-two", "corner-l"], ["diag-three", "top-pair@1"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 188 },
  { pieces: [["diag-two", "diag-three"], ["corner-l", "corner-l@1"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 198 },
  { pieces: [["diag-two@1", "diag-three@1"], ["corner-l@2", "corner-l@3"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 210 },
  { pieces: [["diag-two", "diag-three@1"], ["top-pair", "top-pair@1"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 222 },
  { pieces: [["diag-two@1", "diag-three"], ["top-pair@2", "top-pair@3"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 228 },
  { pieces: [["diag-two", "diag-three"], ["top-bar", "corner-l@1"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 242 },
  { pieces: [["diag-two@1", "diag-three@1"], ["top-bar@1", "corner-l@2"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 254 },
  { pieces: [["diag-two", "diag-three@1"], ["top-bar@2", "corner-l@3"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 258 },
  { pieces: [["diag-two@1", "diag-three"], ["top-bar@3", "corner-l"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 270 },
  { pieces: [["diag-two", "diag-three"], ["corner-l@1", "top-pair@2"]], targetShapeId: "2x2-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 282 },
];

const EXPERT_2_SPECS: readonly AuthoredDominoRoundSpec[] = [
  { pieces: [["diag-two", "diag-three"], ["top-bar", "edge-single"], ["top-pair", "corner-l"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 294 },
  { pieces: [["diag-two@1", "diag-three@1"], ["corner-single@1", "top-bar@1"], ["top-pair@1", "corner-l@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 302 },
  { pieces: [["diag-two", "top-pair"], ["diag-three", "corner-l"], ["top-bar", "edge-single"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 314 },
  { pieces: [["diag-two@1", "top-pair@1"], ["diag-three@1", "corner-l@1"], ["top-bar@1", "edge-single@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 324 },
  { pieces: [["diag-two", "corner-single"], ["diag-three@1", "top-bar@2"], ["corner-l@2", "edge-single@3"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-two", salt: 338 },
  { pieces: [["diag-two@1", "corner-single@1"], ["diag-three", "top-bar@3"], ["corner-l@3", "edge-single@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "diag-three", salt: 342 },
  { pieces: [["diag-two", "top-pair@2"], ["diag-three", "corner-l@3"], ["corner-single@1", "top-bar@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 1, salt: 362 },
  { pieces: [["diag-two@1", "top-pair@3"], ["diag-three@1", "corner-l@2"], ["corner-single@3", "top-bar"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-pair", preferredTrapTurn: 3, salt: 378 },
  { pieces: [["diag-two", "edge-single@2"], ["diag-three@1", "top-bar"], ["corner-l@1", "corner-single@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "edge-single", preferredTrapTurn: 3, salt: 384 },
  { pieces: [["diag-two@1", "edge-single"], ["diag-three", "top-bar@1"], ["corner-l", "corner-single@3"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-bar", preferredTrapTurn: 1, salt: 398 },
  { pieces: [["diag-two", "corner-l@2"], ["diag-three", "top-pair@1"], ["edge-single@3", "top-bar@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 1, salt: 410 },
  { pieces: [["diag-two@1", "corner-l@3"], ["diag-three@1", "top-pair@2"], ["edge-single@1", "top-bar@3"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-pair", preferredTrapTurn: 3, salt: 420 },
];

const WIZARD_2_SPECS: readonly AuthoredDominoRoundSpec[] = [
  { pieces: [["top-pair", "corner-l"], ["top-pair", "corner-l@1"], ["edge-single", "top-bar"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 1, salt: 432 },
  { pieces: [["top-pair@1", "corner-l@2"], ["top-pair@1", "corner-l@3"], ["corner-single@1", "top-bar@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 3, salt: 450 },
  { pieces: [["corner-l", "top-pair"], ["corner-l", "top-pair@1"], ["edge-single@1", "corner-single@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-pair", preferredTrapTurn: 1, salt: 462 },
  { pieces: [["edge-single", "corner-l@1"], ["edge-single", "corner-l@2"], ["top-pair@2", "top-bar@3"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 1, salt: 474 },
  { pieces: [["corner-single", "top-bar"], ["corner-single", "top-bar@1"], ["top-pair@3", "corner-l@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-bar", preferredTrapTurn: 3, salt: 488 },
  { pieces: [["top-bar", "edge-single"], ["top-bar", "edge-single@1"], ["corner-l@3", "corner-single@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "edge-single", preferredTrapTurn: 1, salt: 494 },
  { pieces: [["top-pair@2", "corner-single@1"], ["top-pair@2", "corner-single@2"], ["corner-l", "top-bar@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-single", preferredTrapTurn: 1, salt: 510 },
  { pieces: [["corner-l@1", "top-bar@2"], ["corner-l@1", "top-bar@3"], ["edge-single@2", "top-pair"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-bar", preferredTrapTurn: 3, salt: 518 },
  { pieces: [["edge-single@3", "top-pair@1"], ["edge-single@3", "top-pair@2"], ["corner-single@3", "corner-l@2"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "top-pair", preferredTrapTurn: 1, salt: 530 },
  { pieces: [["corner-single@1", "corner-l@3"], ["corner-single@1", "corner-l"], ["top-bar@2", "edge-single@1"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-l", preferredTrapTurn: 1, salt: 540 },
  { pieces: [["top-bar@1", "corner-single@2"], ["top-bar@1", "corner-single@3"], ["top-pair@2", "edge-single"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "corner-single", preferredTrapTurn: 3, salt: 552 },
  { pieces: [["corner-l@2", "edge-single@1"], ["corner-l@2", "edge-single@2"], ["top-pair@3", "top-bar"]], targetShapeId: "2x3-rect", layoutId: null, preferredTrapPattern: "edge-single", preferredTrapTurn: 1, salt: 572 },
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
