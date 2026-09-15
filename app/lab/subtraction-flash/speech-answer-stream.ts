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
 * Reads an answer as soon as it becomes the recognizer's leading hypothesis.
 * Final results may also use ranked alternatives, but an interim low-ranked
 * guess never becomes an answer.
 */
export function readStreamingSpokenAnswer(
  event: SpeechResultEvent,
  ignoredResultIndexes?: Readonly<{ has(value: number): boolean }>,
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

type SpeechToken = Readonly<{ raw: string; comparable: string }>;

function speechTokens(transcript: string): readonly SpeechToken[] {
  const rawTokens = transcript.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const tokens: SpeechToken[] = [];

  for (let index = 0; index < rawTokens.length; index += 1) {
    const raw = rawTokens[index];
    const next = rawTokens[index + 1];
    if (next) {
      const phrase = `${raw} ${next}`;
      const phraseNumber = parseCanonicalSpokenAnswer(phrase);
      if (phraseNumber !== null) {
        tokens.push({ raw: phrase, comparable: String(phraseNumber) });
        index += 1;
        continue;
      }
    }

    const number = parseSpokenAnswer(raw);
    tokens.push({
      raw,
      comparable: number === null ? raw : String(number),
    });
  }

  return tokens;
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
  // Final results keep their slot for the life of a recognition session, but
  // browsers may overwrite or remove interim slots. Remember which round last
  // owned each ignored slot so a later answer segment can safely reuse it.
  readonly #ignoredResultIndexes = new Map<
    number,
    Readonly<{ isFinal: boolean; roundId: string | null }>
  >();
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
    const armed = this.#isArmed();
    if (armed) {
      for (const [resultIndex, ignored] of this.#ignoredResultIndexes) {
        if (ignored.isFinal || ignored.roundId === this.#roundId) continue;
        // This non-final slot belongs to an older card and the current prompt
        // did not update it. It is now available to the fresh answer segment.
        this.#ignoredResultIndexes.delete(resultIndex);
        this.#lastTranscriptByResultIndex.delete(resultIndex);
      }
    }
    this.#speechActive = true;
    this.#segmentBeganWhileClosed = !armed;
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
    this.#forgetRemovedResults(event.results.length);
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
      const result = event.results.item(resultIndex);
      if (markEveryResultIgnored) {
        if (!result) continue;
        this.#ignoredResultIndexes.set(resultIndex, {
          isFinal: result.isFinal,
          roundId: this.#roundId,
        });
      } else if (!this.#ignoredResultIndexes.has(resultIndex)) {
        continue;
      }

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
      const result = event.results.item(resultIndex);
      if (!result) continue;
      this.#ignoredResultIndexes.set(resultIndex, {
        isFinal: result.isFinal,
        roundId: this.#roundId,
      });
    }
  }

  #forgetRemovedResults(resultCount: number) {
    // The Web Speech API may shrink trailing interim results. A later interim
    // can then reuse the vacated index within the same recognition session.
    for (const resultIndex of this.#ignoredResultIndexes.keys()) {
      if (resultIndex < resultCount) continue;
      this.#ignoredResultIndexes.delete(resultIndex);
      this.#lastTranscriptByResultIndex.delete(resultIndex);
    }
  }
}
