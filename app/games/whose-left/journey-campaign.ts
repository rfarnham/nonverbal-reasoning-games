import {
  CAMPAIGN_ROUNDS,
  buildAuthoredWhoseLeftRounds,
  roundFingerprint,
  validateRound,
  type AuthoredWhoseLeftRoundSpec,
  type Difficulty,
  type Point,
  type Round,
  type Side,
} from "./game-engine.ts";

export type WhoseLeftJourneyExtraLevel =
  | "junior-2"
  | "expert-2"
  | "wizard-2";

type FrozenSpec = readonly [
  id: string,
  difficulty: Difficulty,
  points: string,
  sides: string,
  querySide: Side,
  correctIndex: number,
  nameOffset: number,
  nearMissSalt: number,
  distractorRotation: number,
];

// Frozen generator-selected paths. Runtime construction derives segments,
// landmark geometry, traversal order, all four misconception options, viewBox,
// and the difficulty scaffold before running the complete path/side validator.
const JUNIOR_2_SPECS: readonly FrozenSpec[] = [
  ["journey-junior-2-01", "Junior", "0,0;8,0;8,10;0,10;0,18;-8,18;-8,28", "RLLLRR", "left", 1, 7, 1, 2],
  ["journey-junior-2-02", "Junior", "0,0;0,8;8,8;8,0;16,0;16,-8;24,-8", "LRLRRL", "right", 3, 12, 2, 3],
  ["journey-junior-2-03", "Junior", "0,0;-8,0;-8,-8;0,-8;0,-16;8,-16;8,-8", "RLLRRL", "left", 0, 17, 3, 4],
  ["journey-junior-2-04", "Junior", "0,0;0,-8;-8,-8;-8,0;-16,0;-16,8;-8,8", "RLRLLR", "right", 2, 22, 4, 5],
  ["journey-junior-2-05", "Junior", "0,0;16,0;16,10;6,10;6,-6;-4,-6;-4,-16", "LLRRRL", "left", 1, 1, 5, 6],
  ["journey-junior-2-06", "Junior", "0,0;0,16;12,16;12,6;-4,6;-4,-4;-16,-4", "RRRLLL", "right", 0, 6, 6, 7],
  ["journey-junior-2-07", "Junior", "0,0;-16,0;-16,-12;-6,-12;-6,4;4,4;4,16", "RLRLRL", "left", 3, 11, 7, 8],
  ["journey-junior-2-08", "Junior", "0,0;0,-16;-10,-16;-10,-6;6,-6;6,4;18,4", "LLRRLR", "right", 2, 16, 8, 9],
  ["journey-junior-2-09", "Junior", "0,0;16,0;16,10;6,10;6,-6;-4,-6;-4,4", "LRRLLR", "left", 0, 21, 9, 10],
  ["journey-junior-2-10", "Junior", "0,0;0,16;-10,16;-10,6;6,6;6,-4;-6,-4", "LLLRRR", "right", 2, 0, 10, 11],
  ["journey-junior-2-11", "Junior", "0,0;-16,0;-16,12;-6,12;-6,-4;4,-4;4,6", "RLRRLL", "left", 1, 5, 11, 12],
  ["journey-junior-2-12", "Junior", "0,0;0,-16;10,-16;10,-6;-6,-6;-6,4;6,4", "RRLLLR", "right", 3, 10, 12, 13],
];

const EXPERT_2_SPECS: readonly FrozenSpec[] = [
  ["journey-expert-2-01", "Expert", "0,0;12,0;12,-8;4,-8;4,4;-4,4;-4,12;-12,12;-12,20", "RLRRLLLR", "left", 2, 14, 2, 4],
  ["journey-expert-2-02", "Expert", "0,0;0,12;-8,12;-8,4;4,4;4,-4;12,-4;12,-12;20,-12", "RLLLRLRR", "right", 0, 19, 3, 5],
  ["journey-expert-2-03", "Expert", "0,0;-8,0;-8,-8;2,-8;2,2;14,2;14,10;6,10;6,-2", "LLRRLRRL", "left", 3, 24, 4, 6],
  ["journey-expert-2-04", "Expert", "0,0;0,-8;-8,-8;-8,2;2,2;2,14;10,14;10,6;-2,6", "LRRLRLLR", "right", 1, 3, 5, 7],
  ["journey-expert-2-05", "Expert", "0,0;10,0;10,-14;22,-14;22,-4;6,-4;6,12;-4,12;-4,-2", "LRRLLRLR", "left", 2, 8, 6, 8],
  ["journey-expert-2-06", "Expert", "0,0;0,10;-14,10;-14,22;-4,22;-4,6;12,6;12,-6;-2,-6", "RLLRLLRR", "right", 1, 13, 7, 9],
  ["journey-expert-2-07", "Expert", "0,0;-10,0;-10,14;-22,14;-22,4;-6,4;-6,-12;4,-12;4,-2", "LRRRLLLR", "left", 0, 18, 8, 10],
  ["journey-expert-2-08", "Expert", "0,0;0,-10;14,-10;14,-22;4,-22;4,-6;-12,-6;-12,4;6,4", "RRRLLRLL", "right", 3, 23, 9, 11],
  ["journey-expert-2-09", "Expert", "0,0;10,0;10,-14;22,-14;22,-4;6,-4;6,12;-4,12;-4,-4", "RRLRLLRL", "left", 1, 2, 10, 12],
  ["journey-expert-2-10", "Expert", "0,0;0,10;-14,10;-14,22;-4,22;-4,6;12,6;12,-4;-2,-4", "LRRRLRLL", "right", 3, 7, 11, 13],
  ["journey-expert-2-11", "Expert", "0,0;-10,0;-10,14;-22,14;-22,4;-6,4;-6,-12;6,-12;6,0", "RRLLLRRL", "left", 2, 12, 12, 14],
  ["journey-expert-2-12", "Expert", "0,0;0,-10;-14,-10;-14,-22;-4,-22;-4,-6;12,-6;12,4;-6,4", "RLRRRLLL", "right", 0, 17, 13, 15],
];

const WIZARD_2_SPECS: readonly FrozenSpec[] = [
  ["journey-wizard-2-01", "Wizard", "0,0;-12,0;-12,-8;-4,-8;-4,4;4,4;4,12;12,12;12,20", "LRLLRLRR", "left", 0, 21, 3, 6],
  ["journey-wizard-2-02", "Wizard", "0,0;0,-12;8,-12;8,-4;-4,-4;-4,4;-12,4;-12,12;-20,12", "RLLLRRLR", "right", 2, 0, 4, 7],
  ["journey-wizard-2-03", "Wizard", "0,0;8,0;8,-8;-2,-8;-2,2;-14,2;-14,10;-6,10;-6,-2", "RLRLRLLR", "left", 3, 5, 5, 8],
  ["journey-wizard-2-04", "Wizard", "0,0;0,8;-8,8;-8,-2;2,-2;2,-14;10,-14;10,-6;-2,-6", "LLRRLRRL", "right", 1, 10, 6, 9],
  ["journey-wizard-2-05", "Wizard", "0,0;-10,0;-10,14;-22,14;-22,4;-6,4;-6,-12;6,-12;6,2", "RLLRRRLL", "left", 3, 15, 7, 10],
  ["journey-wizard-2-06", "Wizard", "0,0;0,-10;14,-10;14,-22;4,-22;4,-6;-12,-6;-12,4;-2,4", "LRRLRLRL", "right", 0, 20, 8, 11],
  ["journey-wizard-2-07", "Wizard", "0,0;10,0;10,-14;22,-14;22,-4;6,-4;6,12;-4,12;-4,-6", "RRLLLRLR", "left", 1, 25, 9, 12],
  ["journey-wizard-2-08", "Wizard", "0,0;0,10;14,10;14,22;4,22;4,6;-12,6;-12,-6;0,-6", "LLRRRLRL", "right", 2, 4, 10, 13],
  ["journey-wizard-2-09", "Wizard", "0,0;-10,0;-10,14;-22,14;-22,4;-6,4;-6,-12;4,-12;4,2", "LRLLRRRL", "left", 1, 9, 11, 14],
  ["journey-wizard-2-10", "Wizard", "0,0;0,-10;-14,-10;-14,-22;-4,-22;-4,-6;12,-6;12,6;0,6", "RLLRLRLR", "right", 3, 14, 12, 15],
  ["journey-wizard-2-11", "Wizard", "0,0;10,0;10,-14;22,-14;22,-4;6,-4;6,12;-6,12;-6,-2", "LRLLLRRR", "left", 0, 19, 13, 16],
  ["journey-wizard-2-12", "Wizard", "0,0;0,10;14,10;14,22;4,22;4,6;-12,6;-12,-4;4,-4", "RRLLLLRR", "right", 2, 24, 14, 17],
];

const SPECS: Readonly<
  Record<WhoseLeftJourneyExtraLevel, readonly FrozenSpec[]>
> = {
  "junior-2": JUNIOR_2_SPECS,
  "expert-2": EXPERT_2_SPECS,
  "wizard-2": WIZARD_2_SPECS,
};

function decodePoints(encoded: string): readonly Point[] {
  return encoded.split(";").map((pair) => {
    const coordinates = pair.split(",").map(Number);
    if (
      coordinates.length !== 2 ||
      coordinates.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(`Invalid frozen Whose Left? point: ${pair}`);
    }
    return { x: coordinates[0], y: coordinates[1] };
  });
}

function expandedSpecs(
  level: WhoseLeftJourneyExtraLevel,
): readonly AuthoredWhoseLeftRoundSpec[] {
  return SPECS[level].map(
    ([
      id,
      difficulty,
      points,
      sides,
      querySide,
      correctIndex,
      nameOffset,
      nearMissSalt,
      distractorRotation,
    ]) => ({
      id,
      difficulty,
      points: decodePoints(points),
      sides,
      querySide,
      correctIndex,
      nameOffset,
      nearMissSalt,
      distractorRotation,
    }),
  );
}

function assertAnswerSchedule(
  level: WhoseLeftJourneyExtraLevel,
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

export function buildWhoseLeftJourneyExtraCampaignRounds(): Readonly<
  Record<WhoseLeftJourneyExtraLevel, readonly Round[]>
> {
  const usedFingerprints = new Set(
    CAMPAIGN_ROUNDS.map(roundFingerprint),
  );
  const result = {} as Record<
    WhoseLeftJourneyExtraLevel,
    readonly Round[]
  >;
  for (const level of [
    "junior-2",
    "expert-2",
    "wizard-2",
  ] as const) {
    const rounds = buildAuthoredWhoseLeftRounds(
      expandedSpecs(level),
      `Whose Left? ${level}`,
    );
    assertAnswerSchedule(level, rounds);
    for (const round of rounds) {
      const validation = validateRound(round);
      if (!validation.valid) {
        throw new Error(
          `${round.id} is invalid: ${validation.errors.join(" ")}`,
        );
      }
      const fingerprint = roundFingerprint(round);
      if (usedFingerprints.has(fingerprint)) {
        throw new Error(
          `${round.id} repeats standalone or Journey content.`,
        );
      }
      usedFingerprints.add(fingerprint);
    }
    result[level] = rounds;
  }
  return Object.freeze(result);
}

export const JOURNEY_EXTRA_CAMPAIGN_ROUNDS =
  buildWhoseLeftJourneyExtraCampaignRounds();
