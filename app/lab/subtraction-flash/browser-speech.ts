import type { AnswerValue } from "./game-engine";

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
  answer: AnswerValue;
  confidence: number;
  transcript: string;
}>;

const SPOKEN_ANSWERS: Readonly<Record<string, AnswerValue>> = Object.freeze({
  "2": 2,
  two: 2,
  to: 2,
  too: 2,
  "3": 3,
  three: 3,
  "4": 4,
  four: 4,
  for: 4,
  fore: 4,
  "5": 5,
  five: 5,
  "6": 6,
  six: 6,
  "7": 7,
  seven: 7,
  "8": 8,
  eight: 8,
  ate: 8,
  "9": 9,
  nine: 9,
});

const CANONICAL_SPOKEN_ANSWERS: Readonly<Record<string, AnswerValue>> =
  Object.freeze({
    "2": 2,
    two: 2,
    "3": 3,
    three: 3,
    "4": 4,
    four: 4,
    "5": 5,
    five: 5,
    "6": 6,
    six: 6,
    "7": 7,
    seven: 7,
    "8": 8,
    eight: 8,
    "9": 9,
    nine: 9,
  });

function normalizeSpokenAnswer(transcript: string): string {
  return transcript
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Parses one standalone spoken answer. Extra words and multiple numbers are
 * deliberately rejected so speech-recognition guesses never become answers.
 */
export function parseSpokenAnswer(transcript: string): AnswerValue | null {
  return SPOKEN_ANSWERS[normalizeSpokenAnswer(transcript)] ?? null;
}

/**
 * Parses only an unambiguous number word or digit. Interim hypotheses use this
 * stricter vocabulary so a transient “to”, “for”, or “ate” cannot submit.
 */
export function parseCanonicalSpokenAnswer(
  transcript: string,
): AnswerValue | null {
  return (
    CANONICAL_SPOKEN_ANSWERS[normalizeSpokenAnswer(transcript)] ?? null
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
 * caller gates prompt audio and decides when a recognized digit may submit.
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
