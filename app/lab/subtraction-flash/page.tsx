"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  createGameAudioContext,
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import { createGameNarrationPlayer } from "@/lib/game-narration";

import {
  ANSWER_VALUES,
  buildAnswerOptions,
  createSubtractionDeck,
  type AnswerValue,
  type DeckDraw,
  type PracticeMode,
  type SubtractionDeck,
} from "./game-engine";
import {
  SUBTRACTION_QUESTION_NARRATION,
  subtractionNarrationCueId,
} from "./question-narration";
import styles from "./subtraction-flash.module.css";

type RoundState = Readonly<{
  draw: DeckDraw;
  selectedAnswer: AnswerValue | null;
  correct: boolean | null;
  startedAt: number | null;
}>;

type ModeRounds = Record<PracticeMode, RoundState | null>;

const RESULT_FLASH_MS = 520;

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14.5 5 7.5 12l7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CardsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="5"
        y="4"
        width="14"
        height="16"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M9 9h6M9 13h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 10v4h3l4 3V7l-4 3H5Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M15 9.1c1.2.9 1.8 1.8 1.8 2.9s-.6 2-1.8 2.9M17.7 6.8c2 1.5 3 3.2 3 5.2s-1 3.7-3 5.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SoundIcon({ enabled }: Readonly<{ enabled: boolean }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 10v4h3l4 3V7l-4 3h-3Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {enabled ? (
        <path
          d="M14.5 9.2c1 .8 1.5 1.7 1.5 2.8s-.5 2-1.5 2.8M17 7c1.8 1.4 2.7 3 2.7 5s-.9 3.6-2.7 5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="m15 9 5 6m0-6-5 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function VisualProblem({ round }: Readonly<{ round: RoundState }>) {
  const { card } = round.draw;
  const accessibleProblem =
    card.orientation === "horizontal"
      ? `${card.minuend} minus ${card.subtrahend} equals`
      : `Vertical subtraction: ${card.minuend} minus ${card.subtrahend}`;

  return (
    <div className={styles.questionCard} aria-label={accessibleProblem}>
      <span className={styles.visuallyHidden}>{accessibleProblem}</span>
      {card.orientation === "horizontal" ? (
        <div className={styles.horizontalProblem} aria-hidden="true">
          <span>{card.minuend}</span>
          <span className={styles.operator}>−</span>
          <span>{card.subtrahend}</span>
          <span className={styles.equalsMark}>=</span>
        </div>
      ) : (
        <div className={styles.verticalProblem} aria-hidden="true">
          <span className={styles.verticalTop}>{card.minuend}</span>
          <span className={styles.verticalOperator}>−</span>
          <span className={styles.verticalBottom}>{card.subtrahend}</span>
          <span className={styles.verticalRule} />
        </div>
      )}
    </div>
  );
}

function newRound(draw: DeckDraw, mode: PracticeMode): RoundState {
  return {
    draw,
    selectedAnswer: null,
    correct: null,
    startedAt: mode === "visual" ? performance.now() : null,
  };
}

export default function SubtractionFlashPage() {
  const [mode, setMode] = useState<PracticeMode>("visual");
  const [rounds, setRounds] = useState<ModeRounds>({
    visual: null,
    listen: null,
  });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const modeRef = useRef<PracticeMode>("visual");
  const soundEnabledRef = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackTokenRef = useRef(0);
  const answerButtonRefs = useRef<
    Partial<Record<AnswerValue, HTMLButtonElement | null>>
  >({});

  const [narrationPlayer] = useState(() =>
    createGameNarrationPlayer(SUBTRACTION_QUESTION_NARRATION),
  );
  const [decks] = useState<Record<PracticeMode, SubtractionDeck>>(() => ({
    visual: createSubtractionDeck({ mode: "visual" }),
    listen: createSubtractionDeck({ mode: "listen" }),
  }));

  const currentRound = rounds[mode];
  const answerOptions = currentRound
    ? buildAnswerOptions(currentRound.draw.card)
    : ANSWER_VALUES;
  const answerReady =
    currentRound !== null &&
    currentRound.selectedAnswer === null &&
    (mode === "visual" ||
      (currentRound.startedAt !== null && !isSpeaking));

  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = createGameAudioContext();
    }
    return audioContextRef.current;
  }, []);

  const playEarcon = useCallback(
    (correct: boolean) => {
      if (!soundEnabledRef.current) return;
      const context = ensureAudioContext();
      if (!context) return;

      if (context.state === "suspended") {
        void context
          .resume()
          .then(() => playFeedbackEarcon(context, correct))
          .catch(() => undefined);
        return;
      }
      playFeedbackEarcon(context, correct);
    },
    [ensureAudioContext],
  );

  const markListeningRoundReady = useCallback((cardId: string) => {
    if (modeRef.current !== "listen") return;

    setRounds((previous) => {
      const listeningRound = previous.listen;
      if (
        !listeningRound ||
        listeningRound.draw.card.id !== cardId ||
        listeningRound.selectedAnswer !== null ||
        listeningRound.startedAt !== null
      ) {
        return previous;
      }

      return {
        ...previous,
        listen: {
          ...listeningRound,
          startedAt: performance.now(),
        },
      };
    });
  }, []);

  const speakQuestion = useCallback(
    (round: RoundState) => {
      if (!soundEnabledRef.current || round.selectedAnswer !== null) return;

      const playbackToken = playbackTokenRef.current + 1;
      playbackTokenRef.current = playbackToken;
      setIsSpeaking(true);
      narrationPlayer.prime();

      void narrationPlayer
        .play([subtractionNarrationCueId(round.draw.card)])
        .then((result) => {
          if (playbackTokenRef.current !== playbackToken) return;
          setIsSpeaking(false);
          if (result.status === "completed") {
            markListeningRoundReady(round.draw.card.id);
          }
        })
        .catch(() => {
          if (playbackTokenRef.current !== playbackToken) return;
          setIsSpeaking(false);
          markListeningRoundReady(round.draw.card.id);
        });
    },
    [markListeningRoundReady, narrationPlayer],
  );

  const stopSpeaking = useCallback(() => {
    playbackTokenRef.current += 1;
    narrationPlayer.cancel();
    setIsSpeaking(false);
  }, [narrationPlayer]);

  const handleAnswer = useCallback(
    (answer: AnswerValue) => {
      const round = rounds[mode];
      const deck = decks[mode];
      if (!round || round.selectedAnswer !== null || !answerReady) {
        return;
      }

      const correct = answer === round.draw.card.answer;
      const elapsedMs =
        round.startedAt === null
          ? 0
          : Math.max(0, performance.now() - round.startedAt);
      deck.recordOutcome(round.draw.card, { correct, elapsedMs });

      if (mode === "listen") stopSpeaking();
      setRounds((previous) => ({
        ...previous,
        [mode]: {
          ...round,
          selectedAnswer: answer,
          correct,
        },
      }));
      playEarcon(correct);
    },
    [answerReady, decks, mode, playEarcon, rounds, stopSpeaking],
  );

  const advanceRound = useCallback(() => {
    const deck = decks[mode];

    stopSpeaking();
    const round = newRound(deck.next(), mode);
    setRounds((previous) => ({ ...previous, [mode]: round }));
    if (mode === "listen") speakQuestion(round);
  }, [decks, mode, speakQuestion, stopSpeaking]);

  const handleModeChange = useCallback(
    (nextMode: PracticeMode) => {
      if (nextMode === mode) return;
      const deck = decks[nextMode];

      stopSpeaking();
      modeRef.current = nextMode;
      setMode(nextMode);

      let targetRound = rounds[nextMode];
      if (!targetRound || targetRound.selectedAnswer !== null) {
        targetRound = newRound(deck.next(), nextMode);
      } else {
        targetRound = {
          ...targetRound,
          startedAt: nextMode === "visual" ? performance.now() : null,
        };
      }

      setRounds((previous) => ({
        ...previous,
        [nextMode]: targetRound,
      }));
      if (nextMode === "listen" && targetRound.selectedAnswer === null) {
        speakQuestion(targetRound);
      }
    },
    [decks, mode, rounds, speakQuestion, stopSpeaking],
  );

  const handleSoundToggle = useCallback(() => {
    const enabled = !soundEnabledRef.current;
    soundEnabledRef.current = enabled;
    setSoundEnabled(enabled);
    writeSoundPreference(enabled);
    narrationPlayer.setEnabled(enabled);

    if (!enabled) {
      stopSpeaking();
      return;
    }

    const context = ensureAudioContext();
    if (context?.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
    const listeningRound = rounds.listen;
    if (
      mode === "listen" &&
      listeningRound &&
      listeningRound.selectedAnswer === null
    ) {
      speakQuestion(listeningRound);
    }
  }, [
    ensureAudioContext,
    mode,
    narrationPlayer,
    rounds.listen,
    speakQuestion,
    stopSpeaking,
  ]);

  useEffect(() => {
    const enabled = readSoundPreference();
    if (enabled) return;
    const timer = window.setTimeout(() => {
      soundEnabledRef.current = false;
      setSoundEnabled(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    narrationPlayer.setEnabled(soundEnabled);
  }, [narrationPlayer, soundEnabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRounds({
        visual: newRound(decks.visual.next(), "visual"),
        listen: null,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [decks]);

  useEffect(() => {
    return () => {
      narrationPlayer.dispose();
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    };
  }, [narrationPlayer]);

  useEffect(() => {
    if (!currentRound) return;

    const frame = requestAnimationFrame(() => {
      if (answerReady) {
        answerButtonRefs.current[ANSWER_VALUES[0]]?.focus();
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [answerReady, currentRound]);

  useEffect(() => {
    if (!currentRound || currentRound.selectedAnswer === null) return;

    const answeredMode = mode;
    const timer = window.setTimeout(() => {
      if (modeRef.current === answeredMode) {
        advanceRound();
      }
    }, RESULT_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [advanceRound, currentRound, mode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") ||
          target.isContentEditable)
      ) {
        return;
      }

      const answer = Number(event.key);
      if (!ANSWER_VALUES.includes(answer as AnswerValue)) return;
      event.preventDefault();
      handleAnswer(answer as AnswerValue);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleAnswer]);

  const answerState = (answer: AnswerValue) => {
    if (!currentRound || currentRound.selectedAnswer === null) return "idle";
    if (answer === currentRound.selectedAnswer) {
      return currentRound.correct ? "correct" : "incorrect";
    }
    return "muted";
  };

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.backLink} href="/" aria-label="All games">
          <ArrowLeftIcon />
        </Link>

        <nav className={styles.modeSwitch} aria-label="Practice style">
          <button
            className={styles.modeButton}
            type="button"
            aria-pressed={mode === "visual"}
            onClick={() => handleModeChange("visual")}
          >
            <CardsIcon />
            Cards
          </button>
          <button
            className={styles.modeButton}
            type="button"
            aria-pressed={mode === "listen"}
            onClick={() => handleModeChange("listen")}
          >
            <SpeakerIcon />
            Listen
          </button>
        </nav>

        <button
          className={styles.soundButton}
          type="button"
          aria-pressed={soundEnabled}
          aria-label={`Sound ${soundEnabled ? "on" : "off"}. Toggle sound.`}
          onClick={handleSoundToggle}
        >
          <SoundIcon enabled={soundEnabled} />
        </button>
      </header>

      <main className={styles.main}>
        <section className={styles.board} aria-labelledby="game-heading">
          <h1 className={styles.visuallyHidden} id="game-heading">
            Borrow Flash
          </h1>
          <div className={styles.promptArea}>
            {!currentRound ? (
              <div className={styles.loadingCard} aria-label="Shuffling cards" />
            ) : mode === "visual" ? (
              <VisualProblem round={currentRound} />
            ) : (
              <button
                className={`${styles.listeningCard} ${
                  isSpeaking ? styles.speaking : ""
                }`}
                type="button"
                aria-label={
                  !soundEnabled
                    ? "Sound is off"
                    : isSpeaking
                      ? "Playing subtraction question"
                      : "Replay subtraction question"
                }
                disabled={
                  !soundEnabled ||
                  isSpeaking ||
                  currentRound.selectedAnswer !== null
                }
                onClick={() => speakQuestion(currentRound)}
              >
                <span className={styles.speakerOrb}>
                  <SpeakerIcon />
                </span>
                {!soundEnabled ? (
                  <span className={styles.listeningState}>Sound off</span>
                ) : null}
              </button>
            )}

            <div
              className={`${styles.resultFlash} ${
                currentRound?.correct === true
                  ? styles.resultCorrect
                  : currentRound?.correct === false
                    ? styles.resultIncorrect
                    : ""
              }`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {currentRound?.correct !== null &&
              currentRound?.correct !== undefined ? (
                <>
                  <span className={styles.resultSymbol} aria-hidden="true">
                    {currentRound.correct ? "✓" : "×"}
                  </span>
                  {currentRound.correct ? "Correct" : "Incorrect"}
                </>
              ) : null}
            </div>
          </div>

          <section
            className={styles.answerSection}
            aria-labelledby="answer-heading"
          >
            <h2 className={styles.visuallyHidden} id="answer-heading">
              Choose the answer
            </h2>
            <div className={styles.answerGrid}>
              {answerOptions.map((answer) => {
                const state = answerState(answer);
                const selected = currentRound?.selectedAnswer === answer;
                const stateLabel =
                  state === "correct"
                    ? ", correct"
                    : state === "incorrect"
                      ? ", incorrect"
                      : "";

                return (
                  <button
                    key={answer}
                    ref={(node) => {
                      answerButtonRefs.current[answer] = node;
                    }}
                    className={styles.answerButton}
                    type="button"
                    data-state={state}
                    disabled={!answerReady}
                    aria-keyshortcuts={String(answer)}
                    aria-label={`${answer}${stateLabel}`}
                    aria-pressed={selected}
                    onClick={() => handleAnswer(answer)}
                  >
                    {answer}
                  </button>
                );
              })}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
