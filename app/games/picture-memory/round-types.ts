import type { PictureId } from "./picture-data.ts";

export type Difficulty = "Starter" | "Junior" | "Expert" | "Wizard";

/** Recall is a set: neither study order nor choice order changes the answer. */
export type Round = Readonly<{
  id: string;
  difficulty: Difficulty;
  study: readonly PictureId[];
  options: readonly PictureId[];
}>;

export type JourneyExtraLevel = "junior-2" | "expert-2" | "wizard-2";
