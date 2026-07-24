import {
  ROUNDS,
  buildAuthoredShapeFoldRounds,
  roundFingerprint,
  validateRound,
  type AuthoredShapeFoldRoundSpec,
  type Difficulty,
  type Round,
} from "./game-engine.ts";

export type ShapeFoldJourneyExtraLevel =
  | "junior-2"
  | "expert-2"
  | "wizard-2";

// These prompt inputs were selected from the canonical bounded generator and
// frozen. The native authored builder still calculates the entire fold stack,
// unfolded answer, adjacent-punch misconceptions, and one-opening near-miss.
const JUNIOR_2_SPECS: readonly AuthoredShapeFoldRoundSpec[] = [
  { difficulty: "Medium", folds: ["left", "up"], punches: [{ x: 4, y: 5 }], correctIndex: 1, distractorSalt: 0 },
  { difficulty: "Medium", folds: ["right", "down"], punches: [{ x: 0, y: 3 }], correctIndex: 3, distractorSalt: 503 },
  { difficulty: "Medium", folds: ["up", "left"], punches: [{ x: 5, y: 5 }], correctIndex: 0, distractorSalt: 1006 },
  { difficulty: "Medium", folds: ["down", "right"], punches: [{ x: 3, y: 0 }], correctIndex: 2, distractorSalt: 1509 },
  { difficulty: "Medium", folds: ["left", "down"], punches: [{ x: 7, y: 2 }], correctIndex: 1, distractorSalt: 2012 },
  { difficulty: "Medium", folds: ["right", "up"], punches: [{ x: 0, y: 5 }], correctIndex: 0, distractorSalt: 2515 },
  { difficulty: "Medium", folds: ["up", "right"], punches: [{ x: 0, y: 5 }], correctIndex: 3, distractorSalt: 3018 },
  { difficulty: "Medium", folds: ["down", "left"], punches: [{ x: 5, y: 3 }], correctIndex: 2, distractorSalt: 3521 },
  { difficulty: "Medium", folds: ["left", "right"], punches: [{ x: 4, y: 5 }], correctIndex: 0, distractorSalt: 4024 },
  { difficulty: "Medium", folds: ["right", "left"], punches: [{ x: 3, y: 5 }], correctIndex: 2, distractorSalt: 4527 },
  { difficulty: "Medium", folds: ["up", "down"], punches: [{ x: 5, y: 4 }], correctIndex: 1, distractorSalt: 5030 },
  { difficulty: "Medium", folds: ["down", "up"], punches: [{ x: 4, y: 3 }], correctIndex: 3, distractorSalt: 5533 },
];

const EXPERT_2_SPECS: readonly AuthoredShapeFoldRoundSpec[] = [
  { difficulty: "Hard", folds: ["left", "up", "left"], punches: [{ x: 7, y: 4 }, { x: 6, y: 6 }], correctIndex: 2, distractorSalt: 0 },
  { difficulty: "Hard", folds: ["right", "down", "right"], punches: [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 0, y: 3 }], correctIndex: 0, distractorSalt: 503 },
  { difficulty: "Hard", folds: ["up", "left", "up"], punches: [{ x: 6, y: 6 }, { x: 4, y: 7 }], correctIndex: 3, distractorSalt: 1006 },
  { difficulty: "Hard", folds: ["down", "right", "down"], punches: [{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 1 }], correctIndex: 1, distractorSalt: 1509 },
  { difficulty: "Hard", folds: ["left", "down", "right"], punches: [{ x: 5, y: 0 }, { x: 4, y: 1 }], correctIndex: 2, distractorSalt: 2012 },
  { difficulty: "Hard", folds: ["right", "up", "left"], punches: [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 3, y: 7 }], correctIndex: 1, distractorSalt: 2515 },
  { difficulty: "Hard", folds: ["up", "right", "down"], punches: [{ x: 2, y: 4 }, { x: 3, y: 5 }], correctIndex: 0, distractorSalt: 3018 },
  { difficulty: "Hard", folds: ["down", "left", "up"], punches: [{ x: 6, y: 2 }, { x: 7, y: 2 }, { x: 7, y: 3 }], correctIndex: 3, distractorSalt: 3521 },
  { difficulty: "Hard", folds: ["left", "up", "down"], punches: [{ x: 6, y: 4 }, { x: 7, y: 5 }], correctIndex: 1, distractorSalt: 4024 },
  { difficulty: "Hard", folds: ["right", "down", "up"], punches: [{ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }], correctIndex: 3, distractorSalt: 4527 },
  { difficulty: "Hard", folds: ["up", "left", "right"], punches: [{ x: 4, y: 5 }, { x: 5, y: 6 }], correctIndex: 2, distractorSalt: 5030 },
  { difficulty: "Hard", folds: ["down", "right", "left"], punches: [{ x: 3, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }], correctIndex: 0, distractorSalt: 5533 },
];

const WIZARD_2_SPECS: readonly AuthoredShapeFoldRoundSpec[] = [
  { difficulty: "Wizard", folds: ["left", "up", "left"], punches: [{ x: 6, y: 4 }, { x: 7, y: 6 }], correctIndex: 0, distractorSalt: 0 },
  { difficulty: "Wizard", folds: ["right", "down", "right"], punches: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 3 }], correctIndex: 2, distractorSalt: 503 },
  { difficulty: "Wizard", folds: ["up", "left", "up"], punches: [{ x: 7, y: 6 }, { x: 5, y: 7 }], correctIndex: 3, distractorSalt: 1006 },
  { difficulty: "Wizard", folds: ["down", "right", "down"], punches: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], correctIndex: 1, distractorSalt: 1509 },
  { difficulty: "Wizard", folds: ["left", "down", "right"], punches: [{ x: 5, y: 1 }, { x: 4, y: 2 }], correctIndex: 3, distractorSalt: 2012 },
  { difficulty: "Wizard", folds: ["right", "up", "left"], punches: [{ x: 2, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }], correctIndex: 0, distractorSalt: 2515 },
  { difficulty: "Wizard", folds: ["up", "right", "down"], punches: [{ x: 1, y: 4 }, { x: 0, y: 5 }], correctIndex: 1, distractorSalt: 3018 },
  { difficulty: "Wizard", folds: ["down", "left", "up"], punches: [{ x: 4, y: 2 }, { x: 6, y: 2 }, { x: 7, y: 3 }], correctIndex: 2, distractorSalt: 3521 },
  { difficulty: "Wizard", folds: ["left", "up", "down"], punches: [{ x: 5, y: 4 }, { x: 4, y: 5 }], correctIndex: 1, distractorSalt: 4024 },
  { difficulty: "Wizard", folds: ["right", "down", "up"], punches: [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }], correctIndex: 3, distractorSalt: 4527 },
  { difficulty: "Wizard", folds: ["up", "left", "right"], punches: [{ x: 5, y: 4 }, { x: 4, y: 5 }], correctIndex: 0, distractorSalt: 5030 },
  { difficulty: "Wizard", folds: ["down", "right", "left"], punches: [{ x: 3, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], correctIndex: 2, distractorSalt: 5533 },
];

const SPECS: Readonly<
  Record<ShapeFoldJourneyExtraLevel, readonly AuthoredShapeFoldRoundSpec[]>
> = {
  "junior-2": JUNIOR_2_SPECS,
  "expert-2": EXPERT_2_SPECS,
  "wizard-2": WIZARD_2_SPECS,
};

const DIFFICULTY_BY_LEVEL: Readonly<
  Record<ShapeFoldJourneyExtraLevel, Difficulty>
> = {
  "junior-2": "Medium",
  "expert-2": "Hard",
  "wizard-2": "Wizard",
};

function assertAnswerSchedule(
  level: ShapeFoldJourneyExtraLevel,
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

export function buildShapeFoldJourneyExtraCampaignRounds(): Readonly<
  Record<ShapeFoldJourneyExtraLevel, readonly Round[]>
> {
  const usedFingerprints = new Set(ROUNDS.map(roundFingerprint));
  const result = {} as Record<
    ShapeFoldJourneyExtraLevel,
    readonly Round[]
  >;
  for (const level of [
    "junior-2",
    "expert-2",
    "wizard-2",
  ] as const) {
    const rounds = buildAuthoredShapeFoldRounds(
      SPECS[level],
      `Shape Fold ${level}`,
    );
    assertAnswerSchedule(level, rounds);
    for (const round of rounds) {
      if (round.difficulty !== DIFFICULTY_BY_LEVEL[level]) {
        throw new Error(`${level} contains the wrong difficulty.`);
      }
      const errors = validateRound(round);
      if (errors.length > 0) {
        throw new Error(`${level} is invalid: ${errors.join("; ")}`);
      }
      const fingerprint = roundFingerprint(round);
      if (usedFingerprints.has(fingerprint)) {
        throw new Error(
          `${level} repeats a standalone or Journey Shape Fold round.`,
        );
      }
      usedFingerprints.add(fingerprint);
    }
    result[level] = Object.freeze([...rounds]);
  }
  return Object.freeze(result);
}

export const JOURNEY_EXTRA_CAMPAIGN_ROUNDS =
  buildShapeFoldJourneyExtraCampaignRounds();
