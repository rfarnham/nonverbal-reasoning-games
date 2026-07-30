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

const VARIANTS = [
  {
    id: "question",
    speech(minuend, subtrahend) {
      return `What is ${minuend} minus ${subtrahend}?`;
    },
  },
  {
    id: "paced",
    speech(minuend, subtrahend) {
      return `${minuend}... minus ${subtrahend}. What is the answer?`;
    },
  },
  {
    id: "brisk",
    speech(minuend, subtrahend) {
      return `${minuend} minus ${subtrahend}?`;
    },
  },
];

async function readExistingCues() {
  try {
    const source = JSON.parse(await readFile(manifestUrl, "utf8"));
    return source.cues ?? {};
  } catch {
    return {};
  }
}

const existingCues = await readExistingCues();
const cues = {};

for (let minuend = 11; minuend <= 18; minuend += 1) {
  for (let subtrahend = 2; subtrahend <= 9; subtrahend += 1) {
    if (minuend % 10 >= subtrahend) continue;

    for (const variant of VARIANTS) {
      const cueId = `${minuend}-${subtrahend}-${variant.id}`;
      const speechText = variant.speech(
        NUMBER_WORDS.get(minuend),
        NUMBER_WORDS.get(subtrahend),
      );
      const file = `${minuend}-minus-${subtrahend}-${variant.id}.mp3`;
      const previous = existingCues[cueId];
      const canKeepAudit =
        previous?.speechText === speechText && previous?.file === file;

      cues[cueId] = {
        caption: "Listen for the subtraction problem.",
        speechText,
        file,
        audioDurationMs: canKeepAudit ? previous.audioDurationMs : 0,
        minVisualMs: 0,
        lingerMs: 0,
        sha256: canKeepAudit ? previous.sha256 : "",
      };
    }
  }
}

const manifest = {
  narrator: {
    model: "hexgrad/Kokoro-82M",
    revision: "f3ff3571791e39611d31c381e3a41a3af07b4987",
    voice: "af_heart",
    speed: 0.88,
    sampleRate: 24_000,
    format: "mp3",
  },
  cues,
};

await writeFile(
  manifestUrl,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`Wrote ${Object.keys(cues).length} subtraction narration cues.`);
