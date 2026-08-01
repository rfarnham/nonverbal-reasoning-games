import {
  parseCanonicalSpokenAnswer,
  parseSpokenAnswer,
  type BrowserSpeechRecognitionResultEvent,
  type SpokenAnswerMatch,
} from "./browser-speech.ts";

type SpeechResultEvent = Pick<
  BrowserSpeechRecognitionResultEvent,
  "resultIndex" | "results"
>;

/**
 * Reads a digit as soon as it becomes the recognizer's leading hypothesis.
 * Final results may also use ranked alternatives, but an interim low-ranked
 * guess never becomes an answer.
 */
export function readStreamingSpokenAnswer(
  event: SpeechResultEvent,
  ignoredResultIndexes?: ReadonlySet<number>,
  allowRankedFinalAlternatives = true,
): SpokenAnswerMatch | null {
  for (
    let resultIndex = event.resultIndex;
    resultIndex < event.results.length;
    resultIndex += 1
  ) {
    if (ignoredResultIndexes?.has(resultIndex)) continue;
    const result = event.results.item(resultIndex);
    if (!result) continue;

    const alternativeCount = result.isFinal && allowRankedFinalAlternatives
      ? result.length
      : Math.min(1, result.length);
    for (
      let alternativeIndex = 0;
      alternativeIndex < alternativeCount;
      alternativeIndex += 1
    ) {
      const alternative = result.item(alternativeIndex);
      if (!alternative) continue;

      const answer = result.isFinal
        ? parseSpokenAnswer(alternative.transcript)
        : parseCanonicalSpokenAnswer(alternative.transcript);
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

const PROMPT_NUMBER_TOKENS: Readonly<Record<string, string>> =
  Object.freeze({
    two: "2",
    to: "2",
    too: "2",
    three: "3",
    four: "4",
    for: "4",
    fore: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    ate: "8",
    nine: "9",
    ten: "10",
    eleven: "11",
    twelve: "12",
    thirteen: "13",
    fourteen: "14",
    fifteen: "15",
    sixteen: "16",
    seventeen: "17",
    eighteen: "18",
  });

type SpeechToken = Readonly<{ raw: string; comparable: string }>;

function speechTokens(transcript: string): readonly SpeechToken[] {
  return (transcript.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(
    (raw) => ({
      raw,
      comparable: PROMPT_NUMBER_TOKENS[raw] ?? raw,
    }),
  );
}

function transcriptAfterPrompt(
  transcript: string,
  promptTranscript: string,
): string | null {
  const transcriptTokens = speechTokens(transcript);
  const promptTokens = speechTokens(promptTranscript);
  if (
    promptTokens.length === 0 ||
    transcriptTokens.length <= promptTokens.length
  ) {
    return null;
  }

  for (let index = 0; index < promptTokens.length; index += 1) {
    if (
      transcriptTokens[index]?.comparable !==
      promptTokens[index]?.comparable
    ) {
      return null;
    }
  }

  return transcriptTokens
    .slice(promptTokens.length)
    .map((token) => token.raw)
    .join(" ");
}

function transcriptContainsCompletePrompt(
  transcript: string,
  promptTranscript: string,
): boolean {
  const transcriptTokens = speechTokens(transcript);
  const promptTokens = speechTokens(promptTranscript);
  if (
    promptTokens.length === 0 ||
    transcriptTokens.length < promptTokens.length
  ) {
    return false;
  }

  return promptTokens.every(
    (token, index) =>
      transcriptTokens[index]?.comparable === token.comparable,
  );
}

function transcriptIsPromptNumber(
  transcript: string,
  promptTranscript: string,
): boolean {
  const candidateTokens = speechTokens(transcript);
  if (candidateTokens.length !== 1) return false;
  const candidate = candidateTokens[0]?.comparable;
  return speechTokens(promptTranscript).some(
    (token) => /^\d+$/.test(token.comparable) && token.comparable === candidate,
  );
}

function matchTranscript(
  transcript: string,
  confidence: number,
  isFinal: boolean,
): SpokenAnswerMatch | null {
  const answer = isFinal
    ? parseSpokenAnswer(transcript)
    : parseCanonicalSpokenAnswer(transcript);
  return answer === null
    ? null
    : { answer, confidence, transcript: transcript.trim() };
}

/**
 * Keeps one continuous recognition stream aligned with round boundaries.
 * Result slots first observed while the prompt is playing are trimmed from the
 * stream. New result slots can be accepted as soon as the gate opens, even if
 * the recognizer considers the prompt and answer one speech segment.
 */
export class SpokenAnswerStreamGate {
  readonly #ignoredResultIndexes = new Set<number>();
  readonly #lastTranscriptByResultIndex = new Map<number, string>();
  #roundId: string | null = null;
  #answerAccepted = false;
  #accepting = false;
  #bufferedAnswer: SpokenAnswerMatch | null = null;
  #promptTranscript: string | null = null;
  #observedCompletePrompt = false;
  #speechActive = false;
  #segmentBeganWhileClosed = false;

  beginRecognitionSession() {
    this.#ignoredResultIndexes.clear();
    this.#lastTranscriptByResultIndex.clear();
    this.#observedCompletePrompt = false;
    this.#speechActive = false;
    this.#segmentBeganWhileClosed = false;
  }

  beginPrompt(roundId: string, promptTranscript: string) {
    this.updateRound(roundId, false);
    this.#promptTranscript = promptTranscript;
    this.#bufferedAnswer = null;
    this.#observedCompletePrompt = false;
    this.#lastTranscriptByResultIndex.clear();
    if (this.#speechActive) this.#segmentBeganWhileClosed = true;
  }

  updateRound(roundId: string | null, accepting: boolean) {
    const roundChanged = roundId !== this.#roundId;
    const attemptOpened = accepting && (!this.#accepting || roundChanged);

    this.#roundId = roundId;
    if (roundChanged) {
      this.#answerAccepted = false;
      this.#bufferedAnswer = null;
      this.#promptTranscript = null;
      this.#observedCompletePrompt = false;
      this.#lastTranscriptByResultIndex.clear();
    } else if (attemptOpened) {
      this.#answerAccepted = false;
    }
    this.#accepting = accepting;
    if (!accepting && this.#speechActive) {
      this.#segmentBeganWhileClosed = true;
    }
  }

  speechStarted() {
    this.#speechActive = true;
    this.#segmentBeganWhileClosed = !this.#isArmed();
  }

  speechEnded() {
    this.#speechActive = false;
    // Preserve the segment origin until the next speechstart because result
    // events often arrive after speechend.
  }

  isListeningForAnswer() {
    return this.#isArmed();
  }

  read(event: SpeechResultEvent): SpokenAnswerMatch | null {
    if (!this.isListeningForAnswer()) {
      this.#observeUpdatedResults(event, true);
      return null;
    }

    const bufferedAnswer = this.takeBufferedAnswer();
    if (bufferedAnswer) {
      this.#ignoreUpdatedResults(event);
      return bufferedAnswer;
    }

    const trimmedMatch = this.#readTrimmedAnswer(event);
    const blockOldSegment =
      this.#segmentBeganWhileClosed && !this.#observedCompletePrompt;
    const match =
      trimmedMatch ??
      (blockOldSegment
        ? null
        : readStreamingSpokenAnswer(
            event,
            this.#ignoredResultIndexes,
            !this.#segmentBeganWhileClosed,
          ));
    if (match) {
      this.#acceptAnswer();
      this.#ignoreUpdatedResults(event);
      return match;
    }

    this.#observeUpdatedResults(event, this.#segmentBeganWhileClosed);
    return null;
  }

  takeBufferedAnswer(): SpokenAnswerMatch | null {
    if (!this.#isArmed() || !this.#bufferedAnswer) return null;
    const match = this.#bufferedAnswer;
    this.#bufferedAnswer = null;
    this.#acceptAnswer();
    return match;
  }

  peekBufferedAnswer(): SpokenAnswerMatch | null {
    return this.#isArmed() ? this.#bufferedAnswer : null;
  }

  #isArmed() {
    return (
      this.#roundId !== null &&
      this.#accepting &&
      !this.#answerAccepted
    );
  }

  #acceptAnswer() {
    this.#answerAccepted = true;
    this.#bufferedAnswer = null;
  }

  #readTrimmedAnswer(event: SpeechResultEvent): SpokenAnswerMatch | null {
    if (!this.#promptTranscript) return null;

    for (
      let resultIndex = event.resultIndex;
      resultIndex < event.results.length;
      resultIndex += 1
    ) {
      if (
        !this.#ignoredResultIndexes.has(resultIndex) &&
        !this.#segmentBeganWhileClosed
      ) {
        continue;
      }

      const result = event.results.item(resultIndex);
      if (!result) continue;
      // Every ranked alternative describes this same prompt-side slot. Only
      // its leading hypothesis can carry a prompt-plus-answer continuation;
      // lower alternatives must never masquerade as fresh speech.
      const alternative = result.item(0);
      if (!alternative) continue;

      const suffix = transcriptAfterPrompt(
        alternative.transcript,
        this.#promptTranscript,
      );
      if (suffix) {
        const match = matchTranscript(
          suffix,
          alternative.confidence,
          result.isFinal,
        );
        if (match) return match;
      }

      const previous =
        this.#lastTranscriptByResultIndex.get(resultIndex);
      if (
        ((previous &&
          transcriptContainsCompletePrompt(
            previous,
            this.#promptTranscript,
          )) ||
        (this.#observedCompletePrompt &&
          !transcriptContainsCompletePrompt(
            alternative.transcript,
            this.#promptTranscript,
          ))) &&
        !transcriptIsPromptNumber(
          alternative.transcript,
          this.#promptTranscript,
        )
      ) {
        const match = matchTranscript(
          alternative.transcript,
          alternative.confidence,
          result.isFinal,
        );
        if (match) return match;
      }
    }

    return null;
  }

  #observeUpdatedResults(
    event: SpeechResultEvent,
    markEveryResultIgnored: boolean,
  ) {
    for (
      let resultIndex = event.resultIndex;
      resultIndex < event.results.length;
      resultIndex += 1
    ) {
      if (markEveryResultIgnored) {
        this.#ignoredResultIndexes.add(resultIndex);
      } else if (!this.#ignoredResultIndexes.has(resultIndex)) {
        continue;
      }

      const result = event.results.item(resultIndex);
      const leading = result?.item(0);
      if (!result || !leading) continue;
      this.#lastTranscriptByResultIndex.set(
        resultIndex,
        leading.transcript,
      );

      if (
        this.#promptTranscript &&
        transcriptContainsCompletePrompt(
          leading.transcript,
          this.#promptTranscript,
        )
      ) {
        this.#observedCompletePrompt = true;
      }

      if (
        !this.#answerAccepted &&
        !this.#bufferedAnswer &&
        this.#promptTranscript
      ) {
        const suffix = transcriptAfterPrompt(
          leading.transcript,
          this.#promptTranscript,
        );
        if (suffix) {
          this.#bufferedAnswer = matchTranscript(
            suffix,
            leading.confidence,
            result.isFinal,
          );
        }
      }
    }
  }

  #ignoreUpdatedResults(event: SpeechResultEvent) {
    for (
      let resultIndex = event.resultIndex;
      resultIndex < event.results.length;
      resultIndex += 1
    ) {
      this.#ignoredResultIndexes.add(resultIndex);
    }
  }
}
