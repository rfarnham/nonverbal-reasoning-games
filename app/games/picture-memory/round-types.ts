import type { PictureId } from "./picture-data.ts";

export type Difficulty = "Starter" | "Junior" | "Expert" | "Wizard";

/** Recall is a set of exact appearances, including each picture's pose. */
export type Round = Readonly<{
  id: string;
  difficulty: Difficulty;
  study: readonly PictureId[];
  options: readonly PictureId[];
}>;

export type JourneyExtraLevel = "junior-2" | "expert-2" | "wizard-2";
export type TrapKind = "structural" | "rotation" | "reflection";
export type ReflectionAxis = "left-right" | "top-bottom" | "diagonal" | "antidiagonal";
export type StudyIndex = 0 | 1 | 2;

export type AuthoredTrapSpec = Readonly<
  | { kind: "structural"; source: StudyIndex }
  | { kind: "rotation"; source: StudyIndex; quarterTurns: 1 | 2 | 3 }
  | { kind: "reflection"; source: StudyIndex; axis: ReflectionAxis }
>;

/** Foils are computed from these frozen operations over the actual study set. */
export type AuthoredAppearanceRoundSpec = Readonly<{
  id: string;
  difficulty: "Expert" | "Wizard";
  study: readonly [PictureId, PictureId, PictureId];
  traps: readonly [AuthoredTrapSpec, AuthoredTrapSpec, AuthoredTrapSpec, AuthoredTrapSpec, AuthoredTrapSpec];
  optionOrder: readonly [number, number, number, number, number, number, number, number];
}>;

export type AuthoredRoundSpec = Round | AuthoredAppearanceRoundSpec;
