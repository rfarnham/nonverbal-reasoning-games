import type { SubmittedAnswer } from "./game-engine";

export type BrowserSpeechRecognitionErrorCode =
  | "aborted"
  | "audio-capture"
  | "bad-grammar"
  | "language-not-supported"
  | "network"
  | "no-speech"
  | "not-allowed"
  | "phrases-not-supported"
  | "service-not-allowed";

export interface BrowserSpeechRecognitionResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

export interface BrowserSpeechRecognitionErrorEvent extends Event {
  readonly error: BrowserSpeechRecognitionErrorCode;
  readonly message: string;
}

export interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onaudioend: ((this: BrowserSpeechRecognition, event: Event) => void) | null;
  onaudiostart: ((this: BrowserSpeechRecognition, event: Event) => void) | null;
  onend: ((this: BrowserSpeechRecognition, event: Event) => void) | null;
  onerror:
    | ((
        this: BrowserSpeechRecognition,
        event: BrowserSpeechRecognitionErrorEvent,
      ) => void)
    | null;
  onnomatch:
    | ((
        this: BrowserSpeechRecognition,
        event: BrowserSpeechRecognitionResultEvent,
      ) => void)
    | null;
  onresult:
    | ((
        this: BrowserSpeechRecognition,
        event: BrowserSpeechRecognitionResultEvent,
      ) => void)
    | null;
  onsoundend: ((this: BrowserSpeechRecognition, event: Event) => void) | null;
  onsoundstart: ((this: BrowserSpeechRecognition, event: Event) => void) | null;
  onspeechend: ((this: BrowserSpeechRecognition, event: Event) => void) | null;
  onspeechstart: ((this: BrowserSpeechRecognition, event: Event) => void) | null;
  onstart: ((this: BrowserSpeechRecognition, event: Event) => void) | null;
  abort(): void;
  start(): void;
  stop(): void;
}

export type BrowserSpeechRecognitionConstructor =
  new () => BrowserSpeechRecognition;

export type BrowserSpeechRecognitionScope = Readonly<{
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
}>;

export type SpokenAnswerMatch = Readonly<{
  answer: SubmittedAnswer;
  confidence: number;
  transcript: string;
}>;

const SMALL_NUMBER_WORDS: Readonly<Record<string, SubmittedAnswer>> =
  Object.freeze({
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
  });

const TENS_NUMBER_WORDS: Readonly<Record<string, SubmittedAnswer>> = Object.freeze({
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
});

const SPOKEN_HOMOPHONES: Readonly<Record<string, SubmittedAnswer>> = Object.freeze({
  to: 2,
  too: 2,
  for: 4,
  fore: 4,
  ate: 8,
});

function normalizeSpokenAnswer(transcript: string): string {
  return transcript
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseNormalizedSpokenNumber(
  normalized: string,
  allowHomophones: boolean,
): SubmittedAnswer | null {
  if (/^(?:0|[1-9]\d?)$/.test(normalized)) {
    return Number(normalized);
  }

  const words = normalized.split(" ");
  if (words.length === 1) {
    return (
      SMALL_NUMBER_WORDS[words[0]] ??
      TENS_NUMBER_WORDS[words[0]] ??
      (allowHomophones ? SPOKEN_HOMOPHONES[words[0]] : undefined) ??
      null
    );
  }

  if (words.length !== 2) return null;
  const tens = TENS_NUMBER_WORDS[words[0]];
  const ones = SMALL_NUMBER_WORDS[words[1]];
  if (tens === undefined || ones === undefined || ones < 1 || ones > 9) {
    return null;
  }
  return tens + ones;
}

function hasExplicitSign(transcript: string): boolean {
  return /^[+\-\u2212]/.test(transcript.normalize("NFKC").trimStart());
}

/**
 * Parses one standalone spoken answer. Extra words and multiple numbers are
 * deliberately rejected so speech-recognition guesses never become answers.
 */
export function parseSpokenAnswer(transcript: string): SubmittedAnswer | null {
  if (hasExplicitSign(transcript)) return null;
  return parseNormalizedSpokenNumber(normalizeSpokenAnswer(transcript), true);
}

/**
 * Parses only an unambiguous number word or digit. Interim hypotheses use this
 * stricter vocabulary so a transient “to”, “for”, or “ate” cannot submit.
 */
export function parseCanonicalSpokenAnswer(
  transcript: string,
): SubmittedAnswer | null {
  if (hasExplicitSign(transcript)) return null;
  return parseNormalizedSpokenNumber(
    normalizeSpokenAnswer(transcript),
    false,
  );
}

/**
 * Finds the first valid final answer, preserving the recognizer's result and
 * alternative ranking. Interim hypotheses are never submitted.
 */
export function readSpokenAnswer(
  event: Pick<
    BrowserSpeechRecognitionResultEvent,
    "resultIndex" | "results"
  >,
): SpokenAnswerMatch | null {
  for (
    let resultIndex = event.resultIndex;
    resultIndex < event.results.length;
    resultIndex += 1
  ) {
    const result = event.results.item(resultIndex);
    if (!result?.isFinal) continue;

    for (
      let alternativeIndex = 0;
      alternativeIndex < result.length;
      alternativeIndex += 1
    ) {
      const alternative = result.item(alternativeIndex);
      if (!alternative) continue;

      const answer = parseSpokenAnswer(alternative.transcript);
      if (answer !== null) {
        return {
          answer,
          confidence: alternative.confidence,
          transcript: alternative.transcript.trim(),
        };
      }
    }
  }

  return null;
}

export function getSpeechRecognitionConstructor(
  scope: BrowserSpeechRecognitionScope = globalThis as BrowserSpeechRecognitionScope,
): BrowserSpeechRecognitionConstructor | null {
  const constructor =
    scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
  return typeof constructor === "function" ? constructor : null;
}

/**
 * Creates the continuous recognition stream used by Subtraction Flash. The
 * caller gates prompt audio and decides when a recognized answer may submit.
 */
export function createDigitSpeechRecognition(
  scope?: BrowserSpeechRecognitionScope,
): BrowserSpeechRecognition | null {
  const Constructor = getSpeechRecognitionConstructor(scope);
  if (!Constructor) return null;

  try {
    const recognition = new Constructor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;
    return recognition;
  } catch {
    return null;
  }
}
