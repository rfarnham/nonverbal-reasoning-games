import { readFile, writeFile } from "node:fs/promises";

const manifestUrl = new URL(
  "../content/narration/subtraction-flash.json",
  import.meta.url,
);

const NUMBER_WORDS = new Map([
  [2, "two"],
  [3, "three"],
  [4, "four"],
  [5, "five"],
  [6, "six"],
  [7, "seven"],
  [8, "eight"],
  [9, "nine"],
  [11, "eleven"],
  [12, "twelve"],
  [13, "thirteen"],
  [14, "fourteen"],
  [15, "fifteen"],
  [16, "sixteen"],
  [17, "seventeen"],
  [18, "eighteen"],
]);

const TRIM_EDGE_SILENCE_FILTER =
  "silenceremove=start_periods=1:start_duration=0.04:" +
  "start_threshold=-50dB:start_silence=0.15:detection=rms," +
  "areverse," +
  "silenceremove=start_periods=1:start_duration=0.04:" +
  "start_threshold=-50dB:start_silence=0.15:detection=rms," +
  "areverse";

const NARRATOR = Object.freeze({
  model: "hexgrad/Kokoro-82M",
  revision: "f3ff3571791e39611d31c381e3a41a3af07b4987",
  voice: "af_heart",
  speed: 0.88,
  sampleRate: 24_000,
  format: "mp3",
});

const POSTPROCESS = Object.freeze({
  trimEdgeSilence: true,
  ffmpegAudioFilter: TRIM_EDGE_SILENCE_FILTER,
  ffmpegAudioCodec: "libmp3lame",
  audioBitrateKbps: 48,
});

async function readExistingManifest() {
  try {
    return JSON.parse(await readFile(manifestUrl, "utf8"));
  } catch {
    return { cues: {} };
  }
}

const existingManifest = await readExistingManifest();
const existingCues = existingManifest.cues ?? {};
const auditRecipeMatches =
  Object.entries(NARRATOR).every(
    ([key, value]) => existingManifest.narrator?.[key] === value,
  ) &&
  Object.entries(POSTPROCESS).every(
    ([key, value]) => existingManifest.postprocess?.[key] === value,
  );
const cues = {};

for (let minuend = 11; minuend <= 18; minuend += 1) {
  for (let subtrahend = 2; subtrahend <= 9; subtrahend += 1) {
    if (minuend % 10 >= subtrahend) continue;

    const cueId = `${minuend}-${subtrahend}`;
    const speechText =
      `${NUMBER_WORDS.get(minuend)} minus ${NUMBER_WORDS.get(subtrahend)}?`;
    const file = `${minuend}-minus-${subtrahend}.mp3`;
    const previous =
      existingCues[cueId] ?? existingCues[`${cueId}-brisk`];
    const previousFileIsCurrentOrLegacy =
      previous?.file === file ||
      previous?.file === `${minuend}-minus-${subtrahend}-brisk.mp3`;
    const canKeepAudit =
      auditRecipeMatches &&
      previous?.speechText === speechText &&
      previousFileIsCurrentOrLegacy;

    cues[cueId] = {
      caption: "Listen.",
      speechText,
      file,
      audioDurationMs: canKeepAudit ? previous.audioDurationMs : 0,
      minVisualMs: 0,
      lingerMs: 0,
      sha256: canKeepAudit ? previous.sha256 : "",
    };
  }
}

const manifest = {
  narrator: NARRATOR,
  postprocess: POSTPROCESS,
  cues,
};

await writeFile(
  manifestUrl,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`Wrote ${Object.keys(cues).length} subtraction narration cues.`);
