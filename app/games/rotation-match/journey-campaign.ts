import {
  ROUNDS,
  buildAuthoredRotationRounds,
  roundFingerprint,
  validateRound,
  type AuthoredRotationRoundSpec,
  type Difficulty,
  type Round,
} from "./game-engine.ts";

export type RotationJourneyExtraLevel =
  | "junior-2"
  | "expert-2"
  | "wizard-2";

// Frozen outputs selected from the canonical bounded generator. The authored
// builder decodes these source patterns and recalculates the true transform,
// misconception distractors, and exact answer through the native engine.
const JUNIOR_2_SPECS: readonly AuthoredRotationRoundSpec[] = [
  { pattern: "VCT..VG.G", direction: "clockwise", quarterTurns: 1, difficulty: "Medium", correctIndex: 1, distractors: ["one-block-off", "wrong-rotation", "mirror-main-diagonal"], salts: [1, 2, 3] },
  { pattern: "G.VV.TC..", direction: "counterclockwise", quarterTurns: 1, difficulty: "Medium", correctIndex: 3, distractors: ["one-block-off", "mirror-horizontal", "mirror-anti-diagonal"], salts: [504, 505, 506] },
  { pattern: "V.CTTG..V", axis: "vertical", difficulty: "Medium", correctIndex: 0, distractors: ["one-block-off", "mirror-main-diagonal", "wrong-rotation"], salts: [1007, 1008, 1009] },
  { pattern: "VGG...C.T", axis: "horizontal", difficulty: "Medium", correctIndex: 2, distractors: ["one-block-off", "mirror-anti-diagonal", "wrong-rotation"], salts: [1510, 1511, 1512] },
  { pattern: "TV.GVG.T.", direction: "clockwise", quarterTurns: 2, difficulty: "Medium", correctIndex: 1, distractors: ["one-block-off", "wrong-rotation", "mirror-anti-diagonal"], salts: [2013, 2014, 2015] },
  { pattern: "GG..TV.V.", direction: "counterclockwise", quarterTurns: 2, difficulty: "Medium", correctIndex: 0, distractors: ["one-block-off", "mirror-vertical", "mirror-horizontal"], salts: [2516, 2517, 2518] },
  { pattern: "G.TCCT..V", axis: "main-diagonal", difficulty: "Medium", correctIndex: 3, distractors: ["one-block-off", "mirror-horizontal", "mirror-vertical"], salts: [3019, 3020, 3021] },
  { pattern: "...TTVCV.", axis: "anti-diagonal", difficulty: "Medium", correctIndex: 2, distractors: ["one-block-off", "mirror-main-diagonal", "mirror-vertical"], salts: [3522, 3523, 3524] },
  { pattern: ".G.TVVGC.", direction: "clockwise", quarterTurns: 3, difficulty: "Medium", correctIndex: 0, distractors: ["one-block-off", "wrong-rotation", "mirror-anti-diagonal"], salts: [4025, 4026, 4027] },
  { pattern: "GVG..VT..", direction: "counterclockwise", quarterTurns: 3, difficulty: "Medium", correctIndex: 2, distractors: ["one-block-off", "mirror-vertical", "wrong-rotation"], salts: [4528, 4529, 4530] },
  { pattern: "T..GG.CTV", direction: "clockwise", quarterTurns: 1, difficulty: "Medium", correctIndex: 1, distractors: ["one-block-off", "mirror-horizontal", "mirror-anti-diagonal"], salts: [5031, 5032, 5033] },
  { pattern: "C...TG.CC", axis: "horizontal", difficulty: "Medium", correctIndex: 3, distractors: ["one-block-off", "mirror-main-diagonal", "wrong-rotation"], salts: [5534, 5535, 5536] },
];

const EXPERT_2_SPECS: readonly AuthoredRotationRoundSpec[] = [
  { pattern: "GVCC.CT..", motifs: [{ index: 1, orientation: 2 }, { index: 6, orientation: 2 }], direction: "clockwise", quarterTurns: 1, difficulty: "Hard", correctIndex: 2, distractors: ["one-motif-off", "one-block-off", "mirror-anti-diagonal"], salts: [1, 2, 3] },
  { pattern: ".CCT.GGGT", motifs: [{ index: 1, orientation: 1 }, { index: 5, orientation: 2 }, { index: 7, orientation: 2 }], direction: "counterclockwise", quarterTurns: 1, difficulty: "Hard", correctIndex: 0, distractors: ["one-motif-off", "one-block-off", "wrong-rotation"], salts: [504, 505, 506] },
  { pattern: "G.CTGC..C", motifs: [{ index: 0, orientation: 3 }, { index: 3, orientation: 2 }, { index: 4, orientation: 3 }, { index: 5, orientation: 0 }], axis: "vertical", difficulty: "Hard", correctIndex: 3, distractors: ["one-motif-off", "one-block-off", "mirror-anti-diagonal"], salts: [1007, 1008, 1009] },
  { pattern: "GV.VCCTG.", motifs: [{ index: 0, orientation: 0 }, { index: 6, orientation: 2 }], axis: "horizontal", difficulty: "Hard", correctIndex: 1, distractors: ["one-motif-off", "one-block-off", "wrong-rotation"], salts: [1510, 1511, 1512] },
  { pattern: ".VT..TGGG", motifs: [{ index: 1, orientation: 1 }, { index: 2, orientation: 3 }, { index: 8, orientation: 0 }], direction: "clockwise", quarterTurns: 2, difficulty: "Hard", correctIndex: 2, distractors: ["one-motif-off", "one-block-off", "wrong-rotation"], salts: [2013, 2014, 2015] },
  { pattern: "TTCVGG..C", motifs: [{ index: 0, orientation: 2 }, { index: 1, orientation: 3 }, { index: 2, orientation: 3 }, { index: 3, orientation: 3 }], direction: "counterclockwise", quarterTurns: 2, difficulty: "Hard", correctIndex: 1, distractors: ["one-motif-off", "one-block-off", "mirror-main-diagonal"], salts: [2516, 2517, 2518] },
  { pattern: "VG...CCGC", motifs: [{ index: 0, orientation: 0 }, { index: 6, orientation: 1 }], axis: "main-diagonal", difficulty: "Hard", correctIndex: 0, distractors: ["one-motif-off", "one-block-off", "mirror-anti-diagonal"], salts: [3019, 3020, 3021] },
  { pattern: "VVVVTC..C", motifs: [{ index: 1, orientation: 0 }, { index: 2, orientation: 3 }, { index: 4, orientation: 0 }], axis: "anti-diagonal", difficulty: "Hard", correctIndex: 3, distractors: ["one-motif-off", "one-block-off", "mirror-vertical"], salts: [3522, 3523, 3524] },
  { pattern: "..TGV.CTG", motifs: [{ index: 4, orientation: 1 }, { index: 6, orientation: 2 }, { index: 7, orientation: 1 }, { index: 8, orientation: 1 }], direction: "clockwise", quarterTurns: 3, difficulty: "Hard", correctIndex: 1, distractors: ["one-motif-off", "one-block-off", "mirror-horizontal"], salts: [4025, 4026, 4027] },
  { pattern: ".GCVTVV.V", motifs: [{ index: 4, orientation: 1 }, { index: 5, orientation: 0 }], direction: "counterclockwise", quarterTurns: 3, difficulty: "Hard", correctIndex: 3, distractors: ["one-motif-off", "one-block-off", "wrong-rotation"], salts: [4528, 4529, 4530] },
  { pattern: "TC.V.VGV.", motifs: [{ index: 0, orientation: 2 }, { index: 1, orientation: 3 }, { index: 3, orientation: 3 }], direction: "clockwise", quarterTurns: 1, difficulty: "Hard", correctIndex: 2, distractors: ["one-motif-off", "one-block-off", "mirror-vertical"], salts: [5031, 5032, 5033] },
  { pattern: "T.VT.GCVC", motifs: [{ index: 3, orientation: 0 }, { index: 5, orientation: 3 }, { index: 7, orientation: 3 }, { index: 8, orientation: 2 }], axis: "horizontal", difficulty: "Hard", correctIndex: 0, distractors: ["one-motif-off", "one-block-off", "wrong-rotation"], salts: [5534, 5535, 5536] },
];

const WIZARD_2_SPECS: readonly AuthoredRotationRoundSpec[] = [
  { pattern: "C.T.V.GGG", motifs: [{ index: 6, orientation: 0 }, { index: 7, orientation: 1 }], direction: "clockwise", quarterTurns: 1, difficulty: "Wizard", correctIndex: 0, distractors: ["one-motif-off", "one-block-off", "one-motif-off"], salts: [1, 12, 2] },
  { pattern: ".TVGCTVC.", motifs: [{ index: 1, orientation: 3 }, { index: 2, orientation: 0 }, { index: 5, orientation: 3 }], direction: "counterclockwise", quarterTurns: 1, difficulty: "Wizard", correctIndex: 2, distractors: ["one-motif-off", "one-block-off", "one-motif-off"], salts: [504, 515, 505] },
  { pattern: "VG.TT.VG.", motifs: [{ index: 1, orientation: 0 }, { index: 3, orientation: 0 }, { index: 4, orientation: 3 }, { index: 6, orientation: 3 }], axis: "vertical", difficulty: "Wizard", correctIndex: 3, distractors: ["one-motif-off", "one-block-off", "one-motif-off"], salts: [1007, 1018, 1008] },
  { pattern: "TTGT.VG.T", motifs: [{ index: 2, orientation: 2 }, { index: 8, orientation: 0 }], axis: "horizontal", difficulty: "Wizard", correctIndex: 1, distractors: ["one-motif-off", "one-block-off", "one-motif-off"], salts: [1510, 1521, 1511] },
  { pattern: "VCV.TGG..", motifs: [{ index: 1, orientation: 1 }, { index: 2, orientation: 0 }, { index: 4, orientation: 2 }], direction: "clockwise", quarterTurns: 2, difficulty: "Wizard", correctIndex: 3, distractors: ["one-motif-off", "one-block-off", "one-motif-off"], salts: [2013, 2024, 2014] },
  { pattern: "TTTG.C.VV", motifs: [{ index: 1, orientation: 3 }, { index: 3, orientation: 2 }, { index: 5, orientation: 0 }, { index: 8, orientation: 3 }], direction: "counterclockwise", quarterTurns: 2, difficulty: "Wizard", correctIndex: 0, distractors: ["one-motif-off", "one-block-off", "one-motif-off"], salts: [2516, 2527, 2517] },
  { pattern: "CGC.GV..V", motifs: [{ index: 4, orientation: 3 }, { index: 8, orientation: 3 }], axis: "main-diagonal", difficulty: "Wizard", correctIndex: 1, distractors: ["one-motif-off", "one-block-off", "one-motif-off"], salts: [3019, 3030, 3020] },
  { pattern: "CG.C.VTCC", motifs: [{ index: 0, orientation: 2 }, { index: 5, orientation: 3 }, { index: 8, orientation: 1 }], axis: "anti-diagonal", difficulty: "Wizard", correctIndex: 2, distractors: ["one-motif-off", "one-block-off", "one-motif-off"], salts: [3522, 3533, 3523] },
  { pattern: "GG.TT..VT", motifs: [{ index: 3, orientation: 1 }, { index: 4, orientation: 3 }, { index: 7, orientation: 2 }, { index: 8, orientation: 3 }], direction: "clockwise", quarterTurns: 3, difficulty: "Wizard", correctIndex: 1, distractors: ["one-motif-off", "one-block-off", "one-motif-off"], salts: [4025, 4036, 4026] },
  { pattern: "CV..GVCGG", motifs: [{ index: 6, orientation: 1 }, { index: 8, orientation: 3 }], direction: "counterclockwise", quarterTurns: 3, difficulty: "Wizard", correctIndex: 3, distractors: ["one-motif-off", "one-block-off", "one-motif-off"], salts: [4528, 4539, 4529] },
  { pattern: "VV.CVT..G", motifs: [{ index: 1, orientation: 3 }, { index: 3, orientation: 0 }, { index: 4, orientation: 1 }], direction: "clockwise", quarterTurns: 1, difficulty: "Wizard", correctIndex: 0, distractors: ["one-motif-off", "one-block-off", "one-motif-off"], salts: [5031, 5042, 5032] },
  { pattern: "VCG.TC.GG", motifs: [{ index: 0, orientation: 2 }, { index: 1, orientation: 2 }, { index: 4, orientation: 0 }, { index: 7, orientation: 0 }], axis: "horizontal", difficulty: "Wizard", correctIndex: 2, distractors: ["one-motif-off", "one-block-off", "one-motif-off"], salts: [5534, 5545, 5535] },
];

const SPECS: Readonly<
  Record<RotationJourneyExtraLevel, readonly AuthoredRotationRoundSpec[]>
> = {
  "junior-2": JUNIOR_2_SPECS,
  "expert-2": EXPERT_2_SPECS,
  "wizard-2": WIZARD_2_SPECS,
};

const DIFFICULTY_BY_LEVEL: Readonly<
  Record<RotationJourneyExtraLevel, Difficulty>
> = {
  "junior-2": "Medium",
  "expert-2": "Hard",
  "wizard-2": "Wizard",
};

function assertAnswerSchedule(
  level: RotationJourneyExtraLevel,
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

export function buildRotationJourneyExtraCampaignRounds(): Readonly<
  Record<RotationJourneyExtraLevel, readonly Round[]>
> {
  const usedFingerprints = new Set(ROUNDS.map(roundFingerprint));
  const result = {} as Record<
    RotationJourneyExtraLevel,
    readonly Round[]
  >;

  for (const level of [
    "junior-2",
    "expert-2",
    "wizard-2",
  ] as const) {
    const rounds = buildAuthoredRotationRounds(
      SPECS[level],
      `Rotation Match ${level}`,
    );
    assertAnswerSchedule(level, rounds);
    for (const round of rounds) {
      if (round.difficulty !== DIFFICULTY_BY_LEVEL[level]) {
        throw new Error(`${level} contains the wrong difficulty.`);
      }
      const errors = validateRound(round);
      if (errors.length > 0) {
        throw new Error(`${level} is invalid: ${errors.join(" ")}`);
      }
      const fingerprint = roundFingerprint(round);
      if (usedFingerprints.has(fingerprint)) {
        throw new Error(
          `${level} repeats a standalone or Journey Rotation Match round.`,
        );
      }
      usedFingerprints.add(fingerprint);
    }
    result[level] = Object.freeze([...rounds]);
  }

  return Object.freeze(result);
}

export const JOURNEY_EXTRA_CAMPAIGN_ROUNDS =
  buildRotationJourneyExtraCampaignRounds();
