import narrationSource from "@/content/narration/subtraction-flash.json";
import {
  defineGameNarrationManifest,
  type GameNarrationClip,
} from "@/lib/game-narration";

import type {
  SpokenVariant,
  SubtractionCard,
} from "./game-engine";

const ASSET_ROOT =
  "/audio/narration/kokoro-82m-v1-af-heart/subtraction-flash";

export type SubtractionNarrationCueId = keyof typeof narrationSource.cues;

type SourceCue =
  (typeof narrationSource.cues)[SubtractionNarrationCueId];

function clipFromSource(cue: SourceCue): GameNarrationClip {
  return {
    src: `${ASSET_ROOT}/${cue.file}`,
    audioDurationMs: cue.audioDurationMs,
    minimumVisualMs: Math.max(cue.audioDurationMs, cue.minVisualMs),
    lingerMs: cue.lingerMs,
    transcript: cue.speechText,
  };
}

const clips = Object.fromEntries(
  Object.entries(narrationSource.cues).map(([cueId, cue]) => [
    cueId,
    clipFromSource(cue),
  ]),
) as Record<SubtractionNarrationCueId, GameNarrationClip>;

export const SUBTRACTION_QUESTION_NARRATION =
  defineGameNarrationManifest(clips, narrationSource.narrator);

export function subtractionNarrationCueId(
  card: Pick<SubtractionCard, "minuend" | "subtrahend" | "spokenVariant">,
): SubtractionNarrationCueId {
  const variant: SpokenVariant = card.spokenVariant;
  return `${card.minuend}-${card.subtrahend}-${variant}` as SubtractionNarrationCueId;
}
