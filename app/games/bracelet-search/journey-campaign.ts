import {
  ROUNDS,
  buildEncodedBraceletRounds,
  roundFingerprint,
  type BraceletRound,
  type Difficulty,
  type EncodedRoundSpec,
  type OptionKind,
} from "./game-engine.ts";

export type BraceletJourneyExtraLevel =
  | "junior-2"
  | "expert-2"
  | "wizard-2";

type FrozenRoundSpec = readonly [
  bracelet: string,
  options: readonly [string, string, string, string],
  optionKinds: readonly [OptionKind, OptionKind, OptionKind, OptionKind],
];

// These candidates were produced by the canonical bounded generator, visually
// reviewed, encoded, and frozen. Runtime construction decodes them and
// recalculates the only matching option and its exact bracelet occurrence.
const JUNIOR_2_SPECS: readonly FrozenRoundSpec[] = [
  ["GTTCVGGTVC", ["VCGC", "VGGT", "GVGT", "VGTV"], ["two-color-off", "correct", "adjacent-swap", "skipped-bead"]],
  ["CTGCVTGVVC", ["TGCC", "GCCV", "TTVC", "GTCC"], ["adjacent-swap", "skipped-bead", "two-color-off", "correct"]],
  ["CGTVGCTVGT", ["GTCG", "GTGC", "GVCC", "GCGT"], ["correct", "adjacent-swap", "two-color-off", "skipped-bead"]],
  ["GTGVVCCGCT", ["VGGT", "GVTG", "VGTG", "VVGG"], ["adjacent-swap", "two-color-off", "correct", "skipped-bead"]],
  ["CGGVGTCTVC", ["VTGC", "TGVC", "VGCT", "VGTC"], ["adjacent-swap", "two-color-off", "skipped-bead", "correct"]],
  ["VTCGTCTVCG", ["GCVC", "GCTV", "CGTV", "GTVG"], ["two-color-off", "correct", "adjacent-swap", "skipped-bead"]],
  ["GVTGCGVVTC", ["TGGV", "CTGV", "GCGV", "GCVG"], ["skipped-bead", "two-color-off", "correct", "adjacent-swap"]],
  ["GVGGTCTCVT", ["CTGG", "CTVV", "TCGG", "CGGV"], ["correct", "two-color-off", "adjacent-swap", "skipped-bead"]],
  ["CGTVTVTCCG", ["GGCT", "GCTV", "GCGT", "CTGT"], ["adjacent-swap", "skipped-bead", "correct", "two-color-off"]],
  ["CTCGCVVTGV", ["TCVG", "TCGT", "GCTG", "CTVG"], ["correct", "skipped-bead", "two-color-off", "adjacent-swap"]],
  ["TTCTVGVCCG", ["CVTG", "CTGV", "TTVT", "CTVG"], ["adjacent-swap", "skipped-bead", "two-color-off", "correct"]],
  ["VGVCVTTGCT", ["CCVT", "CGTT", "CTTV", "GCTT"], ["two-color-off", "correct", "skipped-bead", "adjacent-swap"]],
];

const EXPERT_2_SPECS: readonly FrozenRoundSpec[] = [
  ["TtCVCgvGVCtG", ["VGtGT", "VctGT", "VCtGT", "GCtGT"], ["one-color-off", "one-mark-off", "correct", "skipped-bead"]],
  ["CtVgCvCVtTGG", ["TtVCv", "GtVCv", "TcVCv", "TTVCv"], ["correct", "skipped-bead", "one-color-off", "one-mark-off"]],
  ["cTtGGVVcCgVT", ["VtcTt", "TVcTt", "CTcTt", "VTcTt"], ["one-mark-off", "adjacent-swap", "one-color-off", "correct"]],
  ["gCCtGVVTTgCv", ["CgTCV", "CgTTV", "CgTTv", "CgTVV"], ["one-color-off", "correct", "one-mark-off", "skipped-bead"]],
  ["TCTcvGCGtVVg", ["TcvGC", "TcvGc", "TctGC", "cTvGC"], ["correct", "one-mark-off", "one-color-off", "adjacent-swap"]],
  ["TVCgcGTcVvGT", ["vcTGc", "VcTTc", "VcTGc", "VcGTc"], ["one-mark-off", "one-color-off", "correct", "adjacent-swap"]],
  ["GCVtgVGcVTCt", ["VgtVG", "VtgVG", "VttVG", "vtgVG"], ["adjacent-swap", "correct", "one-color-off", "one-mark-off"]],
  ["TVctGVggTCCV", ["GVGtc", "gVGtV", "vVGtc", "gVGtc"], ["one-mark-off", "skipped-bead", "one-color-off", "correct"]],
  ["gcTCCvTGVTgV", ["TgVGc", "TgVgc", "VTVgc", "TgVgt"], ["one-mark-off", "correct", "skipped-bead", "one-color-off"]],
  ["tVvCcGTGTGVc", ["TtcVG", "VtCVG", "vtcVG", "VtcVG"], ["one-color-off", "one-mark-off", "skipped-bead", "correct"]],
  ["VGTvgTvTCGcC", ["vTCGc", "TvCGc", "vTcGc", "vTCVc"], ["correct", "adjacent-swap", "one-mark-off", "one-color-off"]],
  ["TCCVTctGgVVg", ["VgGTc", "VgGcT", "VgGtc", "VtGtc"], ["one-mark-off", "skipped-bead", "correct", "one-color-off"]],
];

const WIZARD_2_SPECS: readonly FrozenRoundSpec[] = [
  ["gVGVcgVTCTtC", ["CT?gV", "cT?Cg", "CT?Gg", "CT?Cg"], ["skipped-bead", "one-mark-off", "one-color-off", "correct"]],
  ["cVVtgCCGTTgV", ["TG?cg", "TG?Cg", "TG?Cv", "TG?Ct"], ["one-mark-off", "correct", "one-color-off", "skipped-bead"]],
  ["GCvVTtGtGcCV", ["CV?Cv", "CV?cv", "CV?CV", "CV?Ct"], ["correct", "one-mark-off", "skipped-bead", "one-color-off"]],
  ["gVcCtGVvTTCG", ["vV?Ct", "vC?tC", "vV?tC", "vV?TC"], ["adjacent-swap", "one-color-off", "correct", "one-mark-off"]],
  ["GGTVVCgVcTtc", ["CT?cG", "cT?cG", "cT?GG", "gT?cG"], ["one-mark-off", "correct", "skipped-bead", "one-color-off"]],
  ["TCvGCGvtGcVT", ["vC?tV", "tC?TV", "Gv?TV", "vC?TV"], ["one-mark-off", "one-color-off", "skipped-bead", "correct"]],
  ["VtVGgTCVGcTc", ["Vg?CV", "gG?CV", "Gg?CV", "Gg?Cv"], ["one-color-off", "adjacent-swap", "correct", "one-mark-off"]],
  ["GGttCGCVCVvt", ["VC?Ct", "CC?Ct", "Vc?Ct", "VG?Ct"], ["correct", "skipped-bead", "one-mark-off", "one-color-off"]],
  ["VGVcCtvCGTGt", ["gV?Ct", "CV?Ct", "GV?Ct", "VV?Ct"], ["one-mark-off", "one-color-off", "correct", "skipped-bead"]],
  ["CVTGcTGGvvCt", ["Cv?GG", "Cv?GC", "cv?GG", "tv?GG"], ["correct", "one-color-off", "one-mark-off", "skipped-bead"]],
  ["gCGTvctVCGVT", ["Tv?tv", "Tv?tV", "Gv?tV", "Cv?tV"], ["one-mark-off", "correct", "skipped-bead", "one-color-off"]],
  ["tcVVgCGtCVTG", ["VV?tg", "VV?tC", "VV?tT", "VV?tG"], ["one-mark-off", "one-color-off", "skipped-bead", "correct"]],
];

const FROZEN_SPECS: Readonly<
  Record<BraceletJourneyExtraLevel, readonly FrozenRoundSpec[]>
> = {
  "junior-2": JUNIOR_2_SPECS,
  "expert-2": EXPERT_2_SPECS,
  "wizard-2": WIZARD_2_SPECS,
};

const DIFFICULTY_BY_LEVEL: Readonly<
  Record<BraceletJourneyExtraLevel, Difficulty>
> = {
  "junior-2": "Medium",
  "expert-2": "Hard",
  "wizard-2": "Wizard",
};

function answerPositionErrors(
  level: BraceletJourneyExtraLevel,
  rounds: readonly BraceletRound[],
): readonly string[] {
  const positions = rounds.map(({ correctIndex }) => correctIndex);
  const counts = [0, 1, 2, 3].map(
    (position) => positions.filter((value) => value === position).length,
  );
  const errors: string[] = [];
  if (counts.some((count) => count !== 3)) {
    errors.push(`${level} answer positions must balance 3/3/3/3.`);
  }
  if (
    positions.some(
      (position, index) =>
        index > 0 && positions[index - 1] === position,
    )
  ) {
    errors.push(`${level} cannot repeat adjacent answer positions.`);
  }
  const blocks = [0, 4, 8].map((start) =>
    positions.slice(start, start + 4).join(","),
  );
  if (new Set(blocks).size === 1) {
    errors.push(`${level} cannot repeat one four-position cycle.`);
  }
  return errors;
}

function expandedSpecs(
  level: BraceletJourneyExtraLevel,
): readonly EncodedRoundSpec[] {
  const difficulty = DIFFICULTY_BY_LEVEL[level];
  return FROZEN_SPECS[level].map(
    ([bracelet, options, optionKinds], index) => ({
      id: `journey:${level}:${String(index + 1).padStart(2, "0")}`,
      difficulty,
      bracelet,
      options,
      optionKinds,
    }),
  );
}

export function buildBraceletJourneyExtraCampaignRounds(): Readonly<
  Record<BraceletJourneyExtraLevel, readonly BraceletRound[]>
> {
  const usedFingerprints = new Set(ROUNDS.map(roundFingerprint));
  const result = {} as Record<
    BraceletJourneyExtraLevel,
    readonly BraceletRound[]
  >;

  for (const level of [
    "junior-2",
    "expert-2",
    "wizard-2",
  ] as const) {
    const rounds = buildEncodedBraceletRounds(expandedSpecs(level));
    if (rounds.length !== 12) {
      throw new Error(`${level} must contain exactly 12 Journey rounds.`);
    }
    if (
      rounds.some(
        ({ difficulty }) => difficulty !== DIFFICULTY_BY_LEVEL[level],
      )
    ) {
      throw new Error(`${level} contains a round at the wrong difficulty.`);
    }
    const scheduleErrors = answerPositionErrors(level, rounds);
    if (scheduleErrors.length > 0) {
      throw new Error(scheduleErrors.join(" "));
    }
    for (const round of rounds) {
      const fingerprint = roundFingerprint(round);
      if (usedFingerprints.has(fingerprint)) {
        throw new Error(
          `${level} repeats a standalone or Journey Bracelet Search round.`,
        );
      }
      usedFingerprints.add(fingerprint);
    }
    result[level] = Object.freeze([...rounds]);
  }
  return Object.freeze(result);
}

export const JOURNEY_EXTRA_CAMPAIGN_ROUNDS =
  buildBraceletJourneyExtraCampaignRounds();
