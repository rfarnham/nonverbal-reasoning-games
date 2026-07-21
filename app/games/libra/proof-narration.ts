import narrationSource from "@/content/narration/libra-proof.json";
import {
  defineGameNarrationManifest,
  type GameNarrationClip,
} from "@/lib/game-narration";

import type { TeachingProofStep } from "./strategy-curriculum.ts";

const ASSET_ROOT =
  "/audio/narration/kokoro-82m-v1-af-heart";

export type LibraProofNarrationCueId = keyof typeof narrationSource.cues;

type SourceCue = (typeof narrationSource.cues)[LibraProofNarrationCueId];

function clipFromSource(cue: SourceCue): GameNarrationClip {
  return {
    src: `${ASSET_ROOT}/${cue.file}`,
    audioDurationMs: cue.audioDurationMs,
    // The measured clip length is part of the visual teaching clock. Muting
    // narration must never make the proof rush ahead.
    minimumVisualMs: Math.max(cue.audioDurationMs, cue.minVisualMs),
    lingerMs: cue.lingerMs,
    transcript: cue.caption,
  };
}

const clips = Object.fromEntries(
  Object.entries(narrationSource.cues).map(([cueId, cue]) => [
    cueId,
    clipFromSource(cue),
  ]),
) as Record<LibraProofNarrationCueId, GameNarrationClip>;

/** Libra's clips use the one narrator identity shared by the whole suite. */
export const LIBRA_PROOF_NARRATION = defineGameNarrationManifest(
  clips,
  narrationSource.narrator,
);

function countedCue(
  prefix: "regroup" | "split",
  count: number,
): LibraProofNarrationCueId {
  if (count !== 2 && count !== 3 && count !== 4) {
    throw new RangeError(
      `Libra narration has no ${prefix} clip for ${count} groups.`,
    );
  }
  return `${prefix}-${count}`;
}

export function proofNarrationCueId(
  step: TeachingProofStep,
): LibraProofNarrationCueId {
  switch (step.kind) {
    case "inspect":
      return step.sources.length === 1 ? "inspect-one" : "inspect-many";
    case "substitute":
      return "substitute";
    case "add-scales":
      return "add-scales";
    case "subtract-scales":
      return "subtract-scales";
    case "cancel-matches":
      return "cancel-matches";
    case "regroup":
      return countedCue("regroup", step.after.groupCount);
    case "split-evenly":
      return countedCue("split", step.divisor);
    case "conclude":
      return "conclude";
  }
}

export function proofNarrationCueIds(
  steps: readonly TeachingProofStep[],
): readonly LibraProofNarrationCueId[] {
  return steps.map(proofNarrationCueId);
}

export function proofNarrationDurationMsForStep(
  step: TeachingProofStep,
): number {
  const clip = LIBRA_PROOF_NARRATION.clips[proofNarrationCueId(step)];
  return clip.minimumVisualMs + clip.lingerMs;
}

export function proofNarrationCaption(step: TeachingProofStep): string {
  return LIBRA_PROOF_NARRATION.clips[proofNarrationCueId(step)].transcript;
}

export const LIBRA_NARRATOR_PROVENANCE = narrationSource.narrator;
